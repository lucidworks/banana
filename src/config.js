/**
 * These is the app's configuration, If you need to configure
 * the default dashboard, please see dashboards/default
 */
define(['settings'],
function (Settings) {
  "use strict";

  return new Settings({

    /**
     * URL to your Solr server. You almost certainly don't
     * want 'http://localhost:8983/solr/' here. Even if Banana and Solr are on
     * the same host
     *
     * By default this will attempt to reach Solr at the same host you have
     * Banana installed on. You probably want to set it to the FQDN of your
     * Solr host
     * @type {String}
     */

    // TODO: Remove ES settings
    elasticsearch: "http://localhost:9200",

    // Specify Solr server and core to store the data.
    solr: "http://localhost:8983/solr/",
    solr_core: "logstash_logs",

    /**
     * The default Solr index to use for storing Banana specific object
     * such as stored dashboards
     * @type {String}
     */
    kibana_index: "kibana-int",

    /**
     * Panel modules available. Panels will only be loaded when they are defined in the
     * dashboard, but this list is used in the "add panel" interface.
     * @type {Array}
     */
    panel_names: [
      'histogram',
      'map',
      'table',
      'filtering',
      'timepicker',
      'text',
      'hits',
      'column',
      // 'derivequeries',  // TODO
      'trends',
      'bettermap',
      'query',
      'terms',
      'multiseries',
      'rangefacet',
      // 'dummy'  // Dummy module for testing
    ]
  });
});
