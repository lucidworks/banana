define(['underscore'],
function (_) {
  "use strict";

  return function Settings (options) {
    /**
     * To add a setting, you MUST define a default. Also,
     * THESE ARE ONLY DEFAULTS.
     * They are overridden by config.js in the root directory, and they match the
     * values that config.js ships with (Lucidworks Fusion defaults), so a config.js
     * that leaves a key out behaves like the shipped one. The exception is panel_names,
     * which is empty here and listed in config.js.
     * @type {Object}
     */
    var defaults = {
      solr: "/api/query-pipelines/_system/collections/",
      solr_core: "system_logs",
      timefield: "timestamp_tdt",
      USE_ADMIN_LUKE: true,
      USE_ADMIN_CORES: true,
      panel_names: [],
      banana_index: "system_banana",
      default_dashboard: "default.json",
      // Servers, besides banana_server and solr, that a shared link may name in its "server"
      // parameter as the place to load a dashboard from.
      allowed_dashboard_servers: [],
      // banana_server (the URL of the server used to store and load saved dashboards) has no
      // default. It is passed through below when config.js sets it.

      // Lucidworks Fusion settings
      USE_FUSION: true,
      apollo: "/api",
      apollo_queryPipeline: "/api/query-pipelines/",
      apollo_indexPipeline: "/api/index-pipelines/",

      SYSTEM_BANANA_QUERY_PIPELINE: "/api/query-pipelines/default/collections/system_banana",
      SYSTEM_BANANA_INDEX_PIPELINE: "/api/index-pipelines/_system/collections/system_banana",
      SYSTEM_BANANA_BLOB_API: "/api/blobs",
      SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM: "resourceType=banana",  // for use when saving dashboards, to create metadata field resourceType=banana
      SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY: "resourceType=banana",  // for use when searching dashboards in Blob Store

      FUSION_API_STATIC_FIELDS: "/schema/fields",
      FUSION_API_DYNAMIC_FIELDS: "/schema/dynamicfields",
      FUSION_API_COLLECTIONS: "/api/collections",

      // Where a 401 sends the browser to log in (the current location is added as the "return" value)
      // and where the logged-in user is read from. The defaults are what Banana 1.6.30 does: the login
      // page one level above the page, and the session of the host that serves Banana.
      FUSION_LOGIN_URL: "../login",
      FUSION_SESSION_API: "/api/session"
    };

    // This initializes a new hash on purpose, to avoid adding parameters to
    // config.js without providing sane defaults
    var settings = {};
    _.each(defaults, function(value, key) {
      settings[key] = typeof options[key] !== 'undefined' ? options[key]  : defaults[key];
    });

    // Optional keys without a default: copied only when config.js sets them.
    if (options.banana_server) {
      settings.banana_server = options.banana_server;
    }

    return settings;
  };
});
