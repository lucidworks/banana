/*

  ## Multiseries Panel

*/
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'd3',
], function(angular, app, _, $, d3) {
    'use strict';

    var module = angular.module('kibana.panels.scatterplot', []);
    app.useModule(module);

    module.controller('scatterplot', function($scope, dashboard, querySrv, filterSrv) {
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
            status: "Experimental",
            description: "This panel help user to plot scatter plot between two variables"
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
            field: 'date',
            xAxis: 'Date',
            yAxis: 'Rates',
            fl: 'open,high,low,close',
            rightAxis: 'volume', // TODO: need to remove hard coded field (volume).
            spyable: true,
            show_queries:true,
        };

        _.defaults($scope.panel, _d);


        $scope.init = function() {
            $scope.$on('refresh', function() {
                $scope.get_data();
            });
            $scope.get_data();
        };

        $scope.get_data = function() {
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
            _.each($scope.panel.queries.ids, function(id) {
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
            if (filterSrv.getSolrFq() && filterSrv.getSolrFq() != '') {
                fq = '&' + filterSrv.getSolrFq();
            }
            var wt_json = '&wt=csv';
            var fl = '&fl=' + $scope.panel.xaxis + ',' + $scope.panel.yaxis + ',' + $scope.panel.field_type;
            var rows_limit = '&rows=' + $scope.panel.max_rows;
            //var sort = '&sort=' + $scope.panel.field + ' asc';

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
            results.then(function(results) {
                // build $scope.data array
                //$scope.data = results.response.docs;
                $scope.data = d3.csv.parse(results);
                if($scope.data.length == 0) {
                    $scope.panel.error = $scope.parse_error("There's no data to show");
                }
                // $scope.data = results;
                $scope.render();
            });

            // Hide the spinning wheel icon
            $scope.panelMeta.loading = false;
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

        $scope.populate_modal = function(request) {
            $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
        };

        $scope.pad = function(n) {
            return (n < 10 ? '0' : '') + n;
        };

    });

    module.directive('scatterplot', function() {
        return {
            restrict: 'E',
            link: function(scope, element) {

                scope.$on('render', function() {
                    render_panel();
                });

                angular.element(window).bind('resize', function() {
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

                    var x = d3.scale.linear()
                        .range([0, width - padding * 2]);

                    var y = d3.scale.linear()
                        .range([height, 0]);

                    var color = d3.scale.category10();

                    var xAxis = d3.svg.axis()
                        .scale(x)
                        .orient("bottom");

                    var yAxis = d3.svg.axis()
                        .scale(y)
                        .orient("left");

                    var svg = d3.select(el).append("svg")
                        .attr("width", width + margin.left + margin.right)
                        .attr("height", height + margin.top + margin.bottom)
                        .attr("viewBox", "0 0 " + parent_width + " " + (height + margin.top))
                        .attr("preserveAspectRatio", "xMidYMid")
                        .append("g")
                        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
                    // add the tooltip area to the webpage
                    var $tooltip = $('<div>');

                    scope.data.forEach(function(d) {
                        d[scope.panel.yaxis] = +d[scope.panel.yaxis];
                        d[scope.panel.xaxis] = +d[scope.panel.xaxis];
                    });

                    x.domain(d3.extent(scope.data, function(d) {
                        return d[scope.panel.xaxis];
                    })).nice();
                    y.domain(d3.extent(scope.data, function(d) {
                        return d[scope.panel.yaxis];
                    })).nice();

                    svg.append("g")
                        .attr("class", "x axis")
                        .attr("transform", "translate(0," + height + ")")
                        .call(xAxis)
                        .append("text")
                        .attr("class", "label")
                        .attr("transform", "translate(" + ((width / 2) - margin.left) + " ," + 30+ ")")
                        .style("text-anchor", "middle")
                        .text(scope.panel.xaxis);

                    svg.append("g")
                        .attr("class", "y axis")
                        .call(yAxis)
                        .append("text")
                        .attr("class", "label")
                        .attr("transform", "rotate(-90)")
                        .attr("y", 0 - margin.left)
                        .attr("x",0 - ((height-margin.top-margin.bottom) / 2))
                        .attr("dy", ".71em")
                        .style("text-anchor", "end")
                        .text(scope.panel.yaxis);

                    svg.selectAll(".dot")
                        .data(scope.data)
                        .enter().append("circle")
                        .attr("class", "dot")
                        .attr("r", 3.5)
                        .attr("cx", function(d) {
                            return x(d[scope.panel.xaxis]);
                        })
                        .attr("cy", function(d) {
                            return y(d[scope.panel.yaxis]);
                        })
                        .style("fill", function(d) {
                            return color(d[scope.panel.field_type]);
                        }).on("mouseover", function(d) {
                            var field_type = d[scope.panel.field_type] ? d[scope.panel.field_type] : "";
                            $tooltip
                                .html('<i class="icon-circle" style="color:' + color(d[scope.panel.field_type]) + ';"></i>' + ' ' +
                                    field_type + " (" + d[scope.panel.xaxis] + ", " + d[scope.panel.yaxis] + ")<br>")
                                .place_tt(d3.event.pageX, d3.event.pageY);
                        })
                        .on("mouseout", function() {
                            $tooltip.detach();
                        });
                    if (scope.panel.field_type) {
                        var legend = svg.selectAll(".legend")
                            .data(color.domain())
                            .enter().append("g")
                            .attr("class", "legend")
                            .attr("transform", function(d, i) {
                                return "translate(0," + i * 20 + ")";
                            });
                        legend.append("text")
                            .attr("x", width - 24)
                            .attr("y", 9)
                            .attr("dy", ".35em")
                            .style("text-anchor", "end")
                            .text(function(d) {
                                return d;
                            });

                        legend.append("rect")
                            .attr("x", width - 18)
                            .attr("width", 18)
                            .attr("height", 18)
                            .style("fill", color);


                    }

                }
            }
        };
    });
});