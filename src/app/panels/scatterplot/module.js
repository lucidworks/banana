/*

 ## Scatterplot Panel

 */
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'd3',
], function (angular, app, _, $, d3) {
    'use strict';

    var module = angular.module('kibana.panels.scatterplot', []);
    app.useModule(module);

    module.controller('scatterplot', function ($scope, $timeout, timer, dashboard, querySrv, filterSrv) {
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
            description: "This panel helps you to plot a bubble scatterplot between two to four variables."
        };

        // default values
        var _d = {
            queries: {
                mode: 'all',
                ids: [],
                query: '*:*',
                custom: ''
            },
            max_rows: 1000, // maximum number of rows returned from Solr
            xaxis: '',
            yaxis: '',
            xaxisLabel: '',
            yaxisLabel: '',
            colorField: '',
            bubbleSizeField: '',
            spyable: true,
            show_queries: true,
            refresh: {
                enable: false,
                interval: 2
            }
        };

        _.defaults($scope.panel, _d);

        $scope.init = function () {
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

        $scope.get_data = function () {
            // Show progress by displaying a spinning wheel icon on panel
            $scope.panelMeta.loading = true;
            delete $scope.panel.error;

            var request, results;
            // Set Solr server
            $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

            // -------------------- TODO: REMOVE ALL ELASTIC SEARCH AFTER FIXING SOLRJS --------------
            $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
            // This could probably be changed to a BoolFilter
            var boolQuery = $scope.sjs.BoolQuery();
            _.each($scope.panel.queries.ids, function (id) {
                boolQuery = boolQuery.should(querySrv.getEjsObj(id));
            });
            request = $scope.sjs.Request().indices(dashboard.indices);
            request = request.query(
                $scope.sjs.FilteredQuery(
                    boolQuery,
                    filterSrv.getBoolFilter(filterSrv.ids)
                ))
                .size($scope.panel.max_rows); // Set the size of query result
            $scope.populate_modal(request);
            // --------------------- END OF ELASTIC SEARCH PART ---------------------------------------

            // Construct Solr query
            var fq = '';
            if (filterSrv.getSolrFq()) {
                fq = '&' + filterSrv.getSolrFq();
            }
            var wt_json = '&wt=csv';
            var rows_limit = '&rows=' + $scope.panel.max_rows;
            var fl = '&fl=' + $scope.panel.xaxis + ',' + $scope.panel.yaxis;

            if ($scope.panel.colorField) {
                fl += ',' + $scope.panel.colorField;
            }

            if ($scope.panel.bubbleSizeField) {
                fl += ',' + $scope.panel.bubbleSizeField;
            }

            $scope.panel.queries.query = querySrv.getORquery() + fq + fl + wt_json + rows_limit;

            // Set the additional custom query
            if ($scope.panel.queries.custom != null) {
                request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
            } else {
                request = request.setQuery($scope.panel.queries.query);
            }

            // Execute the search and get results
            results = request.doSearch();

            // Populate scope when we have results
            results.then(function (results) {
                // build $scope.data array
                $scope.data = d3.csv.parse(results, function (d) {
                    var value = {};
                    // Convert string to number
                    value[$scope.panel.xaxis] = +d[$scope.panel.xaxis];
                    value[$scope.panel.yaxis] = +d[$scope.panel.yaxis];
                    if ($scope.panel.colorField) {
                        value[$scope.panel.colorField] = d[$scope.panel.colorField];
                    }
                    if ($scope.panel.bubbleSizeField) {
                        value[$scope.panel.bubbleSizeField] = +d[$scope.panel.bubbleSizeField];
                    }

                    return value;
                }, function(error, rows) {
                    console.log('Error parsing results from Solr: ', rows);
                });

                if ($scope.data.length === 0) {
                    $scope.panel.error = $scope.parse_error("There's no data to show");
                }

                $scope.render();
            });

            // Hide the spinning wheel icon
            $scope.panelMeta.loading = false;
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
            $scope.$emit('render');
        };

        $scope.render = function () {
            $scope.$emit('render');
        };

        $scope.populate_modal = function (request) {
            $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
        };

        $scope.pad = function (n) {
            return (n < 10 ? '0' : '') + n;
        };
    });

    module.directive('scatterplot', function (dashboard, filterSrv) {
        return {
            restrict: 'E',
            link: function (scope, element) {

                scope.$on('render', function () {
                    render_panel();
                });

                angular.element(window).bind('resize', function () {
                    render_panel();
                });

                // Function for rendering panel
                function render_panel() {
                    element.html("");
                    var el = element[0];
                    var parent_width = element.parent().width(),
                        height = parseInt(scope.row.height),
                        padding = 50;
                    var margin = {
                            top: 20,
                            right: 20,
                            bottom: 100,
                            left: 50
                        },
                        width = parent_width - margin.left - margin.right;

                    height = height - margin.top - margin.bottom;

                    // Scales
                    var color = d3.scale.category20();
                    var rScale;
                    if (scope.panel.bubbleSizeField) {
                        rScale = d3.scale.linear()
                            .domain(d3.extent(scope.data, function (d) {
                                return d[scope.panel.bubbleSizeField];
                            }))
                            .range([3, 20])
                            .nice();
                    }
                    var x = d3.scale.linear()
                        .range([0, width - padding * 2]);
                    var y = d3.scale.linear()
                        .range([height, 0]);

                    x.domain(d3.extent(scope.data, function (d) {
                        return d[scope.panel.xaxis];
                    })).nice();

                    y.domain(d3.extent(scope.data, function (d) {
                        return d[scope.panel.yaxis];
                    })).nice();

                    var svg = d3.select(el).append("svg")
                        .attr("width", width + margin.left + margin.right)
                        .attr("height", height + margin.top + margin.bottom)
                        .attr("viewBox", "0 0 " + parent_width + " " + (height + margin.top + margin.bottom))
                        .attr("preserveAspectRatio", "xMidYMid")
                        .append("g")
                        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

                    // add the tooltip area to the webpage
                    var $tooltip = $('<div>');

                    // Bubble
                    svg.selectAll(".dot")
                        .data(scope.data)
                        .enter().append("circle")
                        .attr("class", "dot")
                        .attr("r", function (d) {
                            if (scope.panel.bubbleSizeField) {
                                return rScale(d[scope.panel.bubbleSizeField]);
                            } else {
                                return 3;
                            }
                        })
                        .attr("cx", function (d) {
                            return x(d[scope.panel.xaxis]);
                        })
                        .attr("cy", function (d) {
                            return y(d[scope.panel.yaxis]);
                        })
                        .style("fill", function (d) {
                            return color(d[scope.panel.colorField]);
                        })
                        .on("mouseover", function (d) {
                            var colorField = d[scope.panel.colorField] ? d[scope.panel.colorField] : "";
                            $tooltip
                                .html('<i class="icon-circle" style="color:' + color(d[scope.panel.colorField]) + ';"></i>' + ' ' +
                                    colorField + " (" + d[scope.panel.xaxis] + ", " + d[scope.panel.yaxis] + ")<br>")
                                .place_tt(d3.event.pageX, d3.event.pageY);
                        })
                        .on("mouseout", function () {
                            $tooltip.detach();
                        })
                        .on("click", function (d) {
                            if (scope.panel.colorField) {
                                filterSrv.set({
                                    type: 'terms',
                                    field: scope.panel.colorField,
                                    value: d[scope.panel.colorField],
                                    mandate: 'must'
                                });
                                $tooltip.detach();
                                dashboard.refresh();
                            }
                        });

                    if (scope.panel.colorField) {
                        var legend = svg.selectAll(".legend")
                            .data(color.domain())
                            .enter().append("g")
                            .attr("class", "legend")
                            .attr("transform", function (d, i) {
                                return "translate(0," + i * 20 + ")";
                            })
                            .on("mouseover", function () {
                                el.style.cursor = 'pointer';
                            })
                            .on("mouseout", function () {
                                el.style.cursor = 'auto';
                            })
                            .on("click", function (d) {
                                filterSrv.set({
                                    type: 'terms',
                                    field: scope.panel.colorField,
                                    value: d,
                                    mandate: 'must'
                                });

                                el.style.cursor = 'auto';
                                dashboard.refresh();
                            });
                        legend.append("text")
                            .attr("x", width - 24)
                            .attr("y", 9)
                            .attr("dy", ".35em")
                            .style("text-anchor", "end")
                            .text(function (d) {
                                return d;
                            });
                        legend.append("rect")
                            .attr("x", width - 18)
                            .attr("width", 18)
                            .attr("height", 18)
                            .style("fill", color);
                    }

                    // Axis
                    var xAxis = d3.svg.axis()
                        .scale(x)
                        .orient("bottom");
                    var yAxis = d3.svg.axis()
                        .scale(y)
                        .orient("left");

                    // X-axis label
                    var xaxisLabel = '';
                    if (scope.panel.xaxisLabel) {
                        xaxisLabel = scope.panel.xaxisLabel;
                    } else {
                        xaxisLabel = scope.panel.xaxis;
                    }

                    svg.append("g")
                        .attr("class", "x axis")
                        .attr("transform", "translate(0," + height + ")")
                        .call(xAxis)
                        .append("text")
                        .attr("class", "label")
                        .attr("transform", "translate(" + ((width / 2) - margin.left) + " ," + 30 + ")")
                        .style("text-anchor", "middle")
                        .text(xaxisLabel);

                    // Y-axis label
                    var yaxisLabel = '';
                    if (scope.panel.yaxisLabel) {
                        yaxisLabel = scope.panel.yaxisLabel;
                    } else {
                        yaxisLabel = scope.panel.yaxis;
                    }

                    svg.append("g")
                        .attr("class", "y axis")
                        .call(yAxis)
                        .append("text")
                        .attr("class", "label")
                        .attr("transform", "rotate(-90)")
                        .attr("y", 0 - margin.left)
                        .attr("x", 0 - ((height - margin.top - margin.bottom) / 2))
                        .attr("dy", ".71em")
                        .style("text-anchor", "end")
                        .text(yaxisLabel);
                }
            }
        };
    });
});
