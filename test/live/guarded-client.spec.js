'use strict';

// A live run of the guarded client against a Fusion instance: two ids are
// created, verified and deleted directly, and one is saved, reopened and
// deleted through Banana's own screens with the browser rule set active. Every
// id comes from the client, so every write names only a run id. Run it with
// `npm run test:live`.

const { test, expect } = require('./fusion-client');

function step(text) {
  process.stdout.write('step: ' + text + '\n');
}

test('direct: create, verify and delete two ids', async ({ live }) => {
  for (let n = 1; n <= 2; n++) {
    const id = live.allocate();
    step('direct ' + n + ': allocated ' + id);
    await live.create(id, { rows: [] });
    const present = await live.get(id);
    expect(present.status).toBe(200);
    expect(present.json[0].id).toBe(id);
    expect(live.stateOf(id)).toBe('created');
    step('direct ' + n + ': created and verified by an independent GET (' + present.status + ')');
    if (n === 1) {
      // a second save of the run's own id overwrites it silently, and the guard allows it
      await live.create(id, { rows: [], marker: 'second' });
      const again = await live.get(id);
      expect(again.status).toBe(200);
      expect(again.json.length).toBe(1);
      expect(JSON.parse(again.json[0].banana_dashboard_s).marker).toBe('second');
      step('direct ' + n + ': a second save of the same id replaced the body (own id only); the state is ' + live.stateOf(id));
    }
    await live.remove(id);
    const gone = await live.get(id);
    expect(gone.status).toBe(404);
    expect(live.stateOf(id)).toBe('deleted');
    step('direct ' + n + ': deleted and confirmed by an independent GET (' + gone.status + ')');
  }
});

test('UI: save, reopen and delete one id through Banana', async ({ live, page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('dialog', (d) => d.accept());
  await live.loginBrowser(page);
  step('UI: logged in; the page is at Banana');

  const id = live.allocate();
  step('UI: allocated ' + id);
  await page.goto(live.bananaUrl('#/dashboard/file/default.json'));
  await page.waitForSelector('a[bs-tooltip="\'Save\'"], li[bs-tooltip="\'Save\'"] > a', { timeout: 60000 });
  await page.waitForTimeout(6000);
  const panels = await page.locator('[ng-controller]').count();
  step('UI: dashboard loaded, ' + panels + ' controllers on the page');

  await page.locator('a[bs-tooltip="\'Save\'"], li[bs-tooltip="\'Save\'"] > a').first().click();
  await page.locator('input[ng-model="elasticsearch.title"]').fill(id);
  await page.locator('button[ng-click="elasticsearch_save(\'dashboard\', null)"]').click();
  await expect.poll(() => live.stateOf(id), { timeout: 30000 }).toBe('created');
  const saved = await live.get(id);
  expect(saved.status).toBe(200);
  expect(saved.json[0].id).toBe(id);
  step('UI: saved through the Save screen; created and verified by an independent GET (' + saved.status + ')');

  // reopen the saved dashboard
  await page.goto(live.bananaUrl('#/dashboard/solr/' + id));
  await page.waitForTimeout(8000);
  const title = await page.title();
  step('UI: reopened; page title "' + title + '"');

  // delete it through the Load screen, typing the id into the filter so only this row is shown
  await page.locator('li[bs-tooltip="\'Load\'"] > a').first().click();
  await page.locator('input[ng-model="elasticsearch.query"]').fill(id);
  const row = page.locator('tr', { has: page.locator('a', { hasText: id }) });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await row.locator('a.btn-danger').click();
  await expect.poll(() => live.stateOf(id), { timeout: 30000 }).toBe('deleted');
  const gone = await live.get(id);
  expect(gone.status).toBe(404);
  step('UI: deleted through the Load screen; confirmed by an independent GET (' + gone.status + ')');

  const logout = await live.logoutBrowser(page);
  step('UI: browser logout answered ' + logout);
  step('UI: page errors seen: ' + errors.length);
  step('UI: telemetry aborts counted: ' + live.telemetryCount());
});

test('logout from Node', async ({ live }) => {
  const status = await live.logoutNode();
  step('Node logout answered ' + status);
});
