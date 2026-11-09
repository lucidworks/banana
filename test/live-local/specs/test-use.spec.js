'use strict';

const { test, expect } = require('../../live/fusion-client');

const SPEC_CREDENTIAL = 'spec-credential-value';
const noisyLogger = { isEnabled: () => true, log: () => {} };

test.use({
  serviceWorkers: 'allow',
  proxy: { server: 'http://127.0.0.1:1' },
  storageState: { cookies: [{ name: 'stolen', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
  httpCredentials: { username: 'spec-user', password: SPEC_CREDENTIAL },
  extraHTTPHeaders: { 'x-spec-header': 'present' },
  userAgent: 'spec-agent',
  launchOptions: { proxy: { server: 'http://127.0.0.1:1' }, executablePath: '/nonexistent/chrome', args: ['--spec-arg'], logger: noisyLogger, env: { SPEC_ENV: '1' }, slowMo: 5 },
  contextOptions: { recordVideo: { dir: process.env.LIVE_LOCAL_VIDEO_DIR }, logger: noisyLogger, serviceWorkers: 'allow' },
  video: 'on'
});

test('test.use: the options a spec sets do not change the context the fixture builds', async ({ page, live }) => {
  await page.goto(live.bananaUrl(''));
  const status = await page.evaluate(async () => (await window.fetch('/api/collections')).status);
  expect(status).toBeLessThan(500);
  const ua = await page.evaluate(() => navigator.userAgent);
  expect(ua).not.toBe('spec-agent');
  expect(await page.context().cookies()).toEqual([]);
});
