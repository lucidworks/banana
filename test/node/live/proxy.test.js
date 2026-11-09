'use strict';

// The test proxy container: the digest header exists only when the key is set,
// the routes it forwards, and what it refuses to start without. Skipped when
// Docker is not available.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { load, tempDir } = require('./helpers');

const settings = load('settings.js');
const proxy = load('proxy.js');

const root = path.resolve(__dirname, '..', '..', '..');
const KEY = crypto.randomBytes(32).toString('hex');

function haveDocker() {
  try {
    childProcess.execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 });
    childProcess.execFileSync('docker', ['image', 'inspect', 'nginx:alpine'], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch (e) {
    return false;
  }
}

const DOCKER = haveDocker();

function bananaDir() {
  const dir = tempDir('live-banana-');
  fs.copyFileSync(path.join(root, 'src', 'config.js'), path.join(dir, 'config.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>banana</html>');
  return dir;
}

// A stand-in for the instance that listens on every interface, so the container
// can reach it, and records what it receives.
function startUpstream() {
  const seen = [];
  const server = http.createServer(function (req, res) {
    seen.push({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie });
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'id=abc; Path=/; Secure; HttpOnly' });
    res.end('{"ok":true}');
  });
  return new Promise(function (resolve) {
    server.listen(0, '0.0.0.0', function () {
      resolve({
        port: server.address().port,
        seen: seen,
        close: function () { return new Promise(function (r) { server.closeAllConnections(); server.close(r); }); }
      });
    });
  });
}

async function run(options, body) {
  const upstream = await startUpstream();
  const origin = 'http://host.docker.internal:' + upstream.port;
  let running = null;
  try {
    running = await proxy.startProxy({
      fusionOrigin: origin,
      digestKey: options.key,
      bananaDir: bananaDir(),
      name: 'banana-live-test-' + crypto.randomBytes(4).toString('hex'),
      extraHosts: ['host.docker.internal:host-gateway']
    });
    await body(running, upstream, origin);
  } finally {
    if (running) {
      running.stop();
    }
    await upstream.close();
  }
}

test('the proxy emits the digest header, the HMAC of its upstream origin under the key, when the key variable is set', { skip: !DOCKER }, async function () {
  await run({ key: KEY }, async function (running, upstream, origin) {
    const expected = settings.digestOf(origin, KEY);
    for (const p of ['/admin/banana/config.js', '/admin/banana/', '/admin/banana/missing.js', '/api/session', '/nowhere', '/api-ws']) {
      const res = await fetch(running.origin + p, { redirect: 'manual' });
      assert.strictEqual(res.headers.get('x-banana-upstream-digest'), expected, p);
    }
  });
});

test('a container started without the key variable emits no digest header at all', { skip: !DOCKER }, async function () {
  await run({}, async function (running) {
    for (const p of ['/admin/banana/config.js', '/admin/banana/missing.js', '/api/session', '/nowhere']) {
      const res = await fetch(running.origin + p, { redirect: 'manual' });
      const names = Array.from(res.headers.keys()).filter(function (n) { return /digest|banana/i.test(n); });
      assert.deepStrictEqual(names, [], p);
    }
  });
});

test('the proxy forwards only /api, /auth/ and /admin/ (not /admin/banana/) and serves Banana\'s files itself', { skip: !DOCKER }, async function () {
  await run({ key: KEY }, async function (running, upstream, origin) {
    const status = async function (p, init) {
      return (await fetch(running.origin + p, Object.assign({ redirect: 'manual' }, init || {}))).status;
    };
    assert.strictEqual(await status('/admin/banana/config.js'), 200);
    assert.strictEqual(await status('/admin/banana/index.html'), 200);
    assert.strictEqual(await status('/admin/banana/nothing'), 404);
    assert.strictEqual(upstream.seen.length, 0);
    for (const p of ['/api', '/api/session', '/api/blobs/x', '/auth/login', '/admin/', '/admin/bundle.js']) {
      assert.strictEqual(await status(p), 200, p);
    }
    assert.deepStrictEqual(upstream.seen.map(function (s) { return s.url; }), ['/api', '/api/session', '/api/blobs/x', '/auth/login', '/admin/', '/admin/bundle.js']);
    // other paths are not forwarded
    for (const p of ['/api-ws', '/solr/x/select', '/other', '/']) {
      assert.strictEqual(await status(p), 404, p);
    }
    assert.strictEqual(upstream.seen.length, 6);
    // the proxy rewrites Origin and Host to the instance's, sends the original URI untouched, and drops Secure
    upstream.seen.length = 0;
    const res = await fetch(running.origin + '/api/blobs/a%2Fb%3Fc', { method: 'DELETE', headers: { origin: running.origin, cookie: 'id=zzz' }, redirect: 'manual' });
    assert.strictEqual(upstream.seen[0].url, '/api/blobs/a%2Fb%3Fc');
    assert.strictEqual(upstream.seen[0].origin, origin);
    assert.strictEqual(upstream.seen[0].host, origin.replace('http://', ''));
    assert.strictEqual(upstream.seen[0].cookie, 'id=zzz');
    assert.ok(!/secure/i.test(res.headers.get('set-cookie')), res.headers.get('set-cookie'));
  });
});

function runForeground(env, args) {
  return childProcess.spawnSync('docker', ['run', '--rm'].concat(args || [], [
    '-v', path.join(proxy.PROXY_DIR, 'default.conf.template') + ':/etc/nginx/templates/default.conf.template:ro',
    '-v', path.join(proxy.PROXY_DIR, '10-banana-live.envsh') + ':/docker-entrypoint.d/10-banana-live.envsh:ro',
    'nginx:alpine', 'nginx', '-t'
  ]), { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 60000 });
}

test('the container refuses to start without the upstream variable or with a malformed key', { skip: !DOCKER }, function () {
  const noUpstream = runForeground({}, []);
  assert.notStrictEqual(noUpstream.status, 0);
  assert.match(noUpstream.stderr + noUpstream.stdout, /BANANA_LIVE_FUSION_URL is not set/);
  for (const key of ['abc', 'ZZ' + KEY.slice(2), KEY + '00']) {
    const bad = runForeground({ BANANA_LIVE_FUSION_URL: 'http://127.0.0.1:9', BANANA_LIVE_DIGEST_KEY: key },
      ['-e', 'BANANA_LIVE_FUSION_URL', '-e', 'BANANA_LIVE_DIGEST_KEY']);
    assert.notStrictEqual(bad.status, 0, key);
    assert.match(bad.stderr + bad.stdout, /BANANA_LIVE_DIGEST_KEY is malformed/);
  }
  const good = runForeground({ BANANA_LIVE_FUSION_URL: 'http://127.0.0.1:9', BANANA_LIVE_DIGEST_KEY: KEY },
    ['-e', 'BANANA_LIVE_FUSION_URL', '-e', 'BANANA_LIVE_DIGEST_KEY']);
  assert.strictEqual(good.status, 0, good.stderr);
});

test('the digest the shell script computes is the HMAC the client computes, for several origins and keys', { skip: !DOCKER }, function () {
  // Run the script's function alone in the image and compare it with Node's HMAC.
  const script = fs.readFileSync(path.join(proxy.PROXY_DIR, '10-banana-live.envsh'), 'utf8');
  const fn = script.slice(script.indexOf('banana_live_hmac() {'), script.indexOf("BANANA_LIVE_DIGEST_DIRECTIVE=''"));
  const cases = [
    [KEY, 'https://fusion.example.test'],
    [crypto.randomBytes(32).toString('hex'), 'http://127.0.0.1:8764'],
    ['00'.repeat(32), ''],
    ['ff'.repeat(32), 'https://x']
  ];
  cases.forEach(function (c) {
    const out = childProcess.execFileSync('docker', ['run', '--rm', 'nginx:alpine', 'sh', '-c', fn + '\nbanana_live_hmac "$1" "$2"', 'sh', c[0], c[1]], { encoding: 'utf8', timeout: 60000 }).trim();
    assert.strictEqual(out, settings.digestOf(c[1], c[0]));
  });
});

test('the hosting image is started with the upstream and the key given by name only, and its public address is the loopback address', function () {
  const args = proxy.imageArgs({ name: 'n', digestKey: KEY, image: 'banana-hosting:dev', extraHosts: ['h:host-gateway'] }, 4321);
  assert.deepStrictEqual(args.slice(0, 5), ['run', '-d', '--rm', '--name', 'n']);
  assert.strictEqual(args[args.length - 1], 'banana-hosting:dev');
  assert.ok(args.indexOf('127.0.0.1:4321:8080') !== -1);
  assert.ok(args.indexOf('BANANA_PUBLIC_ORIGIN=http://127.0.0.1:4321') !== -1);
  assert.ok(args.indexOf('BANANA_ADMIN_MOUNT=on') !== -1);
  assert.ok(args.indexOf('--add-host') !== -1 && args.indexOf('--add-host') < args.length - 1);
  // by name: the values are not on the command line
  assert.strictEqual(args.filter(function (a) { return a === 'FUSION_URL'; }).length, 1);
  assert.strictEqual(args.filter(function (a) { return a === 'BANANA_LIVE_DIGEST_KEY'; }).length, 1);
  assert.ok(!args.join(' ').includes(KEY));
  // no key given: no key variable is passed
  const without = proxy.imageArgs({ name: 'n', image: 'x' }, 1);
  assert.ok(without.indexOf('BANANA_LIVE_DIGEST_KEY') === -1);
});
