define([
  'angular',
  'app',
  'underscore'
],
function (angular, app, _) {
  'use strict';

  var module = angular.module('kibana.controllers');

  module.controller('RowCtrl', function($scope, $rootScope, $timeout, ejsResource, sjsResource, querySrv,dashboard, filterSrv) {
      var _d = {
        title: "Row",
        height: "150px",
        collapse: false,
        collapsable: true,
        editable: true,
        panels: [],
      };

      _.defaults($scope.row,_d);

      $scope.init = function() {
        $scope.querySrv = querySrv;
        $scope.reset_panel();
      };

      $scope.toggle_row = function(row) {
        if(!row.collapsable) {
          return;
        }
        row.collapse = row.collapse ? false : true;
        if (!row.collapse) {
          $timeout(function() {
            $scope.$broadcast('render');
          });
        }
      };

      $scope.rowSpan = function(row) {
        var panels = _.filter(row.panels, function(p) {
            var a = $scope.isPanel(p);
            var d =a ;
          return $scope.isPanel(p);
        });
        var e =_.reduce(_.pluck(panels,'span'), function(p,v) {
            var b = p+v;
            var c =b;
            return p+v;
        },0);
        return _.reduce(_.pluck(panels,'span'), function(p,v) {
            var b = p+v;
            var c =b;
          return p+v;
        },0);

      };

      // This can be overridden by individual panels
      $scope.close_edit = function() {
        $scope.$broadcast('render');
      };

      $scope.remove = function(id) {
          var ids = dashboard.current.filterids;
          if (ids[ids.length-1]!=0){
              filterSrv.remove(ids[ids.length-1]);
              dashboard.refresh();}
      };
      $scope.hide_head = function() {
          dashboard.current.hide_head =  !dashboard.current.hide_head;
      };

      $scope.add_panel = function(row,panel) {
        $scope.row.panels.push(panel);
      };

      $scope.reset_panel = function(type) {
        var
          defaultSpan = 4,
          _as = 12-$scope.rowSpan($scope.row);

        $scope.panel = {
          error   : false,
          span    : _as < defaultSpan && _as >= 0 ? _as : defaultSpan,
          editable: true,
          type    : type
        };
      };

      $scope.init();

    }
  );

});