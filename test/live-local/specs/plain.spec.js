'use strict';

const { test, expect } = require('../../live/fusion-client');

test('plain: a guarded test passes with the runner\'s auto fixtures running', async ({ page, playwright, live }) => {
  await page.goto(live.bananaUrl(''));
  // the guarded context is among the contexts the runner's artifacts fixture reads, as seen through the wrapper
  const contexts = playwright._allContexts();
  expect(contexts.length).toBe(1);
  expect(contexts[0]).toBe(page.context());
  // the runner's launch defaults were set before the guarded launch read them
  expect(typeof playwright._defaultLaunchOptions.tracesDir).toBe('string');
  expect(typeof playwright._defaultLaunchOptions.artifactsDir).toBe('string');
  expect(playwright.request._contexts instanceof Set).toBe(true);
  expect(playwright._instrumentation).toBeTruthy();
});

test('plain: a spec that goes through the helper saves and deletes its own id through the browser', async ({ page, live }) => {
  await live.loginBrowser(page);
  const id = live.allocate();
  const put = await page.evaluate(async (id) => {
    const res = await window.fetch('/api/blobs/' + id + '?resourceType=banana', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id }]) });
    return res.status;
  }, id);
  expect(put).toBe(200);
  expect(live.stateOf(id)).toBe('created');
  const del = await page.evaluate(async (id) => (await window.fetch('/api/blobs/' + id, { method: 'DELETE' })).status, id);
  expect(del).toBe(204);
  expect(live.stateOf(id)).toBe('deleted');
  // a direct create and remove through the Node client
  const second = live.allocate();
  await live.create(second, { rows: [] });
  expect((await live.get(second)).status).toBe(200);
  await live.remove(second);
  expect(live.stateOf(second)).toBe('deleted');
});

test('plain: telemetry is counted and does not fail the test', async ({ page, live }) => {
  await page.goto(live.bananaUrl(''));
  await page.evaluate(() => window.fetch('/api/ui-logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => 0));
  expect(live.telemetryCount()).toBe(1);
});
