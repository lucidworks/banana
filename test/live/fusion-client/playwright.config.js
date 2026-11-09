'use strict';

// The Playwright configuration for live tests. It lives inside the client
// module; `npm run test:live` passes it to Playwright with --config.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

// Live runs type a real credential into the login page. Playwright can write
// that into its artefacts: a page snapshot in error-context.md on a failure, a
// trace, a screenshot or a video. All of them are off, the snapshot is switched
// off through the environment variable that the runner reads, and the output
// directory is outside the repository (the launcher gives it a fresh temporary
// directory and removes it after the run).
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
// Without the launcher, take a fresh directory once and hand it to the workers
// through the environment.
if (!process.env.BANANA_LIVE_OUTPUT_DIR) {
  process.env.BANANA_LIVE_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-live-out-'));
}

module.exports = defineConfig({
  testDir: path.resolve(__dirname, '..'),
  testMatch: '**/*.spec.js',
  testIgnore: '**/fusion-client/**',
  timeout: 180000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.BANANA_LIVE_OUTPUT_DIR,
  use: {
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  }
});
