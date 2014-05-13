/*
  ## Dummy module
  * For demonstartion on how to create a custom Banana module.
*/
define([
  'angular',
  'app',
  'underscore',
  'jquery'
],
function (angular, app, _, $) {
  'use strict';

  var module = angular.module('kibana.panels.dummy', []);
  app.useModule(module);

  module.controller('dummy', function($scope, dashboard, querySrv, filterSrv) {
    $scope.panelMeta = {
      status : "Beta",
      description : "Dummy module for demonstartion"
    };

    var _d = {
      foo : 'bar'
    };

    // Set panel's default values
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.get_data = function() {

      $scope.panelMeta.loading = true;

      var request, results;
      // Set Solr server
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      request = $scope.sjs.Request();
      
      // Construct Solr query
      // ...
      // $scope.panel.queries.query = 'q=*:*';

      // Then assign it to request
      // request = request.setQuery($scope.panel.queries.query);

      // Execute the search and get results
      // results = request.doSearch();

      // Populate scope when we have results
      // results.then(function(results) {
         // Parse the results and store in $scope.data
         // Then emit 'render' event at the end
         // $scope.$emit('render');
      // });

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
  });

  module.directive('dummyTag', function() {
    return {
      restrict: 'E',
      link: function(scope, element) {
        scope.$on('render',function(){
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          element.html('Hello Dummy!');
        }

        render_panel();
      }
    };
  });
});