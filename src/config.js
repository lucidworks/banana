/**
 * This file contains the basic configuration settings for the banana webapp. 
 */
 
define(['settings'],
function (Settings) {
  "use strict";

  return new Settings({

    /**
     * The default solr server and collection.
     * 
     * Banana is designed such that one instance of the webapp can act as a query engine 
     * for multiple instances of Solr and multiple Solr collections. In this file, you can 
     * specify the default Solr server and the collection that stores the data to be 
     * visualized. Each dashboard that you create can (and typically will) override this 
     * setting.
     *
     * Note that the solr server address you specify must be resolvable from the browser
     * i.e., from your users' machine. You probably want to set it to the FQDN and port 
     * number of your Solr host or the proxy that controls access to your Solr host. 
     * By default it is set to localhost:8983, which frequently 
     * works for development and testing, when you are running Solr, Banana and the 
     * browser on one development/testing machine.
     *
     * After configuring this file, we also suggest you edit the solr server and collection 
     * in the default dashboard (app/dashboards/default.json), which is a guided 
     * self-starter for building dashboards. You can later replace the pre-defined 
     * default.json with the dashboard you want your users to see when they first access 
     * your banana web application.
     * @type {String}
     */
    // Specify Solr server and core to store the data.
    solr: "/solr/",
    solr_core: "logs",
    timefield: "timestamp_tdt",

    /**
     * The default Solr index to use for storing objects internal to Banana, such as 
     * stored dashboards. If you have been using a collection named kibana-int 
     * to save your dashboards (the default provided in Banana 1.2 and earlier), then you
     * simply need to replace the string "banana-int" with "kibana-int" and your old 
     * dashboards will be accessible. 
     *
     * This banana-int (or equivalent) collection must be created and available in the 
     * default solr server specified above, which serves as the persistence store for data 
     * internal to banana.
     * @type {String}
     */
    banana_index: "banana-int",
    banana_queryPipeline: "system_banana-default",
    banana_indexPipeline: "system_banana-default",

    /**
     * Lucidworks Fusion settings
     *
     * USE_FUSION = true, mean that Banana will talk to Lucidworks Fusion APIs, instead of Solr.
     * This mainly affect the APIs used to get the list of collections and schemas (fields).
     */
    // USE_FUSION: true,
    USE_FUSION: false,
    apollo: "/api/apollo",
    apollo_queryPipeline: "/api/apollo/query-pipelines/",
    apollo_indexPipeline: "/api/apollo/index-pipelines/",
    
    // Constants  
    SYSTEM_BANANA_QUERY_PIPELINE: "/api/apollo/query-pipelines/default/collections/system_banana",
    SYSTEM_BANANA_INDEX_PIPELINE: "/api/apollo/index-pipelines/_system/collections/system_banana",
    SYSTEM_BANANA_BLOB_API: "/api/apollo/blobs",
    SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM: "resourceType=banana",  // for use when saving dashboards, to create metadata field resourceType=banana
    SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY: "resourceType=banana",  // for use when searching dashboards in Blob Store
    
    FUSION_API_STATIC_FIELDS: "/schema/fields",
    FUSION_API_DYNAMIC_FIELDS: "/schema/dynamicfields",
    FUSION_API_COLLECTIONS: "/api/apollo/collections",

    /**
     * The default settings will use /admin/luke API to retrieve all fields from Solr including
     * dynamic fields (e.g. *_s, *_t, and etc). And also, it will use /admin/cores API to retrieve
     * all cores/collections from Solr to populate the drop-down collection picker.
     * 
     * You can disable the /admin APIs by setting USE_ADMIN_LUKE and USE_ADMIN_CORES flags to false.
     * The effects are that the field list in Table panel will not be able to show the dynamic fields,
     * and the drop-down collection picker will not work.
     * 
     * If USE_ADMIN_LUKE is set to false, Banana will use /schema/fields API instead and dynamic fields
     * will not show up in the field list.
     *
     * If USE_ADMIN_CORES is set to false, Banana will not be able to retrieve the list of Solr collections.
     * And also, the dashboard alert about no collections returned from Solr will be disabled.
     * @type {Boolean}
     */
    USE_ADMIN_LUKE: true,
    USE_ADMIN_CORES: true,

    /**
     * Panel modules available. Panels will only be loaded when they are defined in the
     * dashboard. This list is used to populate the drop-down in the "add panel" interface.
     * @type {Array}
     */
    panel_names: [
      'bar',
      'histogram',
      'map',
      'table',
      'filtering',
      'timepicker',
      'text',
      'hits',
      'column',
      'ticker',
      'bettermap',
      'query',
      'terms',
      'rangeFacet',
      'heatmap',
      'scatterplot',
      'fullTextSearch',
      'facet',
      'tagcloud',
      'multiseries',
      'sunburst',
      'docviewer'
    ]
  });
});
