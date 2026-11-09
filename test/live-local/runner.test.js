'use strict';

// Specs run through the real Playwright test runner (version 1.65.0) against
// local servers: the built-in fixtures, the wrapper of the playwright fixture,
// the options a spec's test.use sets, and the failure at the end of a test.
// No Fusion. Skipped when no Chromium is installed for this version.
// Run with: npm run test:live-local

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const playwrightCore = require('playwright-core');
const { startWorld, root } = require('./world');

const HAVE_BROWSER = (function () {
  try {
    return fs.existsSync(playwrightCore.chromium.executablePath());
  } catch (e) {
    return false;
  }
})();
const skip = HAVE_BROWSER ? false : 'no Chromium for this Playwright version is installed';

function flatten(suite, out) {
  (suite.specs || []).forEach(function (spec) {
    spec.tests.forEach(function (t) {
      const result = t.results[t.results.length - 1] || {};
      out.push({
        title: spec.title,
        status: t.status,
        outcome: result.status,
        error: ((result.errors || []).map(function (e) { return e.message || ''; }).join('\n') || (result.error && result.error.message) || '').replace(/\u001b\[[0-9;]*m/g, '')
      });
    });
  });
  (suite.suites || []).forEach(function (s) { flatten(s, out); });
  return out;
}

// Run the specs whose file name matches `pattern` and return the outcomes and
// what the spy recorded.
async function runSpecs(world, pattern, env, config) {
  const dir = require('../node/live/helpers').tempDir('live-local-run-');
  const spyFile = path.join(dir, 'spy.jsonl');
  const jsonFile = path.join(dir, 'result.json');
  fs.writeFileSync(spyFile, '');
  const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const child = childProcess.spawn(process.execPath, [cli, 'test', '--config', config || path.join(__dirname, 'playwright.config.js'), pattern], {
    cwd: root,
    env: Object.assign(world.env(), {
      LIVE_LOCAL_SPY_FILE: spyFile,
      LIVE_LOCAL_OUTPUT_DIR: path.join(dir, 'out'),
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
      NODE_OPTIONS: '--require ' + path.join(__dirname, 'spy.js')
    }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', function (d) { log += d; });
  child.stderr.on('data', function (d) { log += d; });
  const code = await new Promise(function (resolve) { child.on('exit', resolve); });
  let tests = [];
  if (fs.existsSync(jsonFile)) {
    tests = flatten(JSON.parse(fs.readFileSync(jsonFile, 'utf8')), []);
  }
  const spy = fs.readFileSync(spyFile, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
  return { code: code, tests: tests, spy: spy, log: log };
}

function byTitle(run, text) {
  const found = run.tests.filter(function (t) { return t.title.indexOf(text) !== -1; });
  assert.strictEqual(found.length, 1, 'expected one test matching "' + text + '", got ' + found.length + '\n' + run.log.slice(-2000));
  return found[0];
}

test('plain guarded tests pass with the runner\'s built-in auto fixtures running', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const run = await runSpecs(world, 'plain.spec.js');
    assert.strictEqual(run.code, 0, run.log.slice(-3000));
    assert.strictEqual(run.tests.length, 3);
    run.tests.forEach(function (t) { assert.strictEqual(t.status, 'expected', t.title + '\n' + t.error); });
    // the browser was launched once, by the guarded fixture, with every key present
    const launches = run.spy.filter(function (r) { return r.kind === 'launch'; });
    assert.strictEqual(launches.length, 1);
    const options = require('../live/fusion-client/options');
    options.LAUNCH_KEYS.forEach(function (k) { assert.ok(launches[0].keys.indexOf(k) !== -1, k); });
    // the runner's launch defaults, trace and artifact directories included, were set before the launch read them
    assert.strictEqual(typeof launches[0].defaults.tracesDir, 'string');
    assert.strictEqual(typeof launches[0].defaults.artifactsDir, 'string');
    // after the run, nothing of the run's is left on the instance, and the registry has a deleted line per id
    assert.strictEqual(world.stub.blobs.size, 0);
    const files = fs.readdirSync(world.registryDir);
    assert.strictEqual(files.length, 1);
    assert.match(files[0], new RegExp('^' + world.runTag + '\\.[0-9a-f]{12}\\.jsonl$'));
    const states = fs.readFileSync(path.join(world.registryDir, files[0]), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l).state; });
    assert.strictEqual(states.filter(function (s) { return s === 'deleted'; }).length, 2);
    assert.ok(!fs.readFileSync(path.join(world.registryDir, files[0]), 'utf8').includes('127.0.0.1'));
    // the stand-in for Fusion saw the run's PUTs only after 404 checks
    const log = world.stub.log.filter(function (e) { return e.path.indexOf('/api/blobs/') === 0; });
    log.forEach(function (e, i) {
      if (e.method === 'PUT') {
        const prior = log.slice(0, i).filter(function (p) { return p.path === e.path; });
        assert.strictEqual(prior[prior.length - 1] && prior[prior.length - 1].method, 'GET');
      }
    });
  } finally {
    await world.close();
  }
});

test('a spec that asks for request, browser or a replacement context fails at setup, before it sends anything', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const run = await runSpecs(world, 'request-fixture.spec.js');
    const r = byTitle(run, 'stock request fixture');
    assert.strictEqual(r.status, 'unexpected');
    assert.match(r.error, /the request fixture is not available in live tests/);
    const b = byTitle(await runSpecs(world, 'browser-fixture.spec.js'), 'stock browser fixture');
    assert.strictEqual(b.status, 'unexpected');
    assert.match(b.error, /the browser fixture is not available in live tests/);
    const c = byTitle(await runSpecs(world, 'context-replaced.spec.js'), 'a replacement context fixture');
    assert.strictEqual(c.status, 'unexpected');
    assert.match(c.error, /the browser fixture is not available in live tests/);
    assert.ok(!world.stub.log.some(function (e) { return e.path.indexOf('/api/blobs/') === 0; }));
  } finally {
    await world.close();
  }
});

test('a spec that asks for playwright gets the wrapper: launch, connect and request.newContext throw, the rest works', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const run = await runSpecs(world, 'wrapper.spec.js');
    const r = byTitle(run, 'wrapper:');
    assert.strictEqual(r.status, 'expected', r.error);
    // none of the thrown calls launched a browser (the only launch is the guarded one)
    assert.strictEqual(run.spy.filter(function (x) { return x.kind === 'launch'; }).length, 0);
  } finally {
    await world.close();
  }
});

test('a spec\'s test.use options do not change the context or the launch the fixture builds', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const videoDir = require('../node/live/helpers').tempDir('live-local-video-');
    const run = await runSpecs(world, 'test-use.spec.js', { LIVE_LOCAL_VIDEO_DIR: videoDir });
    const r = byTitle(run, 'test.use:');
    assert.strictEqual(r.status, 'expected', r.error + '\n' + run.log.slice(-2000));
    const options = require('../live/fusion-client/options');
    const launches = run.spy.filter(function (x) { return x.kind === 'launch'; });
    const contexts = run.spy.filter(function (x) { return x.kind === 'context'; });
    assert.strictEqual(launches.length, 1);
    assert.strictEqual(contexts.length, 1);
    // the runner's defaults did carry the spec's settings; the explicit keys override every one of them
    assert.ok(launches[0].defaults.executablePath === '/nonexistent/chrome' || launches[0].defaults.args, JSON.stringify(launches[0].defaults));
    options.LAUNCH_KEYS.forEach(function (k) { assert.ok(launches[0].keys.indexOf(k) !== -1, k); });
    ['executablePath', 'args', 'proxy', 'env', 'slowMo'].forEach(function (k) {
      assert.strictEqual(launches[0].options[k], undefined, k);
    });
    assert.deepStrictEqual(launches[0].options.logger, { noop: true });
    options.CONTEXT_KEYS.forEach(function (k) { assert.ok(contexts[0].keys.indexOf(k) !== -1, k); });
    assert.strictEqual(contexts[0].options.serviceWorkers, 'block');
    ['proxy', 'storageState', 'httpCredentials', 'extraHTTPHeaders', 'userAgent'].forEach(function (k) {
      assert.strictEqual(contexts[0].options[k], undefined, k);
    });
    assert.strictEqual(contexts[0].keys.indexOf('recordVideo'), -1);
    assert.strictEqual(contexts[0].keys.indexOf('logger'), -1);
    // the spec's options bag asked for a video; the runner would copy that key into the context if the
    // combined options were not overridden, and a video file would be written
    assert.deepStrictEqual(fs.readdirSync(videoDir), []);
    // and the stand-in servers saw no proxied request, no extra header, no credentials, no stolen cookie
    const seen = world.stub.log;
    assert.ok(seen.some(function (e) { return e.path === '/api/collections'; }) || world.proxyLog.some(function (l) { return /api\/collections/.test(l); }));
    seen.forEach(function (e) {
      assert.strictEqual(e.headers['x-spec-header'], undefined);
      assert.strictEqual(e.headers.authorization, undefined);
      assert.ok(!/stolen/.test(e.headers.cookie || ''));
    });
  } finally {
    await world.close();
  }
});

test('an abort of any class but telemetry fails the test at its end, with the class and path', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const run = await runSpecs(world, 'fails-at-end.spec.js');
    const r = byTitle(run, 'an abort of any class');
    assert.strictEqual(r.status, 'unexpected');
    assert.match(r.error, /the live-test guard recorded 1 failure/);
    assert.match(r.error, /GET \/api\/solr\/banana-it-x\/admin\/ping aborted as unlisted-read/);
    assert.ok(!world.proxyLog.some(function (l) { return /admin\/ping/.test(l); }));
  } finally {
    await world.close();
  }
});

test('a PUT for an id that already exists is aborted, fails the test, and the other blob is left alone', { skip: skip }, async function () {
  const world = await startWorld();
  world.behave = function (entry, send) {
    if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
      send(200, [{ id: 'another-run' }]);
      return true;
    }
    return false;
  };
  try {
    const run = await runSpecs(world, 'put-collision.spec.js');
    const r = byTitle(run, 'a PUT for an id');
    assert.strictEqual(r.status, 'unexpected');
    assert.match(r.error, /aborted as collision/);
    assert.match(r.error, /aborted as collided/);
    assert.strictEqual(world.stub.log.filter(function (e) { return e.method === 'PUT' || e.method === 'DELETE' && e.path !== '/api/session'; }).length, 0);
  } finally {
    await world.close();
  }
});

test('a proxy for another instance, without the digest, or serving the Solr preset refuses to start, and nothing reaches the instance', { skip: skip }, async function () {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const cases = [
    ['a digest under another key', function (w) { return { BANANA_LIVE_DIGEST_KEY: crypto.randomBytes(32).toString('hex') }; }, /different instance/],
    ['a Solr preset', function (w) {
      w.bananaFiles['config.js'] = fs.readFileSync(path.join(root, 'src', 'config.solr.js'), 'utf8');
      return {};
    }, /USE_FUSION/],
    ['a run tag that is not 12 hexadecimal characters', function () { return { BANANA_LIVE_RUN_TAG: 'nothex' }; }, /RUN_TAG/],
    ['no run tag', function () { return { BANANA_LIVE_RUN_TAG: '' }; }, /RUN_TAG/]
  ];
  for (const c of cases) {
    const world = await startWorld();
    try {
      const env = c[1](world);
      const run = await runSpecs(world, 'plain.spec.js', env);
      assert.notStrictEqual(run.code, 0, c[0]);
      assert.ok(run.tests.length > 0 && run.tests.every(function (t) { return t.status !== 'expected'; }), c[0]);
      assert.match(run.tests.map(function (t) { return t.error; }).join('\n'), c[2], c[0]);
      // not even the login reached the instance
      assert.strictEqual(world.stub.log.length, 0, c[0] + ': ' + JSON.stringify(world.stub.log.map(function (e) { return e.method + ' ' + e.path; })));
      assert.strictEqual(run.spy.filter(function (r) { return r.kind === 'launch'; }).length, 0, c[0]);
    } finally {
      await world.close();
    }
  }
});

test('the alias form page.request throws for every method when it goes through the fixture', { skip: skip }, async function () {
  const world = await startWorld();
  try {
    const run = await runSpecs(world, 'alias.spec.js');
    const r = byTitle(run, 'alias:');
    assert.strictEqual(r.status, 'expected', r.error);
    assert.ok(!world.stub.log.some(function (e) { return e.path.indexOf('/api/blobs/Ops') === 0; }));
    assert.ok(!world.proxyLog.some(function (l) { return /api\/blobs\/Ops/.test(l); }));
  } finally {
    await world.close();
  }
});

// Count the files under `dir` whose bytes contain `needle`, skipping the
// directories in `skipNames`.
function filesHolding(dir, needle, skipNames) {
  let count = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipNames.indexOf(entry.name) === -1) {
        count += filesHolding(full, needle, skipNames);
      }
    } else if (entry.isFile() && fs.readFileSync(full).includes(needle)) {
      count += 1;
    }
  });
  return count;
}

test('a failed browser login leaves the password in no Playwright artefact, output file, log or file of the work tree', { skip: skip }, async function () {
  const secret = ['fake-pw', 'Zq81xT42', 'marker'].join('-');
  const world = await startWorld();
  world.failBrowserLogin = true;
  const out = require('../node/live/helpers').tempDir('live-local-artefacts-');
  try {
    const run = await runSpecs(world, 'failed-login.spec.js', {
      FUSION_PASSWORD: secret,
      BANANA_LIVE_OUTPUT_DIR: out
    }, path.join(__dirname, 'live-config.js'));
    const r = byTitle(run, 'failed login');
    assert.strictEqual(r.status, 'unexpected', 'the login must fail for this test to mean anything');
    assert.match(r.error, /the browser login answered 401/);
    // the runner would write error-context.md, a trace, a screenshot or a video here
    const written = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); } else { written.push(path.relative(out, full)); }
      });
    })(out);
    assert.deepStrictEqual(written.filter(function (f) { return /trace|\.png$|\.webm$|\.zip$/.test(f); }), [], written.join(', '));
    // without a page snapshot, error-context.md holds the error text only
    written.filter(function (f) { return /error-context\.md$/.test(f); }).forEach(function (f) {
      assert.ok(!/Page snapshot/.test(fs.readFileSync(path.join(out, f), 'utf8')), f);
    });
    assert.strictEqual(filesHolding(out, secret, []), 0);
    assert.ok(!run.log.includes(secret), 'the runner output holds the password');
    assert.ok(!r.error.includes(secret));
    assert.strictEqual(filesHolding(root, secret, ['node_modules', '.git']), 0);
  } finally {
    await world.close();
  }
});
