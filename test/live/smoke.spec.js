'use strict';

// The live smoke test of Banana served behind the test proxy in front of a real
// Fusion. It checks that the dashboard with every panel type renders real data
// from the banana-it-logs collection, that a dashboard saved by Banana's own
// screens can be reopened and deleted again, and that the stream panels fail
// the documented way on the default query pipeline route. Every id comes from
// the client and every confirmation is an independent GET. Run it with
// `npm run test:live`.

const { test, expect } = require('./fusion-client');
const panels = require('./panels');

const SAVE_LINK = 'a[bs-tooltip="\'Save\'"], li[bs-tooltip="\'Save\'"] > a';
const STREAM_TYPES = ['timeseries', 'significantTerms', 'graph'];

function step(text) {
  process.stdout.write('step: ' + text + '\n');
}

// A fresh copy of the fixture. Its own title is dropped: the title of a saved
// dashboard is its id.
function fixtureDashboard() {
  const dashboard = panels.readFixture();
  delete dashboard.title;
  return dashboard;
}

// Under the content policy the hosting image sends (no 'unsafe-inline', no 'unsafe-eval'), a feature
// check of the libraries is refused by the browser, and Chromium reports it as a console error with no
// source URL: Leaflet sets an event handler attribute on a detached element and reads it back (jQuery 3 makes no such
// check; jQuery 1 made two). One watched session may load the page twice, so two are allowed. Each
// is answered the same as on a browser without the feature, and none changes what a panel does. They are
// matched by message and counted, and counted apart from the other errors. More than MAX_POLICY_PROBES in
// one watched session are unexpected errors. (A third refusal, vis evaluating `Function('return this')`
// inside a try block, is reported as a policy violation event only and logs no console message.)
// Anything else the policy refuses is still an unexpected error.
const MAX_POLICY_PROBES = 2;
function isPolicyProbe(text) {
  return /^Executing inline event handler violates the following Content Security Policy/.test(text);
}

// Collect console errors and page errors. An error counts unless `allowed`
// says it is expected; the others are returned for the test to assert on.
function watch(page, allowed) {
  const seen = { unexpected: [], allowed: [], probes: [] };
  const started = Date.now();
  function record(text, url) {
    const line = '+' + Math.round((Date.now() - started) / 1000) + 's at ' + page.url().replace(/^https?:\/\/[^/]+/, '') + ': ' + text.slice(0, 200).replace(/\s+/g, ' ');
    if (isPolicyProbe(text) && seen.probes.length < MAX_POLICY_PROBES) {
      seen.probes.push(line);
    } else {
      (allowed(text, url) ? seen.allowed : seen.unexpected).push(line);
    }
  }
  page.on('console', function (m) {
    if (m.type() === 'error') {
      record(m.text(), m.location().url);
    }
  });
  page.on('pageerror', function (e) {
    record('pageerror: ' + e.message, '');
  });
  return seen;
}

// The one expected console error on every dashboard: a resource on another
// origin (map tiles) that the rule set aborted, so the browser reports it.
function offOrigin(origin) {
  return function (text, url) {
    return /^Failed to load resource/.test(text) && url !== '' && url.indexOf(origin + '/') !== 0;
  };
}

// The errors that the reopened copy may log: requests to other origins that the browser rule set aborts, and
// the 404 of the free-title lookup. Anything else fails the test.
function knownReopenError(origin) {
  const aborted = offOrigin(origin);
  const lookup = freeTitleLookup(origin);
  return function (text, url) {
    return aborted(text, url) || lookup(text, url);
  };
}

// Before it saves, Banana asks the blob store whether the title is taken. For a title that is free the blob store
// answers 404, and the browser reports every 404 of a request as a console error.
function freeTitleLookup(origin) {
  return function (text, url) {
    return /^Failed to load resource.*\b404\b/.test(text) && url.indexOf(origin + '/api/blobs/banana-it-') === 0;
  };
}

async function settle(page, types) {
  await expect.poll(async function () {
    return panels.problems(await page.evaluate(panels.summarisePage, types), types);
  }, { timeout: 90000, intervals: [2000], message: 'every panel renders' }).toEqual([]);
  await page.waitForTimeout(3000);
}

async function waitForDashboard(page) {
  await page.waitForSelector(SAVE_LINK, { timeout: 60000 });
}

// After the login the helper leaves the page on Banana's default dashboard.
// Opening another dashboard while it is still loading races inside Banana:
// the route change replaces the current dashboard with an empty object, and
// the default dashboard's collection-list request then writes `core_list`
// into it, which throws "Cannot set properties of undefined (setting
// 'core_list')". The last release has the same code. The test does not
// tolerate that error; it waits for the default dashboard to finish loading
// before it opens the dashboard under test.
async function loginAndSettle(live, page) {
  await live.loginBrowser(page);
  await waitForDashboard(page);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(function () {});
}

test.describe.configure({ mode: 'serial' });

let fixtureId = null;

test('the fixture covers every panel type the build offers', async () => {
  const offered = panels.configuredPanelTypes().sort();
  const used = Array.from(new Set(panels.dashboardPanelTypes(panels.readFixture()))).sort();
  expect(offered.length).toBeGreaterThan(0);
  expect(used).toEqual(offered);
});

test('every panel renders the data of the test collection', async ({ live, page }) => {
  const origin = new URL(live.bananaUrl('')).origin;
  // The content policy of the page as the browser received it (none when a proxy without a policy is used).
  let pagePolicy = null;
  page.on('response', function (r) {
    if (r.request().resourceType() === 'document' && r.url().indexOf(origin + '/admin/banana/') === 0 && r.status() === 200) {
      pagePolicy = r.headers()['content-security-policy'] || null;
    }
  });
  await loginAndSettle(live, page);
  step('logged in through the proxied login; the page is at Banana');
  const seen = watch(page, offOrigin(origin));

  fixtureId = live.allocate();
  await live.create(fixtureId, fixtureDashboard());
  const saved = await live.get(fixtureId);
  expect(saved.status).toBe(200);
  expect(saved.json[0].id).toBe(fixtureId);
  step('fixture dashboard saved as ' + fixtureId + ' and confirmed by an independent GET (' + saved.status + ')');

  await page.goto(live.bananaUrl('#/dashboard/solr/' + fixtureId));
  await waitForDashboard(page);
  const types = Array.from(new Set(panels.dashboardPanelTypes(panels.readFixture())));
  await settle(page, types);
  step('all ' + types.length + ' panel types rendered (data checks for the data panels, structure checks for the five control panels)');
  step('console errors: ' + seen.unexpected.length + ' unexpected, ' + seen.allowed.length + ' for aborted resources on other origins, ' + seen.probes.length + ' content-policy feature probes');
  step('content-security-policy of the page: ' + pagePolicy);
  expect(seen.unexpected).toEqual([]);
});

test('save as, reopen and delete through Banana, then remove the fixture', async ({ live, page }) => {
  expect(fixtureId).not.toBeNull();
  const origin = new URL(live.bananaUrl('')).origin;
  const dialogs = [];
  page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
  await loginAndSettle(live, page);
  const seen = watch(page, knownReopenError(origin));
  const types = Array.from(new Set(panels.dashboardPanelTypes(panels.readFixture())));

  await page.goto(live.bananaUrl('#/dashboard/solr/' + fixtureId));
  await waitForDashboard(page);
  await settle(page, types);

  // save the open dashboard under a new title through the Save screen
  const copyId = live.allocate();
  await page.locator(SAVE_LINK).first().click();
  await page.locator('input[ng-model="elasticsearch.title"]').fill(copyId);
  await page.locator('button[ng-click="elasticsearch_save(\'dashboard\', null)"]').click();
  await expect.poll(function () { return live.stateOf(copyId); }, { timeout: 30000 }).toBe('created');
  const copy = await live.get(copyId);
  expect(copy.status).toBe(200);
  expect(copy.json[0].id).toBe(copyId);
  expect(JSON.parse(copy.json[0].banana_dashboard_s).rows.length).toBe(panels.readFixture().rows.length);
  // a title that is not taken is saved without a question
  expect(dialogs).toEqual([]);
  step('saved through the Save screen as ' + copyId + ' with no question; confirmed by an independent GET (' + copy.status + ')');

  // load it again and check that it renders
  await page.goto(live.bananaUrl('#/dashboard/solr/' + copyId));
  await waitForDashboard(page);
  await settle(page, types);
  step('reopened ' + copyId + '; every panel rendered');
  expect(seen.unexpected).toEqual([]);

  // delete it through the Load screen, with the filter narrowed to this id
  await page.locator('li[bs-tooltip="\'Load\'"] > a').first().click();
  await page.locator('input[ng-model="elasticsearch.query"]').fill(copyId);
  const row = page.locator('tr', { has: page.locator('a', { hasText: copyId }) });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.locator('a.btn-danger').click();
  await expect.poll(function () { return live.stateOf(copyId); }, { timeout: 30000 }).toBe('deleted');
  const gone = await live.get(copyId);
  expect(gone.status).toBe(404);
  const kept = await live.get(fixtureId);
  expect(kept.status).toBe(200);
  step('deleted ' + copyId + ' through the Load screen; independent GET ' + gone.status + '; the fixture is untouched (' + kept.status + ')');
  expect(seen.unexpected).toEqual([]);

  // remove the fixture dashboard through the client
  await live.remove(fixtureId);
  const fixtureGone = await live.get(fixtureId);
  expect(fixtureGone.status).toBe(404);
  step('removed ' + fixtureId + ' through the client; independent GET ' + fixtureGone.status);
  fixtureId = null;
});

// Saving under a title that is taken asks first, names who saved the stored dashboard, and writes only when the
// user says yes. The dashboards are small (the control panels only); every id comes from the client.
test('saving over an existing title asks first, shows the owner, and writes only when accepted', async ({ live, page }) => {
  const origin = new URL(live.bananaUrl('')).origin;
  const dialogs = [];
  let accept = false;
  page.on('dialog', function (d) {
    dialogs.push(d.message());
    return accept ? d.accept() : d.dismiss();
  });
  await loginAndSettle(live, page);
  const seen = watch(page, offOrigin(origin));

  const dashboard = fixtureDashboard();
  dashboard.rows = dashboard.rows.filter(function (row) { return row.title === 'Controls'; });
  const id = live.allocate();
  await live.create(id, dashboard);
  const before = await live.get(id);
  expect(before.status).toBe(200);
  const owner = before.json[0].banana_user_s;
  step('created ' + id + ' through the client; stored owner "' + owner + '"');

  // what the browser's own look-ups answer, and the cache header of the blob store
  const cacheHeaders = [];
  page.on('response', function (r) {
    if (r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/blobs/' + id) {
      cacheHeaders.push(String(r.headers()['cache-control']) + ' (' + r.status() + ')');
    }
  });

  await page.goto(live.bananaUrl('#/dashboard/solr/' + id));
  await waitForDashboard(page);

  // save under the same title
  const title = page.locator('input[ng-model="elasticsearch.title"]');
  const saveButton = page.locator('button[ng-click="elasticsearch_save(\'dashboard\', null)"]');
  await page.locator(SAVE_LINK).first().click();
  await title.fill(id);
  await saveButton.click();
  await expect.poll(function () { return dialogs.length; }, { timeout: 30000 }).toBe(1);
  expect(dialogs[0]).toBe('A dashboard named "' + id + '" already exists. It was saved by ' + owner +
    '. Saving replaces it, and the earlier version cannot be restored. Replace it?');
  step('the dialog named the stored owner "' + owner + '" and the title');

  // declined: nothing is written
  await expect(page.locator('body')).toContainText('The existing dashboard was left as it was', { timeout: 30000 });
  const declined = await live.get(id);
  expect(declined.status).toBe(200);
  expect(declined.json).toEqual(before.json);
  expect(await title.inputValue()).toBe(id);
  step('declined: the stored document is unchanged (independent GET ' + declined.status + ') and the title box still holds the title');

  // accepted: replaced, and the owner is the logged-in user
  accept = true;
  await saveButton.click();
  await expect.poll(function () { return dialogs.length; }, { timeout: 30000 }).toBe(2);
  await expect.poll(async function () { return (await live.get(id)).json[0].banana_user_s; }, { timeout: 30000 }).not.toBe(owner);
  const replaced = await live.get(id);
  const stored = replaced.json[0];
  const sessionUser = await page.evaluate(function () {
    const injector = window.angular.element(document.body).injector();
    return new Promise(function (resolve) { injector.get('lucidworksSrv').getFusionUsername().then(resolve); });
  });
  expect(stored.banana_user_s).toBe(sessionUser);
  expect(stored.banana_user_s).not.toBe('guest');
  expect(JSON.parse(stored.banana_dashboard_s).username).toBe(sessionUser);
  expect(stored.id).toBe(id);
  step('accepted: the document was replaced; the stored owner is the logged-in user "' + sessionUser + '" (independent GET ' + replaced.status + ')');
  step('cache header of Banana\'s look-up GETs of ' + id + ': ' + cacheHeaders.join(', '));
  expect(cacheHeaders.length).toBeGreaterThanOrEqual(3);

  await live.remove(id);
  const gone = await live.get(id);
  expect(gone.status).toBe(404);
  step('removed ' + id + ' through the client; independent GET ' + gone.status);
  expect(seen.unexpected).toEqual([]);
});

// Fusion 5.9.16 refuses stream and graph expressions on the default query
// pipeline route: the pipeline allows no custom request handlers. The panels
// that use them stay empty and each shows the "requires direct Solr access"
// message, and Banana logs the failed requests. The graph panel draws nothing
// and throws nothing. The fixture dashboard
// uses the direct route, which works; this test records the other route so a
// change in Fusion shows up here.
test('stream panels on the default query pipeline route get a 500 from Fusion', async ({ live, page }) => {
  const origin = new URL(live.bananaUrl('')).origin;
  await loginAndSettle(live, page);
  const dashboard = fixtureDashboard();
  dashboard.solr.server = '/api/query-pipelines/_system/collections/';
  dashboard.rows = dashboard.rows.filter(function (row) {
    return row.title === 'Controls' || row.title === 'Stream expressions';
  });
  const id = live.allocate();
  await live.create(id, dashboard);

  const refused = [];
  let failedRequests = 0;
  page.on('response', function (r) {
    const p = new URL(r.url()).pathname;
    if (r.status() === 500 && /\/(stream|graph)$/.test(p)) {
      refused.push(p.split('/').pop());
      failedRequests++;
    }
  });
  const seen = watch(page, function (text, url) {
    return offOrigin(origin)(text, url) ||
      (/^Failed to load resource.*500/.test(text) && /\/(stream|graph)\?/.test(url));
  });
  await page.goto(live.bananaUrl('#/dashboard/solr/' + id));
  await waitForDashboard(page);
  await expect.poll(function () { return refused.indexOf('graph') >= 0 && refused.indexOf('stream') >= 0; }, { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(3000);
  const summary = await page.evaluate(panels.summarisePage, STREAM_TYPES);
  expect(summary.panels.timeseries.canvas).toBe(0);
  expect(summary.panels.timeseries.ticks).toEqual([]);
  expect(summary.panels.significantTerms.rows).toBeLessThan(2);
  expect(summary.panels.graph.graphNodes).toBe(0);
  expect(summary.banners.filter(function (b) { return /This panel requires direct Solr access\./.test(b); }).length).toBe(3);
  // one failed request per panel at least (one stream request each for the time series and the
  // significant terms, and one graph request); a panel that refreshes sends more
  expect(refused.filter(function (n) { return n === 'graph'; }).length).toBeGreaterThanOrEqual(1);
  expect(refused.filter(function (n) { return n === 'stream'; }).length).toBeGreaterThanOrEqual(2);
  step(failedRequests + ' failed stream and graph requests on first load');
  step('stream, significantTerms and graph requests answered 500 on the pipeline route; the three panels hold no data and each shows the requires-direct-Solr message');
  expect(seen.unexpected).toEqual([]);
  await live.remove(id);
  expect((await live.get(id)).status).toBe(404);
  step('removed ' + id + ' through the client; independent GET 404');
});

test('logout from Node', async ({ live }) => {
  const status = await live.logoutNode();
  expect(status).toBeLessThan(300);
  step('Node logout answered ' + status);
});
