/*

 ## Hits

 ### Parameters
 * style :: A hash of css styles
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

    'jquery.flot',
    'jquery.flot.pie'
], function (angular, app, _, $, kbn) {
    'use strict';

    var module = angular.module('kibana.panels.hits', []);
    app.useModule(module);

    module.controller('hits', function ($scope, $q, $timeout, timer, querySrv, dashboard, filterSrv) {
        $scope.panelMeta = {
            modals: [{
                    description: "Inspect",
                    icon: "icon-info-sign",
                    partial: "app/partials/inspector.html",
                    show: $scope.panel.spyable
            }],
            editorTabs: [{
                title: 'Queries',
                src: 'app/partials/querySelect.html'
            }],
            status: "Stable",
            description: "Showing stats like count, min, max, and etc. for the current query including all the applied filters."
        };

        function Metric() {
            this.type = 'count'; // Stats type
            this.field = '';     // Stats field
            this.decimalDigits = 2;
            this.label = '';
            this.value = 0;
        }

        // Set and populate defaults
        var _d = {
            queries: {
                mode: 'all',
                ids: [],
                query: '*:*',
                basic_query: '',
                custom: ''
            },
            style: {"font-size": '10pt'},
            arrangement: 'horizontal',
            chart: 'total',
            counter_pos: 'above',
            donut: false,
            tilt: false,
            labels: true,
            spyable: true,
            show_queries: true,
            metrics: [new Metric()],
            refresh: {
                enable: false,
                interval: 2
            }
        };
        _.defaults($scope.panel, _d);

        $scope.init = function () {
            $scope.hits = 0;

            // Start refresh timer if enabled
            if ($scope.panel.refresh.enable) {
                $scope.set_timer($scope.panel.refresh.interval);
            }

            $scope.$on('refresh', function () {
                $scope.get_data();
            });

            $scope.get_data();
        };

        $scope.set_timer = function (refresh_interval) {
            $scope.panel.refresh.interval = refresh_interval;
            if (_.isNumber($scope.panel.refresh.interval)) {
                timer.cancel($scope.refresh_timer);
                $scope.realtime();
            } else {
                timer.cancel($scope.refresh_timer);
            }
        };

        $scope.realtime = function () {
            if ($scope.panel.refresh.enable) {
                timer.cancel($scope.refresh_timer);

                $scope.refresh_timer = timer.register($timeout(function () {
                    $scope.realtime();
                    $scope.get_data();
                }, $scope.panel.refresh.interval * 1000));
            } else {
                timer.cancel($scope.refresh_timer);
            }
        };

        $scope.addMetric = function () {
            $scope.panel.metrics.push(new Metric());
        };

        $scope.removeMetric = function (metric) {
            if ($scope.panel.metrics.length > 1) {
                $scope.panel.metrics = _.without($scope.panel.metrics, metric);
            }
        };

        $scope.updateFlow = function () {
            if ($scope.panel.arrangement === 'horizontal')
                $scope.panel.style['flex-direction'] = 'row';
            else
                $scope.panel.style['flex-direction'] = 'column';

        }

        $scope.get_data = function () {
            delete $scope.panel.error;
            $scope.panelMeta.loading = true;

            // Make sure we have everything for the request to complete
            if (dashboard.indices.length === 0) {
                return;
            }

            // Solr
            $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);
            var request = $scope.sjs.Request().indices(dashboard.indices);
            $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

            // Build the question part of the query
            _.each($scope.panel.queries.ids, function (id) {
                var _q = $scope.sjs.FilteredQuery(
                    querySrv.getEjsObj(id),
                    filterSrv.getBoolFilter(filterSrv.ids));

                request = request
                    .facet($scope.sjs.QueryFacet(id)
                        .query(_q)
                    ).size(0);
            });

            // Populate the inspector panel
            $scope.populate_modal(request);

            //Solr Search Query
            var fq = '';
            if (filterSrv.getSolrFq()) {
                fq = '&' + filterSrv.getSolrFq();
            }

            var stats = '&stats=true';
            _.each($scope.panel.metrics, function(metric) {
                if (metric.field) {
                    stats += '&stats.field=' + metric.field;
                }
            });

            var wt_json = '&wt=json';
            var rows_limit = '&rows=0'; // for hits, we do not need the actual response doc, so set rows=0
            var promises = [];
            $scope.data = [];
            $scope.hits = 0;
            $scope.panel.queries.query = '';

            _.each($scope.panel.queries.ids, function (id) {
                var temp_q = querySrv.getQuery(id) + fq + stats + wt_json + rows_limit;
                $scope.panel.queries.query += temp_q + '\n';
                // Set the additional custom query
                if ($scope.panel.queries.custom !== null) {
                    request = request.setQuery(temp_q + $scope.panel.queries.custom);
                } else {
                    request = request.setQuery(temp_q);
                }
                promises.push(request.doSearch());
            });

            // Populate scope when we have results
            $q.all(promises).then(function (results) {
                _.each(dashboard.current.services.query.ids, function (id, i) {
                    $scope.panelMeta.loading = false;

                    _.each(results[i].stats.stats_fields, function(metricValues, metricField) {
                        _.each($scope.panel.metrics, function(metric) {
                            if (metric.field === metricField) {
                                metric.value = metricValues[metric.type].toFixed(metric.decimalDigits);
                            }
                        });
                    });

                    // Check for error and abort if found
                    if (!(_.isUndefined(results[i].error))) {
                        $scope.panel.error = $scope.parse_error(results[i].error);
                        return;
                    }

                    $scope.updateFlow();
                });
            });
        };

        $scope.set_refresh = function (state) {
            $scope.refresh = state;
        };

        $scope.close_edit = function () {
            // Start refresh timer if enabled
            if ($scope.panel.refresh.enable) {
                $scope.set_timer($scope.panel.refresh.interval);
            }
            if ($scope.refresh) {
                $scope.get_data();
            }
            $scope.refresh = false;
            $scope.updateFlow();
        };

        $scope.populate_modal = function (request) {
            $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
        };
    });
});
