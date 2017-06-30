/*

  ## query

  ### Parameters
  * query ::  A string or an array of querys. String if multi is off, array if it is on
              This should be fixed, it should always be an array even if its only
              one element
*/
define([
  'angular',
  'app',
  'underscore',
  'css!./query.css'
], function (angular, app, _) {
  'use strict';

  var module = angular.module('kibana.panels.query', []);
  app.useModule(module);

  module.controller('query', function($scope, querySrv, $rootScope) {
    $scope.panelMeta = {

      status  : "Stable",
      description : ""
    };

    // Set and populate defaults
    var _d = {
      query   : "*:*",
      pinned  : true,
        display:'block',
        icon:"icon-caret-down",
      history : [],
      spyable : true,
      remember: 10, // max: 100, angular strap can't take a variable for items param
    };
    _.defaults($scope.panel,_d);

    $scope.querySrv = querySrv;

    $scope.init = function() {
    };

    $scope.refresh = function() {
      update_history(_.pluck($scope.querySrv.list,'query'));
      $rootScope.$broadcast('refresh');
    };

    $scope.render = function() {
      $rootScope.$broadcast('render');
    };
      $scope.display=function() {
          if($scope.panel.display === 'none'){
              $scope.panel.display='block';
              $scope.panel.icon="icon-caret-down";


          }else{
              $scope.panel.display='none';
              $scope.panel.icon="icon-caret-up";
          }
      };
    $scope.toggle_pin = function(id) {
      querySrv.list[id].pin = querySrv.list[id].pin ? false : true;
    };

    $scope.close_edit = function() {
      $scope.refresh();
    };

    var update_history = function(query) {
      if($scope.panel.remember > 0) {
        $scope.panel.history = _.union(query.reverse(),$scope.panel.history);
        var _length = $scope.panel.history.length;
        if(_length > $scope.panel.remember) {
          $scope.panel.history = $scope.panel.history.slice(0,$scope.panel.remember);
        }
      }
    };

    $scope.init();
  });
});
