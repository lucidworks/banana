'use strict';

const { test } = require('../../live/fusion-client');

test('stock request fixture: a spec that asks for request fails at setup', async ({ request }) => {
  await request.delete('/api/blobs/Ops');
});
