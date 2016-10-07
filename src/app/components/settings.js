define(['underscore'],
function (_) {
  "use strict";

  return function Settings (options) {
    /**
     * To add a setting, you MUST define a default. Also,
     * THESE ARE ONLY DEFAULTS.
     * They are overridden by config.js in the root directory
     * @type {Object}
     */
    var defaults = {
      solr: "http://"+window.location.hostname+":8983/solr/",
      solr_core: "logs",
      timefield: "timestamp_tdt",
      USE_ADMIN_LUKE: true,
      USE_ADMIN_CORES: true,
      panel_names: [],
      banana_index: "system_banana",
      banana_queryPipeline: "system_banana-default",
      banana_indexPipeline: "system_banana-default",

      // Lucidworks Fusion settings
      USE_FUSION: true,  
      apollo: "/api/apollo",
      apollo_queryPipeline: "/api/apollo/query-pipelines/",
      apollo_indexPipeline: "/api/apollo/index-pipelines/",

      SYSTEM_BANANA_QUERY_PIPELINE: "/api/apollo/query-pipelines/system_banana-default/collections/system_banana",
      SYSTEM_BANANA_INDEX_PIPELINE: "/api/apollo/index-pipelines/system_banana-default/collections/system_banana",
      FUSION_API_STATIC_FIELDS: "/schema/fields",
      FUSION_API_DYNAMIC_FIELDS: "/schema/dynamicfields",
      FUSION_API_COLLECTIONS: "/api/apollo/collections"
    };

    // This initializes a new hash on purpose, to avoid adding parameters to
    // config.js without providing sane defaults
    var settings = {};
    _.each(defaults, function(value, key) {
      settings[key] = typeof options[key] !== 'undefined' ? options[key]  : defaults[key];
    });

    return settings;
  };
});
