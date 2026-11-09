'use strict';

// Preloaded into the runner's processes by the browser tests (NODE_OPTIONS
// --require). It records the options every launch and every context creation
// receives, and the runner's launch defaults at the time of the launch, so the
// tests can read them back. It changes nothing else.

const fs = require('node:fs');
const playwrightCore = require('playwright-core');

const file = process.env.LIVE_LOCAL_SPY_FILE;

function describe(options) {
  const out = {};
  Object.keys(options || {}).forEach(function (key) {
    const value = options[key];
    out[key] = typeof value === 'function' ? '[function]' : value;
  });
  if (options && options.logger) {
    out.logger = { noop: typeof options.logger.isEnabled === 'function' && options.logger.isEnabled() === false };
  }
  return out;
}

function record(entry) {
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

if (file) {
  ['chromium', 'firefox', 'webkit'].forEach(function (name) {
    const type = playwrightCore[name];
    const launch = type.launch;
    type.launch = async function (options) {
      record({ kind: 'launch', browser: name, keys: Object.keys(options || {}), options: describe(options), defaults: describe(this._playwright._defaultLaunchOptions) });
      const browser = await launch.call(this, options);
      const newContext = browser.newContext;
      browser.newContext = async function (contextOptions) {
        record({ kind: 'context', keys: Object.keys(contextOptions || {}), options: describe(contextOptions) });
        const context = await newContext.call(this, contextOptions);
        return context;
      };
      return browser;
    };
  });
}
