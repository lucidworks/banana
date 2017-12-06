/*! elastic.js - v1.0.0 - 2013-03-05
* https://github.com/fullscale/elastic.js
* Copyright (c) 2013 FullScale Labs, LLC; Licensed MIT */

/*jshint browser:true */
/*global angular:true */
/*jshint es5:true */
'use strict';

/* 
Angular.js service wrapping the elastic.js API. This module can simply
be injected into your angular controllers. 
*/
angular.module('solrjs.service', [])
  .factory('sjsResource', ['$http', function ($http) {

  return function (url) {

    var DEBUG = false; // DEBUG mode

    var useFusion = false; // default to use Solr

    var
      // use existing sjs object if it exists
      sjs = window.sjs || {},

      /* results are returned as a promise */
      promiseThen = function (httpPromise, successcb, errorcb) {
        return httpPromise.then(function (response) {
          (successcb || angular.noop)(response.data);
          return response.data;
        }, function (response) {
          (errorcb || angular.noop)(response.data);
          return response.data;
        });
      };

    // set url to empty string if it was not specified
    if (url == null) {
      url = '';
    }

    /* implement the solr.js client interface for angular */
    sjs.client = {
      server: function (s) {
        if (s == null) {
          return url;
        }
      
        url = s;
        return this;
      },
      useFusion: function (flag) {
        useFusion = flag;
      },
      post: function (path, data, successcb, errorcb) {
        var config = {};

        // Check if use Fusion or Solr
        var isUpdate = path.indexOf('/update');
        if (useFusion) {
          isUpdate = path.indexOf('/index');
        }

        if (DEBUG) { console.debug('solr-angular-client: url=',url,', path=',path,', isUpdate=',isUpdate); }

        if (isUpdate !== -1) {
          config = { headers: {'Content-type':'application/json'} };
        } else {
          config = { headers: {'Content-type':'application/x-www-form-urlencoded'} };
        }

        path = url + path;
        if (DEBUG) { console.debug('solr-angular-client: POST url=',url,', path=',path,', data=',data); }
        return promiseThen($http.post(path, data, config), successcb, errorcb);
      },
      // This function is only use for Fusion Index Pipeline when deleting a saved dashboard.
      postDel: function (path, data, successcb, errorcb) {
        var config = { headers: {'Content-type':'application/vnd.lucidworks-document'} };
        path = url + path;
        return promiseThen($http.post(path, data, config), successcb, errorcb);
      },
      get: function (path, data, successcb, errorcb) {
        path = url + path + '?' + data;
        if (DEBUG) { console.debug('solr-angular-client: GET url=',url,', path=',path,', data=',data); }
        return promiseThen($http.get(path), successcb, errorcb);
      },
      // PUT is only used for saving a dashboard.
      put: function (path, data, successcb, errorcb) {
        path = url + path;

        if (DEBUG) { console.debug('solr-angular-client: PUT path=',path,', data=',data); }

        return promiseThen($http.put(path, data), successcb, errorcb);
      },
      // DELETE is for deleting a saved dashboard.
      del: function (path, data, successcb, errorcb) {
        path = url + path;
        return promiseThen($http.delete(path, data), successcb, errorcb);
      },
      head: function (path, data, successcb, errorcb) {
        path = url + path;
        return $http.head(path, data)
          .then(function (response) {
          (successcb || angular.noop)(response.headers());
          return response.headers();
        }, function (response) {
          (errorcb || angular.noop)(undefined);
          return undefined;
        });
      }

    };
  
    return sjs;
  };
}]);
