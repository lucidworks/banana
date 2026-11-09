'use strict';

// Tests for tools/check-lockfile.js, and a check of the committed package-lock.json and package.json.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const { checkLockfile } = require(path.join(root, 'tools', 'check-lockfile.js'));

function sample() {
  return {
    lockfileVersion: 3,
    packages: {
      '': { devDependencies: { left: '^1.0.0' } },
      'node_modules/left': { version: '1.0.0', resolved: 'https://registry.npmjs.org/left/-/left-1.0.0.tgz', integrity: 'sha512-abc' },
      'node_modules/linked': { link: true, resolved: '../linked' }
    }
  };
}
const pkg = { devDependencies: { left: '^1.0.0' } };

test('a lockfile on the public registry with integrity hashes passes', function () {
  assert.deepStrictEqual(checkLockfile(sample(), pkg), []);
});

test('a resolved URL on another registry fails', function () {
  const lock = sample();
  lock.packages['node_modules/left'].resolved = 'https://registry.example.invalid/left/-/left-1.0.0.tgz';
  const problems = checkLockfile(lock, pkg);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /node_modules\/left: resolved is not on/);
});

test('a missing resolved URL or integrity hash fails', function () {
  const lock = sample();
  delete lock.packages['node_modules/left'].integrity;
  assert.match(checkLockfile(lock, pkg).join('\n'), /integrity is missing/);
  const lock2 = sample();
  delete lock2.packages['node_modules/left'].resolved;
  assert.match(checkLockfile(lock2, pkg).join('\n'), /resolved is not on/);
});

test('a lockfile that no longer matches package.json fails', function () {
  const problems = checkLockfile(sample(), { devDependencies: { left: '^2.0.0' } });
  assert.match(problems.join('\n'), /devDependencies differs/);
});

test('the order of keys in the dependency maps does not matter', function () {
  const lock = sample();
  lock.packages[''].devDependencies = { right: '^1.0.0', left: '^1.0.0' };
  const reordered = { devDependencies: { left: '^1.0.0', right: '^1.0.0' } };
  assert.deepStrictEqual(checkLockfile(lock, reordered), []);
});

test('a lockfile without a packages section fails', function () {
  assert.strictEqual(checkLockfile({ lockfileVersion: 1, dependencies: {} }, pkg).length, 1);
});

test('the committed package-lock.json passes the check', function () {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepStrictEqual(checkLockfile(lock, committed), []);
});

test('the lockfile of the map tools passes the check, and mapshaper is not a dependency of the application', function () {
  const dir = path.join(root, 'tools', 'maps');
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  const tools = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.deepStrictEqual(checkLockfile(lock, tools), []);
  assert.strictEqual(tools.private, true);
  assert.match(tools.devDependencies.mapshaper, /^\d+\.\d+\.\d+$/, 'mapshaper is pinned exactly');
  assert.ok(lock.packages['node_modules/mapshaper'], 'the lockfile contains mapshaper');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(app.devDependencies.mapshaper, undefined);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/mapshaper'], undefined);
  assert.match(fs.readFileSync(path.join(dir, '.npmrc'), 'utf8'), /^legacy-peer-deps=false$/m);
});

test('package.json pins the Node.js range the build needs and the browser tooling exactly', function () {
  const committed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(committed.engines.node, '^22.18.0 || ^24.11.0 || >=26.0.0');
  assert.strictEqual(committed.devDependencies.playwright, '1.65.0');
  assert.strictEqual(committed.devDependencies['@playwright/test'], '1.65.0');
  assert.strictEqual(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), 'lts/jod');
});

test('the project .npmrc sets no registry', function () {
  const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
  assert.doesNotMatch(npmrc, /registry/i);
  assert.match(npmrc, /^legacy-peer-deps=false$/m);
});
