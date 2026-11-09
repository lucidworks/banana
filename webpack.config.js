'use strict';

/*
 * Build for Banana. `npm run build` bundles src/ into dist/, `npm run dev` serves it.
 *
 * Banana's modules are written in AMD (define/require), and webpack reads that natively. What the
 * old RequireJS build did, and this file replaces:
 *   - `paths` become `resolve.alias`; `shim` becomes the loader rules below (tools/webpack/vendor-loader.js)
 *   - the `text!` and `css!` plugin prefixes in module ids are removed, and the files they point to
 *     are loaded as text (asset/source) and as CSS (style-loader)
 *   - panels and their templates are loaded on demand, one chunk each (src/app/components/lazy-require.js)
 *   - config.js, the Solr preset and the other files an operator may edit are copied unchanged
 *   - AngularJS 1.0.8 injects by parameter name, so modules are annotated before they are minified
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const { LicenseWebpackPlugin } = require('license-webpack-plugin');
const { renderLicenses } = require('./tools/webpack/licenses');

const root = __dirname;
const version = require('./package.json').version;
const src = path.resolve(root, 'src');
const v = (p) => path.join(src, 'vendor', p);

// The module ids that the application and the panels use (the old require.config.js `paths`).
const alias = {
  settings: path.join(src, 'app/components/settings'),
  kbn: path.join(src, 'app/components/kbn'),
  // config.js itself stays a separate file; this module hands its settings to the bundle
  config: path.join(src, 'app/components/config-bridge'),
  moment: v('moment'),
  filesaver: v('filesaver'),

  angular: v('angular/angular'),
  'angular-dragdrop': v('angular/angular-dragdrop'),
  'angular-strap': v('angular/angular-strap'),
  'angular-sanitize': v('angular/angular-sanitize'),
  'angular-mocks': v('angular/angular-mocks'),  // used by the unit tests only
  timepicker: v('angular/timepicker'),
  datepicker: v('angular/datepicker'),

  underscore: path.join(src, 'app/components/underscore.extended'),
  'underscore-src': v('underscore'),
  bootstrap: v('bootstrap/bootstrap'),

  jquery: v('jquery/jquery-3.7.1'),
  'jquery-ui': v('jquery/jquery-ui-1.10.3'),
  'extend-jquery': path.join(src, 'app/components/extend-jquery'),

  'jquery.flot': v('jquery/jquery.flot'),
  'jquery.flot.pie': v('jquery/jquery.flot.pie'),
  'jquery.flot.selection': v('jquery/jquery.flot.selection'),
  'jquery.flot.stack': v('jquery/jquery.flot.stack'),
  'jquery.flot.stackpercent': v('jquery/jquery.flot.stackpercent'),
  'jquery.flot.time': v('jquery/jquery.flot.time'),
  'jquery.flot.axislabels': v('jquery/jquery.flot.axislabels'),
  showdown: v('showdown'),

  modernizr: v('modernizr-2.6.1'),
  elasticjs: v('elasticjs/elastic-angular-client'),
  solrjs: v('solrjs/solr-angular-client'),
  d3: v('d3'),
  // vis and x2js come from npm (node_modules), as 'vis' and 'x2js'
  'd3-sankey': v('d3-sankey'),
  'd3-array': v('d3-array'),
  'd3-collection': v('d3-collection'),
  'd3-shape': v('d3-shape'),
  'd3-path': v('d3-path'),
  'd3-force': v('d3-force'),
  'd3-quadtree': v('d3-quadtree'),
  'd3-dispatch': v('d3-dispatch'),
  'd3-timer': v('d3-timer'),
  d3v5: v('d3v5')
};

// Classic scripts that need the equivalent of a RequireJS `shim` entry (the old `shim` block):
// [file, ids that must load first, global the script creates, options]
// `expr` is the expression to export when the script keeps its object in a local variable.
// Libraries written as UMD (the d3-* family, d3v5, d3.tip, vis, x2js) are not listed: webpack reads
// their AMD or CommonJS branch, which is what RequireJS did with them.
const shimTable = [
  [alias.jquery, [], 'jQuery'],
  [alias['underscore-src'], [], '_'],
  [alias.bootstrap, ['jquery'], null],
  [alias.modernizr, [], 'Modernizr'],
  [alias['jquery-ui'], ['jquery'], null],
  [alias.angular, ['jquery'], 'angular'],
  [alias['angular-mocks'], ['angular'], null],  // unit tests only; never reached from the application
  [alias['angular-sanitize'], ['angular'], null],
  [alias['angular-dragdrop'], ['jquery', 'jquery-ui', 'angular'], null],
  [alias.timepicker, ['jquery', 'bootstrap'], null],
  [alias.datepicker, ['jquery', 'bootstrap'], null],
  [alias['angular-strap'], ['angular', 'bootstrap', 'timepicker', 'datepicker'], null],
  [v('elasticjs/elastic'), [], 'ejs'],
  [v('solrjs/solr'), [], 'sjs'],
  [alias.elasticjs, ['angular', v('elasticjs/elastic')], null],
  [alias.solrjs, ['angular', v('solrjs/solr')], null],
  [alias.filesaver, [], 'saveAs', { expr: 'saveAs' }],
  [alias.moment, [], 'moment'],
  [alias.showdown, [], 'Showdown', { expr: 'Showdown' }],
  [path.join(src, 'app/panels/text/lib/showdown'), [], 'Showdown', { expr: 'Showdown' }],
  [alias.d3, [], 'd3'],
  [alias['jquery.flot'], ['jquery'], null],
  [alias['jquery.flot.pie'], ['jquery', 'jquery.flot'], null],
  [alias['jquery.flot.selection'], ['jquery', 'jquery.flot'], null],
  [alias['jquery.flot.stack'], ['jquery', 'jquery.flot'], null],
  [alias['jquery.flot.stackpercent'], ['jquery', 'jquery.flot'], null],
  [alias['jquery.flot.time'], ['jquery', 'jquery.flot'], null],
  [alias['jquery.flot.axislabels'], ['jquery', 'jquery.flot'], null],
  // Leaflet creates the global L only when no module system is detected, and its plugins need it
  [path.join(src, 'app/panels/bettermap/leaflet/leaflet-src'), [], 'L'],
  [path.join(src, 'app/panels/bettermap/leaflet/plugins'), [path.join(src, 'app/panels/bettermap/leaflet/leaflet-src')], null],
  [path.join(src, 'app/panels/map/lib/jquery.jvectormap.min'), ['jquery'], null]
].map(([file, deps, global, opts = {}]) => ({
  file: file.replace(/\.js$/, ''),
  options: {
    shim: true,
    deps: deps.map((d) => alias[d] || d),
    global,
    expr: opts.expr
  }
}));
const shimByFile = new Map(shimTable.map((s) => [s.file, s.options]));

// Vendored libraries: their licence headers are carried into the build output (see tools/vendor-licenses.json).
const vendorManifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/vendor-licenses.json'), 'utf8'));
const vendored = vendorManifest.libraries;
const vendoredFiles = new Set(vendored.map((l) => path.join(root, l.path).replace(/\.js$/, '')));
const bare = (file) => file.replace(/\.js$/, '');

// Files that use AngularJS implicit injection (the old ngmin step) and live outside src/app.
const annotateVendored = [
  alias['angular-dragdrop'], alias['angular-strap'], alias['angular-sanitize'], alias.elasticjs, alias.solrjs
].map(bare);

// Adds a cache-busting stamp to the application entry script in index.html, so that browsers fetch a new
// bundle after an upgrade. The chunks already carry a content hash in their file names.
class EntryStampPlugin {
  apply(compiler) {
    const { RawSource } = webpack.sources;
    compiler.hooks.thisCompilation.tap('EntryStampPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'EntryStampPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          const entry = compilation.getAsset('app/app.js');
          const index = compilation.getAsset('index.html');
          if (!entry || !index) { return; }
          const stamp = crypto.createHash('sha256').update(entry.source.source()).digest('hex').slice(0, 10);
          const html = index.source.source().toString().replace(/src="app\/app\.js"/, 'src="app/app.js?v=' + stamp + '"');
          compilation.updateAsset('index.html', new RawSource(html));
        }
      );
    });
  }
}

module.exports = (env, argv) => ({
  context: src,
  entry: { app: './app/app.js' },
  output: {
    path: path.resolve(root, 'dist'),
    // asset and chunk URLs are relative to the entry script, so dist/ works under /, /banana/ and /admin/banana/
    publicPath: 'auto',
    filename: 'app/[name].js',
    chunkFilename: 'app/chunks/[name].[contenthash:8].js',
    assetModuleFilename: 'app/assets/[name].[contenthash:8][ext]',
    clean: true
  },
  resolve: {
    alias,
    // module ids such as 'services/all' and 'components/kbn' are relative to src/app
    modules: [path.join(src, 'app'), 'node_modules']
  },
  module: {
    // The ids in define() lists keep the old require.js syntax; the prefixes are removed below.
    rules: [
      // Vendored files: keep the licence header, and run classic scripts like a RequireJS shim.
      // (Listed before the annotation rule, so that the annotation runs first.)
      {
        test: (file) => vendoredFiles.has(bare(file)),
        use: (info) => ({
          loader: path.resolve(root, 'tools/webpack/vendor-loader.js'),
          options: shimByFile.get(bare(info.resource)) || { shim: false }
        })
      },
      // AngularJS 1.0.8 injects by parameter name: annotate the injectable functions before the minifier renames them.
      // Without this the build still succeeds, and the page fails at run time with "Unknown provider".
      {
        test: /\.js$/,
        include: [path.join(src, 'app'), ...annotateVendored.map((f) => f + '.js')],
        exclude: [(file) => vendoredFiles.has(bare(file)) && !annotateVendored.includes(bare(file)), /[\\/]panels[\\/]map[\\/]lib[\\/]/],
        use: [{
          loader: 'babel-loader',
          options: { babelrc: false, configFile: false, sourceType: 'script', plugins: ['angularjs-annotate'] }
        }]
      },
      { test: /\.html$/, type: 'asset/source' },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.(png|gif|jpe?g|svg)$/, type: 'asset/resource' }
    ]
  },
  plugins: [
    // 'text!panels/x/module.html' and 'css!./module.css' become plain relative ids
    new webpack.NormalModuleReplacementPlugin(/^(text|css)!/, (r) => { r.request = r.request.replace(/^(text|css)!/, ''); }),
    new CopyPlugin({
      patterns: [
        { from: 'index.html' },
        // Files an operator edits or replaces: copied byte for byte. `minimized` keeps the minifier away from them.
        { from: 'config.js', info: { minimized: true } },
        { from: 'config.solr.js', info: { minimized: true } },
        { from: 'config-boot.js', info: { minimized: true } },
        { from: 'vendor/xhr-xdr-adapter.js', to: 'vendor/xhr-xdr-adapter.js', info: { minimized: true } },
        { from: 'css', to: 'css' },
        { from: 'img', to: 'img' },
        { from: 'font', to: 'font' },
        // The licence of the Font Awesome font must accompany the font files.
        { from: path.join(root, 'licenses/fontawesome-OFL.txt'), to: 'font/OFL.txt', info: { minimized: true } },
        // The licence, the notice and the licence texts of third-party code (see NOTICE)
        { from: path.join(root, 'LICENSE'), to: '[name][ext]', info: { minimized: true } },
        { from: path.join(root, 'NOTICE'), to: '[name][ext]', info: { minimized: true } },
        { from: path.join(root, 'licenses'), to: 'licenses', info: { minimized: true } },
        { from: 'app/dashboards', to: 'app/dashboards' },
        // The version in package.json is the only place the version number is written: the partials carry the
        // placeholder __BANANA_VERSION__, which the build replaces.
        {
          from: 'app/partials',
          to: 'app/partials',
          transform: (content, file) => (file.endsWith('.html')
            ? Buffer.from(content.toString().split('__BANANA_VERSION__').join(version))
            : content)
        },
        // Files that the application fetches at run time by URL (editor.html, micropanel.html, leaflet images, ...).
        // Scripts, stylesheets and module.html are bundled instead.
        {
          from: 'app/panels',
          to: 'app/panels',
          globOptions: { ignore: ['**/*.js', '**/*.css', '**/module.html'] }
        }
      ]
    }),
    new EntryStampPlugin(),
    new LicenseWebpackPlugin({
      outputFilename: 'THIRD-PARTY-LICENSES.txt',
      excludedPackageTest: (name) => name === require('./package.json').name,
      perChunkOutput: false,
      renderLicenses: (modules) => renderLicenses(modules, vendored, root, vendorManifest.embedded)
    })
  ],
  optimization: { splitChunks: false },
  performance: { hints: false },
  devtool: argv.mode === 'development' ? 'eval-source-map' : false,
  devServer: {
    static: false,
    // listen on the local machine only; set BANANA_DEV_HOST (for example 0.0.0.0) to listen on every interface
    host: process.env.BANANA_DEV_HOST || '127.0.0.1',
    hot: false,
    liveReload: false,
    client: { overlay: false },
    // serve the build under a base path such as /admin/banana/
    devMiddleware: { publicPath: process.env.BANANA_DEV_PREFIX || '/' }
  }
});
