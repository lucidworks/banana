'use strict';

/*
 * Unit tests run in headless Chromium under Karma, and the code under test is loaded through the same
 * webpack configuration that builds the application (see test/webpack.test.config.js), so module ids,
 * aliases, the vendored-script shims and the config.js bridge resolve exactly as in production.
 *
 *   npm test              one run, then exit (non-zero when a spec fails)
 *   npm run test:watch    keep running, and run again when a file changes
 *
 * Which Chromium: CHROME_BIN if it is set, else the browser that Playwright installed
 * (`npx playwright install chromium`; PLAYWRIGHT_BROWSERS_PATH chooses where it lives), else a Chrome or
 * Chromium that karma-chrome-launcher finds on the machine.
 */

const fs = require('fs');
const path = require('path');

function findChrome() {
  if (process.env.CHROME_BIN) { return; }
  try {
    const exe = require('playwright').chromium.executablePath();
    if (exe && fs.existsSync(exe)) { process.env.CHROME_BIN = exe; }
  } catch (e) {
    // Playwright is not installed: fall back to the browsers on the machine
  }
}

module.exports = function (config) {
  findChrome();
  const entry = 'test/unit/index.js';

  config.set({
    basePath: '../',
    frameworks: ['jasmine', 'webpack'],

    files: [
      // The same two scripts that index.html loads before the application: config.js is not bundled
      'src/config-boot.js',
      'src/config.js',
      { pattern: entry, watched: false }
    ],
    preprocessors: { [entry]: ['webpack'] },
    webpack: require(path.join(__dirname, 'webpack.test.config.js')),

    plugins: [
      require('karma-jasmine'),
      require('karma-webpack'),
      require('karma-chrome-launcher')
    ],

    reporters: ['dots'],
    browsers: ['ChromeHeadlessLocal'],
    customLaunchers: {
      ChromeHeadlessLocal: {
        base: 'ChromeHeadless',
        // Chromium's sandbox needs privileges that most containers do not grant, so CI turns it off
        flags: process.env.CI ? ['--no-sandbox'] : []
      }
    },

    port: 9876,
    colors: true,
    logLevel: config.LOG_WARN,
    autoWatch: false,
    singleRun: true,
    browserNoActivityTimeout: 60000,
    captureTimeout: 120000
  });
};
