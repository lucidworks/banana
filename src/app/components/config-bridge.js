/**
 * Bridges the runtime-replaceable config.js (loaded as a plain script before the application
 * bundle) to the bundled modules. config.js keeps its AMD-style `define(['settings'], factory)`
 * form, so an operator can still replace it, or copy config.solr.js over it, without a rebuild.
 */
define(['settings'], function (Settings) {
  'use strict';
  var factory = window.__bananaConfigFactory;
  if (!factory) {
    throw new Error('config.js was not loaded before the application bundle');
  }
  // remove the temporary define() stub installed by config-boot.js
  if (window.define && window.define.__bananaStub) {
    delete window.define;
  }
  return factory(Settings);
});
