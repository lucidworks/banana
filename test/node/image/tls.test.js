'use strict';

// Upstream TLS: verification is on by default, the session cookie keeps Secure unless the development
// switch is on, and the settings that would silently break or weaken either are refused or warned about.
// An https stand-in with a self-signed certificate plays Fusion. Skipped when Docker, the image or
// openssl is missing.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const h = require('./helpers');

const HAVE_OPENSSL = childProcess.spawnSync('openssl', ['version']).status === 0;
const skip = !h.AVAILABLE || !HAVE_OPENSSL;
const NAME = 'host.docker.internal';

async function withTls(options, body) {
  const cert = h.selfSigned(NAME);
  const upstream = await h.startUpstream({ tls: cert });
  let container = null;
  try {
    const env = Object.assign({ FUSION_URL: upstream.origin, BANANA_PUBLIC_ORIGIN: 'https://banana.test', BANANA_INSECURE_COOKIES: 'off' }, options.env || {});
    const args = (options.ca ? ['-v', cert.certFile + ':/certs/ca.pem:ro'] : []).concat(options.args || []);
    container = await h.start(env, args);
    upstream.startup = upstream.seen.splice(0);
    await body(container, upstream, cert);
  } finally {
    if (container) { container.stop(); }
    await upstream.close();
  }
}

const PUBLIC_HOST = { host: 'banana.test' };

test('Fusion\'s certificate is verified by default: an untrusted one gives 502 and nothing reaches Fusion', { skip: skip }, async function () {
  await withTls({}, async function (container, upstream) {
    assert.match(container.logs(), /warning: Fusion check failed: the TLS handshake with Fusion failed or its certificate is not trusted/);
    const res = await h.request(container, { path: '/api/session', headers: PUBLIC_HOST });
    assert.strictEqual(res.status, 502);
    assert.deepStrictEqual(upstream.seen, []);
  });
});

test('with the certificate authority given, the proxied request works and the session cookie keeps Secure', { skip: skip }, async function () {
  await withTls({ ca: true, env: { FUSION_CA_FILE: '/certs/ca.pem' } }, async function (container, upstream) {
    assert.match(container.logs(), /banana: Fusion 5\.9\.16 answered/);
    assert.ok(!/BANANA_INSECURE_COOKIES=on/.test(container.logs()));
    const res = await h.request(container, { path: '/api/session', headers: PUBLIC_HOST });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['set-cookie'][0], 'id=abc; Path=/; Secure; HttpOnly; SameSite=Lax');
    assert.strictEqual(upstream.seen[0].headers['x-forwarded-proto'], 'https');
    assert.strictEqual(upstream.seen[0].headers.origin, upstream.origin);
  });
});

test('FUSION_TLS_VERIFY=off reaches an untrusted Fusion, and Secure still passes through', { skip: skip }, async function () {
  await withTls({ env: { FUSION_TLS_VERIFY: 'off' } }, async function (container) {
    const res = await h.request(container, { path: '/api/session', headers: PUBLIC_HOST });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['set-cookie'][0], /; Secure;/);
  });
});

test('the development switch drops Secure, and with an https public origin the log says that is a trap', { skip: skip }, async function () {
  await withTls({ ca: true, env: { FUSION_CA_FILE: '/certs/ca.pem', BANANA_INSECURE_COOKIES: 'on' } }, async function (container) {
    const res = await h.request(container, { path: '/api/session', headers: PUBLIC_HOST });
    assert.ok(!/Secure/.test(res.headers['set-cookie'][0]));
    assert.match(container.logs(), /BANANA_INSECURE_COOKIES=on with an https BANANA_PUBLIC_ORIGIN.*set BANANA_INSECURE_COOKIES=off for a real deployment/);
  });
});

test('an IP address as an https Fusion URL is refused while verification is on, because the web server matches host names only', { skip: skip }, async function () {
  const env = { FUSION_URL: 'https://192.0.2.10', BANANA_PUBLIC_ORIGIN: 'https://banana.test' };
  const refused = await h.runToEnd(env);
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.output, /FUSION_URL names an IP address over https.*DNS name that the certificate carries/);
  // with verification off there is nothing to match, and an http URL has no certificate
  const container = await h.start(Object.assign({}, env, { FUSION_TLS_VERIFY: 'off' }));
  container.stop();
});

test('a redirect from Fusion that spells out the default port is made relative too', { skip: skip }, async function () {
  const container = await h.start({ FUSION_URL: 'https://fusion.invalid', BANANA_PUBLIC_ORIGIN: 'https://banana.test' });
  try {
    const conf = h.docker(['exec', container.name, 'cat', '/run/banana/proxy.conf']).stdout;
    assert.match(conf, /proxy_redirect "~\*\^https:\/\/fusion\\\.invalid\(:443\)\?\(\/\.\*\)\$" \$2;/);
  } finally {
    container.stop();
  }
});
