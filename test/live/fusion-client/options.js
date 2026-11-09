'use strict';

// Every option key the guarded browser and context are created with. The test
// runner fills any key a creator leaves out from the spec's own settings, so a
// key that is present (even with the value undefined) is never filled.

// Context keys: present in every newContext call this module makes.
const CONTEXT_KEYS = [
  'acceptDownloads', 'baseURL', 'bypassCSP', 'clientCertificates', 'colorScheme',
  'contrast', 'deviceScaleFactor', 'extraHTTPHeaders', 'forcedColors',
  'geolocation', 'hasTouch', 'httpCredentials', 'ignoreHTTPSErrors', 'isMobile',
  'javaScriptEnabled', 'locale', 'offline', 'permissions', 'proxy',
  'reducedMotion', 'screen', 'serviceWorkers', 'storageState', 'timezoneId',
  'userAgent', 'viewport'
];

// Launch keys: present in every launch call this module makes.
const LAUNCH_KEYS = [
  'args', 'channel', 'chromiumSandbox', 'downloadsPath', 'env', 'executablePath',
  'firefoxUserPrefs', 'handleSIGHUP', 'handleSIGINT', 'handleSIGTERM', 'headless',
  'ignoreDefaultArgs', 'logger', 'proxy', 'slowMo', 'timeout'
];

// A logger that records nothing. launch() fills a falsy logger from the spec's
// settings, so the guarded launch passes this object.
const NOOP_LOGGER = {
  isEnabled: function () {
    return false;
  },
  log: function () {}
};

// The context options: every key set, service workers blocked, nothing that
// could add a proxy, a stored session, credentials or extra headers.
function contextOptions(proxyOrigin) {
  const options = {};
  CONTEXT_KEYS.forEach(function (key) {
    options[key] = undefined;
  });
  options.baseURL = proxyOrigin;
  options.serviceWorkers = 'block';
  options.viewport = { width: 1400, height: 900 };
  return options;
}

// The launch options: every key set. The runner's own tracesDir and artifactsDir
// are taken from the launch defaults on purpose; they name no network target.
function launchOptions() {
  const options = {};
  LAUNCH_KEYS.forEach(function (key) {
    options[key] = undefined;
  });
  options.headless = true;
  options.handleSIGINT = false;
  options.handleSIGTERM = false;
  options.handleSIGHUP = false;
  options.logger = NOOP_LOGGER;
  return options;
}

module.exports = {
  CONTEXT_KEYS: CONTEXT_KEYS,
  LAUNCH_KEYS: LAUNCH_KEYS,
  NOOP_LOGGER: NOOP_LOGGER,
  contextOptions: contextOptions,
  launchOptions: launchOptions
};
