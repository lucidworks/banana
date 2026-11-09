'use strict';

const { test } = require('../../live/fusion-client');

test('an abort of any class but telemetry fails the test at its end', async ({ page, live }) => {
  await page.goto(live.bananaUrl(''));
  const result = await page.evaluate(() => window.fetch('/api/solr/banana-it-x/admin/ping?action=disable').then(() => 'sent', () => 'failed'));
  if (result !== 'failed') {
    throw new Error('the request was not aborted');
  }
});
