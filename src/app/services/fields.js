define([
  'angular',
  'underscore',
  'config'
],
function (angular, _, config) {
  'use strict';

  var module = angular.module('kibana.services');

  module.service('fields', function(dashboard, $rootScope, $http, alertSrv) {
    // Save a reference to this
    var self = this;

    this.list = ['_type'];
    this.mapping = {};

    $rootScope.$watch(function(){return dashboard.indices;},function(n) {
      if(!_.isUndefined(n) && n.length) {
        // Only get the mapping for indices we don't know it for
        var indices = _.difference(n,_.keys(self.mapping));
        // Only get the mapping if there are indices
        if(indices.length > 0) {
          self.map(indices).then(function(result) {
            self.mapping = _.extend(self.mapping,result);
            self.list = mapFields(self.mapping);
          });
        // Otherwise just use the cached mapping
        } else {
          self.list = mapFields(_.pick(self.mapping,n));
        }
        // DEBUG
        // console.log("indices: "+indices.toString());
        // console.log("mapping:");console.log(self.mapping);
        // console.log("list:"); console.log(self.list);
      }
    });

    var mapFields = function (m) {
      var fields = [];
      _.each(m, function(types) {
        _.each(types, function(v) {
          fields = _.union(fields,_.keys(v));
        });
      });
      return fields;
    };

    // TODO: add solr support
    // Make a request to the server to get indices and fields
    // For example (logstash response):
    //   mapping = {
    //     "logstash-2013.10.07": {
    //       "logs": {
    //         "properties": {        
    //           "@timestamp": {
    //             "format": "dateOptionalTime"
    //             "type": "date"
    //           },
    //           "@version": {
    //             "type": "string"
    //           },
    //           "host": {
    //             "type": "string"
    //           },
    //           "message": {
    //             "type": "string"
    //           },
    //           "path": {
    //             "type": "string"
    //           },
    //           "type": {
    //             "type": "string"
    //           }
    //         }
    //       }
    //   }

    this.map = function(indices) {
      // delete $http.defaults.headers.common['X-Requested-With'];

      var request = $http({
        // Query ES to get mapping fields
        // url: config.elasticsearch + "/" + indices.join(',') + "/_mapping",
        url: config.solr + "/schema/fields",
        method: "GET"
      }).error(function(data, status) {
        if(status === 0) {
          alertSrv.set('Error',"Could not contact Solr at "+config.solr+
            ". Please ensure that Solr is reachable from your system." ,'error');
        } else {
          alertSrv.set('Error',"No index found at "+config.solr+
            ". Please create at least one index."+
            "If you're using a proxy ensure it is configured correctly.",'error');
        }
      });

      return request.then(function(p) {
        var mapping = {};

        // TODO: This hard coded value is just a place holder for extracting fields for the filter list
        var log_index = 'logstash-2099.12.31';

        var logs = 'logs';
        mapping[log_index] = {};
        mapping[log_index][logs] = {};
        
        // TODO: For Solr, need to implement new mapping

        // _.each(p.data, function(v,k) {
        //   mapping[k] = {};
        //   _.each(v, function (v,f) {
        //     mapping[k][f] = flatten(v);
        //   });
        // });
        
        // mapping = {
        //   'collection1': { => have to be in format: 'logstash-YYYY-MM-DD'
        //     'logs': {
        //       '_version_': {
        //         'type': 'long',
        //       },
        //       'allText': {
        //         'type': 'text_general'
        //       }
        //     }
        //   }
        // };

        _.each(p.data.fields, function(v,k) {
          // Exclude fields: id and _version, from the filter
          // if (! _.contains(['id', '_version_'], v.name)) {
          //   mapping[log_index][logs][v.name] = { 'type':v.type };
          // }
          mapping[log_index][logs][v.name] = { 'type':v.type };
        });

        return mapping;
      });
    };

    // I don't use this function for Solr.
    var flatten = function(obj,prefix) {
      var propName = (prefix) ? prefix :  '',
        dot = (prefix) ? '.':'',
        ret = {};
      for(var attr in obj){
        // For now only support multi field on the top level
        // and if if there is a default field set.
        if(obj[attr]['type'] === 'multi_field') {
          ret[attr] = obj[attr]['fields'][attr] || obj[attr];
          continue;
        }
        if (attr === 'properties') {
          _.extend(ret,flatten(obj[attr], propName));
        } else if(typeof obj[attr] === 'object'){
          _.extend(ret,flatten(obj[attr], propName + dot + attr));
        } else {
          ret[propName] = obj;
        }
      }
      return ret;
    };

  });

});