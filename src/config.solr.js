/**
 * Solr preset: the configuration for running Banana against a plain Solr server
 * (no Lucidworks Fusion).
 *
 * To use it, copy this file over config.js in the deployed webapp (for a built
 * distribution, dist/config.js). No rebuild is needed, because config.js is not part
 * of the bundled code. Reload the page afterwards; the browser may have cached the old
 * file. The default dashboard is chosen by default_dashboard below.
 *
 * Apart from the keys in the "Solr preset" blocks, this file matches config.js, so keep
 * the two in step when you change either.
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
     * Note that the server address you specify must be resolvable from the browser
     * i.e., from your users' machine. The default is a relative path, so it works when Banana
     * is served from the same host as Solr (or a proxy in front of it). Otherwise use the
     * FQDN and port of your Solr host or of the proxy that controls access to it, for
     * example "http://solr.example.com:8983/solr/".
     * @type {String}
     */

    // Solr preset: the Solr server and the collection that stores the data.
    solr: "/solr/",
    solr_core: "logs",
    timefield: "timestamp_tdt",

    /**
     * The default index (collection) to use for storing objects internal to Banana, such as
     * stored dashboards. If you have been using a collection named kibana-int (the default
     * in Banana 1.2 and earlier), replace "banana-int" with "kibana-int" and your old
     * dashboards will be accessible. This collection must exist on the Solr server.
     * @type {String}
     */
    // Solr preset
    banana_index: "banana-int",

    /**
     * Name of the dashboard file under app/dashboards that is loaded when no dashboard is
     * given in the URL and none is stored in the browser.
     * @type {String}
     */
    // Solr preset: the Solr default dashboard.
    default_dashboard: "default.solr.json",

    // Uncomment the following line to specify the URL of the server that will be used to store and load saved dashboards.
    // It only matters when USE_FUSION is false; with Fusion, dashboards are saved and loaded through the blob API.
    // If you specify a remote server, then you need to enable CORS on it in order to allow dashboards to be saved or loaded.
    // Reference: https://github.com/lucidworks/banana/tree/release/resources/enable-cors
    //
    // banana_server: "http://localhost:8983/solr/",

    // Servers that a shared link may name, in its "server" URL parameter, as the place to load
    // a dashboard from. The server in banana_server (or solr when that is not set) and relative paths
    // such as "/solr/" are always accepted. A link that names any other server, including a
    // dashboard's own absolute data server, is ignored unless that server is listed here exactly as
    // it appears in the link (or set as banana_server), for example
    // ["http://solr.example.com:8983/solr/"]. It only matters when USE_FUSION is false.
    allowed_dashboard_servers: [],

    /**
     * Lucidworks Fusion settings
     *
     * USE_FUSION = true means that Banana talks to the Lucidworks Fusion APIs instead of Solr.
     * This mainly affects the APIs used to get the list of collections and schemas (fields),
     * and where saved dashboards are stored (the Fusion blob store).
     */
    // Solr preset: talk to Solr directly.
    USE_FUSION: false,
    apollo: "/api",
    apollo_queryPipeline: "/api/query-pipelines/",
    apollo_indexPipeline: "/api/index-pipelines/",
    
    // Constants  
    SYSTEM_BANANA_QUERY_PIPELINE: "/api/query-pipelines/default/collections/system_banana",
    SYSTEM_BANANA_INDEX_PIPELINE: "/api/index-pipelines/_system/collections/system_banana",
    SYSTEM_BANANA_BLOB_API: "/api/blobs",
    SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM: "resourceType=banana",  // for use when saving dashboards, to create metadata field resourceType=banana
    SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY: "resourceType=banana",  // for use when searching dashboards in Blob Store
    
    FUSION_API_STATIC_FIELDS: "/schema/fields",
    FUSION_API_DYNAMIC_FIELDS: "/schema/dynamicfields",
    FUSION_API_COLLECTIONS: "/api/collections",

    /**
     * With a plain Solr (USE_FUSION false), the default settings use the /admin/luke API to
     * retrieve all fields including dynamic fields (e.g. *_s, *_t, and etc), and the Solr
     * collections API to retrieve all collections for the drop-down collection picker.
     * 
     * You can disable these admin APIs by setting USE_ADMIN_LUKE and USE_ADMIN_CORES flags to false.
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
      'graph',
      'ticker',
      'bettermap',
      'query',
      'significantTerms',
      'terms',
      'rangeFacet',
      'heatmap',
      'scatterplot',
      'fullTextSearch',
      'facet',
      'tagcloud',
      'timeseries',
      'multiseries',
      'sunburst',
      'docviewer',
      'sankey',
      'force',
      'boxplot'
    ]
  });
});
