'use strict';

// Tests for the build-output check (tools/check-dist.js) and the pieces it relies on. The check is run
// against a small synthetic source tree and dist, so no build is needed. When dist/ exists (after
// `npm run build`), the real build output is checked as well.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const { checkDist, headerMarker, hasLicenceHeader, licenceStated } = require(path.join(root, 'tools', 'check-dist.js'));
const { panelNamesFromConfig } = require(path.join(root, 'tools', 'lib', 'panel-names.js'));
const { leadingComments } = require(path.join(root, 'tools', 'webpack', 'vendor-loader.js'));

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const made = [];
test.after(function () {
  made.forEach(function (dir) { fs.rmSync(dir, { recursive: true, force: true }); });
});

// A minimal repository and build output with two panels, "alpha" (with a template) and "beta".
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-check-'));
  made.push(dir);
  const config = "define(['settings'], function (S) { return new S({ panel_names: ['alpha', 'beta'] }); });\n";
  write(path.join(dir, 'src/config.js'), config);
  write(path.join(dir, 'src/config.solr.js'), config);
  write(path.join(dir, 'src/app/panels/alpha/module.js'), 'define([], function () {});');
  write(path.join(dir, 'src/app/panels/alpha/module.html'), '<div></div>');
  write(path.join(dir, 'src/app/panels/alpha/editor.html'), '<div>editor</div>');
  write(path.join(dir, 'src/app/panels/beta/module.js'), 'define([], function () {});');
  write(path.join(dir, 'src/app/partials/one.html'), '<div></div>');
  write(path.join(dir, 'src/app/dashboards/default.json'), '{}');
  write(path.join(dir, 'src/vendor/lib.js'), '/*! Lib 1.0 | MIT */\nvar lib = 1;\n');
  write(path.join(dir, 'tools/vendor-licenses.json'), JSON.stringify({
    libraries: [{ path: 'src/vendor/lib.js', name: 'Lib', version: '1.0', license: 'MIT', copyright: 'Someone', licenseText: 'licenses/lib.txt' }]
  }));
  const licence = '                                 Apache License\n                           Version 2.0, January 2004\n...\n   END OF TERMS AND CONDITIONS\n';
  write(path.join(dir, 'LICENSE'), licence);
  write(path.join(dir, 'NOTICE'), 'Banana\n');
  write(path.join(dir, 'licenses/lib.txt'), 'The MIT License\n');
  write(path.join(dir, 'licenses/fontawesome-OFL.txt'), 'SIL OPEN FONT LICENSE Version 1.1\n');
  write(path.join(dir, 'src/font/FontAwesome.otf'), 'font');
  write(path.join(dir, 'dist/font/FontAwesome.otf'), 'font');
  write(path.join(dir, 'dist/font/OFL.txt'), 'SIL OPEN FONT LICENSE Version 1.1\n');
  write(path.join(dir, 'dist/LICENSE'), licence);
  write(path.join(dir, 'dist/NOTICE'), 'Banana\n');
  write(path.join(dir, 'dist/licenses/lib.txt'), 'The MIT License\n');
  write(path.join(dir, 'dist/licenses/fontawesome-OFL.txt'), 'SIL OPEN FONT LICENSE Version 1.1\n');

  write(path.join(dir, 'dist/index.html'), '<script src="config.js"></script><script src="app/app.js?v=abc"></script><link href="css/x.css">');
  write(path.join(dir, 'dist/config.js'), config);
  write(path.join(dir, 'dist/config.solr.js'), config);
  write(path.join(dir, 'dist/app/app.js'), 'if(!e)throw new Error("Automatic publicPath is not supported in this browser");');
  write(path.join(dir, 'dist/app/app.js.LICENSE.txt'), '/*! Lib 1.0 | MIT */\n');
  const chunk = 'x.controller("alpha",["$scope",function(t){}]);'.padEnd(200, ' ');
  write(path.join(dir, 'dist/app/chunks/panel-alpha-module.0123abcd.js'), chunk);
  write(path.join(dir, 'dist/app/chunks/panel-alpha-module-html.0123abcd.js'), chunk);
  write(path.join(dir, 'dist/app/chunks/panel-beta-module.0123abcd.js'), chunk);
  write(path.join(dir, 'dist/app/panels/alpha/editor.html'), '<div>editor</div>');
  write(path.join(dir, 'dist/app/partials/one.html'), '<div></div>');
  write(path.join(dir, 'dist/app/dashboards/default.json'), '{}');
  write(path.join(dir, 'dist/THIRD-PARTY-LICENSES.txt'), 'vis 4.21.0 (Apache-2.0)\nx2js 3.4.5 (Apache-2.0)\nLib 1.0\n  Notice: /*! Lib 1.0 | MIT */\n');
  return dir;
}

function problemsOf(dir) {
  return checkDist({ root: dir }).problems;
}

test('the synthetic build output passes the check', function () {
  const dir = fixture();
  assert.deepStrictEqual(problemsOf(dir), []);
});

test('a panel listed in config.js with no module chunk fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/app/chunks/panel-beta-module.0123abcd.js'));
  const problems = problemsOf(dir);
  assert.strictEqual(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /panel "beta": no module chunk/);
});

test('a panel whose template is missing from the build fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/app/chunks/panel-alpha-module-html.0123abcd.js'));
  assert.match(problemsOf(dir).join('\n'), /panel "alpha": its module\.html template is not in the build/);
});

test('a panel listed in config.js with no source directory fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'src/config.js'), "define(['settings'], function (S) { return new S({ panel_names: ['alpha', 'beta', 'gamma'] }); });\n");
  write(path.join(dir, 'dist/config.js'), fs.readFileSync(path.join(dir, 'src/config.js')));
  assert.match(problemsOf(dir).join('\n'), /lists the panel "gamma"/);
});

test('a run-time file that is not in dist fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/app/panels/alpha/editor.html'));
  assert.match(problemsOf(dir).join('\n'), /missing from dist: app\/panels\/alpha\/editor\.html/);
});

test('an edited config.js in dist fails the check', function () {
  const dir = fixture();
  fs.appendFileSync(path.join(dir, 'dist/config.js'), '// changed\n');
  assert.match(problemsOf(dir).join('\n'), /config\.js in dist differs/);
});

test('an absolute URL in index.html fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'dist/index.html'), '<script src="/app/app.js"></script>');
  assert.match(problemsOf(dir).join('\n'), /non-relative URL/);
});

test('a component registered without injection annotations fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'dist/app/chunks/panel-beta-module.0123abcd.js'), 'x.controller("beta",function(t,e){});'.padEnd(200, ' '));
  assert.match(problemsOf(dir).join('\n'), /without injection annotations/);
});

test('an eval( call in the build output fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'dist/app/chunks/panel-beta-module.0123abcd.js'), 'x.controller("beta",["$scope",function(t){eval(t)}]);'.padEnd(200, ' '));
  assert.match(problemsOf(dir).join('\n'), /panel-beta-module\.0123abcd\.js calls eval\(/);
});

test('a window.eval( call in a top-level build script fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'dist/config-boot.js'), 'window.eval("1");');
  assert.match(problemsOf(dir).join('\n'), /config-boot\.js calls eval\(/);
});

test('a vendored file with a licence header that is not in the manifest fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'src/vendor/other.js'), '/* Other 2.0, Copyright (c) 2020 Someone. MIT license. */\nvar other = 2;\n');
  assert.match(problemsOf(dir).join('\n'), /src\/vendor\/other\.js has a licence header but is not listed/);
});

test('a vendored library whose notice is lost from the output fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/app/app.js.LICENSE.txt'));
  write(path.join(dir, 'dist/THIRD-PARTY-LICENSES.txt'), 'vis 4.21.0 (Apache-2.0)\nx2js 3.4.5 (Apache-2.0)\nLib 1.0\n');
  assert.match(problemsOf(dir).join('\n'), /notice of src\/vendor\/lib\.js .* is not in the build output/);
});

test('a notice that is only in THIRD-PARTY-LICENSES.txt fails unless the manifest entry says listedOnly', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/app/app.js.LICENSE.txt'));
  assert.match(problemsOf(dir).join('\n'), /notice of src\/vendor\/lib\.js .* is not in the build output/);
  write(path.join(dir, 'tools/vendor-licenses.json'), JSON.stringify({
    libraries: [{ path: 'src/vendor/lib.js', name: 'Lib', version: '1.0', license: 'MIT', copyright: 'Someone', listedOnly: true, licenseText: 'licenses/lib.txt' }]
  }));
  assert.deepStrictEqual(problemsOf(dir), []);
});

test('a LICENSE that is not the Apache License 2.0 text fails the check', function () {
  const dir = fixture();
  write(path.join(dir, 'LICENSE'), 'Licensed under the Apache License, see the web.\n');
  write(path.join(dir, 'dist/LICENSE'), 'Licensed under the Apache License, see the web.\n');
  assert.match(problemsOf(dir).join('\n'), /LICENSE is not the full text of the Apache License 2\.0/);
});

test('a LICENSE or NOTICE that is missing from dist, or changed there, fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/LICENSE'));
  assert.match(problemsOf(dir).join('\n'), /dist\/LICENSE is missing/);
  const other = fixture();
  fs.appendFileSync(path.join(other, 'dist/NOTICE'), 'edited\n');
  assert.match(problemsOf(other).join('\n'), /dist\/NOTICE differs from NOTICE/);
});

test('a licence text named in the manifest that is not in dist fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/licenses/lib.txt'));
  assert.match(problemsOf(dir).join('\n'), /dist\/licenses\/lib\.txt \(the licence text of Lib\) is missing/);
});

test('a licence text that is edited in dist, or a licence file that was not copied, fails the check', function () {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'dist/licenses/lib.txt'), 'The MIT License, cut short\n');
  assert.match(problemsOf(dir).join('\n'), /dist\/licenses\/lib\.txt differs from licenses\/lib\.txt/);
  const other = fixture();
  write(path.join(other, 'licenses/extra.txt'), 'Another licence\n');
  assert.match(problemsOf(other).join('\n'), /dist\/licenses\/extra\.txt is missing/);
});

test('a copy of the Font Awesome licence that differs from the source fails the check', function () {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'dist/font/OFL.txt'), 'SIL OPEN FONT LICENSE Version 1.1 (changed)\n');
  assert.match(problemsOf(dir).join('\n'), /dist\/font\/OFL\.txt .* differs from licenses\/fontawesome-OFL\.txt/);
});

// A manifest with one entry for code embedded in a bundle that the build does not rewrite.
function withEmbedded(dir) {
  write(path.join(dir, 'node_modules/pkg/bundle.js'), 'var a; // Copyright (c) 2011 Someone\n');
  write(path.join(dir, 'licenses/embedded.txt'), 'Copyright (c) 2011 Someone\nThe MIT License\n');
  write(path.join(dir, 'dist/licenses/embedded.txt'), 'Copyright (c) 2011 Someone\nThe MIT License\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'tools/vendor-licenses.json'), 'utf8'));
  manifest.embedded = [{ name: 'Embedded routine', container: 'node_modules/pkg/bundle.js', marker: 'Copyright (c) 2011 Someone', license: 'MIT', copyright: 'Someone', licenseText: 'licenses/embedded.txt' }];
  write(path.join(dir, 'tools/vendor-licenses.json'), JSON.stringify(manifest));
  write(path.join(dir, 'dist/THIRD-PARTY-LICENSES.txt'), 'vis 4.21.0 (Apache-2.0)\nx2js 3.4.5 (Apache-2.0)\nLib 1.0\n  Notice: /*! Lib 1.0 | MIT */\nEmbedded routine\n');
}

test('embedded code whose container, licence text or credit is wrong fails the check', function () {
  const ok = fixture();
  withEmbedded(ok);
  assert.deepStrictEqual(problemsOf(ok), []);
  const gone = fixture();
  withEmbedded(gone);
  fs.writeFileSync(path.join(gone, 'node_modules/pkg/bundle.js'), 'var a;\n');
  assert.match(problemsOf(gone).join('\n'), /node_modules\/pkg\/bundle\.js no longer contains "Copyright \(c\) 2011 Someone"/);
  const unnamed = fixture();
  withEmbedded(unnamed);
  fs.writeFileSync(path.join(unnamed, 'licenses/embedded.txt'), 'The MIT License\n');
  fs.writeFileSync(path.join(unnamed, 'dist/licenses/embedded.txt'), 'The MIT License\n');
  assert.match(problemsOf(unnamed).join('\n'), /licenses\/embedded\.txt does not name the copyright holder "Someone"/);
  const unlisted = fixture();
  withEmbedded(unlisted);
  write(path.join(unlisted, 'dist/THIRD-PARTY-LICENSES.txt'), 'vis 4.21.0 (Apache-2.0)\nx2js 3.4.5 (Apache-2.0)\nLib 1.0\n  Notice: /*! Lib 1.0 | MIT */\n');
  assert.match(problemsOf(unlisted).join('\n'), /THIRD-PARTY-LICENSES\.txt does not list Embedded routine/);
});

test('a shipped manifest entry with no stated licence fails the check', function () {
  ['', 'not stated; the source of the data is not recorded', 'no licence is stated in the file', 'unknown', 'Unlicensed'].forEach(function (text) {
    const dir = fixture();
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'tools/vendor-licenses.json'), 'utf8'));
    manifest.libraries[0].license = text;
    write(path.join(dir, 'tools/vendor-licenses.json'), JSON.stringify(manifest));
    assert.match(problemsOf(dir).join('\n'), /src\/vendor\/lib\.js \(Lib\) has no stated licence/, 'license ' + JSON.stringify(text));
  });
  // an entry that is not shipped (a test mock) may have none, and a stated licence passes
  const mock = fixture();
  const manifest = JSON.parse(fs.readFileSync(path.join(mock, 'tools/vendor-licenses.json'), 'utf8'));
  manifest.libraries[0].license = 'not stated';
  manifest.libraries[0].shipped = false;
  write(path.join(mock, 'tools/vendor-licenses.json'), JSON.stringify(manifest));
  assert.doesNotMatch(problemsOf(mock).join('\n'), /no stated licence/);
  ['MIT', 'Apache-2.0 (as part of Kibana 3; identical to Kibana 3.0.0)', 'BSD-3-Clause (the file has no header)', 'Public domain (Natural Earth)'].forEach(function (text) {
    assert.strictEqual(licenceStated(text), true, text);
  });
});

test('embedded code with no stated licence fails the check', function () {
  const dir = fixture();
  withEmbedded(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'tools/vendor-licenses.json'), 'utf8'));
  manifest.embedded[0].license = 'not stated';
  write(path.join(dir, 'tools/vendor-licenses.json'), JSON.stringify(manifest));
  assert.match(problemsOf(dir).join('\n'), /Embedded routine\) has no stated licence/);
});

test('the manifest of this repository names a licence for everything that ships', function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'vendor-licenses.json'), 'utf8'));
  manifest.libraries.filter(function (l) { return l.shipped !== false; }).concat(manifest.embedded || []).forEach(function (lib) {
    assert.strictEqual(licenceStated(lib.license), true, (lib.path || lib.container) + ': ' + lib.license);
  });
});

test('the Font Awesome font without its licence next to it fails the check', function () {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, 'dist/font/OFL.txt'));
  assert.match(problemsOf(dir).join('\n'), /dist\/font\/OFL\.txt .* is missing/);
});

test('a missing dist fails the check', function () {
  const dir = fixture();
  fs.rmSync(path.join(dir, 'dist'), { recursive: true });
  assert.match(problemsOf(dir).join('\n'), /the build did not run/);
});

test('panel_names is read the same way from config.js and config.solr.js', function () {
  const fusion = panelNamesFromConfig(fs.readFileSync(path.join(root, 'src/config.js'), 'utf8'));
  const solr = panelNamesFromConfig(fs.readFileSync(path.join(root, 'src/config.solr.js'), 'utf8'));
  assert.strictEqual(fusion.length, 28);
  assert.deepStrictEqual(solr, fusion);
  fusion.forEach(function (name) {
    assert.ok(fs.existsSync(path.join(root, 'src/app/panels', name, 'module.js')), name + ' has no module.js');
  });
});

test('every vendored script with a licence header in src/vendor is in the manifest', function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/vendor-licenses.json'), 'utf8')).libraries;
  const listed = new Set(manifest.map(function (l) { return l.path; }));
  const missing = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); return; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (/\.js$/.test(e.name) && !listed.has(rel) && hasLicenceHeader(fs.readFileSync(full, 'utf8'))) { missing.push(rel); }
    });
  })(path.join(root, 'src/vendor'));
  assert.deepStrictEqual(missing, []);
  manifest.forEach(function (l) { assert.ok(fs.existsSync(path.join(root, l.path)), l.path + ' does not exist'); });
});

test('the vendor loader turns leading comments into /*! comments', function () {
  assert.strictEqual(leadingComments('/* Lib 1.0 */\nvar a;'), '/*! Lib 1.0 */');
  assert.strictEqual(leadingComments('/*! Lib 1.0 */\nvar a;'), '/*! Lib 1.0 */');
  assert.strictEqual(leadingComments('// Lib 1.0\n// MIT\nvar a;'), '/*!\n * Lib 1.0\n * MIT\n */');
  assert.strictEqual(leadingComments('var a; /* not a header */'), '');
  assert.strictEqual(headerMarker('/* global x */\n// Real Lib 1.0\nvar a;'), 'Real Lib 1.0');
});

test('the real build output passes the check (only when dist/ exists)', { skip: !fs.existsSync(path.join(root, 'dist', 'index.html')) && 'run npm run build first' }, function () {
  assert.deepStrictEqual(checkDist({ root: root }).problems, []);
});

test('LICENSE is the unmodified Apache License 2.0 text, and NOTICE credits Kibana 3 and every shipped library', function () {
  // sha-256 of https://www.apache.org/licenses/LICENSE-2.0.txt; GitHub identifies Apache-2.0 from this text
  const apache = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
  const crypto = require('node:crypto');
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'LICENSE'))).digest('hex'), apache);
  assert.ok(!fs.existsSync(path.join(root, 'LICENSE.md')), 'LICENSE.md next to LICENSE would hide the Apache text from licence detectors');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.license, 'Apache-2.0');
  const notice = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
  assert.match(notice, /Copyright 2013-2026 Lucidworks, Inc\. and Banana contributors/);
  assert.match(notice, /Copyright 2012-2013 Elasticsearch BV/);
  assert.match(notice, /derived from Kibana 3[\s\S]*have been modified/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/vendor-licenses.json'), 'utf8')).libraries;
  manifest.filter(function (l) { return l.shipped !== false; }).forEach(function (l) {
    assert.ok(notice.indexOf(l.name + (l.version ? ' ' + l.version : '')) !== -1, 'NOTICE does not list ' + l.name);
    [].concat(l.licenseText || []).forEach(function (f) { assert.ok(fs.existsSync(path.join(root, f)), f + ' does not exist'); });
  });
  // code embedded in other shipped files is credited in NOTICE too, and its licence text is shipped
  const embedded = JSON.parse(fs.readFileSync(path.join(root, 'tools/vendor-licenses.json'), 'utf8')).embedded;
  assert.ok(embedded.length >= 10, 'the embedded entries are missing');
  embedded.forEach(function (e) {
    assert.ok(notice.indexOf(e.copyright) !== -1, 'NOTICE does not credit ' + e.copyright + ' (' + e.name + ')');
    assert.ok(notice.indexOf(e.licenseText) !== -1, 'NOTICE does not name ' + e.licenseText);
    assert.ok(fs.existsSync(path.join(root, e.licenseText)), e.licenseText + ' does not exist');
  });
  // the Font Awesome licence is the official SIL OFL 1.1 text below a copyright line for the font
  const ofl = fs.readFileSync(path.join(root, 'licenses/fontawesome-OFL.txt'), 'utf8');
  assert.match(ofl, /Copyright \(c\) 2013, Dave Gandy/);
  assert.match(ofl, /\n1\) Neither the Font Software nor any of its individual components,/);
  assert.match(ofl, /substituting -- in part or in whole -- any of the components/);
});
