'use strict';

// Which routes the container forwards to Fusion, which it answers itself and which it refuses,
// and the Host, Origin and Sec-Fetch-Site checks that run first. A stand-in records what reaches
// "Fusion". Skipped when Docker or the image is missing (see helpers.js).
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');

const skip = !h.AVAILABLE;
const PUBLIC_HOST = new URL(h.PUBLIC).host;

test('routes: what is forwarded, what the container answers itself and what it refuses', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on' } }, async function (container, upstream) {
    const status = async function (p, method) {
      return (await h.request(container, { path: p, method: method })).status;
    };
    // forwarded, with the request address as sent
    for (const p of ['/api', '/api/', '/api/collections', '/api/blobs?resourceType=banana', '/api/solr/c/select?q=%2A', '/api/apollo/x', '/auth/login', '/auth/build/app.js', '/admin', '/admin/', '/admin/login', '/admin/bundle.js', '/admin/bananas']) {
      upstream.seen.length = 0;
      assert.strictEqual(await status(p), 200, p);
      assert.deepStrictEqual(upstream.urls(), [p], p);
    }
    // the address reaches Fusion unchanged, encoded characters, doubled slashes and all
    for (const p of ['/api/blobs/banana-it%20x%2Fy%3Fz?resourceType=banana', '/api/blobs/a%23b', '//api/collections', '/api/a/../collections', '/api/blobs/%25']) {
      upstream.seen.length = 0;
      await status(p);
      assert.deepStrictEqual(upstream.urls(), [p], p);
    }
    // answered by the container, never forwarded
    upstream.seen.length = 0;
    assert.strictEqual(await status('/healthz'), 200);
    assert.strictEqual(await status('/'), 200);
    assert.strictEqual(await status('/admin/banana/'), 200);
    assert.strictEqual(await status('/admin/banana/index.html'), 200);
    assert.strictEqual(await status('/config.js'), 200);
    assert.strictEqual(await status('/admin/banana/config.js'), 200);
    assert.strictEqual(await status('/admin/banana/nothing.js'), 404);
    assert.strictEqual(await status('/nothing.js'), 404);
    // not routed
    for (const p of ['/api-ws', '/api-ws/x', '/solr', '/solr/c/select', '/oauth2/x', '/actuator/health', '/healthz/upstream']) {
      assert.strictEqual(await status(p), 404, p);
    }
    assert.deepStrictEqual(upstream.urls(), []);
    // the exact /api route is GET and HEAD only; POST /api (it sets the first administrator's password) is not forwarded
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.strictEqual(await status('/api', method), 405, method);
    }
    assert.strictEqual(await status('/api', 'HEAD'), 200);
    assert.deepStrictEqual(upstream.urls(), ['/api']);
    // under /api/ every method is forwarded
    upstream.seen.length = 0;
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.strictEqual(await status('/api/blobs/x', method), 200, method);
    }
    assert.strictEqual(upstream.seen.length, 4);
  });
});

test('local paths in encoded, dot-segment and doubled-slash forms never reach Fusion', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on' } }, async function (container, upstream) {
    const forms = [
      '/admin/./banana/', '/admin/x/../banana/', '//admin//banana//', '/admin/banana/./', '/admin/banana/x/../',
      '/%61dmin/banana/', '/admin%2Fbanana/', '/admin/banana%2F', '/admin/%62anana/',
      '/./config.js', '//config.js', '/%63onfig.js', '/config%2ejs', '/x/../config.js',
      '/admin/banana/../banana/config.js', '/admin/banana//config.js', '/admin/banana/./config.js', '/admin/banana/%63onfig.js',
      '/./healthz', '//healthz', '/%68ealthz', '/x/../healthz', '/healthz/../healthz'
    ];
    for (const p of forms) {
      const res = await h.request(container, { path: p });
      assert.ok(res.status === 200 || res.status === 308, p + ' answered ' + res.status);
    }
    assert.deepStrictEqual(upstream.urls(), []);
    // and the rendered configuration, not Fusion's or the image's own, answers for them
    assert.match((await h.request(container, { path: '/%63onfig.js' })).body, /generated when the container started/i);
    assert.match((await h.request(container, { path: '/admin/banana/../banana/config.js' })).body, /"FUSION_LOGIN_URL": "\.\.\/login"/);
  });
});

test('exact /admin/banana redirects with a relative address when the mount is on, and is 404 when it is off', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on', BANANA_ALLOWED_ORIGINS: 'https://second.test' } }, async function (container, upstream) {
    for (const host of [PUBLIC_HOST, 'second.test']) {
      const res = await h.request(container, { path: '/admin/banana', headers: { host: host } });
      assert.strictEqual(res.status, 308);
      assert.strictEqual(res.headers.location, '/admin/banana/');
    }
    assert.strictEqual((await h.request(container, { path: '/admin/banana', method: 'POST' })).status, 405);
    assert.deepStrictEqual(upstream.urls(), []);
  });
  await h.scenario({}, async function (container, upstream) {
    for (const p of ['/admin/banana', '/admin/banana/', '/admin/banana/index.html', '/admin/banana/config.js']) {
      assert.strictEqual((await h.request(container, { path: p })).status, 404, p);
    }
    assert.deepStrictEqual(upstream.urls(), []);
    // the rest of /admin/ is still forwarded
    assert.strictEqual((await h.request(container, { path: '/admin/login' })).status, 200);
    assert.deepStrictEqual(upstream.urls(), ['/admin/login']);
  });
});

test('the admin route can be turned off', { skip: skip }, async function () {
  await h.scenario({ env: { FUSION_PROXY_ADMIN_UI: 'off' } }, async function (container, upstream) {
    for (const p of ['/admin', '/admin/', '/admin/login', '/admin/banana/']) {
      assert.strictEqual((await h.request(container, { path: p })).status, 404, p);
    }
    assert.strictEqual((await h.request(container, { path: '/api/session' })).status, 200);
    assert.strictEqual((await h.request(container, { path: '/auth/login' })).status, 200);
    assert.deepStrictEqual(upstream.urls(), ['/api/session', '/auth/login']);
  });
});

test('a raw backslash or control character in the path is refused with 400 and never forwarded', { skip: skip }, async function () {
  await h.scenario({}, async function (container, upstream) {
    for (const line of ['GET /api/a\\b HTTP/1.1', 'GET /api/a\u0001b HTTP/1.1', 'GET /a\\b HTTP/1.1', 'GET /\\evil.example HTTP/1.1']) {
      const answer = await h.rawRequest(container, line);
      assert.match(answer, /^HTTP\/1\.1 400 /, JSON.stringify(line));
    }
    // a backslash after the ?, in the query, is ordinary (Solr escapes with it)
    const ok = await h.request(container, { path: '/api/solr/c/select?q=a%5Cb&fq=x\\:y' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(upstream.urls(), ['/api/solr/c/select?q=a%5Cb&fq=x\\:y']);
  });
});

test('Host: the public name and allowed origins are served, aliases are redirected, others get 421', { skip: skip }, async function () {
  await h.scenario({
    env: {
      BANANA_ALLOWED_ORIGINS: 'https://Second.Test:443, http://third.test:9000',
      BANANA_REDIRECT_HOSTS: 'Alias.Test, short, other.test:8081'
    }
  }, async function (container, upstream) {
    const get = function (host, p, method) { return h.request(container, { path: p || '/api/session', method: method, headers: { host: host } }); };
    // the public name (port 8080 is not the default for http) and the allowed origins
    assert.strictEqual((await get(PUBLIC_HOST)).status, 200);
    assert.strictEqual((await get('BANANA.TEST:8080')).status, 200);
    assert.strictEqual((await get('second.test')).status, 200);
    assert.strictEqual((await get('second.test:443')).status, 200);
    assert.strictEqual((await get('third.test:9000')).status, 200);
    // the public port is significant, and so is the allowed origin's
    assert.strictEqual((await get('banana.test')).status, 421);
    assert.strictEqual((await get('banana.test:80')).status, 421);
    assert.strictEqual((await get('third.test')).status, 421);
    assert.strictEqual((await get('second.test:8443')).status, 421);
    assert.strictEqual(upstream.seen.length, 5);
    upstream.seen.length = 0;
    // an alias: GET and HEAD are redirected to the public origin, the address is built from the configuration
    // (the port of an entry without one is the default port of the public origin's scheme, 80 here)
    for (const host of ['alias.test', 'ALIAS.test:80', 'short', 'other.test:8081']) {
      const res = await get(host, '/admin/banana/?x=1');
      assert.strictEqual(res.status, 308, host);
      assert.strictEqual(res.headers.location, h.PUBLIC + '/admin/banana/?x=1', host);
      assert.strictEqual((await get(host, '/x', 'HEAD')).status, 308, host);
    }
    // an alias entry without a port matches only the default port
    assert.strictEqual((await get('alias.test:8081')).status, 421);
    assert.strictEqual((await get('other.test')).status, 421);
    // any other method to an alias gets 421 and is not forwarded
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await get('alias.test', '/api/blobs/x', method);
      assert.strictEqual(res.status, 421, method);
      assert.match(res.body, new RegExp(h.PUBLIC.replace(/[.]/g, '\\.')));
    }
    // an unknown or missing Host is 421 with a page that names the public address
    for (const host of ['evil.example', '127.0.0.1:' + container.port, 'banana.test.evil.example']) {
      const res = await get(host);
      assert.strictEqual(res.status, 421, host);
      assert.ok(res.body.indexOf(h.PUBLIC) !== -1);
    }
    assert.deepStrictEqual(upstream.urls(), []);
  });
});

test('Host: /healthz is exempt, /healthz/upstream is not, and a front end that rewrites Host gets 421', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_HEALTH_UPSTREAM: 'on' } }, async function (container) {
    assert.strictEqual((await h.request(container, { path: '/healthz', headers: { host: 'banana:8080' } })).status, 200);
    assert.strictEqual((await h.request(container, { path: '/healthz/upstream', headers: { host: 'banana:8080' } })).status, 421);
    assert.strictEqual((await h.request(container, { path: '/healthz/upstream' })).status, 200);
    for (const p of ['/', '/config.js', '/api/session', '/auth/login', '/admin/login']) {
      assert.strictEqual((await h.request(container, { path: p, headers: { host: 'banana:8080' } })).status, 421, p);
    }
  });
});

test('Host: a redirect host that a front end sends as Host gets 308 on GET (the documented loop), not forwarding', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_REDIRECT_HOSTS: 'banana:8080' } }, async function (container, upstream) {
    const res = await h.request(container, { path: '/api/session', headers: { host: 'banana:8080' } });
    assert.strictEqual(res.status, 308);
    assert.strictEqual(res.headers.location, h.PUBLIC + '/api/session');
    assert.deepStrictEqual(upstream.urls(), []);
  });
});

test('Origin: none, the public origin and allowed origins pass; anything else, null included, gets 403 before Fusion', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ALLOWED_ORIGINS: 'https://second.test' } }, async function (container, upstream) {
    const send = function (origin, method, host) {
      return h.request(container, { path: '/api/blobs/x', method: method || 'PUT', headers: { origin: origin, host: host || PUBLIC_HOST } });
    };
    // allowed: no Origin at all, the public origin (case and default port normalized), an allowed origin
    assert.strictEqual((await send(null)).status, 200);
    assert.strictEqual((await send(h.PUBLIC)).status, 200);
    assert.strictEqual((await send('HTTP://Banana.Test:8080')).status, 200);
    assert.strictEqual((await send('https://second.test', 'PUT', 'second.test')).status, 200);
    assert.strictEqual((await send('https://SECOND.test:443', 'PUT', 'second.test')).status, 200);
    assert.strictEqual(upstream.seen.length, 5);
    // refused
    upstream.seen.length = 0;
    for (const origin of ['null', 'https://evil.example', 'http://banana.test', 'http://banana.test:80', 'https://banana.test:8080', 'http://banana.test:8080.evil', 'http://evil.example:8080', 'https://second.test:8443', 'http://second.test']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await send(origin, method);
        assert.strictEqual(res.status, 403, method + ' ' + origin);
      }
    }
    assert.deepStrictEqual(upstream.urls(), []);
  });
});

test('Sec-Fetch-Site under /api/: cross-site and same-site are refused for every method, the rest pass', { skip: skip }, async function () {
  await h.scenario({}, async function (container, upstream) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
      for (const value of ['cross-site', 'same-site', 'Cross-Site']) {
        const res = await h.request(container, { path: '/api/collections', method: method, headers: { 'sec-fetch-site': value } });
        assert.strictEqual(res.status, 403, method + ' ' + value);
      }
      for (const value of ['same-origin', 'none', null]) {
        const res = await h.request(container, { path: '/api/collections', method: method, headers: { 'sec-fetch-site': value } });
        assert.strictEqual(res.status, 200, method + ' ' + value);
      }
    }
    assert.strictEqual(upstream.seen.length, 15);
  });
});

test('Sec-Fetch-Site outside /api/: GET and HEAD are never refused; cross-site writes are', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on' } }, async function (container, upstream) {
    for (const method of ['GET', 'HEAD']) {
      for (const p of ['/', '/auth/login', '/admin/login', '/config.js', '/api', '/admin/banana/']) {
        for (const value of ['cross-site', 'same-site', 'same-origin', 'none', null]) {
          const res = await h.request(container, { path: p, method: method, headers: { 'sec-fetch-site': value } });
          assert.strictEqual(res.status, 200, method + ' ' + p + ' ' + value);
        }
      }
    }
    upstream.seen.length = 0;
    for (const method of ['POST', 'PUT', 'DELETE']) {
      for (const p of ['/auth/login', '/admin/login']) {
        const res = await h.request(container, { path: p, method: method, headers: { 'sec-fetch-site': 'cross-site' } });
        assert.strictEqual(res.status, 403, method + ' ' + p);
        for (const value of ['same-site', 'same-origin', 'none', null]) {
          const ok = await h.request(container, { path: p, method: method, headers: { 'sec-fetch-site': value } });
          assert.strictEqual(ok.status, 200, method + ' ' + p + ' ' + value);
        }
      }
    }
    assert.strictEqual(upstream.seen.length, 3 * 2 * 4);
  });
});

test('what Fusion receives: Origin and Host rewritten, address headers and identity headers removed, the rest as sent', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_STRIP_HEADERS: 'x-sso-user, X-SSO-Groups, True-Client-IP' } }, async function (container, upstream) {
    const headers = {
      origin: h.PUBLIC,
      cookie: 'id=session-value',
      authorization: 'Basic dXNlcjpwYXNz',
      'x-api-key': 'key-value',
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.9',
      forwarded: 'for=203.0.113.9',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-port': '1',
      'x-forwarded-prefix': '/x',
      'x-forwarded-proto': 'http',
      'x-remote-user': 'admin',
      'x-forwarded-user': 'admin',
      'remote-user': 'admin',
      'x-remote-groups': 'admins',
      'x-forwarded-groups': 'admins',
      'x-auth-request-user': 'admin',
      'x-auth-request-email': 'a@example.com',
      'x-auth-request-groups': 'admins',
      'X-SSO-User': 'admin',
      'x-sso-groups': 'admins',
      'true-client-ip': '203.0.113.9',
      'x-custom': 'kept'
    };
    await h.request(container, { path: '/api/blobs/x?apiKey=abc', method: 'PUT', headers: headers, body: '{"a":1}' });
    const got = upstream.seen[0];
    assert.strictEqual(got.url, '/api/blobs/x?apiKey=abc');
    assert.strictEqual(got.headers.origin, upstream.origin);
    assert.strictEqual(got.headers.host, upstream.host);
    assert.strictEqual(got.headers['x-forwarded-proto'], 'http', 'the scheme of the Fusion URL, not the client\'s');
    // the user's own credentials are forwarded as sent
    assert.strictEqual(got.headers.cookie, 'id=session-value');
    assert.strictEqual(got.headers.authorization, 'Basic dXNlcjpwYXNz');
    assert.strictEqual(got.headers['x-api-key'], 'key-value');
    assert.strictEqual(got.headers['x-custom'], 'kept');
    for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-prefix', 'x-remote-user', 'x-forwarded-user', 'remote-user', 'x-remote-groups', 'x-forwarded-groups', 'x-auth-request-user', 'x-auth-request-email', 'x-auth-request-groups', 'x-sso-user', 'x-sso-groups', 'true-client-ip']) {
      assert.strictEqual(name in got.headers, false, name + ' reached Fusion');
    }
    // an empty list changes nothing: the built-in names are still removed, and the container adds none
    assert.strictEqual(Object.keys(got.headers).filter(function (n) { return /^(x-forwarded-|x-real|forwarded)/.test(n) && n !== 'x-forwarded-proto'; }).length, 0);
  });
  await h.scenario({ env: { BANANA_STRIP_HEADERS: '  ' } }, async function (container, upstream) {
    await h.request(container, { path: '/api/x', headers: { 'x-remote-user': 'admin', 'x-forwarded-for': '1.2.3.4' } });
    assert.strictEqual('x-remote-user' in upstream.seen[0].headers, false);
    assert.strictEqual('x-forwarded-for' in upstream.seen[0].headers, false);
  });
});

test('the session cookie passes through; Secure is dropped only with the development switch; Fusion\'s HSTS never passes', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_INSECURE_COOKIES: 'on' } }, async function (container) {
    const res = await h.request(container, { path: '/api/session' });
    assert.strictEqual(res.headers['set-cookie'][0], 'id=abc; Path=/; HttpOnly; SameSite=Lax');
    assert.strictEqual('strict-transport-security' in res.headers, false);
    // Fusion's own headers on proxied responses are kept
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
  });
});

test('a redirect to the Fusion origin becomes a relative redirect', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    const res = await h.request(container, { path: '/api/redirect' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/landing');
  });
});

test('/healthz/upstream is off by default; when on it runs the check, reports Trusted-HTTP realms and answers from a 10 second cache', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    assert.strictEqual((await h.request(container, { path: '/healthz/upstream' })).status, 404);
  });
  const realms = [{ name: 'native', realmType: 'native' }, { name: 'corp-sso', realmType: 'trusted-http' }];
  await h.scenario({ env: { BANANA_HEALTH_UPSTREAM: 'on' }, upstream: { realms: realms } }, async function (container, upstream) {
    upstream.seen.length = 0;
    const first = await h.request(container, { path: '/healthz/upstream' });
    assert.strictEqual(first.status, 200);
    assert.match(first.headers['content-type'], /json/);
    assert.deepStrictEqual(JSON.parse(first.body), { ok: true, version: '5.9.16', trustedHttpRealms: ['corp-sso'] });
    for (let i = 0; i < 5; i++) {
      assert.strictEqual((await h.request(container, { path: '/healthz/upstream' })).status, 200);
    }
    assert.deepStrictEqual(upstream.urls(), ['/api'], 'a flood made more than one call to Fusion in the interval');
    assert.match(container.logs(), /\/healthz\/upstream: .*corp-sso/);
    assert.strictEqual((await h.request(container, { path: '/healthz/upstream', method: 'POST' })).status, 405);
    // The cache keeps an answer for 10 seconds, counted in whole seconds from when Fusion answered:
    // allow a few more seconds for the refresh, and still require exactly one more call.
    await h.sleep(10500);
    for (let attempt = 0; attempt < 5 && upstream.seen.length < 2; attempt++) {
      await h.request(container, { path: '/healthz/upstream' });
      await h.sleep(1000);
    }
    assert.strictEqual(upstream.seen.length, 2, 'the answer was not refreshed after the interval');
  });
});

test('/healthz/upstream answers 503 when Fusion does not', { skip: skip }, async function () {
  const upstream = await h.startUpstream();
  let container;
  try {
    container = await h.start(h.baseEnv({ origin: 'http://127.0.0.1:1' }, { BANANA_HEALTH_UPSTREAM: 'on' }));
    const res = await h.request(container, { path: '/healthz/upstream' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(JSON.parse(res.body).ok, false);
    assert.strictEqual((await h.request(container, { path: '/healthz' })).status, 200);
    // a Fusion that is down is a 502 for the proxied routes, with the container's own headers
    const down = await h.request(container, { path: '/api/session' });
    assert.strictEqual(down.status, 502);
    assert.ok(down.headers['content-security-policy']);
  } finally {
    if (container) { container.stop(); }
    await upstream.close();
  }
});

test('requests of 10 MB are accepted and larger ones refused', { skip: skip }, async function () {
  await h.scenario({}, async function (container, upstream) {
    const ok = await h.request(container, { path: '/api/blobs/x', method: 'PUT', body: Buffer.alloc(9 * 1024 * 1024, 97) });
    assert.strictEqual(ok.status, 200);
    const big = await h.request(container, { path: '/api/blobs/x', method: 'PUT', body: Buffer.alloc(11 * 1024 * 1024, 97) });
    assert.strictEqual(big.status, 413);
    assert.strictEqual(upstream.seen.length, 1);
  });
});
