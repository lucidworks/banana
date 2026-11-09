#!/usr/bin/env node
'use strict';

/*
 * Checks the output of `webpack` (dist/) against the source tree. `npm run build` runs it after webpack.
 *
 * A bundler exits 0 even when a module was left out, so the build output is compared with what the
 * source says it should contain:
 *   - panels:     every name in `panel_names` of config.js, and every directory under src/app/panels, has its
 *                 module chunk, and its module.html template chunk where the panel has one
 *   - files:      the files that are fetched by URL at run time (panel editors, partials, dashboards) are present
 *   - config:     config.js and config.solr.js are in dist/ and byte-identical to src/
 *   - paths:      index.html and the bundle use relative URLs only
 *   - annotation: the panel chunks carry AngularJS injection annotations (without them the page fails at run time)
 *   - eval:       no script in the output calls eval( (the `new Function` that underscore templates and d3 use is
 *                 not checked)
 *   - licences:   every vendored library in tools/vendor-licenses.json is listed in THIRD-PARTY-LICENSES.txt and keeps
 *                 its header in the output (inline in the scripts or in a .LICENSE.txt file; a manifest entry may
 *                 set "listedOnly" to accept the copy in THIRD-PARTY-LICENSES.txt instead), every file under src/vendor
 *                 that has a licence header is listed in that manifest, and the bundled npm packages are credited
 *   - stated:     every shipped manifest entry, and every embedded one, names a licence: an entry whose "license" is empty
 *                 or says that none is stated fails the check, so a file of unknown terms cannot ship unnoticed
 *   - legal:      LICENSE (the Apache License 2.0 text) and NOTICE are in dist/ unchanged, every file in licenses/ is in
 *                 dist/licenses/ unchanged, the Font Awesome font has its licence next to it in dist/font/OFL.txt
 *                 (unchanged), and the "embedded" entries of the manifest (code inside a prebuilt bundle or a compiled
 *                 stylesheet) still match their container and have a licence text that names the holder
 *
 * Usage: node tools/check-dist.js [--dist dist] [--src src]      Exit code 1 when anything is wrong.
 */

const fs = require('fs');
const path = require('path');
const { panelNamesFromConfig } = require('./lib/panel-names');
const { splitLeading } = require('./webpack/vendor-loader');

function walk(dir, filter, out) {
  out = out || [];
  if (!fs.existsSync(dir)) { return out; }
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, filter, out); }
    else if (!filter || filter(full)) { out.push(full); }
  });
  return out;
}

function read(file) { return fs.readFileSync(file, 'utf8'); }

// The text that identifies a file's notice: the first meaningful line of its leading comments.
function headerMarker(text) {
  const comments = splitLeading(text);
  for (let i = 0; i < comments.length; i++) {
    const lines = comments[i].text.split('\n');
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].replace(/^\s*(\/\*[!*]?|\*\/|\*|\/\/)+/, '').replace(/\*\/\s*$/, '').replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]/.test(line) && !/^(global|jslint|jshint|eslint)\b/.test(line)) { return line.slice(0, 80); }
    }
  }
  return null;
}

// Does the "license" of a manifest entry state a licence? An empty text, or one that says the terms are not stated or
// not known, does not.
function licenceStated(text) {
  if (typeof text !== 'string' || !/[A-Za-z]/.test(text)) { return false; }
  return !/\b(not|never|no)\b[^;.,(]{0,40}\b(stated|known|recorded|identified|specified)\b|\bno licen[cs]e\b|\bunlicen[cs]ed\b|\bunknown\b|\bwithout a licen[cs]e\b/i.test(text);
}

// Does the leading comment of a file look like a copyright or licence notice?
function hasLicenceHeader(text) {
  return splitLeading(text).some((c) => /copyright|\(c\)|licen[sc]e|\bMIT\b|\bBSD\b|apache/i.test(c.text));
}

function checkDist(opts) {
  const root = path.resolve(opts.root);
  const dist = path.resolve(root, opts.dist || 'dist');
  const src = path.resolve(root, opts.src || 'src');
  const problems = [];
  const notes = [];
  const fail = (msg) => problems.push(msg);

  if (!fs.existsSync(path.join(dist, 'index.html')) || !fs.existsSync(path.join(dist, 'app', 'app.js'))) {
    fail('dist has no index.html or app/app.js: the build did not run');
    return { problems, notes };
  }

  // ---- panels ----
  const configText = read(path.join(src, 'config.js'));
  const listed = panelNamesFromConfig(configText);
  const panelsDir = path.join(src, 'app', 'panels');
  const onDisk = fs.readdirSync(panelsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(panelsDir, e.name, 'module.js')))
    .map((e) => e.name);
  const chunkDir = path.join(dist, 'app', 'chunks');
  const chunks = fs.existsSync(chunkDir) ? fs.readdirSync(chunkDir) : [];
  const chunkFor = (name, suffix) => chunks.filter((c) => new RegExp('^panel-' + name + '-module' + suffix + '\\.[0-9a-f]{8}\\.js$').test(c))[0];
  listed.forEach((name) => {
    if (onDisk.indexOf(name) === -1) { fail('config.js lists the panel "' + name + '", but src/app/panels/' + name + '/module.js does not exist'); }
  });
  onDisk.forEach((name) => {
    const module = chunkFor(name, '');
    if (!module) { fail('panel "' + name + '": no module chunk in dist/app/chunks'); }
    else if (fs.statSync(path.join(chunkDir, module)).size < 100) { fail('panel "' + name + '": module chunk ' + module + ' is empty'); }
    if (fs.existsSync(path.join(panelsDir, name, 'module.html')) && !chunkFor(name, '-html')) {
      fail('panel "' + name + '": its module.html template is not in the build');
    }
  });
  notes.push('panels: ' + onDisk.length + ' on disk, ' + listed.length + ' listed in config.js, ' + (problems.length ? 'see the problems below' : 'all present in the build'));

  // ---- files fetched by URL at run time ----
  const runtimeFiles = [];
  walk(panelsDir, (f) => /\.html$/.test(f) && path.basename(f) !== 'module.html').forEach((f) => runtimeFiles.push(f));
  walk(path.join(src, 'app', 'partials')).forEach((f) => runtimeFiles.push(f));
  walk(path.join(src, 'app', 'dashboards')).forEach((f) => runtimeFiles.push(f));
  walk(path.join(panelsDir, 'bettermap', 'leaflet', 'images')).forEach((f) => runtimeFiles.push(f));
  ['img', 'css', 'font'].forEach((d) => walk(path.join(src, d)).forEach((f) => runtimeFiles.push(f)));
  runtimeFiles.forEach((f) => {
    const target = path.join(dist, path.relative(src, f));
    if (!fs.existsSync(target)) { fail('missing from dist: ' + path.relative(src, f)); }
  });
  notes.push('runtime files: ' + runtimeFiles.length + ' checked');

  // ---- config files ----
  ['config.js', 'config.solr.js'].forEach((name) => {
    const built = path.join(dist, name);
    if (!fs.existsSync(built)) { fail(name + ' is not in dist'); }
    else if (!fs.readFileSync(built).equals(fs.readFileSync(path.join(src, name)))) { fail(name + ' in dist differs from src/' + name + ' (it must be copied unchanged)'); }
  });

  // ---- relative URLs ----
  const index = read(path.join(dist, 'index.html'));
  (index.match(/(?:src|href)="[^"]*"/g) || []).forEach((attr) => {
    const url = attr.replace(/^(?:src|href)="/, '').replace(/"$/, '');
    if (/^(?:\/|[a-z]+:\/\/)/i.test(url)) { fail('index.html has a non-relative URL: ' + attr); }
  });
  const appJs = read(path.join(dist, 'app', 'app.js'));
  if (!/Automatic publicPath/.test(appJs)) { fail('app/app.js does not compute its public path from the script URL (publicPath: "auto")'); }

  // ---- AngularJS annotation ----
  // An annotated registration is .controller("name",["$scope",function(...)]); a bare function with parameters
  // is injected by parameter name, which the minifier breaks.
  const bare = /\.(controller|directive|service|factory|filter)\("[^"]+",function\([A-Za-z_$]/;
  [path.join('app', 'app.js')].concat(chunks.filter((c) => /\.js$/.test(c)).map((c) => path.join('app', 'chunks', c))).forEach((rel) => {
    const text = read(path.join(dist, rel));
    const m = bare.exec(text);
    if (m) { fail(rel + ' registers a component without injection annotations: ' + m[0].slice(0, 60)); }
  });
  const annotated = /\.controller\("[^"]+",\["\$/;
  if (!annotated.test(chunks.filter((c) => /^panel-/.test(c) && /\.js$/.test(c)).map((c) => read(path.join(chunkDir, c))).join('\n'))) {
    fail('no panel chunk contains an annotated controller: the annotation step did not run');
  }

  // ---- eval ----
  const scripts = walk(dist, (f) => /\.js$/.test(f));
  scripts.forEach((f) => {
    if (/(^|[^$\w.]|\b(window|self|globalThis)\.)eval\s*\(/.test(read(f))) { fail(path.relative(dist, f).split(path.sep).join('/') + ' calls eval('); }
  });

  // ---- licences ----
  const manifestFile = path.join(root, 'tools', 'vendor-licenses.json');
  const manifest = JSON.parse(read(manifestFile)).libraries;
  const licencesFile = path.join(dist, 'THIRD-PARTY-LICENSES.txt');
  if (!fs.existsSync(licencesFile)) {
    fail('dist/THIRD-PARTY-LICENSES.txt is missing');
  } else {
    const licences = read(licencesFile).replace(/\s+/g, ' ');
    ['vis', 'x2js'].forEach((pkg) => {
      if (!new RegExp('(^|\\s)' + pkg + ' \\d').test(licences)) { fail('THIRD-PARTY-LICENSES.txt does not credit the npm package "' + pkg + '"'); }
    });
    const outputFiles = walk(path.join(dist, 'app'), (f) => /\.js$|\.LICENSE\.txt$/.test(f)).concat(walk(path.join(dist, 'vendor')));
    const outputText = outputFiles.map((f) => read(f)).join('\n').replace(/\s+/g, ' ');
    const manifestPaths = new Set(manifest.map((l) => l.path));
    // every vendored script with a licence header must be in the manifest
    walk(path.join(src, 'vendor'), (f) => /\.js$/.test(f)).forEach((f) => {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!manifestPaths.has(rel) && hasLicenceHeader(read(f))) { fail(rel + ' has a licence header but is not listed in tools/vendor-licenses.json'); }
    });
    let inOutput = 0;
    let listedOnly = 0;
    // nothing ships without a stated licence (the entries that are not shipped are test and build files)
    manifest.filter((l) => l.shipped !== false)
      .concat(JSON.parse(read(manifestFile)).embedded || [])
      .forEach((lib) => {
        if (!licenceStated(lib.license)) {
          fail((lib.path || lib.container) + ' (' + lib.name + ') has no stated licence in tools/vendor-licenses.json (its "license" is ' + JSON.stringify(lib.license) + '): replace the file or find its licence before it ships');
        }
      });
    manifest.forEach((lib) => {
      const file = path.join(root, lib.path);
      if (!fs.existsSync(file)) { fail('tools/vendor-licenses.json lists ' + lib.path + ', which does not exist'); return; }
      if (lib.shipped === false) { return; }
      if (licences.indexOf(lib.name) === -1) { fail('THIRD-PARTY-LICENSES.txt does not list ' + lib.name + ' (' + lib.path + ')'); return; }
      const marker = lib.marker || headerMarker(read(file));
      if (!marker) { listedOnly++; return; } // the file has no header: the licences file is the only notice
      const normal = marker.replace(/\s+/g, ' ');
      if (outputText.indexOf(normal) !== -1) { inOutput++; }
      else if (lib.listedOnly === true && licences.indexOf(normal) !== -1) { listedOnly++; }
      else { fail('the notice of ' + lib.path + ' ("' + normal + '") is not in the build output' + (lib.listedOnly === true ? ' or in THIRD-PARTY-LICENSES.txt' : ' (set "listedOnly": true on its manifest entry to accept the copy in THIRD-PARTY-LICENSES.txt instead)')); }
    });
    notes.push('licences: ' + manifest.filter((l) => l.shipped !== false).length + ' shipped vendored libraries; header found in the output for ' + inOutput + ', in THIRD-PARTY-LICENSES.txt only for ' + listedOnly + ' (files without a header or marked listedOnly)');
  }

  // ---- the licence, the notice and the licence texts that ship with the build ----
  ['LICENSE', 'NOTICE'].forEach((name) => {
    const source = path.join(root, name);
    const built = path.join(dist, name);
    if (!fs.existsSync(source)) { fail(name + ' is missing from the repository root'); }
    else if (!fs.existsSync(built)) { fail('dist/' + name + ' is missing'); }
    else if (!fs.readFileSync(built).equals(fs.readFileSync(source))) { fail('dist/' + name + ' differs from ' + name + ' (it must be copied unchanged)'); }
  });
  const licenceFile = path.join(root, 'LICENSE');
  if (fs.existsSync(licenceFile)) {
    const text = read(licenceFile);
    if (!/Apache License\s+Version 2\.0, January 2004/.test(text) || text.indexOf('END OF TERMS AND CONDITIONS') === -1) {
      fail('LICENSE is not the full text of the Apache License 2.0');
    }
  }
  // Every licence text is compared with its source, byte for byte: a text that is edited or cut short in dist/ is as
  // wrong as one that is missing.
  const sameFile = (source, built, label) => {
    if (!fs.existsSync(built)) { fail(label + ' is missing'); return false; }
    if (!fs.readFileSync(built).equals(fs.readFileSync(source))) { fail(label + ' differs from ' + path.relative(root, source).split(path.sep).join('/') + ' (it must be copied unchanged)'); return false; }
    return true;
  };
  let licenceTexts = 0;
  const named = (lib) => [].concat(lib.licenseText || []);
  const embedded = JSON.parse(read(manifestFile)).embedded || [];
  manifest.filter((l) => l.shipped !== false).concat(embedded).forEach((lib) => {
    named(lib).forEach((file) => {
      const source = path.join(root, file);
      const built = path.join(dist, file);
      if (!fs.existsSync(source)) { fail((lib.path || lib.container) + ' names the licence text ' + file + ', which does not exist'); }
      else if (!fs.existsSync(built)) { fail('dist/' + file + ' (the licence text of ' + lib.name + ') is missing'); }
      else { licenceTexts++; }
    });
  });
  // everything in licenses/ ships in dist/licenses/
  walk(path.join(root, 'licenses')).forEach((source) => {
    const rel = path.relative(root, source).split(path.sep).join('/');
    sameFile(source, path.join(dist, rel), 'dist/' + rel);
  });
  // code that is embedded in another shipped file: the file must still contain it, and its licence must name the holder
  embedded.forEach((e) => {
    const container = path.join(root, e.container);
    if (!fs.existsSync(container)) { fail('the file ' + e.container + ', which contains ' + e.name + ', does not exist (run npm install)'); return; }
    if (read(container).indexOf(e.marker) === -1) { fail(e.container + ' no longer contains "' + e.marker + '": check the licence entry for ' + e.name + ' in tools/vendor-licenses.json'); }
    const text = path.join(root, [].concat(e.licenseText)[0]);
    if (fs.existsSync(text) && read(text).indexOf(e.copyright) === -1) { fail(e.licenseText + ' does not name the copyright holder "' + e.copyright + '" of ' + e.name); }
    if (fs.existsSync(licencesFile) && read(licencesFile).indexOf(e.name) === -1) { fail('THIRD-PARTY-LICENSES.txt does not list ' + e.name); }
  });
  if (walk(path.join(src, 'font'), (f) => /fontawesome/i.test(path.basename(f))).length) {
    const source = path.join(root, 'licenses', 'fontawesome-OFL.txt');
    const ofl = path.join(dist, 'font', 'OFL.txt');
    if (!fs.existsSync(source)) { fail('licenses/fontawesome-OFL.txt (the licence of the Font Awesome font) is missing'); }
    else { sameFile(source, ofl, 'dist/font/OFL.txt (the licence of the Font Awesome font)'); }
  }
  notes.push('legal: LICENSE and NOTICE in dist, ' + licenceTexts + ' licence text references checked');

  return { problems, notes };
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { root: path.resolve(__dirname, '..') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') { opts.dist = argv[++i]; }
    else if (argv[i] === '--src') { opts.src = argv[++i]; }
    else { console.error('unknown argument ' + argv[i]); process.exit(2); }
  }
  const result = checkDist(opts);
  result.notes.forEach((n) => console.log('check-dist: ' + n));
  result.problems.forEach((p) => console.error('check-dist: PROBLEM: ' + p));
  if (result.problems.length) {
    console.error('check-dist: ' + result.problems.length + ' problem(s)');
    process.exit(1);
  }
  console.log('check-dist: ok');
}

if (require.main === module) { main(); }

module.exports = { checkDist, headerMarker, hasLicenceHeader, licenceStated };
