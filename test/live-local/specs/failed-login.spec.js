'use strict';

const { test } = require('../../live/fusion-client');

// The login request is answered 401, so the helper throws and the test fails.
// The run that executes this spec checks that no Playwright artefact holds the
// password that was typed into the login page.
test('failed login: the helper throws after a refused login', async ({ page, live }) => {
  await live.loginBrowser(page);
});
