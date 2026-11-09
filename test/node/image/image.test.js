'use strict';

// The image itself: it runs as a non-root user with a health check, writes nowhere but its small
// tmpfs, and holds no secret. Skipped when Docker or the image is missing (see helpers.js).
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const h = require('./helpers');

const skip = !h.AVAILABLE;

function inspectImage() {
  return JSON.parse(h.docker(['image', 'inspect', h.IMAGE]).stdout)[0];
}

test('the image is configured to run as a non-root user, with a health check and one unprivileged port', { skip: skip }, function () {
  const config = inspectImage().Config;
  assert.match(config.User, /^[1-9][0-9]*$/, 'a numeric user that is not root');
  assert.deepStrictEqual(Object.keys(config.ExposedPorts), ['8080/tcp']);
  assert.ok(config.Healthcheck && config.Healthcheck.Test.join(' ').indexOf('/healthz') !== -1);
  assert.deepStrictEqual(Object.keys(config.Volumes || {}), [], 'the image has no volume');
  assert.deepStrictEqual(config.Entrypoint, ['/usr/local/bin/banana-entrypoint']);
});

test('every process in the running container is non-root, and the web server listens on 8080', { skip: skip }, async function () {
  await h.scenario({ env: { BANANA_HEALTH_UPSTREAM: 'on' } }, async function (container) {
    const processes = h.docker(['exec', container.name, 'ps', '-o', 'user,pid,args']).stdout.trim().split('\n').slice(1);
    assert.ok(processes.length >= 2, 'expected the master and a worker process');
    processes.forEach(function (line) {
      if (/\bps -o\b/.test(line)) { return; }
      assert.ok(!/^root\b/.test(line.trim()), 'a process runs as root: ' + line);
    });
    assert.ok(processes.some(function (l) { return /nginx: master|nginx -c/.test(l); }), 'the web server is running');
    assert.ok(processes.some(function (l) { return /fcgiwrap/.test(l); }), 'the optional check runs too');
    assert.strictEqual(h.docker(['exec', container.name, 'id', '-u']).stdout.trim(), '101');
  });
});

test('the health check turns healthy, and it does not call Fusion', { skip: skip }, async function () {
  await h.scenario({ args: ['--health-interval=1s', '--health-start-period=1s', '--health-timeout=3s'] }, async function (container, upstream) {
    const deadline = Date.now() + 30000;
    let status = '';
    while (Date.now() < deadline) {
      status = h.docker(['inspect', '-f', '{{.State.Health.Status}}', container.name]).stdout.trim();
      if (status === 'healthy') { break; }
      await h.sleep(500);
    }
    assert.strictEqual(status, 'healthy');
    assert.deepStrictEqual(upstream.seen, [], 'the health check reached Fusion');
  });
});

test('the container works with a read-only root file system, no capabilities, and writes only under /run/banana', { skip: skip }, async function () {
  const args = ['--read-only', '--tmpfs', '/run/banana:uid=101,gid=101,mode=0700,size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'];
  await h.scenario({ args: args, env: { BANANA_HEALTH_UPSTREAM: 'on' } }, async function (container, upstream) {
    assert.strictEqual((await h.request(container, { path: '/' })).status, 200);
    assert.strictEqual((await h.request(container, { path: '/config.js' })).status, 200);
    assert.strictEqual((await h.request(container, { path: '/api/blobs/x', method: 'PUT', body: 'x'.repeat(2 * 1024 * 1024) })).status, 200);
    assert.strictEqual((await h.request(container, { path: '/healthz/upstream' })).status, 200);
  });
  // without --read-only, what changed in the file system is only under /run/banana
  await h.scenario({}, async function (container) {
    await h.request(container, { path: '/api/blobs/x', method: 'PUT', body: 'x'.repeat(2 * 1024 * 1024) });
    await h.request(container, { path: '/' });
    const changes = h.docker(['diff', container.name]).stdout.trim().split('\n').filter(Boolean);
    // Running an image of the other architecture under emulation makes the emulator write its own cache.
    const emulated = changes.some(function (line) { return /rosetta|qemu/i.test(line); });
    const outside = changes.filter(function (line) {
      const p = line.slice(2);
      if (emulated && ('/var/cache/nginx/.cache'.indexOf(p) === 0 || p.indexOf('/var/cache/nginx/.cache') === 0)) {
        return false;
      }
      return !(p === '/run' || p === '/run/banana' || p.indexOf('/run/banana/') === 0);
    });
    assert.deepStrictEqual(outside, []);
  });
});

test('the image history and config hold no secret, and the layers hold no credential file', { skip: skip }, function () {
  const history = h.docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', h.IMAGE]).stdout;
  assert.ok(history.length > 0);
  assert.ok(!/(PASSWORD|API_KEY|SECRET|TOKEN|CREDENTIAL|DIGEST_KEY|_authToken)/i.test(history), 'a secret-looking name in the build history');
  const config = inspectImage().Config;
  (config.Env || []).forEach(function (entry) {
    assert.ok(!/(PASSWORD|API_KEY|SECRET|TOKEN|CREDENTIAL|DIGEST_KEY)/i.test(entry.split('=')[0]), 'environment of the image: ' + entry.split('=')[0]);
  });
  assert.ok(!/(FUSION_URL|BANANA_PUBLIC_ORIGIN)=/.test((config.Env || []).join('\n')), 'the image has no environment-specific setting');
  const labels = JSON.stringify(config.Labels || {});
  assert.ok(!/(password|secret|token)/i.test(labels));
});

test('a scan of the image file system finds no private key, token, credential file or build leftover', { skip: skip }, function () {
  const name = 'banana-image-scan-' + crypto.randomBytes(4).toString('hex');
  assert.strictEqual(h.docker(['create', '--name', name, h.IMAGE]).status, 0);
  try {
    const listing = childProcess.execSync('docker export ' + name + ' | tar -tf -', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const leftovers = listing.split('\n').filter(function (p) {
      return /(^|\/)(\.env[^/]*|\.npmrc|\.git|node_modules|\.netrc|id_rsa|id_ed25519|\.aws|\.docker)(\/|$)/.test(p) ||
        /(^|\/)(package-lock\.json|webpack\.config\.js|Dockerfile)$/.test(p);
    });
    assert.deepStrictEqual(leftovers, []);
    const content = childProcess.execSync('docker export ' + name + ' | tar -xOf - 2>/dev/null', { encoding: 'latin1', maxBuffer: 1024 * 1024 * 1024 });
    const patterns = {
      'a private key': /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY/,
      'an npm token': /npm_[A-Za-z0-9]{36}/,
      'an npm auth line': /_authToken=/,
      'an AWS access key': /(^|[^A-Z0-9])AKIA[0-9A-Z]{16}([^A-Z0-9]|$)/,
      'a GitHub token': /gh[pousr]_[A-Za-z0-9]{36}/,
      'a bearer token': /Authorization: Bearer [A-Za-z0-9._-]{20,}/i
    };
    Object.keys(patterns).forEach(function (what) {
      assert.ok(!patterns[what].test(content), 'the image holds ' + what);
    });
    // and none of the values this machine would use against a real Fusion, when they are set
    ['FUSION_PASSWORD', 'FUSION_API_KEY', 'FUSION_USER'].forEach(function (key) {
      const value = process.env[key];
      if (value && value.length >= 6) {
        assert.strictEqual(content.indexOf(value), -1, 'the image holds the value of ' + key);
      }
    });
    const fusion = process.env.FUSION_URL;
    if (fusion) {
      assert.strictEqual(content.indexOf(new URL(fusion).host), -1, 'the image holds the host of FUSION_URL');
    }
  } finally {
    h.docker(['rm', '-f', name]);
  }
});

test('the web server version is not announced', { skip: skip }, async function () {
  await h.scenario({}, async function (container) {
    const res = await h.request(container, { path: '/nothing' });
    assert.strictEqual(res.headers.server, 'nginx');
    assert.ok(!/nginx\/\d/.test(res.body));
  });
});

test('the web root has no dot-file and no servlet descriptor', { skip: skip }, function () {
  const name = 'banana-image-root-' + crypto.randomBytes(4).toString('hex');
  assert.strictEqual(h.docker(['create', '--name', name, h.IMAGE]).status, 0);
  try {
    const listing = childProcess.execSync('docker export ' + name + ' | tar -tf -', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(function (p) { return p.indexOf('usr/share/banana/www') === 0; });
    assert.ok(listing.length > 50);
    assert.deepStrictEqual(listing.filter(function (p) { return /(^|\/)\.[^/]/.test(p.replace(/^usr\/share\/banana\/www/, '')); }), []);
    assert.deepStrictEqual(listing.filter(function (p) { return /WEB-INF/.test(p); }), []);
  } finally {
    h.docker(['rm', '-f', name]);
  }
});

test('the build context is an allowlist: nested dot-files and stray local files never reach the build', { skip: skip }, function () {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-image-ctx-'));
  try {
    const put = function (rel, text) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text || 'x');
    };
    fs.copyFileSync(path.join(h.root, '.dockerignore'), path.join(dir, '.dockerignore'));
    // what the build reads
    ['package.json', 'package-lock.json', '.npmrc', 'webpack.config.js', 'LICENSE', 'NOTICE', 'src/index.html', 'src/img/logo.png',
      'licenses/a.txt', 'tools/check-dist.js', 'tools/lib/a.js', 'tools/webpack/a.js', 'tools/vendor-licenses.json', 'docker/banana-entrypoint'].forEach(function (f) { put(f); });
    // what must stay out
    const planted = ['src/img/.DS_Store', 'src/.hidden', 'src/css/.editorconfig', 'docker/.local', 'foo.iml', 'src/foo.iml', 'tmp/local.txt', 'src/tmp/x',
      '.env', '.git/config', '.vscode/settings.json', 'CLAUDE.md', 'notes.txt', 'dist/old.js', 'node_modules/x/index.js', 'src/a.log', 'test/live/x.js'];
    planted.forEach(function (f) { put(f); });
    put('Dockerfile', 'FROM scratch\nCOPY . /ctx\n');
    const tag = 'banana-image-ctx-' + crypto.randomBytes(4).toString('hex');
    const build = h.docker(['build', '-q', '-t', tag, dir]);
    assert.strictEqual(build.status, 0, build.stderr);
    try {
      const out = h.docker(['create', '--name', tag, tag, '/nonexistent']);
      assert.strictEqual(out.status, 0, out.stderr);
      const files = childProcess.execSync('docker export ' + tag + ' | tar -tf -', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').filter(function (p) { return p.indexOf('ctx/') === 0 && !p.endsWith('/'); }).map(function (p) { return p.slice(4); }).sort();
      const expected = ['.dockerignore', '.npmrc', 'LICENSE', 'NOTICE', 'docker/banana-entrypoint', 'licenses/a.txt', 'package-lock.json', 'package.json',
        'src/img/logo.png', 'src/index.html', 'tools/check-dist.js', 'tools/lib/a.js', 'tools/vendor-licenses.json', 'tools/webpack/a.js', 'webpack.config.js'].sort();
      // .dockerignore itself is sent to the daemon but is not a build input; accept it either way
      assert.deepStrictEqual(files.filter(function (f) { return f !== '.dockerignore'; }), expected.filter(function (f) { return f !== '.dockerignore'; }));
    } finally {
      h.docker(['rm', '-f', tag]);
      h.docker(['image', 'rm', '-f', tag]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
