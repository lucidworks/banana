'use strict';

// The Node client against a stand-in for the Fusion blob API.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const { load, tempDir, startStubFusion } = require('./helpers');

const registry = load('registry.js');
const ids = load('ids.js');
const clientModule = load('client.js');
const { FusionClient, GuardError, SessionError, CollisionError, ConfirmError } = clientModule;

const TAG = 'aaaaaaaaaaaa';
const IDENTITY = '0123456789ab';
const CREDENTIAL = 'pw-never-in-output';

async function setup(behave, identity) {
  const stub = await startStubFusion(behave);
  const dir = tempDir();
  const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: identity || IDENTITY });
  const ledger = new registry.Ledger(reg);
  const client = new FusionClient({
    base: stub.origin, user: 'a-user', password: CREDENTIAL, ledger: ledger,
    allocator: new ids.Allocator(identity || IDENTITY), confirmDelayMs: 1
  });
  await client.login();
  return { stub: stub, client: client, ledger: ledger, reg: reg, close: function () { return stub.close(); } };
}

function methods(stub) {
  return stub.log.filter(function (e) { return e.path !== '/api/session'; }).map(function (e) { return e.method; });
}

test('the login is POST /api/session?realmName=native with a JSON body and no Origin header', async function () {
  const t = await setup();
  try {
    const login = t.stub.log[0];
    assert.strictEqual(login.method, 'POST');
    assert.strictEqual(login.path, '/api/session');
    assert.strictEqual(login.query, 'realmName=native');
    assert.strictEqual(login.headers['content-type'], 'application/json');
    assert.strictEqual(login.headers.origin, undefined);
    assert.deepStrictEqual(JSON.parse(login.body), { username: 'a-user', password: CREDENTIAL });
  } finally {
    await t.close();
  }
});

test('create: a 404 check, the PUT with resourceType=banana, a confirming GET; the registry follows', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, { rows: [] });
    assert.deepStrictEqual(methods(t.stub), ['GET', 'PUT', 'GET']);
    const put = t.stub.log.find(function (e) { return e.method === 'PUT'; });
    assert.strictEqual(put.path, '/api/blobs/' + id);
    assert.strictEqual(put.query, 'resourceType=banana');
    assert.strictEqual(put.headers['content-type'], 'application/json;charset=UTF-8');
    const doc = JSON.parse(put.body)[0];
    assert.deepStrictEqual(Object.keys(doc).sort(), ['banana_dashboard_s', 'banana_group_s', 'banana_title_s', 'banana_user_s', 'id', 'is_public_b']);
    assert.strictEqual(doc.id, id);
    assert.strictEqual(doc.banana_title_s, id);
    assert.strictEqual(JSON.parse(doc.banana_dashboard_s).title, id);
    assert.strictEqual(t.ledger.stateOf(id), 'created');
    assert.ok(t.stub.blobs.has(id));
  } finally {
    await t.close();
  }
});

test('create: every request carries only the client session, no Origin, and is not cached', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.slice(1).forEach(function (e) {
      assert.match(e.headers.cookie, /^id=tok1$/);
      assert.strictEqual(e.headers.origin, undefined);
      assert.strictEqual(e.headers.referer, undefined);
      assert.match(e.headers['cache-control'] || '', /no-cache/);
    });
  } finally {
    await t.close();
  }
});

test('the 404 check refuses the PUT and collides the id for 200, 204, 400, 500 and a dropped connection', async function () {
  const statuses = [200, 204, 400, 403, 500, 502];
  for (const status of statuses.concat(['drop'])) {
    const t = await setup({
      before: function (entry, send) {
        if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
          if (status === 'drop') {
            entry.socketDrop = true;
            return 'drop';
          }
          send(status, status === 204 ? undefined : { error: 'x' });
          return true;
        }
        return false;
      }
    });
    try {
      if (status === 'drop') {
        t.stub.behave.before = function (entry, send, state) { return false; };
        const original = t.client._fetch;
        t.client._fetch = function (url, init) {
          if (init.method === 'GET' && url.indexOf('/api/blobs/') !== -1) {
            return Promise.reject(new TypeError('fetch failed'));
          }
          return original(url, init);
        };
      }
      const id = t.client.allocate();
      await assert.rejects(t.client.create(id, {}), CollisionError, String(status));
      assert.strictEqual(t.ledger.stateOf(id), 'collided', String(status));
      assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'PUT'; }).length, 0, String(status));
      // a collided id can be neither created nor removed afterwards
      await assert.rejects(t.client.create(id, {}), GuardError);
      await assert.rejects(t.client.remove(id), GuardError);
      assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'PUT' || m === 'DELETE'; }).length, 0);
    } finally {
      await t.close();
    }
  }
});

test('a 401 on the 404 check logs in again and repeats the GET once', async function () {
  let first = true;
  const t = await setup({
    before: function (entry, send, state) {
      if (first && entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        first = false;
        state.sessions.clear();
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    assert.strictEqual(t.ledger.stateOf(id), 'created');
    const logins = t.stub.log.filter(function (e) { return e.method === 'POST' && e.path === '/api/session'; });
    assert.strictEqual(logins.length, 2);
  } finally {
    await t.close();
  }
});

test('a second 401 aborts with a session error, sends no PUT and does not collide the id', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        send(401, { error: 'no' });
        return true;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await assert.rejects(t.client.create(id, {}), SessionError);
    assert.strictEqual(t.ledger.stateOf(id), 'allocated');
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'PUT'; }).length, 0);
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method === 'GET'; }).length, 2);
  } finally {
    await t.close();
  }
});

test('a 401 on a PUT is not repeated inside the call; the teardown retry then succeeds', async function () {
  let expired = 0;
  const t = await setup({
    before: function (entry, send, state) {
      if (entry.method === 'PUT' && expired < 1) {
        expired++;
        state.sessions.clear();
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await assert.rejects(t.client.create(id, {}));
    assert.strictEqual(t.ledger.stateOf(id), 'put-sent');
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'PUT'; }).length, 1);
    const report = await t.client.teardown();
    assert.deepStrictEqual(report.removed, [id]);
    assert.strictEqual(t.ledger.stateOf(id), 'deleted');
  } finally {
    await t.close();
  }
});

test('a 401 on a DELETE is not repeated inside the call and leaves delete-sent; the teardown retry then succeeds', async function () {
  let armed = false;
  let expired = 0;
  const t = await setup({
    before: function (entry, send, state) {
      if (armed && entry.method === 'DELETE' && expired < 1) {
        expired++;
        state.sessions.clear();
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    armed = true;
    await assert.rejects(t.client.remove(id), ConfirmError);
    assert.strictEqual(t.ledger.stateOf(id), 'delete-sent');
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'DELETE'; }).length, 1);
    assert.ok(t.stub.blobs.has(id));
    const report = await t.client.teardown();
    assert.deepStrictEqual(report.removed, [id]);
    assert.deepStrictEqual(report.orphans, []);
    assert.strictEqual(t.ledger.stateOf(id), 'deleted');
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'DELETE'; }).length, 2);
    assert.ok(!t.stub.blobs.has(id));
  } finally {
    await t.close();
  }
});

test('the confirmation after a save needs a 200 whose body names the id, and leaves put-sent otherwise', async function () {
  let n = 0;
  const t = await setup({
    before: function (entry, send, state) {
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        n++;
        if (n === 2) {
          send(200, [{ id: 'something-else' }]);
          return true;
        }
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await assert.rejects(t.client.create(id, {}), ConfirmError);
    assert.strictEqual(t.ledger.stateOf(id), 'put-sent');
  } finally {
    await t.close();
  }
});

test('a save that answers an error leaves put-sent and does not confirm', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'PUT') {
        send(500, { error: 'x' });
        return true;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await assert.rejects(t.client.create(id, {}), /answered 500/);
    assert.strictEqual(t.ledger.stateOf(id), 'put-sent');
    assert.deepStrictEqual(methods(t.stub), ['GET', 'PUT']);
  } finally {
    await t.close();
  }
});

test('ADR 0008, scenarios S12 and N17: a save that was not confirmed, saved again, finds its own blob and collides', async function () {
  let n = 0;
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        n++;
        if (n === 2) {
          send(500, { error: 'x' });   // the confirmation fails; the PUT had landed
          return true;
        }
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await assert.rejects(t.client.create(id, {}), ConfirmError);
    assert.strictEqual(t.ledger.stateOf(id), 'put-sent');
    await assert.rejects(t.client.create(id, {}), CollisionError);
    assert.strictEqual(t.ledger.stateOf(id), 'collided');
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'PUT'; }).length, 1);
    // the run's own blob is never deleted by the run
    const report = await t.client.teardown();
    assert.deepStrictEqual(report.collided, [id]);
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'DELETE'; }).length, 0);
  } finally {
    await t.close();
  }
});

test('a second save of an id at created skips the 404 check and is confirmed again', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    await t.client.create(id, { rows: [1] });
    assert.deepStrictEqual(methods(t.stub), ['PUT', 'GET']);
    assert.strictEqual(t.ledger.stateOf(id), 'created');
  } finally {
    await t.close();
  }
});

test('remove: the DELETE is the exact URL, the confirmation is an independent 404, then deleted', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    await t.client.remove(id);
    assert.deepStrictEqual(methods(t.stub), ['DELETE', 'GET']);
    const del = t.stub.log[0];
    assert.strictEqual(del.path, '/api/blobs/' + id);
    assert.strictEqual(del.query, '');
    assert.strictEqual(del.body, '');
    assert.strictEqual(t.ledger.stateOf(id), 'deleted');
  } finally {
    await t.close();
  }
});

test('remove: a confirmation of 204 is a failure, retried twice 500 ms apart at most, and never repeats the write', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.method === 'DELETE') {
        send(204);
        return true;
      }
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0 && entry.after) {
        return false;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.log.length = 0;
    // the stub does not delete, so the blob is still there: the confirmation answers 200
    await assert.rejects(t.client.remove(id), ConfirmError);
    assert.deepStrictEqual(methods(t.stub), ['DELETE', 'GET', 'GET', 'GET']);
    assert.strictEqual(t.ledger.stateOf(id), 'delete-sent');
  } finally {
    await t.close();
  }
});

test('remove: a confirmation that answers 204 (a directory) does not count as deleted', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    t.stub.behave.before = function (entry, send) {
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        send(204);
        return true;
      }
      return false;
    };
    await assert.rejects(t.client.remove(id), ConfirmError);
    assert.strictEqual(t.ledger.stateOf(id), 'delete-sent');
  } finally {
    await t.close();
  }
});

test('remove: a confirmation that turns to 404 within the retries is accepted', async function () {
  const t = await setup();
  try {
    const id = t.client.allocate();
    await t.client.create(id, {});
    let gets = 0;
    t.stub.behave.before = function (entry, send, state) {
      if (entry.method === 'DELETE') {
        send(202);   // accepted, not done yet
        return true;
      }
      if (entry.method === 'GET') {
        gets++;
        if (gets === 3) {
          state.blobs.delete(id);
        }
      }
      return false;
    };
    await t.client.remove(id);
    assert.strictEqual(t.ledger.stateOf(id), 'deleted');
    assert.strictEqual(gets, 3);
  } finally {
    await t.close();
  }
});

test('remove and get accept only owned ids, and remove only from put-sent, created or delete-sent', async function () {
  const t = await setup();
  const other = await setup(undefined, 'ba9876543210');
  try {
    const mine = t.client.allocate();
    const theirs = other.client.allocate();
    await assert.rejects(t.client.get(theirs), GuardError);
    await assert.rejects(t.client.remove(theirs), GuardError);
    await assert.rejects(t.client.create(theirs, {}), GuardError);
    await assert.rejects(t.client.remove('banana-it-0123456789ab-99'), GuardError);
    await assert.rejects(t.client.remove('Ops?v2'), GuardError);
    // allocated: not yet at a state that allows a delete
    await assert.rejects(t.client.remove(mine), /allows a delete \(allocated\)/);
    await t.client.create(mine, {});
    await t.client.remove(mine);
    // deleted: not again
    await assert.rejects(t.client.remove(mine), /allows a delete \(deleted\)/);
    assert.strictEqual(methods(other.stub).filter(function (m) { return m === 'DELETE'; }).length, 0);
  } finally {
    await t.close();
    await other.close();
  }
});

test('the probe reads an id from a registry file without needing to own it, and refuses anything that is not a run id', async function () {
  const t = await setup();
  try {
    assert.strictEqual(await t.client.probe('banana-it-aaaaaaaaaaaa-1'), 404);
    await assert.rejects(t.client.probe('Ops'), GuardError);
    await assert.rejects(t.client.probe('banana-it-aaaaaaaaaaaa-1?x'), GuardError);
    assert.deepStrictEqual(methods(t.stub), ['GET']);
  } finally {
    await t.close();
  }
});

test('a redirect answer to any direct request is a failure and is not followed', async function () {
  const t = await setup();
  try {
    t.stub.behave.before = function (entry, send) {
      if (entry.path.indexOf('/api/blobs/') === 0) {
        send(307, '', { location: '/elsewhere' });
        return true;
      }
      if (entry.path === '/elsewhere') {
        return false;
      }
      return false;
    };
    const id = t.client.allocate();
    // the 404 check cannot tell what is there, so the id collides and nothing is repeated at the new address
    await assert.rejects(t.client.create(id, {}), CollisionError);
    assert.ok(!t.stub.log.some(function (e) { return e.path === '/elsewhere'; }));
    // a redirect answer to a PUT
    const id2 = t.client.allocate();
    t.stub.behave.before = function (entry, send) {
      if (entry.method === 'GET' && entry.path.indexOf('/api/blobs/') === 0) {
        send(404, {});
        return true;
      }
      if (entry.method === 'PUT') {
        send(308, '', { location: '/elsewhere' });
        return true;
      }
      return false;
    };
    await assert.rejects(t.client.create(id2, {}), /redirect/);
    assert.ok(!t.stub.log.some(function (e) { return e.path === '/elsewhere'; }));
    // a redirect answer to the login
    t.stub.behave.before = function (entry, send) {
      send(302, '', { location: '/elsewhere' });
      return true;
    };
    await assert.rejects(t.client.login(), /redirect/);
    assert.ok(!t.stub.log.some(function (e) { return e.path === '/elsewhere'; }));
  } finally {
    await t.close();
  }
});

test('logout sends one DELETE /api/session with no query and no body, and drops the cookie', async function () {
  const t = await setup();
  try {
    t.stub.log.length = 0;
    const status = await t.client.logout();
    assert.strictEqual(status, 204);
    assert.strictEqual(t.stub.log.length, 1);
    assert.strictEqual(t.stub.log[0].method, 'DELETE');
    assert.strictEqual(t.stub.log[0].path, '/api/session');
    assert.strictEqual(t.stub.log[0].query, '');
    assert.strictEqual(t.stub.log[0].body, '');
    assert.strictEqual(t.client._cookies.size, 0);
  } finally {
    await t.close();
  }
});

test('error messages carry the path only, never the host, the port or a credential', async function () {
  const t = await setup({
    before: function (entry, send) {
      if (entry.path.indexOf('/api/blobs/') === 0) {
        send(500, { error: 'x' });
        return true;
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    let message = '';
    try {
      await t.client.create(id, {});
    } catch (e) {
      message = e.message + (e.cls || '');
    }
    t.stub.behave.before = null;
    try {
      await t.client.get('banana-it-ba9876543210-1');
    } catch (e) {
      message += e.message;
    }
    try {
      await t.client._send({ method: 'DELETE', url: t.stub.origin + '/api/blobs/Ops?v2', body: null });
    } catch (e) {
      message += e.message;
    }
    const port = String(new URL(t.stub.origin).port);
    assert.ok(message.length > 0);
    assert.ok(!message.includes('127.0.0.1'), message);
    assert.ok(!message.includes(port), message);
    assert.ok(!message.includes(CREDENTIAL), message);
    assert.ok(!message.includes('a-user'), message);
  } finally {
    await t.close();
  }
});

test('one request is in flight at a time', async function () {
  let inFlight = 0;
  let max = 0;
  const t = await setup({
    before: function (entry, send) {
      if (entry.path.indexOf('/api/blobs/') === 0) {
        inFlight++;
        max = Math.max(max, inFlight);
        setTimeout(function () {
          inFlight--;
          send(404, {});
        }, 20);
        return true;
      }
      return false;
    }
  });
  try {
    const owned = [t.client.allocate(), t.client.allocate(), t.client.allocate(), t.client.allocate()];
    await Promise.all(owned.map(function (id) { return t.client.get(id); }));
    assert.strictEqual(max, 1);
  } finally {
    await t.close();
  }
});

test('the client refuses a request its own rule table does not allow', async function () {
  const t = await setup();
  try {
    await assert.rejects(t.client._send({ method: 'DELETE', url: t.stub.origin + '/api/blobs/Ops', body: null }), GuardError);
    await assert.rejects(t.client._send({ method: 'PUT', url: t.stub.origin + '/api/blobs/Ops?resourceType=banana', body: '[]' }), GuardError);
    await assert.rejects(t.client._send({ method: 'POST', url: t.stub.origin + '/api/apps', body: '{}' }), GuardError);
    await assert.rejects(t.client._send({ method: 'GET', url: 'http://127.0.0.1:1/api' }), GuardError);
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method !== 'POST'; }).length, 0);
  } finally {
    await t.close();
  }
});

test('teardown removes what may exist, skips collided ids and reports what it could not remove', async function () {
  const t = await setup();
  try {
    const a = t.client.allocate();
    const b = t.client.allocate();
    const c = t.client.allocate();
    const d = t.client.allocate();
    await t.client.create(a, {});
    await t.client.create(b, {});
    await t.client.remove(b);
    t.stub.blobs.set(c, []);
    await assert.rejects(t.client.create(c, {}), CollisionError);
    const report = await t.client.teardown();
    assert.deepStrictEqual(report.removed.sort(), [a, b].sort());
    assert.deepStrictEqual(report.collided, [c]);
    assert.deepStrictEqual(report.neverSent, [d]);
    assert.deepStrictEqual(report.orphans, []);
    assert.ok(t.stub.blobs.has(c));    // the collided blob was left alone
  } finally {
    await t.close();
  }
});

test('teardown retries an id left at delete-sent once, then reports it as an orphan', async function () {
  const t = await setup();
  try {
    const a = t.client.allocate();
    await t.client.create(a, {});
    t.stub.behave.before = function (entry, send) {
      if (entry.method === 'DELETE') {
        send(500, {});
        return true;
      }
      return false;
    };
    const report = await t.client.teardown();
    assert.deepStrictEqual(report.orphans, [a]);
    assert.strictEqual(methods(t.stub).filter(function (m) { return m === 'DELETE'; }).length, 2);
    assert.strictEqual(t.ledger.stateOf(a), 'delete-sent');
  } finally {
    await t.close();
  }
});

test('after a 401 on a write, the next request logs in first, so two writes in a row do not both fail', async function () {
  let expire = true;
  const t = await setup({
    before: function (entry, send, state) {
      if (expire && entry.method === 'PUT') {
        expire = false;
        state.sessions.clear();
      }
      return false;
    }
  });
  try {
    const id = t.client.allocate();
    t.client.beginPut(id);
    const put = function () {
      return t.client._send({ method: 'PUT', url: t.stub.origin + '/api/blobs/' + id + '?resourceType=banana', contentType: 'application/json', body: '[]' });
    };
    assert.strictEqual((await put()).status, 401);
    // no read in between: the write itself must start with a new login
    assert.strictEqual((await put()).status, 200);
    assert.strictEqual(t.stub.log.filter(function (e) { return e.method === 'POST' && e.path === '/api/session'; }).length, 2);
  } finally {
    await t.close();
  }
});
