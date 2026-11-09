'use strict';

// Static checks that the Fusion 5.x API paths, the removal of scripted
// dashboards and eval, and the removal of the metrics dashboard stay in place.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// Drop whole-line // comments so that commented-out code does not count.
function code(rel) {
  return read(rel).split('\n').filter(function (l) {
    return !/^\s*\/\//.test(l);
  }).join('\n');
}

test('no /api/apollo path remains under src', function () {
  const hits = walk(src).filter(function (f) {
    return fs.readFileSync(f, 'utf8').includes('/api/apollo');
  }).map(function (f) { return path.relative(root, f); });
  assert.deepStrictEqual(hits, []);
});

test('dashboard service has no script_load and no new Function', function () {
  const s = read('src/app/services/dashboard.js');
  assert.ok(!s.includes('script_load'), 'script_load present');
  assert.ok(!/new\s+Function/.test(s), 'new Function present');
});

['src/vendor/angular/angular-dragdrop.js'].forEach(function (rel) {
  test('no eval( call in ' + rel, function () {
    assert.ok(!/(^|[^$\w.])eval\s*\(/.test(code(rel)), 'eval( present');
  });
});

test('no lucidworks-metrics file or reference remains', function () {
  assert.ok(!fs.existsSync(path.join(src, 'app/dashboards/lucidworks-metrics.json')));
  const hits = walk(src).concat(walk(path.join(root, 'test')).filter(function (f) {
    return path.resolve(f) !== __filename;
  })).filter(function (f) {
    return fs.readFileSync(f, 'utf8').includes('lucidworks-metrics');
  }).map(function (f) { return path.relative(root, f); });
  assert.deepStrictEqual(hits, []);
});
