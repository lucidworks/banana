'use strict';

// Checks which files the npm package would contain, using the packlist code that npm itself bundles
// (the code that decides the contents of a package, without creating a tarball). Fusion copies
// node_modules/banana-fusion/dist, so a package without dist/ is an empty Banana.
// The checks on the files list and on what is left out need no build. The check on the dist/ tree needs
// `npm run build` first and is skipped, with a message, when dist/ does not exist.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const always = ['package.json', 'LICENSE', 'NOTICE', 'README.md'];

// npm's own modules live in <prefix>/lib/node_modules/npm/node_modules (or <prefix>/node_modules/npm/... on Windows).
function npmModules() {
  const bin = path.dirname(fs.realpathSync(process.execPath));
  const candidates = [
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'node_modules'),
    path.join(bin, 'node_modules', 'npm', 'node_modules')
  ];
  return candidates.find(function (dir) {
    return fs.existsSync(path.join(dir, 'npm-packlist')) && fs.existsSync(path.join(dir, '@npmcli', 'arborist'));
  });
}

const modules = npmModules();
const unavailable = modules ? false : 'the npm that ships with this Node.js has no bundled npm-packlist and Arborist';

async function packlist() {
  const Arborist = require(path.join(modules, '@npmcli', 'arborist'));
  const packlistFor = require(path.join(modules, 'npm-packlist'));
  const tree = await new Arborist({ path: root }).loadActual();
  return (await packlistFor(tree)).map(function (file) { return file.replace(/\\/g, '/'); });
}

// npm never packs these names, wherever they are.
const npmAlwaysIgnores = /^(\.DS_Store|\._.*|\.npmrc)$/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(function (entry) {
    return !npmAlwaysIgnores.test(entry.name);
  }).reduce(function (all, entry) {
    const full = path.join(dir, entry.name);
    return all.concat(entry.isDirectory() ? walk(full) : [path.relative(root, full).split(path.sep).join('/')]);
  }, []);
}

test('package.json lists the files to publish and builds before packing', function () {
  assert.ok(Array.isArray(pkg.files), 'package.json needs a "files" allowlist');
  assert.ok(pkg.files.includes('dist/'), '"files" must include dist/');
  assert.strictEqual(pkg.scripts.prepack, 'npm run build');
});

test('the packlist has the licence files and the readme and leaves out development files', { skip: unavailable }, async function () {
  const files = await packlist();
  always.forEach(function (name) {
    assert.ok(files.includes(name), name + ' is in the package');
  });
  const unwanted = files.filter(function (file) {
    return /^(test|resources|src|tools|scripts|docs|licenses|jetty-contexts|\.[^/]+)\//.test(file) ||
      /(^|\/)node_modules\//.test(file) ||
      /\.map$/.test(file) ||
      /\.jar$/.test(file) ||
      /^(pom\.xml|build\.xml|mvn\.template|default\.properties|webpack\.config\.js|package-lock\.json|QUICKSTART|CONTRIBUTING\.md|SECURITY\.md|index\.html)$/.test(file);
  });
  assert.deepStrictEqual(unwanted, [], 'development files in the package');
  const outside = files.filter(function (file) { return !/^dist\//.test(file) && !always.includes(file); });
  assert.deepStrictEqual(outside, [], 'files outside dist/ other than the licence files, readme and package.json');
});

const built = fs.existsSync(path.join(root, 'dist', 'index.html'));

test('the packlist has every file of dist/', { skip: unavailable || (built ? false : 'dist/ is not built: run npm run build first') }, async function () {
  const files = await packlist();
  const expected = walk(path.join(root, 'dist'));
  assert.ok(expected.includes('dist/index.html'));
  ['dist/LICENSE', 'dist/NOTICE', 'dist/THIRD-PARTY-LICENSES.txt'].forEach(function (name) {
    assert.ok(files.includes(name), name + ' is in the package');
  });
  assert.ok(files.some(function (file) { return /^dist\/licenses\/[^/]+$/.test(file); }), 'the licence texts under dist/licenses/ are in the package');
  assert.deepStrictEqual(expected.filter(function (file) { return !files.includes(file); }), [], 'dist/ files missing from the package');
  assert.deepStrictEqual(files.filter(function (file) { return /\.map$/.test(file); }), [], 'source maps are not part of the package');
});
