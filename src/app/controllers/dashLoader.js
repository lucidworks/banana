define([
  'angular',
  'underscore'
],
function (angular, _) {
  'use strict';

  var module = angular.module('kibana.controllers');

  module.controller('dashLoader', function($scope, $http, timer, dashboard, alertSrv) {
    $scope.loader = dashboard.current.loader;

    $scope.init = function() {
      $scope.gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;
      $scope.gist = $scope.gist || {};
      $scope.elasticsearch = $scope.elasticsearch || {};
      $scope.resetNewDefaults();
      // $scope.elasticsearch is used throught out this file, dashLoader.html and others.
      // So we'll keep using it for now before refactoring it to $scope.solr.
      // $scope.solr = $scope.solr || {};
    };

    // This function should be replaced by one-way binding feature of AngularJS 1.3
    $scope.resetNewDefaults = function() {
      $scope.new = {
        server: $scope.config.solr,
        core_name: $scope.config.solr_core,
        time_field: 'event_timestamp'
      };
    };
    
    $scope.showDropdown = function(type) {
      // var _l = $scope.loader;
      var _l = dashboard.current.loader || $scope.loader;

      if(type === 'new') {
        return (_l.load_elasticsearch || _l.load_gist || _l.load_local);
      }
      if(type === 'load') {
        return (_l.load_elasticsearch || _l.load_gist || _l.load_local);
      }
      if(type === 'save') {
        return (_l.save_elasticsearch || _l.save_gist || _l.save_local || _l.save_default);
      }
      if(type === 'share') {
        return (_l.save_temp);
      }
      return false;
    };
    
    $scope.create_new = function(type) {
      $http.get('app/dashboards/' + type + '.json?' + new Date().getTime()).
        success(function(data) {
          data.solr.server = $scope.new.server;
          data.solr.core_name = $scope.new.core_name;
          // If time series dashboard, update all timefield references in the default dashboard
          if (type === 'default-ts') {
            data.services.filter.list[0].field = $scope.new.time_field;
            // Iterate over panels and update timefield
            for (var i = 0; i < data.rows.length; i++) {
              for (var j = 0; j < data.rows[i].panels.length; j++) {
                if (data.rows[i].panels[j].timefield) {
                  data.rows[i].panels[j].timefield = $scope.new.time_field;
                } else if (data.rows[i].panels[j].time_field) {
                  data.rows[i].panels[j].time_field = $scope.new.time_field;
                }
              }
            }
          }

          dashboard.dash_load(data);
          
          // Reset new dashboard defaults
          $scope.resetNewDefaults();
        }).
        error(function() {
          alertSrv.set('Error','Unable to load default dashboard','error');
        });
    };

    $scope.set_default = function() {
      if(dashboard.set_default()) {
        alertSrv.set('Local Default Set',dashboard.current.title+' has been set as your local default','success',5000);
      } else {
        alertSrv.set('Incompatible Browser','Sorry, your browser is too old for this feature','error',5000);
      }
    };

    $scope.purge_default = function() {
      if(dashboard.purge_default()) {
        alertSrv.set('Local Default Clear','Your local default dashboard has been cleared','success',5000);
      } else {
        alertSrv.set('Incompatible Browser','Sorry, your browser is too old for this feature','error',5000);
      }
    };

    $scope.elasticsearch_save = function(type,ttl) {
      dashboard.elasticsearch_save(
        type,
        ($scope.elasticsearch.title || dashboard.current.title),
        ($scope.loader.save_temp_ttl_enable ? ttl : false)
      ).then(
        function(result) {
        // Solr
        if(result.responseHeader.status === 0) {
          alertSrv.set('Dashboard Saved','This dashboard has been saved to Solr as "' +
            ($scope.elasticsearch.title || dashboard.current.title) + '"','success',5000);
          if(type === 'temp') {
            $scope.share = dashboard.share_link(dashboard.current.title,'temp',result.response.docs[0].id);
          }
          $scope.elasticsearch.title = '';
        } else {
          alertSrv.set('Save failed','Dashboard could not be saved to Solr','error',5000);
        }
      });
    };

    $scope.elasticsearch_delete = function(id) {
      dashboard.elasticsearch_delete(id).then(
        function(result) {
          if(!_.isUndefined(result)) {
            if (result.responseHeader.status === 0) {
              alertSrv.set('Dashboard Deleted',id+' has been deleted','success',5000);
              // Find the deleted dashboard in the cached list and remove it
              // var toDelete = _.where($scope.elasticsearch.dashboards,{_id:id})[0];
              var toDelete = _.where($scope.elasticsearch.dashboards,{id:id})[0];
              $scope.elasticsearch.dashboards = _.without($scope.elasticsearch.dashboards,toDelete);
            } else {
              alertSrv.set('Dashboard Not Found','Could not find '+id+' in Solr','warning',5000);
            }
          } else {
            alertSrv.set('Dashboard Not Deleted','An error occurred deleting the dashboard','error',5000);
          }
        }
      );
    };

    $scope.elasticsearch_dblist = function(query) {
      dashboard.elasticsearch_list(query,dashboard.current.loader.load_elasticsearch_size).then(
        function(result) {
        if (!_.isUndefined(result.response.docs)) {
          $scope.hits = result.response.numFound;
          $scope.elasticsearch.dashboards = result.response.docs;
        }
      });
    };

    $scope.save_gist = function() {
      dashboard.save_gist($scope.gist.title).then(
        function(link) {
        if(!_.isUndefined(link)) {
          $scope.gist.last = link;
          alertSrv.set('Gist saved','You will be able to access your exported dashboard file at '+
            '<a href="'+link+'">'+link+'</a> in a moment','success');
        } else {
          alertSrv.set('Save failed','Gist could not be saved','error',5000);
        }
      });
    };

    $scope.gist_dblist = function(id) {
      dashboard.gist_list(id).then(
        function(files) {
        if(files && files.length > 0) {
          $scope.gist.files = files;
        } else {
          alertSrv.set('Gist Failed','Could not retrieve dashboard list from gist','error',5000);
        }
      });
    };

  });

});