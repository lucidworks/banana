'use strict';

// The version number is written in package.json only. The build puts it into the one template that shows it
// (the placeholder __BANANA_VERSION__ in src/app/partials/dasheditor.html). This test fails when a second literal
// copy of the version appears in a source file, when a retired build descriptor comes back, or when the build output
// still has the placeholder or shows another version.
// The scan root can be changed with BANANA_VERSION_ROOT, which lets the test be pointed at a scratch copy.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.BANANA_VERSION_ROOT
  ? path.resolve(process.env.BANANA_VERSION_ROOT)
  : path.resolve(__dirname, '..', '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Directories and files whose content is not Banana's own statement of its version: third-party code, the lockfile
// (generated from package.json), decision records and the release data the tests compare against. These are skipped
// by path, so scripts that merely share a directory name (tools/fixtures) are still scanned. Hidden directories
// (version control and local tool folders) are skipped too, except .github, which holds the CI configuration.
const skipPaths = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'licenses', 'docs',
  'src/vendor', 'test/fixtures', 'test/node/fixtures', 'tools/maps']);
function skipDir(full) {
  const rel = path.relative(root, full).split(path.sep).join('/');
  const name = path.basename(full);
  return skipPaths.has(rel) || name === 'node_modules' || (name.charAt(0) === '.' && name !== '.github');
}
const skipFiles = new Set(['package.json', 'package-lock.json']);
const textFile = /\.(js|json|html|css|md|xml|yml|yaml|properties|txt|template)$|^(QUICKSTART|NOTICE|LICENSE)$/;

function sources(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDir(full)) { sources(full, out); }
    } else if (textFile.test(entry.name) && !skipFiles.has(entry.name)) {
      out.push(full);
    }
  });
  return out;
}

const escaped = version.replace(/\./g, '\\.');
const literal = new RegExp('(^|[^0-9.])v?' + escaped + '([^0-9]|\\.(?![0-9])|$)');
const bannaVersion = /\bBanana\s+v\d+\.\d+\.\d+/i;  // the form the editor shows: "Banana v", then the number

test('package.json has a semantic version', function () {
  assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

test('no source file repeats the version from package.json or states another Banana version', function () {
  const hits = [];
  sources(root, []).forEach(function (file) {
    const rel = path.relative(root, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
      if (literal.test(line) || bannaVersion.test(line)) { hits.push(rel + ':' + (i + 1) + ': ' + line.trim().slice(0, 100)); }
    });
  });
  assert.deepStrictEqual(hits, [], 'literal version outside package.json');
});

test('the retired Maven and Ant build files are gone', function () {
  ['pom.xml', 'mvn.template', 'build.xml', 'default.properties', 'jetty-contexts', 'src/WEB-INF'].forEach(function (name) {
    assert.ok(!fs.existsSync(path.join(root, name)), name + ' must not exist');
  });
});

test('the dashboard editor template takes the version from the build', function () {
  const partial = fs.readFileSync(path.join(root, 'src/app/partials/dasheditor.html'), 'utf8');
  assert.ok(partial.includes('Banana v__BANANA_VERSION__'), 'placeholder in the template');
});

const built = path.join(root, 'dist', 'app', 'partials', 'dasheditor.html');
test('the build output shows the version of package.json and has no placeholder left', { skip: !fs.existsSync(built) && 'dist/ is not built' }, function () {
  assert.ok(fs.readFileSync(built, 'utf8').includes('Banana v' + version), 'version shown in dasheditor.html');
  const left = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (/\.(html|js|css|json)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('__BANANA_VERSION__')) { left.push(path.relative(root, full)); }
    });
  })(path.join(root, 'dist'));
  assert.deepStrictEqual(left, [], 'placeholder left in the build output');
});
