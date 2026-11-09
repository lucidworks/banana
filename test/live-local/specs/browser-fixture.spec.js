'use strict';

const { test } = require('../../live/fusion-client');

test('stock browser fixture: a spec that asks for browser fails at setup', async ({ browser }) => {
  await browser.newContext();
});
