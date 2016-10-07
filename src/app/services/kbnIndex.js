define([
  'angular',
  'underscore',
  'config',
  'moment'
],
function (angular, _, config, moment) {
  'use strict';

  var DEBUG = false; // DEBUG mode

  var module = angular.module('kibana.services');

  // TODO: add solr support to query indices

  module.service('kbnIndex', function($http, alertSrv) {
    // returns a promise containing an array of all indices matching the index
    // pattern that exist in a given range
    this.indices = function(from,to,pattern,interval) {
      var possible = [];
      _.each(expand_range(fake_utc(from),fake_utc(to),interval),function(d){
        possible.push(d.format(pattern));
      });

      return all_indices().then(function(p) {
        var indices = _.intersection(possible,p);
        indices.reverse();
        return indices;
      });
    };

    /**
     * Get an array of all collections in Solr or Fusion.
     * @param hostUrl
     * @returns promise
     */
    // param: solr_server (e.g. http://localhost:8983/solr/)
    this.collections = function(solrServer) {
      return all_collections(solrServer).then(function (p) {
        return p;
      });
    };
      
    function all_collections(solrServer) {
      var collectionApi;

      // Remove trailing slash in solrServer
      if (solrServer.endsWith('/')) {
        solrServer = solrServer.replace(/\/$/, '');
      }

      // Check if use Fusion or Solr
      if (config.USE_FUSION) {
        collectionApi = config.FUSION_API_COLLECTIONS;
      } else {
        // Getting Solr collection names
        if (config.USE_ADMIN_CORES) {
          collectionApi = solrServer + '/admin/cores?action=STATUS&wt=json&omitHeader=true';
        } else {
          // admin API is disabled, then we cannot retrieve the collection list from Solr.
          // return an empty list
          return new Promise(function(resolve) {
            resolve([]);  
          });  
        }
      }

      var promise = $http({
        // Use Solr Admin handler to get the list of all collections.
        // two hacks here: we're stripping the trailing "/" from the URL so the call is /solrAdmin/ instead of /solr/
        // And we're hard-coding the "default" search cluster ...that's the only one we'll get collections for, and it
        // is not yet configurable.
        url: collectionApi,
        method: "GET"
      }).error(function(data, status) {
        alertSrv.set('Error',"Could not retrieve collections from Solr (error status = "+status+")");
        console.debug('kbnIndex: error data = ',data);
      });

      return promise.then(function (p) {
        // Parse Solr response to an array of collections
        var collections = [];

        if (p) {
          if (config.USE_FUSION) {
            _.each(p.data, function(v) {
              collections.push(v.id);
            });  
          } else {
            _.each(p.data.status, function(v,k) {
              collections.push(k);  
            });  
          }
        }
        if (DEBUG) { console.debug('kbnIndex: all_collections response p = ',p,'collections = ',collections); }
        return collections;
      });
    }

    // returns a promise containing an array of all indices in an elasticsearch
    // cluster
    function all_indices() {
      var something = $http({
        // Query ES to get all indices (e.g. "kibana-int", "logstash-2013.10.07", and etc.)
        // {
        //   "logstash-2013.10.07" : {
        //     "aliases" : { }
        //   },
        //   "logstash-2013.10.08" : {
        //     "aliases" : { }
        //   },
        //   "kibana-int" : {
        //     "aliases" : { }
        //   }
        // }

        // TODO: Solr has no concept of indices, instead it uses Core to store data.
        // How I gonna implement this?
        // url: config.elasticsearch + "/_aliases",
        // url: config.solr + "/schema/fields",
        // NOTE: Hard-coded to start -10YEARS from NOW
        url: config.solr + config.solr_core + "/select?q=*:*&wt=json&rows=0&omitHeader=true&facet=true&facet.range=event_timestamp&facet.range.start=NOW-10YEARS/DAY&facet.range.end=NOW&facet.range.gap=%2B1DAY&facet.mincount=1",

        method: "GET"
      }).error(function(data, status) {
        if(status === 0) {
          alertSrv.set('Error',"Could not contact Solr at "+config.solr+
            ". Please ensure that Solr is reachable from your system." ,'error');
        } else {
          alertSrv.set('Error',"Could not reach "+config.solr+". If you"+
          " are using a proxy, ensure it is configured correctly",'error');
        }
      });

      return something.then(function(p) {
        if (DEBUG) { console.debug('kbnIndex: p=',p); }
        
        // var indices = [];
        // _.each(p.data, function(v,k) {
        //   indices.push(k);
        //   // Also add the aliases. Could be expensive on systems with a lot of them
        //   _.each(v.aliases, function(v, k) {
        //     indices.push(k);
        //   });
        // });
      
        var indices = [];

        var timestamp_array = p.data.facet_counts.facet_ranges.event_timestamp.counts;

        for (var i=0; i < timestamp_array.length; i=i+2) {
          // extract and convert timestamp to YYYY.MM.DD
          var t = timestamp_array[i].substr(0,10).replace(/-/g,'.');
          indices.push('logstash-' + t);
        }

        // indices[] should be in this format
        // indices = ['logstash-2013.11.25'];
        
        if (DEBUG) { console.debug('kbnIndex: indices=',indices); }

        return indices;
      });
    }

    // this is stupid, but there is otherwise no good way to ensure that when
    // I extract the date from an object that I get the UTC date. Stupid js.
    // I die a little inside every time I call this function.
    // Update: I just read this again. I died a little more inside.
    // Update2: More death.
    function fake_utc(date) {
      date = moment(date).clone().toDate();
      return moment(new Date(date.getTime() + date.getTimezoneOffset() * 60000));
    }

    // Create an array of date objects by a given interval
    function expand_range(start, end, interval) {
      if(_.contains(['hour','day','week','month','year'],interval)) {
        var range;
        start = moment(start).clone();
        range = [];
        while (start.isBefore(end)) {
          range.push(start.clone());
          switch (interval) {
          case 'hour':
            start.add('hours',1);
            break;
          case 'day':
            start.add('days',1);
            break;
          case 'week':
            start.add('weeks',1);
            break;
          case 'month':
            start.add('months',1);
            break;
          case 'year':
            start.add('years',1);
            break;
          }
        }
        range.push(moment(end).clone());
        return range;
      } else {
        return false;
      }
    }
  });

});
