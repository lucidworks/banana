'use strict';

// Start-up checks made through the proxy before any context is created.
//   1. The instance check: the proxy must answer with the keyed digest of the
//      same origin the client uses as its base, so the browser and the client
//      cannot write to different instances.
//   2. The mode check: the served config.js must have the Fusion mode on and
//      the blob API at /api/blobs.
// Both read one static file (config.js) through the proxy; nothing is sent to
// the instance itself.

const crypto = require('node:crypto');
const vm = require('node:vm');
const settings = require('./settings');
const rules = require('./rules');

// Evaluate a served config.js in an isolated context with a stub define and
// Settings: no network, no require.
function evaluateConfig(source) {
  let result;
  const sandbox = {
    define: function (deps, factory) {
      if (typeof deps === 'function') {
        factory = deps;
        deps = [];
      }
      result = factory.apply(null, deps.map(function () {
        return function Settings(values) {
          return values;
        };
      }));
    }
  };
  vm.runInNewContext(source, sandbox, { filename: 'config.js', timeout: 1000 });
  return result;
}

// Refuses unless the Fusion mode is on and the blob API is /api/blobs.
function checkConfigSource(source) {
  let config;
  try {
    config = evaluateConfig(source);
  } catch (e) {
    throw new Error('the served config.js could not be evaluated');
  }
  if (!config || config.USE_FUSION !== true) {
    throw new Error('the served config.js does not have USE_FUSION true');
  }
  if (config.SYSTEM_BANANA_BLOB_API !== '/api/blobs') {
    throw new Error('the served config.js does not have SYSTEM_BANANA_BLOB_API /api/blobs');
  }
  return config;
}

// Refuses unless the header carries the digest of `fusionOrigin` under the key.
function checkDigest(headerValue, fusionOrigin, keyHex) {
  if (!settings.validKey(keyHex)) {
    throw new Error('the digest key is not set or is malformed');
  }
  if (typeof headerValue !== 'string' || headerValue === '') {
    throw new Error('the proxy did not answer with the digest header; it was not started by the launcher');
  }
  const expected = Buffer.from(settings.digestOf(fusionOrigin, keyHex), 'utf8');
  const actual = Buffer.from(headerValue.trim().toLowerCase(), 'utf8');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('the proxy points at a different instance than the client');
  }
}

// Fetch config.js through the proxy (as a read the rule table allows), run both
// checks, and return the evaluated config.
async function checkInstance(options) {
  const url = options.proxyOrigin + settings.BANANA_PATH + 'config.js';
  const verdict = rules.classify({ method: 'GET', url: url, body: null }, {
    origin: options.proxyOrigin,
    stateOf: function () { return undefined; }
  });
  if (!verdict.allow) {
    throw new Error('the config.js check was refused: ' + verdict.cls);
  }
  const doFetch = options.fetchImpl || fetch;
  let res;
  try {
    res = await doFetch(url, { redirect: 'manual', cache: 'no-store' });
  } catch (e) {
    throw new Error('the proxy did not answer');
  }
  checkDigest(res.headers.get(settings.DIGEST_HEADER), options.fusionOrigin, options.digestKey);
  if (res.status !== 200) {
    throw new Error('the proxy answered ' + res.status + ' for config.js');
  }
  return checkConfigSource(await res.text());
}

module.exports = {
  evaluateConfig: evaluateConfig,
  checkConfigSource: checkConfigSource,
  checkDigest: checkDigest,
  checkInstance: checkInstance
};
