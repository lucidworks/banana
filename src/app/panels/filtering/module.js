/*

  ## filtering

*/
define([
  'angular',
  'app',
  'underscore'
],
function (angular, app, _) {
  'use strict';

  var module = angular.module('kibana.panels.filtering', []);
  app.useModule(module);

  module.controller('filtering', function($scope, filterSrv, $rootScope, $location, dashboard) {

    $scope.panelMeta = {
      modals: [{
        description: "Inspect",
        icon: "icon-info-sign",
        partial: "app/partials/inspector.html",
        show: true
      }],
      status: "Stable",
      description: "A controllable list of all filters currently applied to the dashboard. You need one of these on your dashboard somewhere in order for all the panels to work properly while you are interacting with your data."
    };

    // Set and populate defaults
    var _d = {
      spyable: true
    };
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.filterSrv = filterSrv;

      var locationSearch = $location.search(),
          mandateMap = {'+': 'must', '-': 'mustNot'};

      if (locationSearch.q) {
        angular.forEach(locationSearch.q.split(' '), function (value) {
          if (value) {
            var startWithMandate = value[0].match(/\+|-/) !== null,
                mandate = startWithMandate ? mandateMap[value[0]] : 'either';
            filterSrv.set({
              editing   : false,
              type      : 'querystring',
              query     : startWithMandate ? value.substr(1, value.length) : value,
              mandate   : mandate
            }, undefined, true);
          }
        });
        $scope.refresh();
      }
    };

    $scope.remove = function(id) {
      filterSrv.remove(id);
      dashboard.refresh();
    };

    $scope.add = function(query) {
      query = query || '*';
      filterSrv.set({
        editing   : true,
        type      : 'querystring',
        query     : query,
        mandate   : 'must'
      },undefined,true);
    };

    $scope.toggle = function(id) {
      filterSrv.list[id].active = !filterSrv.list[id].active;
      dashboard.refresh();
    };

    $scope.refresh = function() {
      $rootScope.$broadcast('refresh');
    };

    $scope.render = function() {
      $rootScope.$broadcast('render');
    };

    $scope.show_key = function(key) {
      return !_.contains(['type','id','alias','mandate','active','editing'],key);
    };

    $scope.isEditable = function(filter) {
      var uneditable = ['time','range'];
      if(_.contains(uneditable,filter.type)) {
        return false;
      } else {
        return true;
      }
    };

    $scope.decodeFilterValue = function(value) {
      if (value instanceof Date) {
        return value.toLocaleDateString() + ' ' + value.toTimeString().substring(0,17); // e.g. 4/7/2017 11:45:34 GMT+0700
      } else {
        return decodeURIComponent(value);
      }
    };
  });

  module.filter('truncate', function() {
    return function(text, length) {
      length = length || 200;
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.length > length ? text.substr(0,length)+'...' : text;
      }
      return '';
    };
  });
});
