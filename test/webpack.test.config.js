'use strict';

/*
 * The webpack configuration for the unit tests: the build's own configuration (aliases, vendored-script
 * shims, AngularJS annotation, text and css handling), without the parts that only produce dist/
 * (entry, output, file copying, licence report, dev server).
 */

const path = require('path');
const webpack = require('webpack');
const buildConfig = require('../webpack.config.js')({}, { mode: 'development' });

// `npm run test:coverage` (test/karma.coverage.conf.js) sets COVERAGE. The services are then instrumented
// before the annotation step reads them, so the counts refer to the lines of the source files.
const root = path.resolve(__dirname, '..');
const instrument = process.env.COVERAGE ? [{
  test: /\.js$/,
  enforce: 'pre',
  include: [path.join(root, 'src/app/services')],
  use: [{
    loader: 'babel-loader',
    options: {
      babelrc: false,
      configFile: false,
      sourceType: 'script',
      plugins: [[require.resolve('babel-plugin-istanbul'), { cwd: root, include: ['src/app/services/**/*.js'] }]]
    }
  }]
}] : [];

module.exports = {
  mode: 'development',
  devtool: false,
  context: buildConfig.context,
  // `app` (app.js) bootstraps the whole page when it loads, so the panels get a stand-in that only
  // registers their modules, which the specs then load into an injector.
  resolve: Object.assign({}, buildConfig.resolve, {
    alias: Object.assign({}, buildConfig.resolve.alias, { app$: path.join(__dirname, 'unit/helpers/app-stub.js') })
  }),
  module: instrument.length ? Object.assign({}, buildConfig.module, { rules: instrument.concat(buildConfig.module.rules) }) : buildConfig.module,
  // keep only the plugin that strips the text! and css! prefixes from module ids
  plugins: buildConfig.plugins.filter((p) => p instanceof webpack.NormalModuleReplacementPlugin),
  performance: { hints: false }
};
