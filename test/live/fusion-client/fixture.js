'use strict';

// The Playwright fixture for live tests. A spec imports `test` from here and
// gets guarded `context` and `page` fixtures. Every browser context is created
// by this module, from a browser that only this module launches, with the rule
// set of guard.js installed on all URLs. The stock `request` and `browser`
// fixtures throw, and the `playwright` fixture is a wrapper of the real module
// whose launch, connect and request-context calls throw.

const path = require('node:path');
const base = require('@playwright/test');
const playwrightCore = require('playwright-core');

const settings = require('./settings');
const ids = require('./ids');
const registry = require('./registry');
const instance = require('./instance');
const options = require('./options');
const { FusionClient } = require('./client');
const { Guard, makeQueue } = require('./guard');
const { makeTracer } = require('./trace');

const CONTEXT_KEYS = options.CONTEXT_KEYS;
const LAUNCH_KEYS = options.LAUNCH_KEYS;
const NOOP_LOGGER = options.NOOP_LOGGER;

const GUARDED = 'use the guarded fixtures of test/live/fusion-client instead';
const REQUEST_METHODS = ['fetch', 'get', 'head', 'post', 'put', 'patch', 'delete'];
const PATCHED = Symbol.for('banana.live.requestClassPatched');

function refused(what) {
  return function () {
    throw new Error(what + ' is not available in live tests; ' + GUARDED);
  };
}

// The runner's own `playwright` fixture loads playwright-core by name. This
// module must hold the same module instance, so a context it creates is in the
// set the runner's auto fixtures read.
function checkSamePlaywright() {
  const mine = require.resolve('playwright-core');
  const runners = require.resolve('playwright-core', { paths: [path.dirname(require.resolve('playwright'))] });
  if (mine !== runners) {
    throw new Error('the client module and the test runner load different copies of playwright-core');
  }
}

// A proxy that forwards reads and writes to the real object and calls methods
// with the real object as `this`, except for the members in `overrides`.
function forwarding(target, overrides) {
  return new Proxy(target, {
    get: function (t, prop) {
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return overrides[prop](t);
      }
      const value = Reflect.get(t, prop, t);
      return typeof value === 'function' ? value.bind(t) : value;
    },
    set: function (t, prop, value) {
      return Reflect.set(t, prop, value, t);
    }
  });
}

// A wrapper of the real playwright module. It forwards everything the runner's
// auto fixtures use (_instrumentation, _allContexts, request._contexts, the
// default launch and context settings) and throws only from the calls that
// obtain an unguarded browser or request client.
function wrapPlaywright(real) {
  const cache = {};
  function browserType(name) {
    if (!cache[name]) {
      const throwing = {};
      ['launch', 'launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP'].forEach(function (m) {
        throwing[m] = function () {
          return refused(name + '.' + m);
        };
      });
      cache[name] = forwarding(real[name], throwing);
    }
    return cache[name];
  }
  const overrides = {
    chromium: function () { return browserType('chromium'); },
    firefox: function () { return browserType('firefox'); },
    webkit: function () { return browserType('webkit'); },
    request: function (t) {
      return forwarding(t.request, { newContext: function () { return refused('request.newContext'); } });
    },
    _android: refused('_android'),
    _electron: refused('_electron')
  };
  return forwarding(real, overrides);
}

// page.request and context.request are one object that holds the session's
// cookies and that no route sees. Replace the public methods of its class with
// functions that throw. route.fetch uses an internal method of the same class,
// which stays in place, so the guarded writes keep working.
function patchRequestClass(context) {
  const proto = Object.getPrototypeOf(context.request);
  if (proto[PATCHED]) {
    return;
  }
  REQUEST_METHODS.forEach(function (name) {
    Object.defineProperty(proto, name, { value: refused('request.' + name), writable: true, configurable: true });
  });
  Object.defineProperty(proto, PATCHED, { value: true });
}

// Install the rule set on a browser context: one route for all URLs, the
// WebSocket route and the redirect-hop listener.
async function installGuard(context, guard) {
  await context.route(/.*/, guard.handleRoute);
  await context.routeWebSocket(/.*/, guard.handleWebSocket);
  context.on('request', guard.onRequest);
}

async function launchGuardedBrowser() {
  return playwrightCore.chromium.launch(options.launchOptions());
}

async function newGuardedContext(browser, proxyOrigin) {
  return browser.newContext(options.contextOptions(proxyOrigin));
}

// Everything one worker needs to write: the checks, the registry, the client.
async function createSession(env) {
  const s = settings.readSettings(env, { credentials: true, proxy: true });
  checkSamePlaywright();
  const dir = registry.checkRegistryDir(s.registryDir);
  // The mode and instance checks come first: nothing is sent to the instance
  // when either fails.
  await instance.checkInstance({ proxyOrigin: s.proxyOrigin, fusionOrigin: s.fusionOrigin, digestKey: s.digestKey });
  const identity = ids.newIdentity();
  const reg = new registry.Registry({ dir: dir, runTag: s.runTag, identity: identity });
  const ledger = new registry.Ledger(reg);
  const trace = makeTracer(env.BANANA_LIVE_TRACE_FILE);
  const client = new FusionClient({
    base: s.fusionOrigin,
    user: s.user,
    password: s.password,
    ledger: ledger,
    allocator: new ids.Allocator(identity),
    trace: trace
  });
  await client.login();
  return { settings: s, identity: identity, registry: reg, ledger: ledger, client: client, serialise: makeQueue(), trace: trace };
}

async function endSession(session) {
  const report = await session.client.teardown();
  session.registry.close();
  process.stdout.write('live-test teardown: removed ' + report.removed.length + ', left behind ' + report.orphans.length +
    ', collided ' + report.collided.length + ', never sent ' + report.neverSent.length + '\n');
  ['orphans', 'collided'].forEach(function (key) {
    report[key].forEach(function (id) {
      process.stdout.write('live-test ' + key + ': ' + id + '\n');
    });
  });
  if (report.orphans.length) {
    throw new Error('live-test teardown left blobs behind: ' + report.orphans.join(', '));
  }
}

// Set the value of an input inside the page and tell the page's listeners, the
// way locator.fill does, without putting the value into Playwright's call log.
function setValue(locator, value, timeout) {
  return locator.evaluate(function (el, v) {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value, { timeout: timeout || 30000 });
}

function bananaUrl(proxyOrigin, hash) {
  return proxyOrigin + settings.BANANA_PATH + 'index.html' + (hash || '');
}

// The helpers a spec uses. Specs never send a request themselves.
function liveApi(session, guard) {
  const origin = session.settings.proxyOrigin;
  return {
    allocate: function () { return session.client.allocate(); },
    create: function (id, dashboard) { return session.client.create(id, dashboard); },
    get: function (id) { return session.client.get(id); },
    remove: function (id) { return session.client.remove(id); },
    stateOf: function (id) { return session.ledger.stateOf(id); },
    logoutNode: function () { return session.client.logout(); },
    bananaUrl: function (hash) { return bananaUrl(origin, hash); },
    aborts: function () { return guard.aborts.slice(); },
    telemetryCount: function () { return guard.telemetryCount(); },
    // Log the browser in through the login application, with the return
    // address set to Banana, then navigate to Banana whichever page it landed
    // on, so a test never starts on, or stays on, the admin UI.
    loginBrowser: async function (page) {
      await page.goto(origin + '/auth/login?return=' + encodeURIComponent(settings.BANANA_PATH + 'index.html'));
      // The login application loads its components lazily after the load
      // event. A click before they are ready is lost, so wait for the page to
      // go quiet first.
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(function () {});
      // A fill or a click that lands before the components are ready is lost
      // without an error, so fill and click again if no login request is seen.
      // The values are set inside the page, not with locator.fill: fill writes
      // its value into the call log, which ends up in error messages, and the
      // password field is emptied again as soon as the request is sent, so a
      // page snapshot taken later cannot hold it.
      const password = page.locator('input[type=password]').first();
      let response = null;
      try {
        for (let attempt = 1; attempt <= 4 && !response; attempt++) {
          await setValue(page.locator('input[type=text]').first(), session.settings.user);
          await setValue(password, session.settings.password);
          const isLogin = function (r) { return r.method() === 'POST' && new URL(r.url()).pathname === '/api/session'; };
          const sent = page.waitForRequest(isLogin, { timeout: 8000 });
          const answered = page.waitForResponse(function (r) { return isLogin(r.request()); }, { timeout: 60000 });
          answered.catch(function () {});
          await page.getByRole('button', { name: 'Login' }).click();
          // Only a click that sent no login request is repeated. A login that
          // was sent is never sent again, whatever the answer or its delay.
          const request = await sent.catch(function () { return null; });
          if (request) {
            response = await answered;
          }
          await setValue(password, '', 1000).catch(function () {});
        }
      } finally {
        await setValue(password, '', 1000).catch(function () {});
      }
      if (!response) {
        throw new Error('the browser login sent no request');
      }
      if (response.status() < 200 || response.status() > 299) {
        throw new Error('the browser login answered ' + response.status());
      }
      // The login application moves the page on by itself; wait for that
      // before navigating, so the two navigations do not race.
      await page.waitForURL(function (url) { return url.pathname.indexOf('/auth/login') !== 0; }, { timeout: 30000 }).catch(function () {});
      await page.waitForLoadState('load');
      await page.goto(bananaUrl(origin, ''));
    },
    // Banana has no logout code. The request is sent from the page, so it goes
    // through the context route and meets the same rule as any other DELETE.
    logoutBrowser: async function (page) {
      if (page.url().indexOf(origin) !== 0) {
        await page.goto(bananaUrl(origin, ''));
      }
      return page.evaluate(async function () {
        const res = await fetch('/api/session', { method: 'DELETE' });
        return res.status;
      });
    }
  };
}

const test = base.test.extend({
  // A wrapper of the real module, not something that throws: the runner's auto
  // fixtures read and set members of it in every test.
  playwright: [async function ({ playwright }, use) {
    await use(wrapPlaywright(playwright));
  }, { scope: 'worker', box: true }],

  // The stock request client and browser are unguarded.
  request: [async function ({}, use) {
    refused('the request fixture')();
    await use(null);
  }, {}],
  browser: [async function ({}, use) {
    refused('the browser fixture')();
    await use(null);
  }, { scope: 'worker' }],

  // The free-form contextOptions bag adds nothing to the guarded context.
  _combinedContextOptions: [{}, { box: true }],

  _session: [async function ({}, use) {
    const session = await createSession(process.env);
    let failure = null;
    try {
      await use(session);
    } finally {
      try {
        await endSession(session);
      } catch (e) {
        failure = e;
      }
    }
    if (failure) {
      throw failure;
    }
  }, { scope: 'worker', timeout: 0 }],

  // The guarded browser's setup depends on _browserOptions, so the runner's
  // launch defaults (trace and artifact directories) are set before it launches.
  _guardedBrowser: [async function ({ _browserOptions, _session }, use) {
    const browser = await launchGuardedBrowser(_browserOptions);
    await use(browser);
    await browser.close();
  }, { scope: 'worker', timeout: 0 }],

  _guard: async function ({ _session }, use) {
    await use(new Guard({ client: _session.client, origin: _session.settings.proxyOrigin, serialise: _session.serialise, trace: _session.trace }));
  },

  context: async function ({ _guardedBrowser, _session, _guard }, use) {
    const context = await newGuardedContext(_guardedBrowser, _session.settings.proxyOrigin);
    patchRequestClass(context);
    await installGuard(context, _guard);
    await use(context);
    await context.close();
    const failures = _guard.failures();
    if (failures.length) {
      throw new Error('the live-test guard recorded ' + failures.length + ' failure(s):\n  ' + failures.join('\n  '));
    }
  },

  page: async function ({ context }, use) {
    await use(await context.newPage());
  },

  live: async function ({ _session, _guard, context }, use) {
    await use(liveApi(_session, _guard));
  }
});

module.exports = {
  test: test,
  expect: base.expect,
  wrapPlaywright: wrapPlaywright,
  patchRequestClass: patchRequestClass,
  checkSamePlaywright: checkSamePlaywright,
  CONTEXT_KEYS: CONTEXT_KEYS,
  LAUNCH_KEYS: LAUNCH_KEYS,
  NOOP_LOGGER: NOOP_LOGGER,
  liveApi: liveApi,
  createSession: createSession,
  installGuard: installGuard,
  launchGuardedBrowser: launchGuardedBrowser,
  newGuardedContext: newGuardedContext
};
