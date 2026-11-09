'use strict';

const { test, expect } = require('../../live/fusion-client');

test('a PUT for an id that already exists is aborted and fails the test', async ({ page, live }) => {
  await page.goto(live.bananaUrl(''));
  const id = live.allocate();
  const put = () => page.evaluate(async (id) => window.fetch('/api/blobs/' + id + '?resourceType=banana', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '[]' }).then((r) => r.status, () => 'failed'), id);
  expect(await put()).toBe('failed');
  expect(live.stateOf(id)).toBe('collided');
  expect(await put()).toBe('failed');
});
