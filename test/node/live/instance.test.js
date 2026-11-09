'use strict';

// Start-up checks: the served config.js (mode) and the keyed digest header
// (instance), and the settings that feed them.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { load } = require('./helpers');

const instance = load('instance.js');
const settings = load('settings.js');

const root = path.resolve(__dirname, '..', '..', '..');
const KEY = crypto.randomBytes(32).toString('hex');
const OTHER_KEY = crypto.randomBytes(32).toString('hex');
const FUSION = 'https://fusion.example.test';

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('ADR 0008, decision 6: the config check passes for the shipped config.js', function () {
  const config = instance.checkConfigSource(read('src/config.js'));
  assert.strictEqual(config.USE_FUSION, true);
  assert.strictEqual(config.SYSTEM_BANANA_BLOB_API, '/api/blobs');
});

test('ADR 0008, decision 6: the config check passes for the last release\'s config.js', function () {
  // test/node/fixtures/config-1.6.30.js is dist/config.js of release 1.6.30, byte for byte. It is a committed copy so
  // that the test does not depend on that release's history being present in the clone.
  const source = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'config-1.6.30.js'), 'utf8');
  assert.strictEqual(instance.checkConfigSource(source).USE_FUSION, true);
});

test('ADR 0008, decision 6: the config check fails for the Solr preset, for USE_FUSION false and for another blob path', function () {
  assert.throws(function () { instance.checkConfigSource(read('src/config.solr.js')); }, /USE_FUSION/);
  const shipped = read('src/config.js');
  assert.throws(function () { instance.checkConfigSource(shipped.replace('USE_FUSION: true', 'USE_FUSION: false')); }, /USE_FUSION/);
  assert.throws(function () { instance.checkConfigSource(shipped.replace('USE_FUSION: true', 'USE_FUSION: "true"')); }, /USE_FUSION/);
  assert.throws(function () { instance.checkConfigSource(shipped.replace('SYSTEM_BANANA_BLOB_API: "/api/blobs"', 'SYSTEM_BANANA_BLOB_API: "/api/other"')); }, /SYSTEM_BANANA_BLOB_API/);
  assert.throws(function () { instance.checkConfigSource(shipped.replace('SYSTEM_BANANA_BLOB_API: "/api/blobs"', 'SYSTEM_BANANA_BLOB_API: "/api/blobs/"')); }, /SYSTEM_BANANA_BLOB_API/);
  assert.throws(function () { instance.checkConfigSource(shipped.replace(/SYSTEM_BANANA_BLOB_API: "\/api\/blobs",/, '')); }, /SYSTEM_BANANA_BLOB_API/);
});

test('ADR 0008, decision 6: the config check fails for a config.js that throws, calls out or does not return settings', function () {
  assert.throws(function () { instance.checkConfigSource('throw new Error("x");'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define(["settings"], function () { throw new Error("x"); });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define([], function () { return fetch("http://x"); });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define([], function () { return require("fs").readFileSync("/etc/passwd"); });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define([], function () { return process.env; });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define([], function () { return new XMLHttpRequest(); });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('define([], function () { while (true) {} });'); }, /could not be evaluated/);
  assert.throws(function () { instance.checkConfigSource('// nothing'); }, /USE_FUSION/);
  assert.throws(function () { instance.checkConfigSource(''); }, /USE_FUSION/);
});

test('ADR 0008, decision 12: the digest of an origin is the HMAC-SHA-256 under the key', function () {
  const expected = crypto.createHmac('sha256', Buffer.from(KEY, 'hex')).update(FUSION).digest('hex');
  assert.strictEqual(settings.digestOf(FUSION, KEY), expected);
  assert.notStrictEqual(settings.digestOf(FUSION, KEY), settings.digestOf(FUSION, OTHER_KEY));
  assert.notStrictEqual(settings.digestOf(FUSION, KEY), settings.digestOf('https://other.example.test', KEY));
});

test('ADR 0008, decision 12: the digest check refuses a missing header, another origin, another key and an unset or malformed key', function () {
  const good = settings.digestOf(FUSION, KEY);
  instance.checkDigest(good, FUSION, KEY);
  instance.checkDigest(good.toUpperCase(), FUSION, KEY);
  assert.throws(function () { instance.checkDigest(null, FUSION, KEY); }, /did not answer with the digest header/);
  assert.throws(function () { instance.checkDigest('', FUSION, KEY); }, /did not answer with the digest header/);
  assert.throws(function () { instance.checkDigest(undefined, FUSION, KEY); }, /digest header/);
  assert.throws(function () { instance.checkDigest(settings.digestOf('https://other.example.test', KEY), FUSION, KEY); }, /different instance/);
  assert.throws(function () { instance.checkDigest(settings.digestOf(FUSION, OTHER_KEY), FUSION, KEY); }, /different instance/);
  assert.throws(function () { instance.checkDigest('abc', FUSION, KEY); }, /different instance/);
  assert.throws(function () { instance.checkDigest(good, FUSION, undefined); }, /key/);
  assert.throws(function () { instance.checkDigest(good, FUSION, ''); }, /key/);
  assert.throws(function () { instance.checkDigest(good, FUSION, 'xyz'); }, /key/);
  assert.throws(function () { instance.checkDigest(good, FUSION, KEY.slice(2)); }, /key/);
});

function startProxyStub(options) {
  const seen = [];
  const server = http.createServer(function (req, res) {
    seen.push(req.method + ' ' + req.url);
    const headers = { 'content-type': 'application/javascript' };
    if (options.digest !== undefined) {
      headers['x-banana-upstream-digest'] = options.digest;
    }
    res.writeHead(options.status || 200, headers);
    res.end(options.config === undefined ? read('src/config.js') : options.config);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({
        origin: 'http://127.0.0.1:' + server.address().port,
        seen: seen,
        close: function () { return new Promise(function (r) { server.closeAllConnections(); server.close(r); }); }
      });
    });
  });
}

test('ADR 0008, decision 12: the instance check passes for a proxy that answers with the right digest, and reads only config.js', async function () {
  const p = await startProxyStub({ digest: settings.digestOf(FUSION, KEY) });
  try {
    const config = await instance.checkInstance({ proxyOrigin: p.origin, fusionOrigin: FUSION, digestKey: KEY });
    assert.strictEqual(config.USE_FUSION, true);
    assert.deepStrictEqual(p.seen, ['GET /admin/banana/config.js']);
  } finally {
    await p.close();
  }
});

test('ADR 0008, decision 12: a proxy with no digest, another origin\'s digest or another key refuses to start', async function () {
  for (const digest of [undefined, settings.digestOf('https://other.example.test', KEY), settings.digestOf(FUSION, OTHER_KEY)]) {
    const p = await startProxyStub({ digest: digest });
    try {
      await assert.rejects(instance.checkInstance({ proxyOrigin: p.origin, fusionOrigin: FUSION, digestKey: KEY }), /digest|different instance/);
    } finally {
      await p.close();
    }
  }
});

test('ADR 0008, decision 12: an unset or malformed key refuses to start before the proxy is asked anything it could answer', async function () {
  const p = await startProxyStub({ digest: settings.digestOf(FUSION, KEY) });
  try {
    await assert.rejects(instance.checkInstance({ proxyOrigin: p.origin, fusionOrigin: FUSION, digestKey: undefined }), /key/);
    await assert.rejects(instance.checkInstance({ proxyOrigin: p.origin, fusionOrigin: FUSION, digestKey: 'zz' }), /key/);
  } finally {
    await p.close();
  }
});

test('ADR 0008, decisions 6 and 12: the mode check also refuses a proxy that serves the Solr preset, and a proxy that is down', async function () {
  const p = await startProxyStub({ digest: settings.digestOf(FUSION, KEY), config: read('src/config.solr.js') });
  try {
    await assert.rejects(instance.checkInstance({ proxyOrigin: p.origin, fusionOrigin: FUSION, digestKey: KEY }), /USE_FUSION/);
  } finally {
    await p.close();
  }
  await assert.rejects(instance.checkInstance({ proxyOrigin: 'http://127.0.0.1:1', fusionOrigin: FUSION, digestKey: KEY }), /did not answer/);
  const gone = await startProxyStub({ digest: settings.digestOf(FUSION, KEY), status: 404 });
  try {
    await assert.rejects(instance.checkInstance({ proxyOrigin: gone.origin, fusionOrigin: FUSION, digestKey: KEY }), /answered 404/);
  } finally {
    await gone.close();
  }
});

const GOOD_ENV = {
  BANANA_LIVE_FUSION_URL: 'https://fusion.example.test/',
  BANANA_LIVE_REGISTRY_DIR: '/x',
  BANANA_LIVE_RUN_TAG: 'aaaaaaaaaaaa',
  BANANA_LIVE_DIGEST_KEY: KEY,
  BANANA_LIVE_PROXY_URL: 'http://127.0.0.1:1234',
  FUSION_USER: 'u',
  FUSION_PASSWORD: 'p'
};

test('ADR 0008, scenario N11 and decision 12: a missing or malformed run tag, key or URL refuses to start', function () {
  const ok = settings.readSettings(GOOD_ENV, { credentials: true, proxy: true });
  assert.strictEqual(ok.fusionOrigin, 'https://fusion.example.test');
  assert.strictEqual(ok.proxyOrigin, 'http://127.0.0.1:1234');
  const without = function (key, value) {
    const env = Object.assign({}, GOOD_ENV);
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
    return env;
  };
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_RUN_TAG')); }, /RUN_TAG/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_RUN_TAG', 'XYZ')); }, /RUN_TAG/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_DIGEST_KEY')); }, /DIGEST_KEY/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_DIGEST_KEY', 'abc')); }, /DIGEST_KEY/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_FUSION_URL')); }, /FUSION_URL/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_FUSION_URL', 'not a url')); }, /FUSION_URL/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_FUSION_URL', 'ftp://x')); }, /FUSION_URL/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_REGISTRY_DIR')); }, /REGISTRY_DIR/);
  assert.throws(function () { settings.readSettings(without('FUSION_USER'), { credentials: true }); }, /FUSION_USER/);
  assert.throws(function () { settings.readSettings(without('BANANA_LIVE_PROXY_URL'), { proxy: true }); }, /PROXY_URL/);
});

test('ADR 0008, decision 12: one variable gives the upstream and the base; there is no second setting', function () {
  // A different URL in another variable is ignored.
  const env = Object.assign({}, GOOD_ENV, { FUSION_URL: 'https://another.example.test', BANANA_LIVE_UPSTREAM_URL: 'https://another.example.test' });
  assert.strictEqual(settings.readSettings(env).fusionOrigin, 'https://fusion.example.test');
  const bare = Object.assign({}, GOOD_ENV);
  delete bare.BANANA_LIVE_FUSION_URL;
  bare.FUSION_URL = 'https://fusion.example.test';
  assert.throws(function () { settings.readSettings(bare); }, /BANANA_LIVE_FUSION_URL/);
  // No file of the client module names a variable that holds a URL except this one and the proxy URL the launcher sets.
  const dir = path.join(root, 'test', 'live', 'fusion-client');
  const names = new Set();
  fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    (text.match(/[A-Z][A-Z0-9_]*_URL/g) || []).forEach(function (n) { names.add(n); });
  });
  assert.deepStrictEqual(Array.from(names).sort(), ['BANANA_LIVE_FUSION_URL', 'BANANA_LIVE_PROXY_URL']);
  // The proxy receives the same variable by name.
  assert.match(fs.readFileSync(path.join(dir, 'proxy.js'), 'utf8'), /'-e', settings\.VAR\.fusionUrl/);
  assert.strictEqual(settings.VAR.fusionUrl, 'BANANA_LIVE_FUSION_URL');
});
