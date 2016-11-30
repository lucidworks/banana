define([
    'angular',
    'config',
    'underscore'
  ],
  function (angular, config, _) {
    'use strict';

    var module = angular.module('kibana.services');

    module.service('lucidworksSrv', function ($http, $q) {
      var self = this;

      self.fusionHost = window.location.protocol + '//' + window.location.host;
      self.fusionSessionApi = self.fusionHost + '/api/session';

      self.getFusionUsername = function() {
        return $http.get(self.fusionSessionApi).then(function (sessionResponse) {
          if (sessionResponse) {
            return sessionResponse.data.user.username;
          } else {
            // default username is 'guest'
            return 'guest';
          }
        }, function (error) {
          console.log('ERROR: Cannot get response from Fusion Session API.', error);
          // In case of errors or using Solr, return the default username 'guest'
          return 'guest';
        });
      };

      self.getFields = function(collection) {
        var staticFieldsUrl = config.FUSION_API_COLLECTIONS + '/' + collection + config.FUSION_API_STATIC_FIELDS;
        var dynamicFieldsUrl = config.FUSION_API_COLLECTIONS + '/' + collection + config.FUSION_API_DYNAMIC_FIELDS;
        var promises = [];

        promises.push($http.get(staticFieldsUrl)
        .then(function (results) {
          return results.data;
        }, function (error) {
          console.log(error);
        }));

        promises.push($http.get(dynamicFieldsUrl)
        .then(function (results) {
          // Filter out empty indexFields
          var dynamicFields = _.filter(results.data, function (field) {
            return field.indexFields.length > 0;
          });

          // Transform result into proper output format
          return _.flatten(_.map(dynamicFields, function (field) {
            var baseProperties = _.omit(field, ['name', 'indexFields']);
            return _.map(field.indexFields, function (f) {
              return _.extend(f, baseProperties);
            });
          }));
        }, function (error) {
          console.log(error);
        }));

        return $q.all(promises).then(function (results) {
          return _.sortBy(_.flatten(results), 'name');
        }, function (error) {
          console.log(error);
        });
      };

      // Return a promise that resolve to a list of dashboard from Blob Store API
      // Need to return the result list in Solr response format, so it'll render correctly.
      self.getDashboardList = function(query) {        
        // Validate query
        query = encodeURIComponent(query) || '';
        var url = config.SYSTEM_BANANA_BLOB_SEARCH_API + '?q=id:' + query + '*' + config.SYSTEM_BANANA_BLOB_ID_SUFFIX;
        
        return $http.get(url).then(function(resp) {
          var solrResp = {
            response: {
              numFound: 0,
              docs: _.sortBy(resp.data, 'name')
            }
          };

          // NOTES: No need for _.filter() because we use BLOB_SEARCH_API.
          // Filter resp to get only Banana dashboard json that match the query.
          // solrResp.response.docs = _.filter(resp.data, function(blobObj) {
          //   return blobObj.name.endsWith('.json') && blobObj.name.includes(query);
          // });
          solrResp.response.numFound = solrResp.response.docs.length;

          return solrResp;
        });
      };
    });
  });
