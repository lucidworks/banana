'use strict';

// Checks the shipped configuration defaults, the Solr preset, and that the
// fallbacks in settings.js agree with config.js.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');

// Evaluate an AMD file of the form define([deps], function (a, b) { return ...; })
// with a stub define. `resolve` maps a dependency name to its value.
function loadAmd(rel, resolve, win) {
  let result;
  const sandbox = {
    window: win || { location: { hostname: 'localhost' } },
    define: function (deps, factory) {
      if (typeof deps === 'function') { factory = deps; deps = []; }
      result = factory.apply(null, deps.map(resolve));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  return result;
}

// A minimal stand-in for underscore: only each() is used by settings.js.
const underscore = {
  each: function (obj, fn) { Object.keys(obj).forEach(function (k) { fn(obj[k], k); }); }
};

const Settings = loadAmd('src/app/components/settings.js', function (d) {
  assert.strictEqual(d, 'underscore');
  return underscore;
});

// Copy into this realm so deep-equality checks do not trip on foreign prototypes.
function plain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadConfig(rel) {
  return plain(loadAmd(rel, function (d) {
    assert.strictEqual(d, 'settings');
    return Settings;
  }));
}

// The keys a config file actually lists, before settings.js filters them. The stub
// define returns the factory argument unchanged, so nothing is dropped.
function loadRawConfig(rel) {
  return plain(loadAmd(rel, function (d) {
    assert.strictEqual(d, 'settings');
    return function (o) { return o; };
  }));
}

function loadDefaults() {
  return plain(Settings({}));
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, ''));
}

function sha(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// Snapshot of the values shipped in release 1.6.30 (src/config.js), stored here so the
// test does not need the git history.
const RELEASE_1_6_30 = {
  solr: '/api/query-pipelines/_system/collections/',
  solr_core: 'system_logs',
  timefield: 'timestamp_tdt',
  banana_index: 'system_banana',
  USE_FUSION: true,
  apollo: '/api',
  apollo_queryPipeline: '/api/query-pipelines/',
  apollo_indexPipeline: '/api/index-pipelines/',
  SYSTEM_BANANA_QUERY_PIPELINE: '/api/query-pipelines/default/collections/system_banana',
  SYSTEM_BANANA_INDEX_PIPELINE: '/api/index-pipelines/_system/collections/system_banana',
  SYSTEM_BANANA_BLOB_API: '/api/blobs',
  SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM: 'resourceType=banana',
  SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY: 'resourceType=banana',
  FUSION_API_STATIC_FIELDS: '/schema/fields',
  FUSION_API_DYNAMIC_FIELDS: '/schema/dynamicfields',
  FUSION_API_COLLECTIONS: '/api/collections',
  USE_ADMIN_LUKE: true,
  USE_ADMIN_CORES: true
};

const RELEASE_1_6_30_PANELS = [
  'bar', 'histogram', 'map', 'table', 'filtering', 'timepicker', 'text', 'hits',
  'column', 'ticker', 'bettermap', 'query', 'terms', 'rangeFacet', 'heatmap',
  'scatterplot', 'fullTextSearch', 'facet', 'tagcloud', 'multiseries', 'sunburst',
  'docviewer'
];

// SHA-256 of JSON.stringify of the parsed default.json shipped in 1.6.30.
const RELEASE_1_6_30_DEFAULT_DASHBOARD_SHA256 = 'b6e87dd705a3d862d43305180ffa27024c72b644e63b170e048e35581bda6ea1';

// Values of the Solr preset (the standalone Solr defaults).
const SOLR_PRESET = {
  solr: '/solr/',
  solr_core: 'logs',
  banana_index: 'banana-int',
  USE_FUSION: false,
  default_dashboard: 'default.solr.json'
};

test('shipped config.js reproduces the 1.6.30 values', function () {
  const config = loadConfig('src/config.js');
  Object.keys(RELEASE_1_6_30).forEach(function (key) {
    assert.deepStrictEqual(config[key], RELEASE_1_6_30[key], key);
  });
  assert.strictEqual(config.default_dashboard, 'default.json');
  assert.strictEqual(config.banana_server, undefined);
});

test('shipped config.js keeps every 1.6.30 panel', function () {
  const config = loadConfig('src/config.js');
  RELEASE_1_6_30_PANELS.forEach(function (name) {
    assert.ok(config.panel_names.indexOf(name) !== -1, name);
  });
});

test('shipped default.json is the 1.6.30 default dashboard', function () {
  const dash = readJson('src/app/dashboards/default.json');
  assert.strictEqual(dash.solr.server, '/api/query-pipelines/_system/collections/');
  assert.strictEqual(dash.solr.core_name, 'system_logs');
  assert.strictEqual(sha(dash), RELEASE_1_6_30_DEFAULT_DASHBOARD_SHA256);
});

test('Solr preset config.solr.js has the standalone Solr values', function () {
  const preset = loadConfig('src/config.solr.js');
  Object.keys(SOLR_PRESET).forEach(function (key) {
    assert.deepStrictEqual(preset[key], SOLR_PRESET[key], key);
  });
});

test('Solr preset differs from config.js only in the Solr keys', function () {
  const config = loadRawConfig('src/config.js');
  const preset = loadRawConfig('src/config.solr.js');
  assert.deepStrictEqual(Object.keys(preset).sort(), Object.keys(config).sort());
  Object.keys(config).forEach(function (key) {
    if (!(key in SOLR_PRESET)) {
      assert.deepStrictEqual(preset[key], config[key], key);
    }
  });
});

test('Solr preset default dashboard exists and points at Solr', function () {
  const preset = loadConfig('src/config.solr.js');
  const dash = readJson('src/app/dashboards/' + preset.default_dashboard);
  assert.strictEqual(dash.solr.server, '/solr/');
  assert.strictEqual(dash.solr.core_name, 'collection1');
});

test('settings.js defaults agree with config.js for every shared key', function () {
  const config = loadConfig('src/config.js');
  const defaults = loadDefaults();
  Object.keys(defaults).forEach(function (key) {
    if (key === 'panel_names') { return; } // empty here by design, listed in config.js
    assert.deepStrictEqual(defaults[key], config[key], key);
  });
});

test('every key in config.js and config.solr.js has a default in settings.js', function () {
  const defaults = loadDefaults();
  ['src/config.js', 'src/config.solr.js'].forEach(function (rel) {
    Object.keys(loadRawConfig(rel)).forEach(function (key) {
      if (key === 'banana_server') { return; } // optional, has no default by design
      assert.ok(key in defaults, rel + ': ' + key);
    });
  });
});

test('dashboard.js loads config.default_dashboard, falling back to default.json, at both call sites', function () {
  const src = fs.readFileSync(path.join(root, 'src/app/services/dashboard.js'), 'utf8');
  const calls = src.match(/self\.file_load\(config\.default_dashboard \|\| 'default\.json'\)/g) || [];
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(/file_load\('default\.json'\)/.test(src), false);
});

test('settings.js passes banana_server through and omits it when unset', function () {
  assert.strictEqual(Settings({ banana_server: 'http://solr.example.com/solr/' }).banana_server,
    'http://solr.example.com/solr/');
  assert.strictEqual('banana_server' in Settings({}), false);
});

test('no shipped config lists a dashboard server by default, and settings.js defaults to none', function () {
  // (arrays made inside the vm context are compared as JSON)
  assert.strictEqual(JSON.stringify(loadConfig('src/config.js').allowed_dashboard_servers), '[]');
  assert.strictEqual(JSON.stringify(loadConfig('src/config.solr.js').allowed_dashboard_servers), '[]');
  assert.strictEqual(JSON.stringify(Settings({}).allowed_dashboard_servers), '[]');
});
