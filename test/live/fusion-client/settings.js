'use strict';

// Reads and validates the environment. One variable gives both the proxy's
// upstream and the client's base, so the two cannot point at different
// instances. Nothing here is written to the registry, the output or a log.

const crypto = require('node:crypto');
const ids = require('./ids');

const VAR = {
  fusionUrl: 'BANANA_LIVE_FUSION_URL',
  registryDir: 'BANANA_LIVE_REGISTRY_DIR',
  runTag: 'BANANA_LIVE_RUN_TAG',
  digestKey: 'BANANA_LIVE_DIGEST_KEY',
  proxyUrl: 'BANANA_LIVE_PROXY_URL',
  bananaDir: 'BANANA_LIVE_BANANA_DIR',
  image: 'BANANA_LIVE_IMAGE',
  user: 'FUSION_USER',
  credential: 'FUSION_PASSWORD'
};

const DIGEST_HEADER = 'x-banana-upstream-digest';
const BANANA_PATH = '/admin/banana/';

function originOf(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(name + ' is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(name + ' must be an http or https URL');
  }
  return url.origin;
}

function requireVar(env, key) {
  if (!env[key]) {
    throw new Error(key + ' is not set');
  }
  return env[key];
}

function validKey(key) {
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key);
}

// The keyed digest of an origin: HMAC-SHA-256 under the run's key.
function digestOf(origin, keyHex) {
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(origin).digest('hex');
}

// Settings for a process that can write: the Fusion base, the run tag, the
// registry directory and the digest key. The proxy URL is added for a browser
// process.
function readSettings(env, options) {
  const runTag = env[VAR.runTag];
  if (!ids.isValidRunTag(runTag)) {
    throw new Error(VAR.runTag + ' is missing or malformed; start the run with npm run test:live');
  }
  const key = requireVar(env, VAR.digestKey);
  if (!validKey(key)) {
    throw new Error(VAR.digestKey + ' is malformed');
  }
  const settings = {
    fusionOrigin: originOf(requireVar(env, VAR.fusionUrl), VAR.fusionUrl),
    runTag: runTag,
    registryDir: requireVar(env, VAR.registryDir),
    digestKey: key
  };
  if (options && options.credentials) {
    settings.user = requireVar(env, VAR.user);
    settings.password = requireVar(env, VAR.credential);
  }
  if (options && options.proxy) {
    settings.proxyOrigin = originOf(requireVar(env, VAR.proxyUrl), VAR.proxyUrl);
  }
  return settings;
}

module.exports = {
  VAR: VAR,
  DIGEST_HEADER: DIGEST_HEADER,
  BANANA_PATH: BANANA_PATH,
  originOf: originOf,
  validKey: validKey,
  digestOf: digestOf,
  readSettings: readSettings
};
