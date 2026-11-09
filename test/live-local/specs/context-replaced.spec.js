'use strict';

const { test } = require('../../live/fusion-client');

test.use({
  context: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  }
});

test('a replacement context fixture has no browser to make a context from', async ({ page }) => {
  await page.goto('about:blank');
});
