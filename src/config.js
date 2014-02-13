/**
 * These is the app's configuration, If you need to configure
 * the default dashboard, please see dashboards/default
 */
define(['settings'],
function (Settings) {
  "use strict";

  return new Settings({

    /**
     * URL to your elasticsearch server. You almost certainly don't
     * want 'http://localhost:9200' here. Even if Kibana and ES are on
     * the same host
     *
     * By default this will attempt to reach ES at the same host you have
     * elasticsearch installed on. You probably want to set it to the FQDN of your
     * elasticsearch host
     * @type {String}
     */
    //elasticsearch: "http://"+window.location.hostname+":9200",
    // TODO:
    elasticsearch: "http://localhost:9200",

    // Which Solr's core store the logstash output?
    // solr_server: "http://localhost:8983/solr/",
    // solr: "http://localhost:8983/solr/logstash_logs",
    solr: "http://localhost:8983/solr/",
    // solr_collection: "logstash_logs",
    solr_core: "logstash_logs",

    /**
     * The default ES index to use for storing Kibana specific object
     * such as stored dashboards
     * @type {String}
     */
     // TODO:
    kibana_index: "kibana-int",

//    kibana_index: "banana-int",
    /**
     * Panel modules available. Panels will only be loaded when they are defined in the
     * dashboard, but this list is used in the "add panel" interface.
     * @type {Array}
     */
    panel_names: [
      'histogram',
      'map',
      'pie',
      'table',
      'filtering',
      'timepicker',
      'text',
      'fields',
      'hits',
      'dashcontrol',
      'column',
      'derivequeries',
      'trends',
      'bettermap',
      'query',
      'terms'
    ]
  });
});
