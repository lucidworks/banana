'use strict';

// The optional trace of what was sent: method, path, names of query
// parameters, content type, verdict and status, and nothing that identifies
// the instance or a user.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, tempDir, startStubFusion } = require('./helpers');

const registry = load('registry.js');
const ids = load('ids.js');
const { FusionClient } = load('client.js');
const { Guard } = load('guard.js');
const traceModule = load('trace.js');

const CREDENTIAL = 'trace-credential-value';

test('the query names are the names only, never the values', function () {
  assert.deepStrictEqual(traceModule.queryNames('a=1&b=secret&c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(traceModule.queryNames(''), []);
  assert.deepStrictEqual(traceModule.queryNames(undefined), []);
});

test('no file is written without a path, and a tracer appends one JSON line per call', function () {
  assert.strictEqual(traceModule.makeTracer(undefined), null);
  const file = path.join(tempDir(), 'trace.jsonl');
  const trace = traceModule.makeTracer(file);
  trace({ who: 'node', method: 'GET' });
  trace({ who: 'node', method: 'PUT' });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  assert.deepStrictEqual(lines.map(function (l) { return l.method; }), ['GET', 'PUT']);
  assert.ok(lines.every(function (l) { return typeof l.time === 'string'; }));
});

test('a traced run holds no host, port, cookie, body or credential', async function () {
  const stub = await startStubFusion();
  try {
    const file = path.join(tempDir(), 'trace.jsonl');
    const trace = traceModule.makeTracer(file);
    const reg = new registry.Registry({ dir: tempDir(), runTag: 'aaaaaaaaaaaa', identity: '0123456789ab' });
    const ledger = new registry.Ledger(reg);
    const client = new FusionClient({
      base: stub.origin, user: 'trace-user', password: CREDENTIAL, ledger: ledger,
      allocator: new ids.Allocator('0123456789ab'), confirmDelayMs: 1, trace: trace
    });
    await client.login();
    const id = client.allocate();
    await client.create(id, {});
    await client.remove(id);
    // a browser request through the guard, with a select body and a refused request
    const guard = new Guard({ client: client, origin: 'http://127.0.0.1:7777', trace: trace });
    const fake = function (method, url, body, type) {
      return {
        request: function () {
          return {
            method: function () { return method; }, url: function () { return url; },
            headers: function () { return type ? { 'content-type': type } : {}; },
            postDataBuffer: function () { return body ? Buffer.from(body) : null; }
          };
        },
        continue: async function () {}, abort: async function () {},
        fetch: async function () { return { status: function () { return 200; } }; },
        fulfill: async function () {}
      };
    };
    await guard.handleRoute(fake('GET', 'http://127.0.0.1:7777/api/blobs?q=id%3Asecret-value&resourceType=banana'));
    await guard.handleRoute(fake('POST', 'http://127.0.0.1:7777/api/solr/banana-it-x/select', 'q=secret-query&rows=5', 'application/x-www-form-urlencoded'));
    await guard.handleRoute(fake('GET', 'https://other.example/a?token=secret-value'));
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(lines.length >= 9, String(lines.length));
    assert.ok(!text.includes(String(new URL(stub.origin).port)));
    assert.ok(!text.includes('127.0.0.1'));
    assert.ok(!text.includes('tok1'));
    assert.ok(!text.includes('trace-user'));
    assert.ok(!text.includes(CREDENTIAL));
    assert.ok(!text.includes('secret-value'));
    assert.ok(!text.includes('secret-query'));
    lines.forEach(function (l) {
      Object.keys(l).forEach(function (k) {
        assert.ok(['time', 'who', 'method', 'path', 'query', 'contentType', 'status', 'verdict', 'kind', 'row', 'cls', 'params'].indexOf(k) !== -1, k);
      });
    });
    const select = lines.find(function (l) { return l.kind === 'select'; });
    assert.deepStrictEqual(select.params, ['q', 'rows']);
    assert.ok(lines.some(function (l) { return l.who === 'browser' && l.verdict === 'abort' && l.cls === 'off-origin'; }));
    assert.ok(lines.some(function (l) { return l.who === 'node' && l.method === 'DELETE' && l.status === 204; }));
  } finally {
    await stub.close();
  }
});
