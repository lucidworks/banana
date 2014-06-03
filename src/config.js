/**
 * These is the app's configuration, If you need to configure
 * the default dashboard, please see dashboards/default
 */
define(['settings'],
function (Settings) {
  "use strict";

  return new Settings({

    /**
     * Specify URL to your Solr server and core to store the data.
     *
     * By default this will attempt to reach Solr at the same host you have
     * Banana installed on. You probably want to set it to the FQDN of your
     * Solr host
     * @type {String}
     */
    solr: "http://localhost:8983/solr/",
    solr_core: "logstash_logs",

    /**
     * The default Solr index to use for storing Banana specific object
     * such as stored dashboards
     * @type {String}
     */
    banana_index: "banana-int",

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
      'ticker',
      'bettermap',
      'query',
      'terms',
      // 'multiseries',
      'rangeFacet'
      // 'dummy'  // Dummy module for testing
    ]
  });
});
