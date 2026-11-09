'use strict';

// The headers the container sends: the baseline set on what it generates itself, Fusion's headers
// left alone on what it forwards, caching, HSTS, the content policy mode, and the test-only digest
// header that exists only when its key is set. Skipped when Docker or the image is missing.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const h = require('./helpers');

const skip = !h.AVAILABLE;

const BASELINE = {
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};
const CSP = "default-src 'self'; script-src 'self' https://api.github.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.osm.org http://*.tile.osm.org; font-src 'self' data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
// Headers of a response that are not the container's choice: the protocol, the body, the file's validators.
const PLAIN = ['date', 'server', 'content-type', 'content-length', 'connection', 'etag', 'last-modified', 'accept-ranges',
  'cache-control', 'content-encoding', 'vary', 'transfer-encoding', 'location', 'keep-alive'];
const BASELINE_NAMES = Object.keys(BASELINE).concat(['content-security-policy']);

function baselineHeaders(res, where) {
  assert.strictEqual(res.headers['content-security-policy'], CSP, where);
  Object.keys(BASELINE).forEach(function (name) {
    assert.strictEqual(res.headers[name], BASELINE[name], where + ' ' + name);
  });
}

function onlyKnown(res, where, extra) {
  const allowed = PLAIN.concat(BASELINE_NAMES, extra || []);
  Object.keys(res.headers).forEach(function (name) {
    assert.ok(allowed.indexOf(name) !== -1, where + ': unexpected header ' + name);
  });
}

test('everything the container generates carries the baseline headers and nothing else extra', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on', BANANA_REDIRECT_HOSTS: 'alias.test' }, upstream: {} }, async function (container) {
    const answers = {
      static: await h.request(container, { path: '/' }),
      asset: await h.request(container, { path: '/app/app.js' }),
      config: await h.request(container, { path: '/config.js?r=1' }),
      mountConfig: await h.request(container, { path: '/admin/banana/config.js' }),
      mount: await h.request(container, { path: '/admin/banana/' }),
      mountRedirect: await h.request(container, { path: '/admin/banana' }),
      healthz: await h.request(container, { path: '/healthz' }),
      notFound: await h.request(container, { path: '/missing.js' }),
      notRouted: await h.request(container, { path: '/solr/x' }),
      misdirected: await h.request(container, { path: '/', headers: { host: 'evil.example' } }),
      aliasRedirect: await h.request(container, { path: '/', headers: { host: 'alias.test' } }),
      origin403: await h.request(container, { path: '/api/x', headers: { origin: 'https://evil.example' } }),
      fetch403: await h.request(container, { path: '/api/x', headers: { 'sec-fetch-site': 'cross-site' } }),
      method405: await h.request(container, { path: '/api', method: 'POST' }),
      post405: await h.request(container, { path: '/index.html', method: 'POST' }),
      tooBig: await h.request(container, { path: '/api/x', method: 'PUT', body: Buffer.alloc(11 * 1024 * 1024) })
    };
    Object.keys(answers).forEach(function (name) {
      baselineHeaders(answers[name], name);
      onlyKnown(answers[name], name);
    });
    assert.strictEqual(answers.static.status, 200);
    assert.strictEqual(answers.misdirected.status, 421);
    assert.strictEqual(answers.tooBig.status, 413);
    assert.strictEqual(answers.post405.status, 405);
    const early = await h.rawRequest(container, 'GET /a\\b HTTP/1.1');
    assert.match(early, /^HTTP\/1\.1 400 /);
    assert.ok(early.indexOf('Content-Security-Policy: ' + CSP) !== -1, 'a request nginx refuses itself carries the baseline');
  });
});

test('static files are revalidated: no-cache with validators, a conditional request gets 304', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on' } }, async function (container) {
    for (const p of ['/', '/index.html', '/app/app.js', '/app/dashboards/default.json', '/config.js', '/admin/banana/', '/admin/banana/config.js']) {
      const res = await h.request(container, { path: p });
      assert.strictEqual(res.status, 200, p);
      assert.strictEqual(res.headers['cache-control'], 'no-cache', p);
    }
    const first = await h.request(container, { path: '/index.html' });
    assert.ok(first.headers.etag && first.headers['last-modified']);
    const again = await h.request(container, { path: '/index.html', headers: { 'if-none-match': first.headers.etag } });
    assert.strictEqual(again.status, 304);
  });
});

test('forwarded responses keep Fusion\'s headers and do not get the baseline set', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    for (const p of ['/api', '/api/session', '/auth/login', '/admin/login']) {
      const res = await h.request(container, { path: p });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['x-frame-options'], 'DENY', p);
      for (const name of ['content-security-policy', 'referrer-policy', 'permissions-policy', 'x-content-type-options', 'strict-transport-security']) {
        assert.strictEqual(name in res.headers, false, p + ' ' + name);
      }
    }
  });
});

test('Strict-Transport-Security is sent only when BANANA_HSTS=on, and replaces Fusion\'s', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    for (const p of ['/', '/api/session']) {
      assert.strictEqual('strict-transport-security' in (await h.request(container, { path: p })).headers, false, p);
    }
  });
  await h.scenario({ env: { BANANA_HSTS: 'on' } }, async function (container) {
    for (const p of ['/', '/healthz', '/api/session', '/nothing']) {
      assert.strictEqual((await h.request(container, { path: p })).headers['strict-transport-security'], 'max-age=31536000', p);
    }
  });
});

test('BANANA_CSP_MODE=report-only renames the policy header; extra sources are appended to their directive', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_CSP_MODE: 'report-only', BANANA_CSP_CONNECT_SRC: 'https://*.example.com, https://api.example.org', BANANA_CSP_IMG_SRC: 'https:' } }, async function (container) {
    const res = await h.request(container, { path: '/' });
    assert.strictEqual('content-security-policy' in res.headers, false);
    const policy = res.headers['content-security-policy-report-only'];
    assert.ok(policy.indexOf("connect-src 'self' https://api.github.com https://*.example.com https://api.example.org;") !== -1, policy);
    assert.ok(policy.indexOf('http://*.tile.osm.org https:;') !== -1, policy);
    assert.ok(policy.indexOf("frame-ancestors 'self'") !== -1);
  });
});

test('the digest header exists only when the key is set, and is the HMAC of the Fusion origin under it', { skip: skip }, async function () {
  const key = crypto.randomBytes(32).toString('hex');
  const paths = ['/', '/config.js', '/admin/banana/config.js', '/healthz', '/nothing', '/api/session', '/auth/login', '/admin/login', '/api-ws'];
  await h.scenario({ env: { BANANA_LIVE_DIGEST_KEY: key, BANANA_ADMIN_MOUNT: 'on' } }, async function (container, upstream) {
    const expected = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(upstream.origin).digest('hex');
    for (const p of paths) {
      const res = await h.request(container, { path: p });
      assert.strictEqual(res.headers['x-banana-upstream-digest'], expected, p);
    }
    // on the container's own answers it comes with the baseline; no other header is added
    onlyKnown(await h.request(container, { path: '/' }), '/', ['x-banana-upstream-digest']);
    // a refusal carries it too (the live test checks the instance on its first request, whatever it is)
    assert.strictEqual((await h.request(container, { path: '/api/x', headers: { origin: 'https://evil.example' } })).headers['x-banana-upstream-digest'], expected);
  });
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on' } }, async function (container) {
    for (const p of paths) {
      const res = await h.request(container, { path: p });
      const names = Object.keys(res.headers).filter(function (n) { return /digest|banana/i.test(n); });
      assert.deepStrictEqual(names, [], p);
    }
    onlyKnown(await h.request(container, { path: '/' }), '/');
  });
});

test('there is no way to give the container a Fusion credential: nothing is added to a request', { skip: skip }, async function () {
  const never = 'hunter2-never';
  const env = {
    FUSION_USER: 'admin-never',
    FUSION_PASSWORD: never,
    FUSION_API_KEY: 'key-never',
    FUSION_AUTHORIZATION: 'Basic YWRtaW46bmV2ZXI=',
    BANANA_API_KEY: 'key-never',
    BANANA_FUSION_API_KEY: 'key-never'
  };
  await h.scenario({ env: env }, async function (container, upstream) {
    await h.request(container, { path: '/api/session' });
    await h.request(container, { path: '/api/blobs/x', method: 'PUT', body: '{}' });
    const logs = container.logs();
    assert.ok(!/never/.test(logs), 'a credential value reached the log');
    upstream.seen.concat(upstream.startup).forEach(function (r) {
      ['authorization', 'x-api-key', 'cookie'].forEach(function (name) {
        assert.strictEqual(name in r.headers, false, r.url + ' ' + name);
      });
      assert.ok(!/never/.test(JSON.stringify(r.headers)));
    });
    for (const p of ['/config.js', '/admin/banana/config.js', '/']) {
      assert.ok(!/never/.test((await h.request(container, { path: p })).body), p);
    }
  });
});

test('the access log has method, path, status and time; never a query string, cookie or credential', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    await h.request(container, { path: '/api/blobs/x?apiKey=SECRETKEYVALUE&q=hidden', headers: { cookie: 'id=SECRETCOOKIE', authorization: 'Basic U0VDUkVUQkFTSUM=', 'x-api-key': 'SECRETHEADERKEY' } });
    await h.request(container, { path: '/auth/login?return=%2Fsecret-return' });
    const logs = container.logs();
    assert.match(logs, / GET \/api\/blobs\/x 200 /);
    assert.match(logs, / GET \/auth\/login 200 /);
    for (const secret of ['SECRETKEYVALUE', 'hidden', 'SECRETCOOKIE', 'U0VDUkVUQkFTSUM', 'SECRETHEADERKEY', 'secret-return', 'apiKey']) {
      assert.strictEqual(logs.indexOf(secret), -1, secret);
    }
  });
});
