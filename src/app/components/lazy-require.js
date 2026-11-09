/**
 * Loads panel modules and their templates on demand.
 *
 * app.js exposes this function as $rootScope.requireContext, and kibanaPanel, addPanel and a few
 * panels call it with module ids that are only known at run time, such as
 * 'panels/<name>/module' and 'text!panels/<name>/module.html'. A bundler cannot see through a
 * computed id, so each id shape is mapped here to an import() the bundler can follow. This
 * produces one chunk per panel. Ids that are not listed are rejected with an error.
 */
define(['jquery'], function ($) {
  'use strict';

  var panelModule = /^panels\/([^/]+)\/module$/;
  var panelTemplate = /^text!panels\/([^/]+)\/module\.html$/;
  var mapData = /^(?:\.\/)?panels\/map\/lib\/map\.([\w-]+)$/;

  function load(id) {
    var m;
    if ((m = panelTemplate.exec(id))) {
      return import(/* webpackChunkName: "panel-[request]" */ '../panels/' + m[1] + '/module.html').then(function (mod) { return mod.default; });
    }
    if ((m = panelModule.exec(id))) {
      return import(/* webpackChunkName: "panel-[request]" */ '../panels/' + m[1] + '/module');
    }
    if ((m = mapData.exec(id))) {
      // jVectorMap data files: each one registers a map with the jVectorMap plugin
      return import(/* webpackChunkName: "mapdata-[request]", webpackInclude: /map\.[\w-]+\.js$/ */ '../panels/map/lib/map.' + m[1]);
    }
    if (id === './leaflet/plugins') {
      return import(/* webpackChunkName: "leaflet-plugins" */ '../panels/bettermap/leaflet/plugins');
    }
    if (id === 'jquery.flot.pie') {
      return import(/* webpackChunkName: "flot-pie" */ 'jquery.flot.pie');
    }
    if (id === 'jquery') {
      return Promise.resolve($);
    }
    return Promise.reject(new Error('lazy-require: unknown module id ' + id));
  }

  return function lazyRequire(deps, callback, errback) {
    return Promise.all(deps.map(load)).then(function (mods) {
      return callback.apply(null, mods);
    }, errback);
  };
});
