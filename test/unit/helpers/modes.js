'use strict';

/*
 * The two ways Banana talks to a server, as the settings that differ between them.
 *
 *   fusion  the shipped defaults: the Fusion gateway paths, saved dashboards in the blob store
 *   solr    the Solr preset (config.solr.js): a plain /solr/ path, saved dashboards in the banana-int collection
 *
 * Both use the collection the fixtures were recorded on. The Solr mode has no recorded Fusion answers behind
 * it: its fixtures are Solr response shapes (recorded through Fusion's Solr proxy, or derived), which each
 * fixture says in its `source`.
 */

var config = require('config');

var MODES = {
  fusion: {
    USE_FUSION: true,
    solr: '/api/query-pipelines/_system/collections/',
    solr_core: 'banana-it-logs',
    banana_index: 'system_banana',
    USE_ADMIN_LUKE: true,
    USE_ADMIN_CORES: true
  },
  solr: {
    USE_FUSION: false,
    solr: '/solr/',
    solr_core: 'banana-it-logs',
    banana_index: 'banana-int',
    USE_ADMIN_LUKE: true,
    USE_ADMIN_CORES: true
  }
};

var KEYS = Object.keys(MODES.fusion).concat(['banana_server', 'allowed_dashboard_servers']);

/**
 * Registers hooks that apply a mode before each spec of the enclosing describe and restore the settings
 * afterwards. `overrides` change single settings (for example USE_ADMIN_LUKE: false).
 */
function useMode(name, overrides) {
  var saved;
  beforeEach(function () {
    saved = {};
    KEYS.forEach(function (key) {
      saved[key] = { present: Object.prototype.hasOwnProperty.call(config, key), value: config[key] };
    });
    delete config.banana_server;
    Object.keys(MODES[name]).forEach(function (key) { config[key] = MODES[name][key]; });
    Object.keys(overrides || {}).forEach(function (key) { config[key] = overrides[key]; });
  });
  afterEach(function () {
    KEYS.forEach(function (key) {
      if (saved[key].present) {
        config[key] = saved[key].value;
      } else {
        delete config[key];
      }
    });
  });
}

module.exports = { MODES: MODES, useMode: useMode };
