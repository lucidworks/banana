'use strict';

// The scrub check for the recorded fixtures (tools/fixtures/check.js): it must pass on the committed fixtures, and it
// must fail, for each rule, on a fixture that breaks the rule. The planted fixtures are written to a temporary
// directory outside the repository. Run with: npm run test:node
//
// With the environment of the recording (FUSION_URL, FUSION_USER, FUSION_PASSWORD, FUSION_API_KEY) the committed
// fixtures are also checked against those values. Without it (CI) only the rules that need no environment run, and
// this file says so in its output instead of passing as if everything had been checked.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const check = require(path.join(root, 'tools', 'fixtures', 'check.js'));
const scrub = require(path.join(root, 'tools', 'fixtures', 'scrub.js'));
const FIXTURES = path.join(root, 'test', 'fixtures');
const CHECK_CLI = path.join(root, 'tools', 'fixtures', 'check.js');

const made = [];
process.on('exit', function () {
  made.forEach(function (dir) { fs.rmSync(dir, { recursive: true, force: true }); });
});

function plant(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-scrub-'));
  made.push(dir);
  Object.keys(files).forEach(function (name) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const value = files[name];
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  });
  return dir;
}

function fixture(body, extra) {
  return Object.assign({
    source: 'recorded',
    recordedRequest: { method: 'GET', path: '/api/example' },
    response: { status: 200, contentType: 'application/json', body: body }
  }, extra || {});
}

function rules(result) {
  const names = result.violations.map(function (v) { return v.rule; });
  return names.filter(function (n, i) { return names.indexOf(n) === i; }).sort();
}

// What the environment-specific rules are run with in the planted cases below: values that are not real.
const ENV = {
  FUSION_URL: 'https://fusion.test-host.invalid:6764/',
  FUSION_USER: 'rec-user',
  FUSION_PASSWORD: 'rec-password-1',
  FUSION_API_KEY: 'rec-key-0123456789'
};

test('the committed fixtures pass the scrub check', function (t) {
  const result = check.checkDir(FIXTURES, process.env);
  const notice = check.skippedNotice(result);
  if (notice) {
    // not a silent pass: the notice is part of the test output
    t.diagnostic(notice);
    console.log(notice);
  } else {
    t.diagnostic('every rule ran, including the ones that need the environment of the recording');
  }
  assert.ok(result.files.length > 20, 'fixtures were found (' + result.files.length + ')');
  assert.deepStrictEqual(result.violations, [], check.format(result));
  if (process.env.BANANA_REQUIRE_FIXTURE_ENV === '1') {
    assert.deepStrictEqual(result.skipped, [], 'the environment-specific rules were skipped');
  }
});

test('every committed fixture says where it comes from', function () {
  const kinds = new Set(['recorded', 'recorded-solr', 'derived']);
  const files = check.checkDir(FIXTURES, {}).files;
  files.forEach(function (file) {
    const f = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
    assert.ok(kinds.has(f.source), file + ' has a source of ' + f.source);
    assert.ok(f.response && typeof f.response.status === 'number', file + ' has a response status');
    if (f.source === 'derived') {
      assert.ok(typeof f.note === 'string' && f.note.length > 20, file + ' says in a note how it was derived');
    } else {
      assert.ok(f.recordedRequest && f.recordedRequest.path, file + ' has the request it answers');
    }
  });
});

test('a clean fixture passes, and says which rules were skipped without the environment', function () {
  const dir = plant({ 'ok.json': fixture({ message: 'hello', url: 'http://localhost:8983/solr/' }) });
  const result = check.checkDir(dir, {});
  assert.deepStrictEqual(result.violations, []);
  assert.strictEqual(result.skipped.length, 4);
  assert.match(check.skippedNotice(result), /SKIPPED/);
  assert.strictEqual(check.skippedNotice(check.checkDir(dir, ENV)), null);
});

test('rule host: a URL with a host that is not localhost fails', function () {
  [
    'https://fusion.example.com/api',
    'http://10.0.0.5:8983/solr/',
    'wss://gateway.internal/api-ws',
    'https://user@host.example/x'
  ].forEach(function (url) {
    const dir = plant({ 'f.json': fixture({ url: url }) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('host') !== -1, url);
  });
  ['http://localhost/x', 'http://localhost:9876/x', 'http://127.0.0.1:8983/x', 'HTTP://LOCALHOST/x'].forEach(function (url) {
    const dir = plant({ 'f.json': fixture({ url: url }) });
    assert.deepStrictEqual(check.checkDir(dir, {}).violations, [], url);
  });
});

test('rule host: a host-named field that is not localhost fails, wherever it sits', function () {
  const dir = plant({ 'f.json': fixture({ docs: [{ id: 'x', host_s: 'node-c.example.net' }] }) });
  const result = check.checkDir(dir, {});
  assert.ok(rules(result).indexOf('host') !== -1);
  const origin = plant({ 'f.json': fixture({ origin: 'https://fusion.example.com' }) });
  assert.ok(rules(check.checkDir(origin, {})).indexOf('host') !== -1);
  const inside = plant({ 'f.json': fixture({ banana_dashboard_s: JSON.stringify({ solr: { server: 'http://solr.example.org/solr/' } }) }) });
  assert.ok(rules(check.checkDir(inside, {})).indexOf('host') !== -1, 'a host inside a string that holds JSON');
});

test('rule host: hosts without a scheme fail (IPv4, name and port, node name, encoded, scheme-relative)', function () {
  const cases = {
    'a bare IP with a port': { message: 'connect to 10.20.30.40:8983 failed' },
    'a bare IP': { message: 'from 192.168.1.9' },
    'a Solr node name': { node_name: '10.0.0.5:8983_solr' },
    'host and port under server': { server: 'solr.example.org:8983' },
    'a percent-encoded URL': { redirect: 'http%3A%2F%2Ffusion.example.com%2Fapi' },
    'a scheme-relative URL': { link: '//fusion.example.com/api' }
  };
  Object.keys(cases).forEach(function (name) {
    const dir = plant({ 'f.json': fixture(cases[name]) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('host') !== -1, name);
  });
  const ok = plant({ 'f.json': fixture({ a: 'http://127.0.0.1:9/x', b: '0.0.0.0', c: 'localhost:8983_solr', g: '127.0.0.1:8983', h: 'banana-it-logs:12', d: '//localhost/x', e: 'v2.2', f: '12:30' }) });
  assert.deepStrictEqual(check.checkDir(ok, {}).violations, []);
});

test('rule host: a stray % does not stop the decoding, and a double encoding is decoded twice', function () {
  const cases = {
    'a stray percent sign': 'saved 100% next=https%3A%2F%2Ffusion.example.com%2Fx',
    'a double encoding': 'http%253A%252F%252Ffusion.example.com%252Fapi',
    'a stray percent sign and a double encoding': '5% http%253A%252F%252F10.1.2.3%252F'
  };
  Object.keys(cases).forEach(function (name) {
    const dir = plant({ 'f.json': fixture({ note: cases[name] }) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('host') !== -1, name);
  });
  const ok = plant({ 'f.json': fixture({ note: '100% sure, 50%25 off, %zz and http%3A%2F%2Flocalhost%2Fx' }) });
  assert.deepStrictEqual(check.checkDir(ok, {}).violations, []);
});

test('rule host: a hyphenated single-label host with a port fails, own object names and Solr text do not', function () {
  ['solr-headless:8983', 'connect solr-headless:8983_solr failed', 'zk-0:2181'].forEach(function (text) {
    const dir = plant({ 'f.json': fixture({ note: text }) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('host') !== -1, text);
  });
  const ok = plant({ 'f.json': fixture({ a: 'banana-it-logs:4', b: 'level_s:200', c: 'q=title:abc', d: 'timestamp_tdt:[NOW-1DAY TO NOW]', e: 'ratio 3:30', f: 'localhost-x' }) });
  assert.deepStrictEqual(check.checkDir(ok, {}).violations, []);
});

test('rule id: a number or an object under an id key fails too', function () {
  [{ userId: 12345 }, { created_by: { name: 'somebody' } }, { sessionId: ['abc'] }].forEach(function (body) {
    const dir = plant({ 'f.json': fixture(body) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('id') !== -1, JSON.stringify(Object.keys(body)));
  });
});

test('what the check does not recognise (the residuals the decision record lists)', function () {
  const passes = {
    'a dotted host with no scheme or port in prose': { note: 'served from fusion.example.com today' },
    'a host under server': { server: 'fusion.example.com' },
    'a host under serverHost': { serverHost: 'fusion.example.com' },
    'a host under domain': { domain: 'fusion.example.com' },
    'a single-label host with no port': { note: 'ask fusionhost' },
    'a single-label host with a port and no hyphen': { note: 'solrhost:8983' },
    'an IPv6 literal outside a URL': { note: 'from fe80::1 and [2001:db8::1]:8983' },
    'a host in base64': { note: Buffer.from('fusion.example.com').toString('base64') },
    'a host split across fields': { a: 'fusion', b: 'example', c: 'com' },
    'an e-mail domain': { note: 'someone@fusion.example.com' },
    'rawHeaders with Set-Cookie not first': { rawHeaders: ['Accept', 'x', 'Set-Cookie', 'a=b'] },
    'a HAR cookies array': { cookies: [{ name: 'id', value: 'abc' }] }
  };
  Object.keys(passes).forEach(function (name) {
    const dir = plant({ 'f.json': fixture(passes[name]) });
    assert.deepStrictEqual(check.checkDir(dir, {}).violations, [], name + ' is not recognised');
  });
  const quoted = plant({ 'f.txt': 'the header "Set-Cookie": "a=b" was sent' });
  assert.deepStrictEqual(check.checkDir(quoted, {}).violations, [], 'a quoted header key in non-JSON text');
  // with the environment: the recording host is found as text, also inside a percent-encoded URL, but not base64 or %-encoded letters
  const found = plant({ 'f.json': fixture({ a: 'http%3A%2F%2Ffusion.test-host.invalid%2Fx', b: 'FUSION.test-host.INVALID' }) });
  assert.ok(rules(check.checkDir(found, ENV)).indexOf('env-host') !== -1);
  const hidden = plant({
    'a.json': fixture({ note: Buffer.from('fusion.test-host.invalid').toString('base64') }),
    'b.json': fixture({ note: '%66usion.test-host.invalid'.replace('test-host.invalid', 'test%2Dhost.invalid') })
  });
  assert.ok(rules(check.checkDir(hidden, ENV)).indexOf('env-host') === -1);
});

test('the scrubber leaves a version number alone and replaces an address that stands alone', function () {
  const s = scrub.stringScrubber({});
  assert.strictEqual(s('version 11.0.20.1-SNAPSHOT and v11.0.20.1 and 0.5:10'), 'version 11.0.20.1-SNAPSHOT and v11.0.20.1 and 0.5:10');
  assert.strictEqual(s('999.1.1.1'), '999.1.1.1');
  assert.strictEqual(s('at 10.1.2.3. Next'), 'at 127.0.0.1. Next');
  assert.strictEqual(s('(10.1.2.3:8983)'), '(127.0.0.1:8983)');
  assert.strictEqual(s('solr-headless:8983_solr'), 'localhost:8983_solr');
  assert.strictEqual(s('banana-it-logs:12'), 'banana-it-logs:12');
});

test('rule header: headers kept as data or in the middle of a line fail', function () {
  const cases = {
    'name and value pairs': fixture({ headers: [['Set-Cookie', 'JSESSIONID=abc'], ['Accept', 'x']] }),
    'a headersArray of name and value': fixture({ headers: [{ name: 'Set-Cookie', value: 'a=b' }] }),
    'a Cookie in the middle of a line': fixture({ log: 'request sent with Cookie: id=abc and more' }),
    'apikey key': fixture({ headers: { apikey: 'k' } }),
    'x-lw-api-key key, any case': fixture({ headers: { 'X-LW-Api-Key': 'k' } }),
    'a letters-only Basic token': fixture({ note: 'Basic dXNlcjpQYXNzd29yZEFiYw' })
  };
  Object.keys(cases).forEach(function (name) {
    const dir = plant({ 'f.json': cases[name] });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('header') !== -1, name);
  });
});

test('rule id: a session fixture with a trailing slash, and user_id or UserId, are checked', function () {
  const slash = plant({ 'f.json': fixture({ user: { id: 'abc123' } }, { recordedRequest: { method: 'GET', path: '/api/session/' } }) });
  assert.ok(rules(check.checkDir(slash, {})).indexOf('id') !== -1);
  ['user_id', 'UserId', 'created_by'].forEach(function (key) {
    const o = {};
    o[key] = 'somebody';
    const dir = plant({ 'f.json': fixture(o) });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('id') !== -1, key);
  });
});

test('the scrubber also replaces hosts without a scheme, encoded and scheme-relative ones', function () {
  const s = scrub.stringScrubber({});
  assert.strictEqual(s('connect to 10.20.30.40:8983 failed'), 'connect to 127.0.0.1:8983 failed');
  assert.strictEqual(s('10.0.0.5:8983_solr'), '127.0.0.1:8983_solr');
  assert.strictEqual(s('http%3A%2F%2Ffusion.example.com%2Fapi'), 'http%3A%2F%2Flocalhost%2Fapi');
  assert.strictEqual(s('"//fusion.example.com/api"'), '"//localhost/api"');
  assert.strictEqual(s('from 192.168.1.9'), 'from 127.0.0.1');
  const f = { message: 'x 10.1.2.3:80 //h.example.org/p' };
  assert.deepStrictEqual(check.checkDir(plant({ 'f.json': fixture(JSON.parse(s(JSON.stringify(f)))) }), {}).violations, []);
});

test('rule header: a cookie or authorization header fails', function () {
  const cases = [
    fixture({}, { headers: { Cookie: 'id=abc' } }),
    fixture({}, { headers: { 'set-cookie': 'id=abc; Secure' } }),
    fixture({}, { response: { status: 200, headers: { Authorization: 'Bearer abcdefgh12345' }, body: {} } }),
    fixture({}, { headers: { 'x-api-key': 'k' } }),
    fixture({}, { headers: { 'Proxy-Authorization': 'x' } })
  ];
  cases.forEach(function (f, i) {
    const dir = plant({ 'f.json': f });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('header') !== -1, 'case ' + i);
  });
  const lines = plant({ 'f.txt': 'HTTP/1.1 200 OK\nSet-Cookie: id=abc\n' });
  assert.ok(rules(check.checkDir(lines, {})).indexOf('header') !== -1, 'a header line in text');
  const bearer = plant({ 'f.json': fixture({ note: 'sent Bearer eyJhbGciOi.payload' }) });
  assert.ok(rules(check.checkDir(bearer, {})).indexOf('header') !== -1, 'a bearer credential');
  const prose = plant({ 'f.json': fixture({ message: 'Basic authentication is required' }) });
  assert.deepStrictEqual(check.checkDir(prose, {}).violations, [], 'prose that starts with the scheme word');
});

test('rule id: a session or user id that is not the placeholder fails', function () {
  const real = '3f2b8c1e-5a9d-4e77-9c1b-0a1b2c3d4e5f';
  const cases = {
    'session id': fixture({ user: { id: real, username: check.USER_PLACEHOLDER } }, { recordedRequest: { method: 'GET', path: '/api/session' } }),
    'a short session id': fixture({ user: { id: 'abc123' } }, { recordedRequest: { method: 'GET', path: '/api/session' } }),
    'a username in a session': fixture({ user: { id: check.ID_PLACEHOLDER, username: 'somebody' } }, { recordedRequest: { method: 'GET', path: '/api/session' } }),
    'userId': fixture({ updates: [{ userId: 'somebody' }] }),
    'createdBy': fixture({ createdBy: 'somebody' }),
    'sessionId': fixture({ sessionId: 'abc' }),
    'any other uuid': fixture({ text: 'trace ' + real })
  };
  Object.keys(cases).forEach(function (name) {
    const dir = plant({ 'f.json': cases[name] });
    assert.ok(rules(check.checkDir(dir, {})).indexOf('id') !== -1, name);
  });
  const ok = plant({
    'f.json': fixture({ updates: [{ userId: '' }, { userId: check.ID_PLACEHOLDER }], createdBy: check.ID_PLACEHOLDER }),
    's.json': fixture({ user: { id: check.ID_PLACEHOLDER, username: check.USER_PLACEHOLDER } }, { recordedRequest: { method: 'GET', path: '/api/session' } }),
    'blob.json': fixture([{ id: 'banana-it-000000000000-1' }])
  });
  assert.deepStrictEqual(check.checkDir(ok, {}).violations, [], 'placeholders, an empty userId and a blob id are fine');
});

test('rule env-host: the host of FUSION_URL fails, as a URL or as bare text, in any case', function () {
  ['see https://fusion.test-host.invalid:6764/x', 'bare fusion.test-host.invalid text', 'UPPER FUSION.TEST-HOST.INVALID'].forEach(function (text) {
    const dir = plant({ 'f.json': fixture({ note: text }) });
    assert.ok(rules(check.checkDir(dir, ENV)).indexOf('env-host') !== -1, text);
    assert.ok(rules(check.checkDir(dir, {})).indexOf('env-host') === -1, 'not checked without the environment');
  });
});

test('rule env-user: the user name fails as a whole token, not inside a longer name', function () {
  const bad = plant({ 'f.json': fixture({ owner: 'rec-user' }) });
  assert.ok(rules(check.checkDir(bad, ENV)).indexOf('env-user') !== -1);
  const embedded = plant({ 'f.json': fixture({ text: 'created by rec-user at noon' }) });
  assert.ok(rules(check.checkDir(embedded, ENV)).indexOf('env-user') !== -1);
  const longer = plant({ 'f.json': fixture({ id: 'rec-user-it-1', other: 'rec-user_title_s', third: 'my-rec-user' }) });
  assert.deepStrictEqual(check.checkDir(longer, ENV).violations, []);
});

test('rule env-user: a resource type that is the same word as the user name is application vocabulary', function () {
  const env = Object.assign({}, ENV, { FUSION_USER: 'banana' });
  const dir = plant({
    'a.json': fixture({ metadata: { resourceType: 'banana' } }, { recordedRequest: { method: 'GET', path: '/api/blobs?q=id:x*&resourceType=banana' } }),
    'b.json': fixture({ banana_dashboard_s: '{"resourceType": "banana"}' })
  });
  assert.deepStrictEqual(check.checkDir(dir, env).violations, []);
  const other = plant({ 'c.json': fixture({ owner: 'banana' }) });
  assert.ok(rules(check.checkDir(other, env)).indexOf('env-user') !== -1, 'the same word anywhere else is still the user');
});

test('rule env-password and env-api-key: the values fail', function () {
  const dir = plant({ 'f.json': fixture({ a: 'x rec-password-1 y', b: 'k=rec-key-0123456789' }) });
  assert.deepStrictEqual(rules(check.checkDir(dir, ENV)), ['env-api-key', 'env-password']);
});

test('the findings name the file, the rule and the place, never the value', function () {
  const dir = plant({ 'deep/f.json': fixture({ list: [{ note: 'rec-password-1 and https://leak.example.com/' }] }) });
  const text = check.format(check.checkDir(dir, ENV));
  assert.match(text, /deep[\\/]f\.json: rule env-password at response\.body\.list\.0\.note/);
  assert.match(text, /rule host at response\.body\.list\.0\.note/);
  assert.ok(text.indexOf('rec-password-1') === -1);
  assert.ok(text.indexOf('leak.example.com') === -1);
});

test('the command line exits 1 on a finding, 0 on a clean directory, and 1 on a skip when the environment is required', function () {
  const clean = plant({ 'ok.json': fixture({ a: 1 }) });
  const dirty = plant({ 'bad.json': fixture({ url: 'https://fusion.example.com/' }) });
  const bare = { PATH: process.env.PATH };
  const run = function (dir, env) {
    return childProcess.spawnSync(process.execPath, [CHECK_CLI, dir], { env: env, encoding: 'utf8' });
  };
  const ok = run(clean, bare);
  assert.strictEqual(ok.status, 0);
  assert.match(ok.stdout, /SKIPPED/);
  assert.match(ok.stdout, /passed/);
  const bad = run(dirty, bare);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /rule host/);
  const required = run(clean, Object.assign({}, bare, { BANANA_REQUIRE_FIXTURE_ENV: '1' }));
  assert.strictEqual(required.status, 1);
  const withEnv = run(clean, Object.assign({}, bare, ENV));
  assert.strictEqual(withEnv.status, 0);
  assert.ok(withEnv.stdout.indexOf('SKIPPED') === -1);
});

test('the scrubber replaces what identifies the system and keeps the vocabulary of the fixtures', function () {
  const pw = 'pw-12345';
  const key = 'key-0123456789';
  const s = scrub.stringScrubber({ host: 'fusion.test-host.invalid', user: 'banana', password: pw, apiKey: key });
  assert.strictEqual(s('https://fusion.test-host.invalid:6764/api'), 'https://localhost:6764/api');
  assert.strictEqual(s('http://other.example.org/x'), 'http://localhost/x');
  assert.strictEqual(s('http://localhost:8983/x'), 'http://localhost:8983/x');
  assert.strictEqual(s('node-c.example.test'), 'localhost');
  assert.strictEqual(s('3f2b8c1e-5a9d-4e77-9c1b-0a1b2c3d4e5f'), check.ID_PLACEHOLDER);
  assert.strictEqual(s('banana-it-0123456789ab-7'), 'banana-it-000000000000-7');
  assert.strictEqual(s('pw-12345 key-0123456789'), 'fixture-password fixture-api-key');
  // the user name only as a whole token, and not in the resource type
  assert.strictEqual(s('banana'), check.USER_PLACEHOLDER);
  assert.strictEqual(s('by banana.'), 'by ' + check.USER_PLACEHOLDER + '.');
  assert.strictEqual(s('banana-it-logs banana_title_s'), 'banana-it-logs banana_title_s');
  assert.strictEqual(s('/api/blobs?resourceType=banana'), '/api/blobs?resourceType=banana');
});
