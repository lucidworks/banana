'use strict';

// The Playwright facts the guard leans on, shown with a real browser (version
// 1.65.0) against local servers. No Fusion. Skipped when no Chromium is
// installed for this Playwright version.
// Run with: npm run test:live-local

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const playwrightCore = require('playwright-core');
const { startWorld } = require('./world');
const helpers = require('../node/live/helpers');

const fixture = require('../live/fusion-client/fixture');
const { Guard } = require('../live/fusion-client/guard');

const HAVE_BROWSER = (function () {
  try {
    return fs.existsSync(playwrightCore.chromium.executablePath());
  } catch (e) {
    return false;
  }
})();

const skip = HAVE_BROWSER ? false : 'no Chromium for this Playwright version is installed';

const PAGES = {
  'frame.html': '<!doctype html><script>fetch("/api/solr/iframe/admin/ping");</script>',
  'outer.html': '<!doctype html><iframe src="frame.html"></iframe>',
  'sw.js': 'self.addEventListener("fetch", function () {});'
};

// Start a world, a session, a browser and one guarded context.
async function withContext(options, body) {
  const world = await startWorld(options);
  const env = world.env();
  const session = await fixture.createSession(env);
  const browser = await fixture.launchGuardedBrowser();
  const context = await fixture.newGuardedContext(browser, session.settings.proxyOrigin);
  fixture.patchRequestClass(context);
  const guard = new Guard({ client: session.client, origin: session.settings.proxyOrigin, serialise: session.serialise });
  await fixture.installGuard(context, guard);
  try {
    await body({ world: world, session: session, browser: browser, context: context, guard: guard, env: env });
  } finally {
    await context.close();
    await browser.close();
    await session.client.teardown();
    session.registry.close();
    await world.close();
  }
}

async function bananaPage(t, options) {
  const page = await t.context.newPage();
  await page.goto(t.world.proxyOrigin + '/admin/banana/index.html');
  if (!options || options.login !== false) {
    // the stand-in for Fusion answers 401 to a request without a session
    const status = await page.evaluate(async function () {
      const res = await fetch('/api/session?realmName=native', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return res.status;
    });
    assert.strictEqual(status, 201);
  }
  return page;
}

function putInPage(page, id) {
  return page.evaluate(async function (id) {
    const res = await fetch('/api/blobs/' + id + '?resourceType=banana', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: id }])
    });
    return res.status;
  }, id);
}

function deleteInPage(page, path) {
  return page.evaluate(async function (p) {
    const res = await fetch(p, { method: 'DELETE' });
    return res.status;
  }, path);
}

function pageFetch(page, url, init) {
  return page.evaluate(async function (args) {
    try {
      const res = await fetch(args.url, args.init);
      return res.status;
    } catch (e) {
      return 'failed';
    }
  }, { url: url, init: init || {} });
}

test('the route sees a request from a second page and from an iframe', { skip: skip }, async function () {
  await withContext({ bananaFiles: PAGES }, async function (t) {
    const first = await bananaPage(t);
    const second = await t.context.newPage();
    await second.goto(t.world.proxyOrigin + '/admin/banana/index.html');
    assert.strictEqual(await pageFetch(second, '/api/solr/second/admin/ping'), 'failed');
    const third = await t.context.newPage();
    await third.goto(t.world.proxyOrigin + '/admin/banana/outer.html');
    await third.waitForTimeout(500);
    const paths = t.guard.aborts.map(function (a) { return a.path; });
    assert.ok(paths.includes('/api/solr/second/admin/ping'), paths.join());
    assert.ok(paths.includes('/api/solr/iframe/admin/ping'), paths.join());
    assert.strictEqual(first.url().indexOf(t.world.proxyOrigin), 0);
    // neither reached the stand-in for Fusion
    assert.ok(!t.world.stub.log.some(function (e) { return /\/admin\/ping/.test(e.path); }));
  });
});

test('with service workers blocked, none runs and none controls the page', { skip: skip }, async function () {
  await withContext({ bananaFiles: PAGES }, async function (t) {
    const page = await bananaPage(t);
    const result = await page.evaluate(async function () {
      let outcome;
      try {
        await navigator.serviceWorker.register('/admin/banana/sw.js');
        outcome = 'registered';
      } catch (e) {
        outcome = 'refused';
      }
      await new Promise(function (r) { setTimeout(r, 500); });
      const regs = await navigator.serviceWorker.getRegistrations();
      return { outcome: outcome, registrations: regs.length, controlled: !!navigator.serviceWorker.controller };
    });
    process.stdout.write('# service worker register() with serviceWorkers "block": ' + JSON.stringify(result) + '\n');
    assert.strictEqual(t.context.serviceWorkers().length, 0);
    assert.strictEqual(result.controlled, false);
    await page.reload();
    assert.strictEqual(await page.evaluate(function () { return !!navigator.serviceWorker.controller; }), false);
    assert.strictEqual(t.context.serviceWorkers().length, 0);
  });
});

test('the PUT confirmation runs before the page sees the response, and the DELETE confirmation too', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    const page = await bananaPage(t);
    const id = t.session.client.allocate();
    t.world.stub.log.length = 0;
    const status = await putInPage(page, id);
    assert.strictEqual(status, 200);
    const afterPut = t.world.stub.log.filter(function (e) { return e.path !== '/api/session'; }).map(function (e) { return e.method; });
    assert.deepStrictEqual(afterPut, ['GET', 'PUT', 'GET']);
    assert.strictEqual(t.session.ledger.stateOf(id), 'created');
    t.world.stub.log.length = 0;
    const del = await deleteInPage(page, '/api/blobs/' + id);
    assert.ok(del >= 200 && del < 300, String(del));
    assert.deepStrictEqual(t.world.stub.log.map(function (e) { return e.method; }), ['DELETE', 'GET']);
    assert.strictEqual(t.session.ledger.stateOf(id), 'deleted');
    assert.deepStrictEqual(t.guard.failures(), []);
  });
});

test('a 307 or 308 answer to a login, a select, a PUT and a DELETE comes back as 502 and the target is never requested', { skip: skip }, async function () {
  for (const redirectStatus of [307, 308]) {
    await withContext({}, async function (t) {
      const page = await bananaPage(t);
      const owned = t.session.client.allocate();
      await t.session.client.create(owned, {});
      const fresh = t.session.client.allocate();
      t.world.redirectStatus = redirectStatus;
      const cases = [
        ['login', function (e) { return e.method === 'POST' && e.path === '/api/session' && e.headers.origin; }, function () {
          return pageFetch(page, '/api/session?realmName=native', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        }],
        ['select', function (e) { return e.method === 'POST' && /\/select$/.test(e.path); }, function () {
          return pageFetch(page, '/api/solr/banana-it-x/select', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'q=*' });
        }],
        ['put', function (e) { return e.method === 'PUT'; }, function () { return putInPage(page, fresh); }],
        ['delete', function (e) { return e.method === 'DELETE' && e.path !== '/api/session'; }, function () { return deleteInPage(page, '/api/blobs/' + owned); }]
      ];
      for (const c of cases) {
        t.world.redirectOn = c[1];
        const before = t.guard.aborts.length;
        const status = await c[2]();
        assert.strictEqual(status, 502, redirectStatus + ' ' + c[0]);
        assert.ok(t.guard.aborts.slice(before).some(function (a) { return a.cls === 'redirect'; }), redirectStatus + ' ' + c[0]);
      }
      t.world.redirectOn = null;
      assert.deepStrictEqual(t.world.target.hits, [], 'the redirect target was requested');
      // the delete is still there: the confirmation failed, so the test fails and the id is left to the teardown
      assert.ok(t.guard.failures().length >= 2);
      assert.strictEqual(t.session.ledger.stateOf(owned), 'delete-sent');
    });
  }
});

test('route.fetch sends the context cookies, and a Set-Cookie in a fulfilled login answer reaches the cookie jar', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    const page = await bananaPage(t, { login: false });
    assert.deepStrictEqual(await t.context.cookies(), []);
    const status = await pageFetch(page, '/api/session?realmName=native', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(status, 201);
    const cookies = await t.context.cookies();
    assert.ok(cookies.some(function (c) { return c.name === 'id' && c.value; }), JSON.stringify(cookies));
    // the next guarded write is sent with that cookie: the stand-in for Fusion answers 401 without a session
    const id = t.session.client.allocate();
    t.world.stub.log.length = 0;
    assert.strictEqual(await putInPage(page, id), 200);
    const put = t.world.stub.log.find(function (e) { return e.method === 'PUT'; });
    assert.match(put.headers.cookie, /id=tok\d+/);
  });
});

test('the alias form page.request throws for every method, while route.fetch still sends the guarded writes', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    const page = await bananaPage(t);
    const api = page.request;
    assert.strictEqual(api, t.context.request);
    for (const method of ['fetch', 'get', 'head', 'post', 'put', 'patch', 'delete']) {
      await assert.rejects(Promise.resolve().then(function () { return api[method](t.world.proxyOrigin + '/api/blobs/Ops'); }), /not available in live tests/, method);
    }
    assert.ok(!t.world.stub.log.some(function (e) { return e.path === '/api/blobs/Ops'; }));
    const id = t.session.client.allocate();
    assert.strictEqual(await putInPage(page, id), 200);
    const del = await deleteInPage(page, '/api/blobs/' + id);
    assert.ok(del >= 200 && del < 300);
    assert.strictEqual(t.session.ledger.stateOf(id), 'deleted');
    assert.deepStrictEqual(t.guard.failures(), []);
  });
});

test('every WebSocket a page opens is closed and recorded; the admin channel is telemetry, any other a failure', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    const page = await bananaPage(t);
    const open = function (p) {
      return page.evaluate(function (u) {
        return new Promise(function (resolve) {
          const ws = new WebSocket(u);
          ws.onclose = function () { resolve('closed'); };
          ws.onerror = function () {};
          setTimeout(function () { resolve('timeout'); }, 4000);
        });
      }, 'ws://' + new URL(t.world.proxyOrigin).host + p);
    };
    assert.strictEqual(await open('/api-ws'), 'closed');
    assert.deepStrictEqual(t.guard.failures(), []);
    assert.strictEqual(t.guard.telemetryCount(), 1);
    assert.strictEqual(await open('/other'), 'closed');
    assert.strictEqual(t.guard.failures().length, 1);
    assert.match(t.guard.failures()[0], /aborted as websocket/);
    // no socket was connected to a server
    assert.deepStrictEqual(t.world.upgrades, []);
  });
});

test('a redirected GET hop is reported by the request-event check (the test notes whether the event fires per hop)', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    t.world.behave = function (entry, send) {
      if (entry.method === 'GET' && entry.path === '/api/collections') {
        send(302, '', { location: '/api/solr/banana-it-x/admin/ping?action=disable' });
        return true;
      }
      return false;
    };
    const page = await bananaPage(t);
    const hops = [];
    t.context.on('request', function (r) { hops.push(r.url().replace(t.world.proxyOrigin, '') + (r.redirectedFrom() ? ' (hop)' : '')); });
    await pageFetch(page, '/api/collections');
    await page.waitForTimeout(300);
    process.stdout.write('# request events for a redirected GET: ' + hops.join(' -> ') + '\n');
    assert.ok(hops.some(function (h) { return /\(hop\)$/.test(h); }), 'the request event did not fire for the redirect hop: ' + hops.join(' -> '));
    assert.ok(t.guard.aborts.some(function (a) { return a.hop && a.cls === 'unlisted-read'; }), JSON.stringify(t.guard.aborts));
    assert.strictEqual(t.guard.failures().length, 1);
  });
});

test('logoutBrowser sends one DELETE /api/session through the route and logout() sends one from Node', { skip: skip }, async function () {
  await withContext({}, async function (t) {
    // the browser needs a session of its own to be logged out
    const page = await bananaPage(t);
    const api = fixture.liveApi(t.session, t.guard);
    t.world.stub.log.length = 0;
    const status = await api.logoutBrowser(page);
    assert.ok(status >= 200 && status < 300, String(status));
    assert.strictEqual(t.world.stub.log.length, 1);
    assert.strictEqual(t.world.stub.log[0].method, 'DELETE');
    assert.strictEqual(t.world.stub.log[0].path, '/api/session');
    assert.strictEqual(t.world.stub.log[0].query, '');
    assert.strictEqual(t.world.stub.log[0].body, '');
    t.world.stub.log.length = 0;
    await api.logoutNode();
    assert.strictEqual(t.world.stub.log.length, 1);
    assert.strictEqual(t.world.stub.log[0].method, 'DELETE');
    assert.strictEqual(t.world.stub.log[0].query, '');
    assert.strictEqual(t.world.stub.log[0].body, '');
    assert.deepStrictEqual(t.guard.failures(), []);
    await t.session.client.login();
  });
});

for (const landing of ['banana', 'admin']) {
  test('the login helper ends on Banana whether the login lands on Banana or on the admin UI (' + landing + ')', { skip: skip }, async function () {
    await withContext({ landing: landing }, async function (t) {
      t.world.landing = landing;
      const api = fixture.liveApi(t.session, t.guard);
      const page = await t.context.newPage();
      await api.loginBrowser(page);
      assert.strictEqual(page.url(), api.bananaUrl(''));
      const seen = t.world.stub.log.map(function (e) { return e.method + ' ' + e.path; });
      const login = t.world.stub.log.find(function (e) { return e.method === 'POST' && e.path === '/api/session' && e.headers.origin; });
      assert.strictEqual(login.query, 'realmName=native');
      assert.strictEqual(login.headers['content-type'], 'application/json');
      if (landing === 'admin') {
        // the landing reads are on the allowlist, the telemetry is counted, nothing fails the test
        assert.ok(t.world.proxyLog.includes('GET /api-ws'), t.world.proxyLog.join());
        assert.ok(seen.includes('GET /api/apps'));
        assert.ok(!seen.includes('POST /api/ui-logs'));
        assert.ok(t.guard.telemetryCount() >= 1);
      }
      assert.deepStrictEqual(t.guard.failures(), []);
    });
  });
}

test('the launch and context calls pass every key explicitly, and an explicit no-op logger', { skip: skip }, async function () {
  const world = await startWorld();
  const session = await fixture.createSession(world.env());
  const launches = [];
  const originalLaunch = playwrightCore.chromium.launch;
  playwrightCore.chromium.launch = function (o) {
    launches.push(o);
    return originalLaunch.call(this, o);
  };
  let browser;
  try {
    browser = await fixture.launchGuardedBrowser();
  } finally {
    playwrightCore.chromium.launch = originalLaunch;
  }
  const contexts = [];
  const originalNew = browser.newContext;
  browser.newContext = function (o) {
    contexts.push(o);
    return originalNew.call(this, o);
  };
  const context = await fixture.newGuardedContext(browser, session.settings.proxyOrigin);
  try {
    assert.strictEqual(launches.length, 1);
    fixture.LAUNCH_KEYS.forEach(function (k) { assert.ok(k in launches[0], k); });
    assert.strictEqual(launches[0].logger, fixture.NOOP_LOGGER);
    assert.strictEqual(contexts.length, 1);
    fixture.CONTEXT_KEYS.forEach(function (k) { assert.ok(k in contexts[0], k); });
    assert.strictEqual(contexts[0].serviceWorkers, 'block');
    assert.strictEqual(contexts[0].baseURL, session.settings.proxyOrigin);
  } finally {
    await context.close();
    await browser.close();
    session.registry.close();
    await world.close();
  }
});
