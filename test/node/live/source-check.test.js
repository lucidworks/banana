'use strict';

// The source check over test/live.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, tempDir } = require('./helpers');

const check = load('source-check.js');

const root = path.resolve(__dirname, '..', '..', '..');

function rules(text, options) {
  return check.checkText(text, 'x.js', options).map(function (f) { return f.rule; });
}

function flagged(text, options) {
  const found = rules(text, options);
  assert.ok(found.length > 0, 'should be flagged: ' + text);
  return found;
}

function clean(text, options) {
  assert.deepStrictEqual(rules(text, options), [], 'should pass: ' + text);
}

const SPEC = { spec: true };
const FIXTURE_IMPORT = "const { test, expect } = require('../fusion-client');\n";

test('imports: Playwright\'s own test and request, in every form, are refused', function () {
  // each form is checked with a fixture import present, so only the import rule can flag it
  const withFixture = function (line) { return FIXTURE_IMPORT + line; };
  const importRule = /@playwright\/test|playwright(-core)?\b/;
  [
    "import { test } from '@playwright/test';\n",
    "import { test, expect } from '@playwright/test';\n",
    "import { request } from '@playwright/test';\n",
    "import { expect, request } from '@playwright/test';\n",
    "import pw from '@playwright/test';\n",
    "import * as pw from '@playwright/test';\n",
    "import pw, { expect } from '@playwright/test';\n",
    "const { test } = require('@playwright/test');\n",
    "const pw = require ( \"@playwright/test\" );\n",
    "const pw = await import('@playwright/test');\n",
    "import '@playwright/test';\n",
    "import { chromium } from 'playwright';\n",
    "import { chromium } from 'playwright-core';\n",
    "const pw = require('playwright');\n",
    "const pw = require('playwright-core/lib/x');\n",
    "const pw = await import('playwright-core');\n"
  ].forEach(function (line) {
    const found = flagged(withFixture(line), SPEC);
    assert.ok(found.some(function (r) { return importRule.test(r); }), line + ' -> ' + found.join('; '));
  });
});

test('imports: expect and type-only names pass', function () {
  clean("import { expect } from '@playwright/test';\nimport { test } from '../fusion-client';\n", SPEC);
  clean("import { expect as e } from '@playwright/test';\nimport { test } from '../fusion-client/index.js';\n", SPEC);
  clean("import type { Page } from '@playwright/test';\nimport { test } from '../fusion-client';\n", SPEC);
  clean("import { type Page, expect } from '@playwright/test';\nimport { test } from '../fusion-client';\n", SPEC);
  clean(FIXTURE_IMPORT, SPEC);
});

test('imports: a spec must import test from the fixture module', function () {
  assert.ok(rules("test('x', async () => {});\n", SPEC).some(function (r) { return /import test from the fixture/.test(r); }));
  assert.ok(rules("const { expect } = require('../fusion-client');\n", SPEC).some(function (r) { return /import test from the fixture/.test(r); }));
  assert.ok(rules("import { test } from './other';\n", SPEC).some(function (r) { return /import test from the fixture/.test(r); }));
  // a file that is not a spec is not asked
  clean("const x = 1;\n");
});

test('tokens that make a browser or context without the guard are refused, in compact and spaced forms', function () {
  [
    'browser.newContext()', 'browser.newContext ()', 'page.context().browser().newContext()', 'ctx.newPage()', 'ctx.newPage ()',
    'bt.connect(url)', 'bt.connect (url)', 'bt . connect(url)', 'chromium.launch()', 'chromium.launch ()', 'chromium . launch()',
    'chromium.launchPersistentContext(dir)', 'chromium.launchServer()', 'chromium.connectOverCDP(url)',
    'test.extend({})', 'test.extend ({})', 'mergeTests(a, b)',
    'page.context().newCDPSession(page)', 'page.context().browser().newBrowserCDPSession()',
    'api._innerFetch({})', 'pw._android', 'pw._electron', 'chromium._playwright', 'page.context().browser().browserType()._playwright',
    'ctx._channel.x', 'test.use({ _combinedContextOptions: {} })', 'browser._newContextForReuse()'
  ].forEach(function (t) {
    flagged(t + ';\n');
  });
});

test('the internal fixtures and members of the client module are refused, in the plain and spaced forms', function () {
  [
    'async ({ _session }) => {}', 'async ({ _guard }) => {}', 'async ({ _guardedBrowser }) => {}',
    '_session.client._once(x)', 'live._session.client._fetch(x)', 'x._once (y)',
    'session.ledger.states.set(id, 1)', 'session . ledger.states', 'session.ledger'
  ].forEach(function (t) {
    flagged(t + ';\n');
  });
  assert.ok(rules('x._fetch(y);').some(function (r) { return /_fetch/.test(r); }));
  assert.ok(rules('x._once(y);').some(function (r) { return /_once/.test(r); }));
  assert.ok(rules('_session;').some(function (r) { return /_session/.test(r); }));
  assert.ok(rules('a.ledger;').some(function (r) { return /\.ledger/.test(r); }));
  clean('const ledgerName = 1;\n');
});

test('the tokens match as substrings, so _newContextForReuse is caught by newContext', function () {
  assert.ok(rules('b._newContextForReuse();').some(function (r) { return /newContext/.test(r); }));
  assert.ok(rules('chromium._playwright.x;').some(function (r) { return /_playwright/.test(r); }));
});

test('a bare fetch in any position, and the other request makers, are refused', function () {
  [
    'fetch(url)', 'fetch (url)', 'const f = fetch;', 'globalThis.fetch(url)', 'window.fetch (url)', 'const { fetch: f } = globalThis;',
    'route.fetch()', 'new XMLHttpRequest()', 'navigator.sendBeacon(u)', "require('axios')", "require('undici')", "require('node-fetch')",
    "require('got')", "import got from 'got';", 'got(url)', 'got (url)', 'APIRequestContext'
  ].forEach(function (t) {
    flagged(t + '\n');
  });
  clean('const refetched = 1; const fetcher = 2; const gotten = 3; const target = 4;\n');
});

test('a .request property access that is not a call, a request destructuring and request.newContext are refused', function () {
  [
    'const api = page.request;', 'page.request.delete(url)', 'context.request.get(url)', 'page?.request?.delete(url)',
    "page['request'].delete(url)", 'page["request"]', 'const { request } = page.context();', 'const { page, request } = ctx;',
    'test("x", async ({ page, request }) => {});', 'async function f({ request }) {}', 'const { request: r } = ctx;',
    'request.newContext()', 'playwright.request.newContext()'
  ].forEach(function (t) {
    flagged(t + '\n');
  });
  // a call of request() (the request of a route or a response) is fine
  clean('const r = route.request(); const q = response.request ();\n');
  clean('test("x", async ({ page, live }) => {});\n');
});

test('network and process modules are refused in the plain and node: forms', function () {
  ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'child_process'].forEach(function (m) {
    flagged("const x = require('" + m + "');\n");
    flagged("const x = require('node:" + m + "');\n");
    flagged("import x from '" + m + "';\n");
    flagged("import x from 'node:" + m + "';\n");
    flagged("import { y } from \"node:" + m + "\";\n");
    flagged("const x = await import('node:" + m + "');\n");
  });
  flagged('http.request(options);\n');
  flagged('https.request (options);\n');
  clean("const fs = require('node:fs'); const path = require('node:path');\n");
});

test('curl and wget are refused in a script', function () {
  assert.ok(rules('curl -s http://x\n', { script: true }).length > 0);
  assert.ok(rules('wget http://x\n', { script: true }).length > 0);
  clean('# a curly brace\n', { script: true });
});

test('routes of the spec\'s own are refused, and route.continue with an override', function () {
  [
    'page.route("**/*", h)', 'page.route ("**/*", h)', 'ctx.route(/x/, h)', 'page.unroute(x)', 'page.unrouteAll()', 'ctx.unrouteAll({})',
    'page.routeFromHAR(f)', 'ctx.routeWebSocket(/x/, h)', 'route.continue({ method: "GET" })', 'route.continue ({ url: u })'
  ].forEach(function (t) {
    flagged(t + ';\n');
  });
  clean('route.continue();\n');
});

test('defineConfig is refused outside the client module', function () {
  flagged("import { defineConfig } from '@playwright/test';\n");
  flagged("const { defineConfig } = require('@playwright/test');\n");
});

function liveTree(files) {
  const live = tempDir('live-tree-');
  Object.keys(files).forEach(function (rel) {
    const file = path.join(live, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, files[rel]);
  });
  return live;
}

test('the tree scan skips the client module, scans specs, scripts and the proxy folder, and refuses a config file elsewhere', function () {
  const live = liveTree({
    'fusion-client/fixture.js': 'page.request.delete(url); fetch(u); newContext;',
    'ok.spec.js': FIXTURE_IMPORT + "test('x', async ({ page, live }) => { await live.loginBrowser(page); });\n",
    'bad.spec.js': FIXTURE_IMPORT + "test('x', async ({ page }) => { await page.route('**/*', h); });\n",
    'helpers/util.js': 'const f = fetch;\n',
    'proxy/run.sh': 'curl http://x\n',
    'proxy/default.conf.template': 'curl fetch request\n',
    'playwright.config.js': 'module.exports = {};\n',
    'data.json': '{ "expr": "fetch(a, b)" }\n'
  });
  const found = check.checkTree(live, null);
  const where = found.map(function (f) { return f.file + ': ' + f.rule; });
  assert.ok(where.some(function (w) { return /^bad\.spec\.js: \.route\(/.test(w); }), where.join('\n'));
  assert.ok(where.some(function (w) { return /^helpers\/util\.js: the identifier fetch/.test(w); }));
  assert.ok(where.some(function (w) { return /^proxy\/run\.sh: curl or wget/.test(w); }));
  assert.ok(where.some(function (w) { return /^playwright\.config\.js: a Playwright configuration file/.test(w); }));
  assert.ok(!where.some(function (w) { return /^ok\.spec\.js/.test(w); }), where.join('\n'));
  assert.ok(!where.some(function (w) { return /^fusion-client/.test(w); }));
  assert.ok(!where.some(function (w) { return /^data\.json/.test(w) || /default\.conf\.template/.test(w); }));
});

test('the package.json test:live entries are scanned for curl and wget', function () {
  const live = liveTree({ 'a.spec.js': FIXTURE_IMPORT });
  const pkg = path.join(tempDir(), 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ scripts: { 'test:live': 'curl http://x && node a.js', 'test': 'wget x' } }));
  const found = check.checkTree(live, pkg);
  assert.deepStrictEqual(found.map(function (f) { return f.rule; }), ['curl or wget in the test:live entry']);
  fs.writeFileSync(pkg, JSON.stringify({ scripts: { 'test:live': 'node test/live/fusion-client/launcher.js' } }));
  assert.deepStrictEqual(check.checkTree(live, pkg), []);
});

test('the check passes on the real tree', function () {
  const findings = check.checkAll(root);
  assert.deepStrictEqual(findings, []);
});

test('the check fails if the guard installation is removed from the fixture', function () {
  const real = fs.readFileSync(path.join(root, 'test', 'live', 'fusion-client', 'fixture.js'), 'utf8');
  assert.deepStrictEqual(check.checkFixtureSource(real), []);
  check.FIXTURE_MARKERS.forEach(function (marker) {
    const mutated = real.split(marker[1]).join('removed');
    const found = check.checkFixtureSource(mutated);
    assert.strictEqual(found.length, 1, marker[0]);
    assert.match(found[0].rule, /no longer contains/);
  });
  // each marker is a distinct part of the fixture
  assert.ok(check.FIXTURE_MARKERS.length >= 12);
});

test('the Playwright version must be the exact pinned one in package.json, the installed packages and the lockfile', function () {
  assert.strictEqual(check.PINNED_PLAYWRIGHT, '1.65.0');
  assert.deepStrictEqual(check.checkPlaywrightVersion(root), []);
  const dir = tempDir('live-version-');
  const write = function (rel, obj) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(obj));
  };
  ['@playwright/test', 'playwright', 'playwright-core'].forEach(function (n) {
    write('node_modules/' + n + '/package.json', { version: '1.65.0' });
  });
  write('package.json', { devDependencies: { '@playwright/test': '1.65.0' } });
  assert.deepStrictEqual(check.checkPlaywrightVersion(dir), []);
  // a range
  write('package.json', { devDependencies: { '@playwright/test': '^1.65.0' } });
  assert.match(check.checkPlaywrightVersion(dir)[0].rule, /not exactly 1\.65\.0/);
  write('package.json', { devDependencies: { '@playwright/test': '1.64.0' } });
  assert.match(check.checkPlaywrightVersion(dir)[0].rule, /not exactly 1\.65\.0/);
  write('package.json', { devDependencies: {} });
  assert.ok(check.checkPlaywrightVersion(dir).length >= 1);
  // an installed package of another version
  write('package.json', { devDependencies: { '@playwright/test': '1.65.0' } });
  write('node_modules/playwright-core/package.json', { version: '1.66.0' });
  assert.match(check.checkPlaywrightVersion(dir)[0].rule, /installed version is 1\.66\.0/);
  write('node_modules/playwright-core/package.json', { version: '1.65.0' });
  // a lockfile that differs
  write('package-lock.json', { packages: { 'node_modules/@playwright/test': { version: '1.65.1' } } });
  assert.match(check.checkPlaywrightVersion(dir)[0].rule, /lockfile/);
  write('package-lock.json', { packages: { 'node_modules/@playwright/test': { version: '1.65.0' } } });
  assert.deepStrictEqual(check.checkPlaywrightVersion(dir), []);
});
