/*

  ## Better maps

  ### Parameters
  * size :: How many results to show, more results = slower
  * field :: field containing a 2 element array in the format [lon,lat]
  * tooltip :: field to extract the tool tip value from
  * spyable :: Show the 'eye' icon that reveals the last ES query
*/
define([
  'angular',
  'app',
  'underscore',
  './leaflet/leaflet-src',
  'require',
  // './leaflet/plugins', // moving it here causing error in the app, fallback to the old Kibana way.

  'css!./module.css',
  'css!./leaflet/leaflet.css',
  'css!./leaflet/plugins.css'
],
function (angular, app, _, L, localRequire) {
  'use strict';

  var DEBUG = false; // DEBUG mode
  var fitBoundsFlag = true;

  var module = angular.module('kibana.panels.bettermap', []);
  app.useModule(module);

  module.controller('bettermap', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {
          title: 'Queries',
          src: 'app/partials/querySelect.html'
        }
      ],
      status  : "Experimental",
      description : "Displays geo points in clustered groups on a map. For better or worse, this panel does NOT use the geo-faceting capabilities of Solr. This means that it transfers more data and is generally heavier to compute, while showing less actual data. If you have a time filter, it will attempt to show to most recent points in your search, up to your defined limit. It is best used after filtering the results through other queries and filter queries, or when you want to inspect a recent sample of points."
    };

    // Set and populate defaults
    var _d = {
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      size     : 1000,
      spyable  : true,
      lat_start: '',
      lat_end  : '',
      lon_start: '',
      lon_end  : '',
//      tooltip : "_id",
      field: null,
      show_queries: true,
      fitBoundsAuto: true,
      lat_empty: 0,
      lon_empty: 0
    };

    _.defaults($scope.panel, _d);
    $scope.requireContext = localRequire;

    // inorder to use relative paths in require calls, require needs a context to run. Without
    // setting this property the paths would be relative to the app not this context/file.

    $scope.init = function() {
      $scope.$on('refresh',function() {
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
    };

    $scope.fitBounds = function() {
      fitBoundsFlag = true;
      $scope.$emit('draw');
    };

    $scope.get_data = function(segment,query_id) {
      $scope.require(['./leaflet/plugins'], function () {
        $scope.panel.error =  false;
        delete $scope.panel.error;

        // Make sure we have everything for the request to complete
        if(dashboard.indices.length === 0) {
          return;
        }

        // check if [lat,lon] field is defined
        if(_.isUndefined($scope.panel.field)) {
          $scope.panel.error = "Please select a field that contains geo point in [lon,lat] format";
          return;
        }

        // Solr.js
        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

        var _segment = _.isUndefined(segment) ? 0 : segment;

        // var request = $scope.sjs.Request().indices(dashboard.indices);

        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
        var boolQuery = $scope.sjs.BoolQuery();
        _.each($scope.panel.queries.ids,function(id) {
          boolQuery = boolQuery.should(querySrv.getEjsObj(id));
        });

        var request = $scope.sjs.Request().indices(dashboard.indices[_segment]);

        request = request.query(
        $scope.sjs.FilteredQuery(
          boolQuery,
          filterSrv.getBoolFilter(filterSrv.ids)
        ))
        .size($scope.panel.size); // Set the size of query result

        $scope.populate_modal(request);

        if (DEBUG) {
            console.debug('bettermap:\n\trequest=',request,'\n\trequest.toString()=',request.toString());
        }

        // Build Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
          fq = '&' + filterSrv.getSolrFq();
        }
        var query_size = $scope.panel.size;
        var wt_json = '&wt=json';
        var rows_limit;
        var sorting = '&sort=' + filterSrv.getTimeField() + ' desc'; // Only get the latest data, sorted by time field.

        // set the size of query result
        if (query_size !== undefined && query_size !== 0) {
          rows_limit = '&rows=' + query_size;
        } else { // default
          rows_limit = '&rows=25';
        }

        // FIXED LatLong Query
        if($scope.panel.lat_start && $scope.panel.lat_end && $scope.panel.lon_start && $scope.panel.lon_end && $scope.panel.field) {
          fq += '&fq=' + $scope.panel.field + ':[' + $scope.panel.lat_start + ',' + $scope.panel.lon_start + ' TO ' + $scope.panel.lat_end + ',' + $scope.panel.lon_end + ']';
        }

        // Set the panel's query
        $scope.panel.queries.query = querySrv.getORquery() + wt_json + rows_limit + fq + sorting;

        // Set the additional custom query
        if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
        } else {
          request = request.setQuery($scope.panel.queries.query);
        }

        var results = request.doSearch();

        results.then(function(results) {
          $scope.panelMeta.loading = false;

          if(_segment === 0) {
            $scope.data = [];
            query_id = $scope.query_id = new Date().getTime();
          }

          // Check for error and abort if found
          if(!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error.msg);
            return;
          }

          // Check that we're still on the same query, if not stop
          if($scope.query_id === query_id) {
            // Keep only what we need for the set
            $scope.data = $scope.data.slice(0,$scope.panel.size).concat(_.map(results.response.docs, function(hit) {
              var latlon;
              if (hit[$scope.panel.field]) {
                latlon = hit[$scope.panel.field].split(',');
              } else {
                latlon = [$scope.panel.lat_empty, $scope.panel.lon_empty];
              }

              return {
                coordinates : new L.LatLng(latlon[0],latlon[1]),
                tooltip : hit[$scope.panel.tooltip]
              };
            }));

          } else {
            return;
          }

          $scope.$emit('draw');
          // Get $size results then stop querying
          // Searching Solr using Segments
          if($scope.data.length < $scope.panel.size && _segment+1 < dashboard.indices.length) {
            $scope.get_data(_segment+1, $scope.query_id);
          }
        });
      });
    };

    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
    };

  });

  module.directive('bettermap', function() {
    return {
      restrict: 'A',
      link: function(scope, elem, attrs) {

        elem.html('<center><img src="img/load_big.gif"></center>');

        // Receive render events
        scope.$on('draw',function(){
          render_panel();
        });

        scope.$on('render', function(){
          if(!_.isUndefined(map)) {
            map.invalidateSize();
            map.getPanes();
          }
        });

        var map, layerGroup;

        function render_panel() {
          scope.require(['./leaflet/plugins'], function () {
            scope.panelMeta.loading = false;

            L.Icon.Default.imagePath = 'app/panels/bettermap/leaflet/images';
            if(_.isUndefined(map)) {
              map = L.map(attrs.id, {
                scrollWheelZoom: true,
                center: [40, -86],
                zoom: 10
              });

              // Add Change to the tile layer url, because it was returning 403 (forbidden)
              // Forbidden because of API Key in cloudmade, so I used osm for now
              // osm (open street map) (http://{s}.tile.osm.org/{z}/{x}/{y}.png)
              // cloud made (http://{s}.tile.cloudmade.com/57cbb6ca8cac418dbb1a402586df4528/22677/256/{z}/{x}/{y}.png)
              L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                minZoom: 2
              }).addTo(map);

              layerGroup = new L.MarkerClusterGroup({maxClusterRadius:50});
            } else {
              layerGroup.clearLayers();
            }

            _.each(scope.data, function(p) {
              if(!_.isUndefined(p.tooltip) && p.tooltip !== '') {
                layerGroup.addLayer(L.marker(p.coordinates).bindLabel(p.tooltip));
              } else {
                layerGroup.addLayer(L.marker(p.coordinates));
              }
            });

            layerGroup.addTo(map);

            if (scope.panel.fitBoundsAuto || fitBoundsFlag) {
              map.fitBounds(_.pluck(scope.data,'coordinates'));
              fitBoundsFlag = false;
            }
          });
        }
      }
    };
  });

});
