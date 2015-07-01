/*
  ## Docviewer module
  *
*/
define([
  'angular',
  'app',
  'kbn',
  'underscore'/*,
  'jquery'*/
],
function (angular, app, kbn, _/*, $*/) {
  'use strict';

  var module = angular.module('kibana.panels.docviewer', []);
  app.useModule(module);

  module.controller('docviewer', function($scope, dashboard, fields, querySrv, filterSrv, $http) {
    $scope.panelMeta = {
      modals: [
        {
          description: 'Inspect',
          icon: 'icon-info-sign',
          partial: 'app/partials/inspector.html',
          show: $scope.panel.spyable
        }
      ],
      editorTabs: [
        {
          title: 'Queries',
          src: 'app/partials/querySelect.html'
        }
      ],
      status: 'Experimental',
      description: 'Docviewer panel for displaying search results in a document viewer style.'
    };

    // Define panel's default properties and values
    $scope.docIndex = 0;
    $scope.data = [];

    var _d = {
      queries: {
        mode: 'all',
        query: '*:*',
        custom: ''
      },
      titleField: '',
      contentField: '',
      uniqueKey: 'id',
      max_rows: 20,
      fragsize: 0,
      simplePre: '<mark>',
      simplePost: '</mark>',
      spyable: true,
      show_queries: true
    };

    // Set panel's default values
    _.defaults($scope.panel, _d);

    $scope.init = function() {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

      // Get the unique key (field) from the collection (or core) schema.
      // This field will be used for selecting the highlighting results.
      var solrUrl = dashboard.current.solr.server + dashboard.current.solr.core_name + '/schema/uniquekey?wt=json&omitHeader=true';
      $http.get(solrUrl).then(function (resp) {
        $scope.panel.uniqueKey = resp.data.uniqueKey;
      });
    };

    $scope.set_refresh = function(state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if ($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh = false;
      $scope.$emit('render');
    };

    $scope.render = function() {
      $scope.$emit('render');
    };

    $scope.get_data = function() {
      // Show the spinning wheel icon
      $scope.panelMeta.loading = true;

      // Set Solr server
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);
      var request = $scope.sjs.Request();

      // Construct Solr query
      var fq = '';
      if (filterSrv.getSolrFq()) {
          fq = '&' + filterSrv.getSolrFq();
      }
      var wt = '&wt=json';
      var fl = '&fl=' + $scope.panel.titleField + ' ' + $scope.panel.contentField + ' ' + $scope.panel.uniqueKey;
      var rows_limit = '&rows=' + $scope.panel.max_rows;
      var hl = '&hl=true&hl.fl=' + $scope.panel.titleField + ' ' + $scope.panel.contentField;
      hl += '&hl.fragsize=' + $scope.panel.fragsize;
      hl += '&hl.simple.pre=' + $scope.panel.simplePre + '&hl.simple.post=' + $scope.panel.simplePost;

      $scope.panel.queries.query = querySrv.getQuery(0) + fq + fl + wt + rows_limit + hl;

      // Set the additional custom query
      if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
      } else {
          request = request.setQuery($scope.panel.queries.query);
      }

      // Execute the search and get results
      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        // If there's no result, do nothing.
        if (results.response.docs.length === 0) {
          $scope.data = [];
          $scope.docIndex = -1; // this will be addbed by one and shown on the panel as zero.
          $scope.panel.docTitle = '';
          $scope.panel.docContent = '';

          return false;
        }

        $scope.data = results.response.docs;
        $scope.highlighting = results.highlighting;
        $scope.docIndex = 0;
        var uniquekey = $scope.data[$scope.docIndex][$scope.panel.uniqueKey];

        if ($scope.highlighting[uniquekey][$scope.panel.titleField]) {
          $scope.panel.docTitle = $scope.highlighting[uniquekey][$scope.panel.titleField];
        } else {
          $scope.panel.docTitle = $scope.data[$scope.docIndex][$scope.panel.titleField];
        }

        if ($scope.highlighting[uniquekey][$scope.panel.contentField]) {
          $scope.panel.docContent = $scope.highlighting[uniquekey][$scope.panel.contentField];
        } else {
          $scope.panel.docContent = $scope.data[$scope.docIndex][$scope.panel.contentField];
        }

        $scope.render();
      });

      // Hide the spinning wheel icon
      $scope.panelMeta.loading = false;
    };

    $scope.nextDoc = function() {
      if ($scope.docIndex < $scope.data.length - 1) {
        $scope.docIndex++;
        var uniquekey = $scope.data[$scope.docIndex][$scope.panel.uniqueKey];

        if ($scope.highlighting[uniquekey][$scope.panel.titleField]) {
          $scope.panel.docTitle = $scope.highlighting[uniquekey][$scope.panel.titleField];
        } else {
          $scope.panel.docTitle = $scope.data[$scope.docIndex][$scope.panel.titleField];
        }

        if ($scope.highlighting[uniquekey][$scope.panel.contentField]) {
          $scope.panel.docContent = $scope.highlighting[uniquekey][$scope.panel.contentField];
        } else {
          $scope.panel.docContent = $scope.data[$scope.docIndex][$scope.panel.contentField];
        }
      }
    };

    $scope.prevDoc = function() {
      if ($scope.docIndex > 0) {
        $scope.docIndex--;
        var uniquekey = $scope.data[$scope.docIndex][$scope.panel.uniqueKey];

        if ($scope.highlighting[uniquekey][$scope.panel.titleField]) {
          $scope.panel.docTitle = $scope.highlighting[uniquekey][$scope.panel.titleField];
        } else {
          $scope.panel.docTitle = $scope.data[$scope.docIndex][$scope.panel.titleField];
        }

        if ($scope.highlighting[uniquekey][$scope.panel.contentField]) {
          $scope.panel.docContent = $scope.highlighting[uniquekey][$scope.panel.contentField];
        } else {
          $scope.panel.docContent = $scope.data[$scope.docIndex][$scope.panel.contentField];
        }
      }
    };
  });
});
