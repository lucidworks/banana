'use strict';

// The container start-up: the configuration rendered from the environment, and what it refuses.
// Skipped when Docker or the image is missing (see helpers.js).
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const h = require('./helpers');

const skip = !h.AVAILABLE;

// Evaluates a rendered config.js with a stub loader that hands back the object it was given.
function evaluate(source) {
  let result;
  vm.runInNewContext(source, {
    define: function (deps, factory) {
      result = factory(function (o) { return o; });
    }
  });
  return JSON.parse(JSON.stringify(result));
}

// The values of src/config.js through the real settings.js.
function shipped() {
  const run = function (rel, resolve) {
    let result;
    vm.runInNewContext(fs.readFileSync(path.join(h.root, rel), 'utf8'), {
      window: { location: { hostname: 'localhost' } },
      define: function (deps, factory) {
        if (typeof deps === 'function') { factory = deps; deps = []; }
        result = factory.apply(null, deps.map(resolve));
      }
    });
    return result;
  };
  const underscore = { each: function (o, fn) { Object.keys(o).forEach(function (k) { fn(o[k], k); }); } };
  const Settings = run('src/app/components/settings.js', function () { return underscore; });
  return JSON.parse(JSON.stringify(run('src/config.js', function () { return Settings; })));
}

test('/config.js is the Fusion preset of this build plus the login page for the root page', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    const res = await h.request(container, { path: '/config.js?r=abc123' });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.strictEqual(res.headers['cache-control'], 'no-cache');
    const config = evaluate(res.body);
    const expected = shipped();
    expected.FUSION_LOGIN_URL = '/auth/login';
    assert.deepStrictEqual(config, expected);
    // typed values, not strings
    assert.strictEqual(config.USE_FUSION, true);
    assert.ok(Array.isArray(config.panel_names));
    // the image's own dist/config.js is never what is served
    const own = await h.request(container, { path: '/config.js' });
    assert.ok(/generated when the container started/i.test(own.body));
  });
});

test('the mount at /admin/banana/ has its own config.js with the 1.6.30 login redirect and session path', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_ADMIN_MOUNT: 'on', FUSION_LOGIN_URL: '/admin/login' } }, async function (container, upstream) {
    const root = evaluate((await h.request(container, { path: '/config.js' })).body);
    const mount = evaluate((await h.request(container, { path: '/admin/banana/config.js?r=1' })).body);
    assert.strictEqual(root.FUSION_LOGIN_URL, '/admin/login');
    assert.strictEqual(mount.FUSION_LOGIN_URL, '../login');
    assert.strictEqual(mount.FUSION_SESSION_API, '/api/session');
    assert.deepStrictEqual(upstream.seen, []);
    const page = await h.request(container, { path: '/admin/banana/' });
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /<html/i);
  });
});

test('environment values are typed: booleans, a list of panels, strings, paths', { skip: skip }, async function () {
  await h.scenario({
    env: {
      BANANA_SETTING_USE_ADMIN_LUKE: 'false',
      BANANA_SETTING_panel_names: 'bar, table,facet',
      BANANA_SETTING_solr_core: 'my_collection',
      BANANA_SETTING_solr: '/api/query-pipelines/default/collections/',
      FUSION_LOGIN_URL: '/auth/login'
    }
  }, async function (container) {
    const config = evaluate((await h.request(container, { path: '/config.js' })).body);
    assert.strictEqual(config.USE_ADMIN_LUKE, false);
    assert.deepStrictEqual(config.panel_names, ['bar', 'table', 'facet']);
    assert.strictEqual(config.solr_core, 'my_collection');
    assert.strictEqual(config.solr, '/api/query-pipelines/default/collections/');
  });
});

test('a hostile value cannot end the script, and arrives unchanged', { skip: skip }, async function () {
  const hostile = 'a"</script><script>alert(1)</script>&\\' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "'x";
  await h.scenario({ env: { BANANA_SETTING_solr_core: hostile } }, async function (container) {
    const res = await h.request(container, { path: '/config.js' });
    assert.ok(!/[<>&\u2028\u2029]/.test(res.body.split('\n').filter(function (l) { return /solr_core/.test(l); }).join('')), 'unescaped character in the rendered value');
    assert.strictEqual(res.body.indexOf('</script>'), -1);
    assert.strictEqual(evaluate(res.body).solr_core, hostile);
  });
});

test('the rendered files carry no secret', { skip: skip }, async function () {
  const never = 'hunter2-never';
  await h.scenario({ env: { FUSION_PASSWORD: never, FUSION_API_KEY: 'key-never' } }, async function (container) {
    for (const p of ['/config.js', '/admin/banana/config.js']) {
      const res = await h.request(container, { path: p });
      assert.ok(!/hunter2-never|key-never|password|api[_-]?key/i.test(res.body), p);
    }
  });
});

const REFUSALS = [
  { name: 'FUSION_URL is missing', env: { FUSION_URL: null }, message: /FUSION_URL is not set/ },
  { name: 'BANANA_PUBLIC_ORIGIN is missing', env: { BANANA_PUBLIC_ORIGIN: null }, message: /BANANA_PUBLIC_ORIGIN is not set/ },
  { name: 'FUSION_URL has a path', env: { FUSION_URL: 'https://fusion.example.com/api' }, message: /FUSION_URL must be scheme:\/\/host/ },
  { name: 'the public origin has a trailing slash', env: { BANANA_PUBLIC_ORIGIN: 'https://banana.example.com/' }, message: /BANANA_PUBLIC_ORIGIN must be scheme:\/\/host/ },
  { name: 'the Fusion URL is http without the development switch', env: { FUSION_URL: 'http://fusion.example.com', BANANA_INSECURE_COOKIES: 'off' }, message: /FUSION_URL is http:\/\/.*BANANA_INSECURE_COOKIES=on/ },
  { name: 'a setting does not exist', env: { BANANA_SETTING_nope: '1' }, message: /unknown setting: nope/ },
  { name: 'a boolean is not true or false', env: { BANANA_SETTING_USE_FUSION: 'yes' }, message: /USE_FUSION must be true or false/ },
  { name: 'a path does not start with a slash', env: { BANANA_SETTING_solr: 'api/x' }, message: /solr must be a path/ },
  { name: 'a path is protocol-relative', env: { BANANA_SETTING_solr: '//evil.example/' }, message: /solr must be a path/ },
  { name: 'the login URL leaves the host', env: { FUSION_LOGIN_URL: '//evil.example/login' }, message: /FUSION_LOGIN_URL must be a path/ },
  { name: 'a panel name is invalid', env: { BANANA_SETTING_panel_names: 'bar;x' }, message: /panel_names must be a list/ },
  { name: 'a value holds a control character', env: { BANANA_SETTING_solr_core: 'a\u0001b' }, message: /solr_core contains a control character/ },
  { name: 'the Solr preset is asked for', env: { BANANA_PRESET: 'solr' }, message: /BANANA_PRESET=solr is not supported/ },
  { name: 'the mount is on and the admin route is off', env: { BANANA_ADMIN_MOUNT: 'on', FUSION_PROXY_ADMIN_UI: 'off' }, message: /BANANA_ADMIN_MOUNT=on needs the admin route/ },
  { name: 'the login URL is under /admin/ and the admin route is off', env: { FUSION_LOGIN_URL: '/admin/login', FUSION_PROXY_ADMIN_UI: 'off' }, message: /FUSION_LOGIN_URL=\/admin\/login is under \/admin\// },
  { name: 'a header name to strip is invalid', env: { BANANA_STRIP_HEADERS: 'X-Ok, bad name;' }, message: /BANANA_STRIP_HEADERS has a name/ },
  { name: 'the digest key is malformed', env: { BANANA_LIVE_DIGEST_KEY: 'abc' }, message: /BANANA_LIVE_DIGEST_KEY is malformed/ },
  { name: 'a switch is neither on nor off', env: { BANANA_HSTS: 'maybe' }, message: /BANANA_HSTS must be on or off/ },
  { name: 'the content policy source is not a plain source', env: { BANANA_CSP_SCRIPT_SRC: "'unsafe-hashes'" }, message: /BANANA_CSP_SCRIPT_SRC has a source/ },
  { name: 'strict preflight and Fusion does not answer', env: { BANANA_PREFLIGHT: 'strict', FUSION_URL: 'http://127.0.0.1:1' }, message: /Fusion check failed.*strict/ }
];

REFUSALS.forEach(function (c) {
  test('the container refuses to start when ' + c.name, { skip: skip }, async function () {
    const upstream = await h.startUpstream();
    try {
      const env = h.baseEnv(upstream, c.env);
      Object.keys(env).forEach(function (k) { if (env[k] === null) { delete env[k]; } });
      const res = await h.runToEnd(env);
      assert.notStrictEqual(res.status, 0, res.output);
      assert.match(res.output, c.message);
    } finally {
      await upstream.close();
    }
  });
});

test('without strict preflight an unreachable Fusion is a warning and the container starts', { skip: skip }, async function () {
  const upstream = await h.startUpstream();
  try {
    const container = await h.start(h.baseEnv(upstream, { FUSION_URL: 'http://127.0.0.1:1' }));
    try {
      assert.match(container.logs(), /warning: Fusion check failed: the connection to Fusion was refused/);
    } finally {
      container.stop();
    }
  } finally {
    await upstream.close();
  }
});

test('the start-up check logs the Fusion version', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    assert.match(container.logs(), /banana: Fusion 5\.9\.16 answered/);
  });
});

test('the start-up check says what is wrong when the name does not resolve', { skip: skip }, async function () {
  const upstream = await h.startUpstream();
  try {
    const container = await h.start(h.baseEnv(upstream, { FUSION_URL: 'http://no-such-host.invalid' }));
    try {
      assert.match(container.logs(), /warning: Fusion check failed: the host name of the Fusion URL does not resolve/);
    } finally {
      container.stop();
    }
  } finally {
    await upstream.close();
  }
});

test('the start-up check says what is wrong when the answer is not a Fusion gateway', { skip: skip }, async function () {
  // The stand-in answers {"ok":true} to every path but /api; make /api not look like Fusion.
  await h.scenario({ upstream: { realms: 'not a list' } }, async function (container) {
    assert.match(container.logs(), /not a Fusion gateway response/);
  });
});

test('the Fusion check names each Trusted-HTTP realm, and strict preflight needs each acknowledged', { skip: skip }, async function () {
  const realms = [{ name: 'native', realmType: 'native' }, { name: 'corp-sso', realmType: 'trusted-http' }];
  await h.scenario({ upstream: { realms: realms } }, async function (container) {
    assert.match(container.logs(), /warning: Fusion has an enabled Trusted-HTTP realm named "corp-sso".*BANANA_STRIP_HEADERS/);
  });
  const upstream = await h.startUpstream({ realms: realms });
  try {
    const refused = await h.runToEnd(h.baseEnv(upstream, { BANANA_PREFLIGHT: 'strict' }));
    assert.notStrictEqual(refused.status, 0);
    assert.match(refused.output, /Trusted-HTTP realm "corp-sso" is not acknowledged/);
    const container = await h.start(h.baseEnv(upstream, { BANANA_PREFLIGHT: 'strict', BANANA_ACK_TRUSTED_REALMS: 'other, corp-sso', BANANA_STRIP_HEADERS: 'X-SSO-User,X-SSO-Groups' }));
    container.stop();
  } finally {
    await upstream.close();
  }
  const comma = await h.startUpstream({ realms: [{ name: 'a,b', realmType: 'trusted-http' }] });
  try {
    const refused = await h.runToEnd(h.baseEnv(comma, { BANANA_PREFLIGHT: 'strict', BANANA_ACK_TRUSTED_REALMS: 'a,b' }));
    assert.notStrictEqual(refused.status, 0);
    assert.match(refused.output, /has a comma in its name/);
  } finally {
    await comma.close();
  }
});

test('the start-up log names the http upstream, the plain-http public origin and the identity headers it removes', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_STRIP_HEADERS: 'X-SSO-User' } }, async function (container, upstream) {
    const logs = container.logs();
    assert.match(logs, /warning: BANANA_PUBLIC_ORIGIN is not https/);
    assert.ok(logs.indexOf('BANANA_INSECURE_COOKIES=on: the session cookie loses its Secure flag, and the Fusion upstream (' + upstream.origin + ') is plain http') !== -1);
    assert.match(logs, /removed from every request: X-Forwarded-For X-Real-IP Forwarded .*X-Auth-Request-Groups X-SSO-User/);
  });
});

test('the digest key is never logged', { skip: skip }, async function () {
  const key = crypto.randomBytes(32).toString('hex');
  await h.scenario({ env: { BANANA_LIVE_DIGEST_KEY: key } }, async function (container) {
    await h.request(container, { path: '/' });
    assert.strictEqual(container.logs().indexOf(key), -1);
    const environ = h.docker(['exec', container.name, 'sh', '-c', 'tr "\\0" "\\n" </proc/1/environ']).stdout;
    assert.strictEqual(environ.indexOf(key), -1, 'the key is still in the environment of the web server');
    const files = h.docker(['exec', container.name, 'sh', '-c', 'grep -rl ' + key + ' /run/banana || true']).stdout;
    assert.strictEqual(files.trim(), '');
  });
});

test('FUSION_TLS_VERIFY=off is logged as a warning at every start', { skip: skip }, async function () {
  await h.scenario({ env: { FUSION_TLS_VERIFY: 'off' } }, async function (container) {
    assert.match(container.logs(), /warning: FUSION_TLS_VERIFY=off: the certificate of Fusion is not verified/);
  });
});

test('a CA file that does not exist stops the start', { skip: skip }, async function () {
  const upstream = await h.startUpstream();
  try {
    const res = await h.runToEnd(h.baseEnv(upstream, { FUSION_CA_FILE: '/certs/none.pem' }));
    assert.notStrictEqual(res.status, 0);
    assert.match(res.output, /FUSION_CA_FILE \(\/certs\/none\.pem\) is not a readable file/);
  } finally {
    await upstream.close();
  }
});

test('allowed_dashboard_servers is a list of http(s) URLs and paths, not panel names', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_SETTING_allowed_dashboard_servers: 'https://solr.example.com/solr/, /api/solr/' } }, async function (container) {
    assert.deepStrictEqual(evaluate((await h.request(container, { path: '/config.js' })).body).allowed_dashboard_servers, ['https://solr.example.com/solr/', '/api/solr/']);
  });
  await h.scenario({ env: { BANANA_SETTING_allowed_dashboard_servers: '["https://a.example.com/x"]' } }, async function (container) {
    assert.deepStrictEqual(evaluate((await h.request(container, { path: '/config.js' })).body).allowed_dashboard_servers, ['https://a.example.com/x']);
  });
  for (const bad of ['javascript:alert(1)', 'ftp://x.example.com', '//evil.example/x', 'https://a b.example.com', 'relative/path']) {
    const upstream = await h.startUpstream();
    try {
      const res = await h.runToEnd(h.baseEnv(upstream, { BANANA_SETTING_allowed_dashboard_servers: bad }));
      assert.notStrictEqual(res.status, 0, bad);
      assert.match(res.output, /allowed_dashboard_servers must be a list of http\(s\) URLs or paths/, bad);
    } finally {
      await upstream.close();
    }
  }
});
