'use strict';

// The configuration for the specs that the browser tests run through the real
// Playwright test runner against local servers.

const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'specs'),
  testMatch: '**/*.spec.js',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  reporter: [['json']],
  outputDir: process.env.LIVE_LOCAL_OUTPUT_DIR || path.join(__dirname, '..', '..', 'test-results', 'live-local')
});
