'use strict';

const { test, expect } = require('../../live/fusion-client');

test('alias: page.request is the guarded context request, and every public method throws', async ({ page, live }) => {
  await page.goto(live.bananaUrl(''));
  const api = page.request;
  expect(api).toBe(page.context().request);
  for (const method of ['fetch', 'get', 'head', 'post', 'put', 'patch', 'delete']) {
    let thrown = null;
    try {
      await api[method](live.bananaUrl('').replace('/admin/banana/index.html', '/api/blobs/Ops'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown, method).toBeTruthy();
    expect(thrown.message, method).toContain('not available in live tests');
    expect(thrown.message).toContain('guarded');
  }
});
