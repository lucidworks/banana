/*
 ## Terms

 ### Parameters
 * style :: A hash of css styles
 * size :: top N
 * arrangement :: How should I arrange the query results? 'horizontal' or 'vertical'
 * chart :: Show a chart? 'none', 'bar', 'pie'
 * donut :: Only applies to 'pie' charts. Punches a hole in the chart for some reason
 * tilt :: Only 'pie' charts. Janky 3D effect. Looks terrible 90% of the time.
 * lables :: Only 'pie' charts. Labels on the pie?
 */
define([
        'angular',
        'app',
        'underscore',
        'jquery',
        'kbn',
        'angular-smart-table',
    ],
    function (angular, app, _, $, kbn) {
        'use strict';

        var module = angular.module('kibana.panels.statistics', ['smart-table']);
        app.useModule(module);

        module.controller('statistics', function($scope, $translate,$timeout, $filter, timer, querySrv, dashboard, filterSrv) {
            $scope.panelMeta = {
                exportfile: true,
                editorTabs : [
                    {title:$translate.instant('Queries'), src:'app/partials/querySelect.html'}
                ],
                status  : "Stable",
              description : ""
            };

            // Set and populate defaults
            var _d = {
                queries     : {
                    mode        : 'all',
                    ids         : [],
                    query       : '*:*',
                    custom      : ''
                },
                mode    : 'statistic', // mode to tell which number will be used to plot the chart.
                field   : '',
                stats_field : '',
                decimal_points : 0, // The number of digits after the decimal point
                exclude : [],
                missing : false,
                other   : false,
                size    : 10000,
                display:'block',
                icon:"icon-caret-down",
                sortBy  : 'count',
                threshold_first:3000,
                threshold_second:5000,
                order   : 'descending',
                style   : { "font-size": '10pt'},
                fontsize:20,
                linkage_id:'a',
                donut   : false,
                tilt    : false,
                labels  : true,
                logAxis : false,
                arrangement : 'horizontal',
                chart       : 'bar',
                counter_pos : 'above',
                exportSize : 10000,
                lastColor : '',
                spyable     : true,
                show_queries:true,
                error : '',
                chartColors : querySrv.colors,
                refresh: {
                    enable: false,
                    interval: 2
                },
              itemsByPage: 10,
              displayPage: 10,
            };
            _.defaults($scope.panel,_d);


            $scope.init = function () {
                $scope.hits = 0;
                //$scope.testMultivalued();

                // Start refresh timer if enabled
                if ($scope.panel.refresh.enable) {
                    $scope.set_timer($scope.panel.refresh.interval);
                }

                $scope.$on('refresh',function(){
                    $scope.get_data();
                });

                $scope.get_data();
            };

            $scope.testMultivalued = function() {
                if($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("M") > -1) {
                    $scope.panel.error = "Can't proceed with Multivalued field";
                    return;
                }

                if($scope.panel.stats_field && $scope.fields.typeList[$scope.panel.stats_field].schema.indexOf("M") > -1) {
                    $scope.panel.error = "Can't proceed with Multivalued field";
                    return;
                }
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

            $scope.build_query = function(filetype, isForExport) {
                // Build Solr query
                var fq = '';
                if (filterSrv.getSolrFq()) {
                    fq = '&' + filterSrv.getSolrFq();
                }
                var wt_json = '&wt=' + filetype;
                var rows_limit = isForExport ? '&rows=0' : ''; // for terms, we do not need the actual response doc, so set rows=0
                var facet = '';

                if ($scope.panel.mode === 'count') {
                    facet = '&facet=true&facet.field=' + $scope.panel.field + '&facet.limit=' + $scope.panel.size + '&facet.missing=true';
                } else {
                    facet = '&stats=true&stats.facet=' + $scope.panel.field + '&stats.field=' + $scope.panel.stats_field + '&facet.missing=true';
                }
                facet += '&f.' + $scope.panel.field + '.facet.sort=' + ($scope.panel.sortBy || 'count');

                var exclude_length = $scope.panel.exclude.length;
                var exclude_filter = '';
                if(exclude_length > 0){
                    for (var i = 0; i < exclude_length; i++) {
                        if($scope.panel.exclude[i] !== "") {
                            exclude_filter += '&fq=-' + $scope.panel.field +":"+ $scope.panel.exclude[i];
                        }
                    }
                }
                return querySrv.getORquery() + wt_json + rows_limit + fq + exclude_filter + facet + ($scope.panel.queries.custom != null ? $scope.panel.queries.custom : '');
            };

            $scope.exportfile = function(filetype) {

                var query = this.build_query(filetype, true);

                $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

                var request = $scope.sjs.Request().indices(dashboard.indices),
                    response;

                request.setQuery(query);

                response = request.doSearch();

                // Populate scope when we have results
                response.then(function(response) {
                    kbn.download_response(response, filetype, "terms");
                });
            };

            $scope.set_timer = function(refresh_interval) {
                $scope.panel.refresh.interval = refresh_interval;
                if (_.isNumber($scope.panel.refresh.interval)) {
                    timer.cancel($scope.refresh_timer);
                    $scope.realtime();
                } else {
                    timer.cancel($scope.refresh_timer);
                }
            };

            $scope.realtime = function() {
                if ($scope.panel.refresh.enable) {
                    timer.cancel($scope.refresh_timer);

                    $scope.refresh_timer = timer.register($timeout(function() {
                        $scope.realtime();
                        $scope.get_data();
                    }, $scope.panel.refresh.interval*1000));
                } else {
                    timer.cancel($scope.refresh_timer);
                }
            };

            $scope.get_data = function() {
              console.log("Get Data");
              // Make sure we have everything for the request to complete
              if (dashboard.indices.length === 0) {
                return;
              }

              delete $scope.panel.error;
              $scope.panelMeta.loading = true;
              var request, results;

              $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

              request = $scope.sjs.Request().indices(dashboard.indices);
              $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

              // Populate the inspector panel
              $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

              var query = this.build_query('json', false);

              // Set the panel's query
              $scope.panel.queries.query = query;

              request.setQuery(query);
              results = request.doSearch();
              // Populate scope when we have results
              results.then(function successCallback(response) {
                var k = 0;
                $scope.panelMeta.loading = false;
                $scope.hits = response.response.numFound;
                $scope.data = [];
                $scope.yaxis_min = null;
                // this callback will be called asynchronously
                // when the response is available
                $scope.yaxis_min = null;
                if ($scope.panel.mode === 'count') {
                  var temp_data = response.facet_counts.facet_fields[$scope.panel.field];
                  for(var i=0; i<temp_data.length; i=i+2){
                    var slice = {
                      term: temp_data[i],
                      count: temp_data[i+1],
                    };
                    $scope.data.push(slice);
                  }
                }
                else {
                  _.each(response.stats.stats_fields[$scope.panel.stats_field].facets[$scope.panel.field], function (stats_obj, facet_field) {
                    //var slice = {label: facet_field, data: [[k, stats_obj['mean'], stats_obj['count'], stats_obj['max'], stats_obj['min'], stats_obj['stddev'], facet_field]], actions: true};
                    var slice = {
                      term: facet_field,
                      index: k,
                      mean: stats_obj['mean'],
                      count: stats_obj['count'],
                      max: stats_obj['max'],
                      min: stats_obj['min'],
                      stddev: stats_obj['stddev'],
                      actions: true
                    };
                    $scope.data.push(slice);
                  });
                }
              }, function errorCallback() {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
              });
                $scope.$emit('render');
            };

            $scope.build_search = function(term,negate) {
                filterSrv.set({
                    type: 'terms', field: $scope.panel.field, value: term.term,
                    mandate: (negate ? 'mustNot' : 'must')
                });
                dashboard.current.linkage_id = $scope.panel.linkage_id;
                dashboard.current.enable_linkage = false;
                dashboard.refresh();
            };

            $scope.set_refresh = function (state) {
                $scope.refresh = state;
                // if 'count' mode is selected, set decimal_points to zero automatically.
                if ($scope.panel.mode === 'count') {
                    $scope.panel.decimal_points = 0;
                }
            };

            $scope.close_edit = function() {
                // Start refresh timer if enabled
                if ($scope.panel.refresh.enable) {
                    $scope.set_timer($scope.panel.refresh.interval);
                }

                if ($scope.refresh) {
                    // $scope.testMultivalued();
                    $scope.get_data();
                }
                $scope.refresh =  false;
                $scope.$emit('render');
            };

            $scope.showMeta = function(term) {
                if(_.isUndefined(term.meta)) {
                    return true;
                }
                if(term.meta === 'other' && !$scope.panel.other) {
                    return false;
                }
                if(term.meta === 'missing' && !$scope.panel.missing) {
                    return false;
                }
                return true;
            };

        });


    });
