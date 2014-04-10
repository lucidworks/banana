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
      description : "Manage all of the queries on the dashboard. You almost certainly need one of "+
        "these somewhere. This panel allows you to add, remove, label, pin and color queries"
    };

    // Set and populate defaults
    var _d = {
      query   : "*:*",
      // defType : 'lucene',
      // df      : 'df=message',
      pinned  : true,
      history : [],
      remember: 10 // max: 100, angular strap can't take a variable for items param
    };
    _.defaults($scope.panel,_d);

    $scope.querySrv = querySrv;

    $scope.init = function() {
    };

    $scope.refresh = function() {
      // _.each($scope.querySrv.list, function (v) {
      //   if ($scope.panel.def_type) {
      //     // If defType is specified, strip off old defType params from the query
      //     // before appending the new defType value.
      //     v.query = remove_deftype(v.query) + '&defType=' + $scope.panel.def_type;
      //   } else {
      //     // strip off defType (in case previously specified)
      //     v.query = remove_deftype(v.query)
      //   }
      // });
      update_history(_.pluck($scope.querySrv.list,'query'));
      $rootScope.$broadcast('refresh');
    };

    $scope.render = function() {
      $rootScope.$broadcast('render');
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

    // var remove_deftype = function(query) {
    //   // strip off all defType params in the query
    //   return query.replace(/(&defType=\w+)/g,'');
    // };

    $scope.init();

  });
});