'use strict';

// The browser rule set, driven with stand-ins for Playwright's route, request
// and WebSocket objects and a stand-in for Fusion behind them.
// Run with: npm run test:node

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert');
const { load, tempDir, startStubFusion } = require('./helpers');

const registry = load('registry.js');
const ids = load('ids.js');
const { FusionClient } = load('client.js');
const { Guard } = load('guard.js');

const TAG = 'aaaaaaaaaaaa';
const IDENTITY = '0123456789ab';
const PROXY = 'http://127.0.0.1:7777';
const FORM = 'application/x-www-form-urlencoded';

async function setup(behave) {
  const stub = await startStubFusion(behave);
  const reg = new registry.Registry({ dir: tempDir(), runTag: TAG, identity: IDENTITY });
  const ledger = new registry.Ledger(reg);
  const client = new FusionClient({
    base: stub.origin, user: 'u', password: 'p', ledger: ledger, allocator: new ids.Allocator(IDENTITY), confirmDelayMs: 1
  });
  await client.login();
  const guard = new Guard({ client: client, origin: PROXY });
  return { stub: stub, client: client, ledger: ledger, registry: reg, guard: guard, close: function () { return stub.close(); } };
}

// A route whose fetch sends the request to the stand-in for Fusion, the way
// the proxy would, without following redirects.
function route(t, spec, fetchOverride) {
  const u = new URL(spec.url);
  const calls = [];
  const r = {
    calls: calls,
    request: function () {
      return {
        method: function () { return spec.method; },
        url: function () { return spec.url; },
        headers: function () { return spec.contentType ? { 'content-type': spec.contentType } : {}; },
        postDataBuffer: function () { return spec.body === undefined || spec.body === null ? null : Buffer.from(spec.body); },
        redirectedFrom: function () { return spec.redirectedFrom || null; }
      };
    },
    abort: async function () { calls.push('abort'); },
    continue: async function () { calls.push('continue'); },
    fetch: async function (options) {
      calls.push('fetch');
      assert.strictEqual(options.maxRedirects, 0);
      if (fetchOverride) {
        return fetchOverride();
      }
      const res = await fetch(t.stub.origin + u.pathname + u.search, {
        method: spec.method,
        headers: Object.assign({ cookie: 'id=tok1' }, spec.contentType ? { 'content-type': spec.contentType } : {}),
        body: spec.body === undefined || spec.body === null ? undefined : spec.body,
        redirect: 'manual'
      });
      const text = await res.text();
      return { status: function () { return res.status; }, text: text };
    },
    fulfill: async function (options) { calls.push('fulfill'); r.fulfilled = options; }
  };
  return r;
}

// The last record in the registry file, as it is on disk at this moment.
function lastRecord(t) {
  const lines = fs.readFileSync(t.registry.file, 'utf8').split('\n').filter(function (l) { return l.trim() !== ''; });
  return JSON.parse(lines[lines.length - 1]);
}

// Make the route's fetch record what the registry held when the write was sent.
function recordRegistryAtFetch(t, r) {
  const seen = [];
  const send = r.fetch;
  r.fetch = async function (options) {
    seen.push(lastRecord(t));
    return send(options);
  };
  return seen;
}

function put(id) {
  return { method: 'PUT', url: PROXY + '/api/blobs/' + id + '?resourceType=banana', body: JSON.stringify([{ id: id }]), contentType: 'application/json' };
}

function del(id) {
  return { method: 'DELETE', url: PROXY + '/api/blobs/' + id };
}

test('an allowed GET is continued unchanged', async function () {
  const t = await setup();
  try {
    const r = route(t, { method: 'GET', url: PROXY + '/api/collections' });
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['continue']);
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});

test('a refused request is aborted before anything is sent, and recorded with its class and path', async function () {
  const t = await setup();
  try {
    const r = route(t, { method: 'GET', url: PROXY + '/api/solr/banana-it-x/admin/ping?action=disable' });
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['abort']);
    assert.deepStrictEqual(t.guard.aborts, [{ method: 'GET', cls: 'unlisted-read', path: '/api/solr/banana-it-x/admin/ping' }]);
    assert.strictEqual(t.guard.failures().length, 1);
    assert.match(t.guard.failures()[0], /GET \/api\/solr\/banana-it-x\/admin\/ping aborted as unlisted-read/);
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method !== 'POST'; }).length, 0);
  } finally {
    await t.close();
  }
});

test('PUT: the 404 check runs first, then put-sent, the write, the confirmation, created, and only then the page is answered', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    const r = route(t, put(id));
    const seen = recordRegistryAtFetch(t, r);
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['fetch', 'fulfill']);
    // put-sent was on disk before the write was sent
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].id, id);
    assert.strictEqual(seen[0].state, 'put-sent');
    assert.deepStrictEqual(t.stub.log.filter(function (e) { return e.path !== '/api/session'; }).map(function (e) { return e.method; }), ['GET', 'PUT', 'GET']);
    assert.strictEqual(t.ledger.stateOf(id), 'created');
    assert.deepStrictEqual(t.guard.failures(), []);
    assert.strictEqual(r.fulfilled.response.status(), 200);
    // a second save of the same title skips the check but is confirmed
    t.stub.log.length = 0;
    const r2 = route(t, put(id));
    await t.guard.handleRoute(r2);
    assert.deepStrictEqual(t.stub.log.map(function (e) { return e.method; }), ['PUT', 'GET']);
  } finally {
    await t.close();
  }
});

test('ADR 0008, scenario S12: a PUT for an id that already exists collides, is aborted, fails the test, and a second PUT aborts as collided', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    t.stub.blobs.set(id, [{ id: 'another-run' }]);
    const r = route(t, put(id));
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['abort']);
    assert.strictEqual(t.ledger.stateOf(id), 'collided');
    assert.ok(t.guard.failures().length >= 1);
    assert.strictEqual(t.guard.aborts[0].cls, 'collision');
    const r2 = route(t, put(id));
    await t.guard.handleRoute(r2);
    assert.deepStrictEqual(r2.calls, ['abort']);
    assert.strictEqual(t.guard.aborts[1].cls, 'collided');
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method === 'PUT'; }).length, 0);
    assert.deepStrictEqual(t.stub.blobs.get(id), [{ id: 'another-run' }]);
  } finally {
    await t.close();
  }
});

test('DELETE: put-sent... delete-sent is flushed first, the confirmation runs before the page is answered', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    const order = [];
    const r = route(t, del(id));
    const seen = recordRegistryAtFetch(t, r);
    const fulfil = r.fulfill;
    r.fulfill = async function (o) {
      order.push('fulfill:' + t.stub.log.map(function (e) { return e.method; }).join(','));
      return fulfil(o);
    };
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(order, ['fulfill:DELETE,GET']);
    // delete-sent was on disk before the write was sent
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].id, id);
    assert.strictEqual(seen[0].state, 'delete-sent');
    assert.strictEqual(t.ledger.stateOf(id), 'deleted');
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});

test('PUT: if the registry cannot be written, the route is aborted and nothing is sent', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    t.registry._fsync = function () { throw new Error('disk full'); };
    const r = route(t, put(id));
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['abort']);
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method === 'PUT' || e.method === 'DELETE'; }).length, 0);
    assert.ok(t.guard.failures().some(function (f) { return /disk full/.test(f); }));
    assert.strictEqual(t.guard.aborts[0].cls, 'guard-error');
  } finally {
    await t.close();
  }
});

test('DELETE: if the registry cannot be written, the route is aborted and nothing is sent', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    t.registry._fsync = function () { throw new Error('disk full'); };
    const r = route(t, del(id));
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['abort']);
    assert.strictEqual(t.stub.log.length, 0);
    assert.ok(t.stub.blobs.has(id));
    assert.ok(t.guard.failures().some(function (f) { return /disk full/.test(f); }));
  } finally {
    await t.close();
  }
});

test('DELETE: a confirmation that fails is a debt that fails the test, and the page is still answered', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'DELETE') {
        send(200, {});      // reports success, deletes nothing
        return true;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    const r = route(t, del(id));
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['fetch', 'fulfill']);
    assert.strictEqual(r.fulfilled.response.status(), 200);
    assert.strictEqual(t.ledger.stateOf(id), 'delete-sent');
    assert.strictEqual(t.guard.failures().length, 1);
    assert.match(t.guard.failures()[0], /delete of .* was not confirmed/);
  } finally {
    await t.close();
  }
});

test('ADR 0008, scenarios S5, S6 and S3: a DELETE that is not the exact URL of an owned id never leaves the browser', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    for (const url of [
      PROXY + '/api/blobs/' + id.substring(1),                    // Banana drops the first character
      PROXY + '/api/blobs/' + id + '?x',                         // a title with a question mark
      PROXY + '/api/blobs/banana-it-ba9876543210-1',             // another process's id
      PROXY + '/api/blobs/Ops%3Fv2'
    ]) {
      const r = route(t, { method: 'DELETE', url: url });
      await t.guard.handleRoute(r);
      assert.deepStrictEqual(r.calls, ['abort'], url);
    }
    assert.strictEqual(t.guard.aborts.length, 4);
    assert.ok(t.guard.aborts.every(function (a) { return a.cls === 'delete'; }));
    assert.strictEqual(t.stub.log.length, 0);
    assert.strictEqual(t.ledger.stateOf(id), 'created');
  } finally {
    await t.close();
  }
});

test('ADR 0008, scenario N6: a 3xx answer to a write is not passed to the page: a 502 and an abort of class redirect', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'PUT' || entry.method === 'DELETE' || (entry.method === 'POST' && entry.path.indexOf('/select') !== -1)) {
        send(307, '', { location: '/elsewhere' });
        return true;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    const r = route(t, put(id));
    await t.guard.handleRoute(r);
    assert.strictEqual(r.fulfilled.status, 502);
    assert.strictEqual(r.fulfilled.response, undefined);
    assert.ok(t.guard.aborts.some(function (a) { return a.cls === 'redirect'; }));
    // the confirmation fails, so the test fails and the id is left at put-sent
    assert.strictEqual(t.ledger.stateOf(id), 'put-sent');
    assert.ok(t.guard.failures().length >= 2);
    // select
    const s = route(t, { method: 'POST', url: PROXY + '/api/solr/banana-it-x/select', body: 'q=*', contentType: FORM });
    await t.guard.handleRoute(s);
    assert.strictEqual(s.fulfilled.status, 502);
    assert.ok(!t.stub.log.some(function (e) { return e.path === '/elsewhere'; }));
  } finally {
    await t.close();
  }
});

test('select, login and logout are sent through route.fetch and answered from the fetched response', async function () {
  const t = await setup();
  try {
    const login = route(t, { method: 'POST', url: PROXY + '/api/session?realmName=native', body: '{"username":"u","password":"p"}', contentType: 'application/json' });
    await t.guard.handleRoute(login);
    assert.deepStrictEqual(login.calls, ['fetch', 'fulfill']);
    const logout = route(t, { method: 'DELETE', url: PROXY + '/api/session' });
    await t.guard.handleRoute(logout);
    assert.deepStrictEqual(logout.calls, ['fetch', 'fulfill']);
    const sel = route(t, { method: 'POST', url: PROXY + '/api/solr/banana-it-x/select', body: 'q=*', contentType: FORM });
    await t.guard.handleRoute(sel);
    assert.deepStrictEqual(sel.calls, ['fetch', 'fulfill']);
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});

test('a select whose body names another parameter is aborted', async function () {
  const t = await setup();
  try {
    const sel = route(t, { method: 'POST', url: PROXY + '/api/solr/banana-it-x/select', body: 'q=*&shards=x', contentType: FORM });
    await t.guard.handleRoute(sel);
    assert.deepStrictEqual(sel.calls, ['abort']);
    assert.strictEqual(t.guard.aborts[0].cls, 'refused-param');
  } finally {
    await t.close();
  }
});

test('ADR 0008, decision 8: telemetry is aborted and does not fail the test; an off-origin GET does not; an off-origin POST does', async function () {
  const t = await setup();
  try {
    const logs = route(t, { method: 'POST', url: PROXY + '/api/ui-logs', body: '{}', contentType: 'application/json' });
    await t.guard.handleRoute(logs);
    assert.deepStrictEqual(logs.calls, ['abort']);
    assert.strictEqual(t.guard.telemetryCount(), 1);
    assert.deepStrictEqual(t.guard.failures(), []);
    const font = route(t, { method: 'GET', url: 'https://fonts.example/a.woff' });
    await t.guard.handleRoute(font);
    assert.deepStrictEqual(font.calls, ['abort']);
    const head = route(t, { method: 'HEAD', url: 'https://fonts.example/a.woff' });
    await t.guard.handleRoute(head);
    assert.deepStrictEqual(t.guard.failures(), []);
    const gist = route(t, { method: 'POST', url: 'https://api.github.com/gists', body: '{}', contentType: 'application/json' });
    await t.guard.handleRoute(gist);
    assert.deepStrictEqual(gist.calls, ['abort']);
    assert.strictEqual(t.guard.failures().length, 1);
    assert.match(t.guard.failures()[0], /POST \/gists aborted as off-origin/);
  } finally {
    await t.close();
  }
});

test('ADR 0008, decision 5: every WebSocket is closed; the admin channel is telemetry, any other is a failure', async function () {
  const t = await setup();
  try {
    const sockets = [];
    const ws = function (url) {
      const s = { closed: 0, connected: false, url: function () { return url; }, close: async function () { s.closed++; } };
      sockets.push(s);
      return s;
    };
    await t.guard.handleWebSocket(ws('ws://127.0.0.1:7777/api-ws'));
    assert.deepStrictEqual(t.guard.failures(), []);
    assert.strictEqual(t.guard.telemetryCount(), 1);
    await t.guard.handleWebSocket(ws('ws://127.0.0.1:7777/api-ws'));
    assert.strictEqual(t.guard.telemetryCount(), 2);
    // anything else fails the test
    await t.guard.handleWebSocket(ws('ws://127.0.0.1:7777/other'));
    await t.guard.handleWebSocket(ws('ws://127.0.0.1:7777/api-ws?x=1'));
    await t.guard.handleWebSocket(ws('ws://127.0.0.1:7778/api-ws'));
    await t.guard.handleWebSocket(ws('wss://127.0.0.1:7777/api-ws'));
    await t.guard.handleWebSocket(ws('ws://evil.example/api-ws'));
    assert.strictEqual(t.guard.failures().length, 5);
    assert.ok(t.guard.failures().every(function (f) { return /WEBSOCKET .* aborted as websocket/.test(f); }));
    assert.ok(sockets.every(function (s) { return s.closed === 1; }));
  } finally {
    await t.close();
  }
});

test('ADR 0008, decision 5: a redirect hop that the rule table would refuse is reported afterwards', async function () {
  const t = await setup();
  try {
    const hop = function (url, method) {
      return {
        redirectedFrom: function () { return {}; }, method: function () { return method || 'GET'; },
        url: function () { return url; }, headers: function () { return {}; }, postDataBuffer: function () { return null; }
      };
    };
    t.guard.onRequest({ redirectedFrom: function () { return null; }, method: function () { return 'GET'; }, url: function () { return PROXY + '/api/solr/other/admin/ping'; } });
    assert.deepStrictEqual(t.guard.failures(), []);
    t.guard.onRequest(hop(PROXY + '/api/collections'));
    assert.deepStrictEqual(t.guard.failures(), []);
    t.guard.onRequest(hop(PROXY + '/api/solr/banana-it-x/admin/ping?action=disable'));
    assert.strictEqual(t.guard.failures().length, 1);
    assert.match(t.guard.failures()[0], /redirect hop/);
  } finally {
    await t.close();
  }
});

test('all writes of one process go through one queue, so two saves of one id see current state', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    const a = route(t, put(id));
    const b = route(t, put(id));
    await Promise.all([t.guard.handleRoute(a), t.guard.handleRoute(b)]);
    // the first save created it; the second came after, from created, without a second 404 check
    const methods = t.stub.log.filter(function (e) { return e.path !== '/api/session'; }).map(function (e) { return e.method; });
    assert.deepStrictEqual(methods, ['GET', 'PUT', 'GET', 'PUT', 'GET']);
    assert.strictEqual(t.ledger.stateOf(id), 'created');
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});

test('a login at an off-list form never reaches fetch', async function () {
  const t = await setup();
  try {
    const r = route(t, { method: 'POST', url: PROXY + '/api/session?realmName=ldap', body: '{}', contentType: 'application/json' });
    await t.guard.handleRoute(r);
    assert.deepStrictEqual(r.calls, ['abort']);
    const r2 = route(t, { method: 'POST', url: PROXY + '/api/session?realmName=native&_cookie=false', body: '{}', contentType: 'application/json' });
    await t.guard.handleRoute(r2);
    assert.deepStrictEqual(r2.calls, ['abort']);
  } finally {
    await t.close();
  }
});

test('a failure inside the route handler is recorded, except for a page that is already closed', async function () {
  const t = await setup();
  try {
    const failing = route(t, { method: 'GET', url: PROXY + '/api/collections' });
    failing.continue = async function () { throw new Error('something broke'); };
    await t.guard.handleRoute(failing);
    assert.deepStrictEqual(t.guard.failures(), ['the route handler failed: something broke']);
    t.guard.reset();
    const closed = route(t, { method: 'GET', url: PROXY + '/api/collections' });
    closed.continue = async function () { throw new Error('Target page, context or browser has been closed'); };
    await t.guard.handleRoute(closed);
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});

test('a failure inside the route handler aborts the request, and a second abort cannot throw', async function () {
  const t = await setup();
  try {
    const failing = route(t, { method: 'GET', url: PROXY + '/api/collections' });
    failing.continue = async function () { throw new Error('something broke'); };
    await t.guard.handleRoute(failing);
    assert.deepStrictEqual(failing.calls, ['abort']);
    const twice = route(t, { method: 'GET', url: PROXY + '/api/collections' });
    twice.continue = async function () { throw new Error('something broke'); };
    twice.abort = async function () { twice.calls.push('abort'); throw new Error('already handled'); };
    await t.guard.handleRoute(twice);
    assert.deepStrictEqual(twice.calls, ['abort']);
    assert.deepStrictEqual(t.guard.failures(), ['the route handler failed: something broke', 'the route handler failed: something broke']);
  } finally {
    await t.close();
  }
});

test('ADR 0008, decision 4: the confirmations are made by the Node client with its own session, never with the browser\'s', async function () {
  const t = await setup();
  try {
    // log the browser in separately: a second session on the stand-in for Fusion
    const login = await fetch(t.stub.origin + '/api/session?realmName=native', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const browserCookie = login.headers.getSetCookie()[0].split(';')[0];
    const clientCookie = t.stub.log.filter(function (e) { return e.method === 'GET' || e.method === 'PUT'; }).length;
    assert.strictEqual(clientCookie, 0);
    const id = t.client.allocate();
    const r = route(t, put(id));
    // the route sends the browser's cookie, as the real browser would
    const original = r.fetch;
    r.fetch = async function (options) {
      r.calls.push('fetch');
      const u = new URL(put(id).url);
      const res = await fetch(t.stub.origin + u.pathname + u.search, { method: 'PUT', headers: { cookie: browserCookie, 'content-type': 'application/json' }, body: JSON.stringify([{ id: id }]), redirect: 'manual' });
      await res.text();
      return { status: function () { return res.status; } };
    };
    void original;
    await t.guard.handleRoute(r);
    const seen = t.stub.log.filter(function (e) { return e.path.indexOf('/api/blobs/') === 0; });
    assert.deepStrictEqual(seen.map(function (e) { return e.method; }), ['GET', 'PUT', 'GET']);
    assert.strictEqual(seen[1].headers.cookie, browserCookie);
    assert.notStrictEqual(seen[0].headers.cookie, browserCookie);
    assert.strictEqual(seen[2].headers.cookie, seen[0].headers.cookie);
    assert.deepStrictEqual(t.guard.failures(), []);
  } finally {
    await t.close();
  }
});
