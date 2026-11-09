'use strict';

// The explicit context and launch option lists, compared with the installed
// Playwright version's own member names.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers');

const options = load('options.js');

const root = path.resolve(__dirname, '..', '..', '..');
const modules = path.join(root, 'node_modules');

function members(text, interfaceName) {
  const start = text.indexOf('export interface ' + interfaceName + ' {');
  assert.ok(start !== -1, interfaceName + ' not found in the typings');
  const end = text.indexOf('\n}\n', start);
  const body = text.slice(start, end);
  const names = new Set();
  const re = /^  ([A-Za-z_][A-Za-z0-9_]*)\??:/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    names.add(m[1]);
  }
  return names;
}

test('the launch keys are the members of LaunchOptions, except the runner\'s own output directories', function () {
  const typings = fs.readFileSync(path.join(modules, 'playwright-core', 'types', 'types.d.ts'), 'utf8');
  const names = members(typings, 'LaunchOptions');
  names.delete('artifactsDir');
  names.delete('tracesDir');
  assert.deepStrictEqual(options.LAUNCH_KEYS.slice().sort(), Array.from(names).sort());
});

test('the context keys are the options the runner copies into every context it creates', function () {
  const source = fs.readFileSync(path.join(modules, 'playwright', 'lib', 'index.js'), 'utf8');
  const start = source.indexOf('_combinedContextOptions: [async ({');
  assert.ok(start !== -1, 'the runner\'s combined context options fixture was not found');
  const end = source.indexOf('{ scope: "test", box: true }', start);
  const body = source.slice(start, end);
  const set = new Set();
  const re = /options\.([A-Za-z_][A-Za-z0-9_]*) = /g;
  let m;
  while ((m = re.exec(body)) !== null) {
    set.add(m[1]);
  }
  assert.deepStrictEqual(options.CONTEXT_KEYS.slice().sort(), Array.from(set).sort());
  // each of them is also a member of the context options of the typings
  const typings = fs.readFileSync(path.join(modules, 'playwright-core', 'types', 'types.d.ts'), 'utf8');
  const known = members(typings, 'BrowserContextOptions');
  options.CONTEXT_KEYS.forEach(function (key) {
    assert.ok(known.has(key), key + ' is not a context option of this Playwright version');
  });
});

test('every key is present in the options an actual call passes, even with the value undefined', function () {
  const context = options.contextOptions('http://127.0.0.1:1234');
  options.CONTEXT_KEYS.forEach(function (key) {
    assert.ok(key in context, key);
  });
  assert.strictEqual(context.baseURL, 'http://127.0.0.1:1234');
  assert.strictEqual(context.serviceWorkers, 'block');
  ['proxy', 'storageState', 'httpCredentials', 'extraHTTPHeaders', 'clientCertificates', 'permissions', 'geolocation'].forEach(function (key) {
    assert.strictEqual(context[key], undefined, key);
  });
  const launch = options.launchOptions();
  options.LAUNCH_KEYS.forEach(function (key) {
    assert.ok(key in launch, key);
  });
  ['args', 'executablePath', 'proxy', 'env', 'channel', 'downloadsPath', 'ignoreDefaultArgs'].forEach(function (key) {
    assert.strictEqual(launch[key], undefined, key);
  });
});

test('the launch logger is an explicit no-op object, which launch() does not replace', function () {
  const launch = options.launchOptions();
  assert.ok(launch.logger);
  assert.strictEqual(launch.logger.isEnabled(), false);
  assert.strictEqual(launch.logger.log(), undefined);
  assert.strictEqual(launch.logger, options.NOOP_LOGGER);
});
