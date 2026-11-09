'use strict';

/*
 * Helpers for specs that need the real application modules.
 *
 * angular-mocks 1.0.8 only works with Jasmine 1.x: its module() and inject() read Jasmine's private
 * `currentSpec`, which later versions removed. So specs build an injector directly, with
 * createInjector(), and use ngMock's services ($httpBackend and the others) through it.
 */

var angular = require('angular');

// angular-mocks registers a Jasmine hook when it sees a global `jasmine`, and that hook fails under
// current Jasmine. Hide the global while the file loads: the ngMock module itself is not affected.
var jasmineGlobal = window.jasmine;
window.jasmine = undefined;
try {
  require('angular-mocks');
} finally {
  window.jasmine = jasmineGlobal;
}

// The application creates these modules in app.js before it loads the services and filters.
['kibana.services', 'kibana.filters', 'kibana.controllers'].forEach(function (name) {
  angular.module(name, []);
});
require('elasticjs');
require('solrjs');
require('services/all');
require('filters/all');
require('controllers/dash');
require('controllers/dashLoader');

/**
 * Returns an injector for the real services and filters.
 * @param {Object} provided values that replace services, by name, for example {dashboard: fakeDashboard}
 * @param {Array} extraModules further modules (names or config functions) to load, for example to add an
 *   $http interceptor or the module of a panel
 */
function createInjector(provided, extraModules) {
  return angular.injector([
    'ng',
    'ngMock',
    'elasticjs.service',
    'solrjs.service',
    'kibana.services',
    'kibana.filters',
    'kibana.controllers',
    ['$provide', function ($provide) {
      Object.keys(provided || {}).forEach(function (name) {
        $provide.value(name, provided[name]);
      });
    }]
  ].concat(extraModules || []));
}

/** A stand-in for the dashboard service that holds what querySrv and filterSrv read from it. */
function fakeDashboard() {
  return {
    current: {
      solr: { server: 'http://solr.example/solr/', core_name: 'logs' },
      services: {}
    }
  };
}

module.exports = { createInjector: createInjector, fakeDashboard: fakeDashboard };
