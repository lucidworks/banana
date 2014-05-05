/*

  ## Multiseries

*/
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'd3'
], function (angular, app, _, $, d3) {
    'use strict';

    var module = angular.module('kibana.panels.multiseries', []);
    app.useModule(module);

    var DEBUG = true; //still in debug mode

    module.controller('multiseries', function ($scope, dashboard, querySrv, filterSrv) {
        $scope.panelMeta = {
            modals: [
                {
                    description: "Inspect",
                    icon: "icon-info-sign",
                    partial: "app/partials/inspector.html",
                    show: $scope.panel.spyable
                }
            ],
            editorTabs: [
                {
                    title: 'Queries',
                    src: 'app/partials/querySelect.html'
                }
            ],
            status: "Beta",
            description: "Using D3 for visualizing data"
        };

        // default values
        var _d = {
            queries: {
                mode: 'all',
                ids: [],
                query: '*:*',
                custom: ''
            },
            size: 1000,
            spyable: true
        };

        _.defaults($scope.panel, _d);

        $scope.init = function () {
            $scope.$on('refresh', function () {
                $scope.get_data();
            });
            $scope.get_data();
        };

        $scope.get_data = function () {
//            $scope.data = [1, 2, 3, 4]; // just dummy data

            // Show progress by displaying a spinning wheel icon on panel
            $scope.panelMeta.loading = true;

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

            request = $scope.sjs.Request();

            request = request.query(
                $scope.sjs.FilteredQuery(
                    boolQuery,
                    filterSrv.getBoolFilter(filterSrv.ids)
                ))
                .size($scope.panel.size); // Set the size of query result

            $scope.populate_modal(request);

            if (DEBUG) {
                console.log('multiseries:\n\trequest=', request, '\n\trequest.toString()=', request.toString());
            }
            // --------------------- END OF ELASTIC SEARCH PART ---------------------------------------

            // Construct Solr query
            // ...

//            var fq = '&' + filterSrv.getSolrFq();
            var fq = '';
            var wt_json = '&wt=json';
            var rows_limit = '&rows=' + $scope.panel.size;

            $scope.panel.queries.query = querySrv.getQuery(0) + fq + wt_json + rows_limit;

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
                
                $scope.data = results.response.docs;

                $scope.render();
            });

            // Hide the spinning wheel icon
            $scope.panelMeta.loading = false;
        };

        $scope.set_refresh = function (state) {
            $scope.refresh = state;
        };

        $scope.close_edit = function () {
            if ($scope.refresh) {
                $scope.get_data();
            }
            $scope.refresh = false;
            $scope.$broadcast('render');
        };

        $scope.render = function () {
            $scope.$broadcast('render');
        };

        $scope.populate_modal = function (request) {
            $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
        };

        module.directive('multiseriesChart', function () {
            return {
                restrict: 'E',
                link: function (scope, element) {

                    scope.$on('render', function () {
                        render_panel();
                    });

                    // Function for rendering panel
                    function render_panel() {
                        var el = element[0];
                        var data = scope.data;
                        
                        var margin = {top: 20,right: 80,bottom: 30,left: 50},
                            width = 960 - margin.left - margin.right,
                            height = 500 - margin.top - margin.bottom;
                        
                        // d3 stuffs
                        var x = d3.time.scale().range([0, width]);
                        var y = d3.scale.linear().range([height, 0]);
                        
                        var color = d3.scale.category10();
                        var xAxis = d3.svg.axis().scale(x).orient("bottom");
                        var yAxis = d3.svg.axis().scale(y).orient("left");
                        
                        var line = d3.svg.line()
                            .interpolate("basis")
                            .x(function(d) { return x(d.date); })
                            .y(function(d) { return y(d.temperature); });
                        var hasSvg = d3.select(el).select("svg");
                        
                        var svg = d3.select(el).append("svg")
                            .attr("width", width + margin.left + margin.right)
                            .attr("height", height + margin.top + margin.bottom)
                            .append("g")
                            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
                        
                        color.domain(d3.keys(data[0]).filter(function(key) { return (key !== "date" && key !== "_id"); }));
                        
                        var parseDate = d3.time.format("%Y%m%d");
                        
                        data.forEach(function(d) {
                            d.date = parseDate.parse(String(d.date));
                        });
                        
                        var cities = color.domain().map(function(name) {
                            return {
                                name: name,
                                values: data.map(function(d) {
                                return {date: d.date, temperature: +d[name]};
                                })
                            };
                        });
                        
                        x.domain(d3.extent(data, function(d) { return d.date; }));

                        y.domain([
                            d3.min(cities, function(c) { return d3.min(c.values, function(v) { return v.temperature; }); }),
                            d3.max(cities, function(c) { return d3.max(c.values, function(v) { return v.temperature; }); })
                        ]);
                        
                        svg.append("g")
                           .attr("class", "x axis")
                           .attr("transform", "translate(0," + height + ")")
                           .call(xAxis);                        
                        
                        svg.append("g")
                           .attr("class", "y axis")
                           .call(yAxis)
                           .append("text")
                           .attr("transform", "rotate(-90)")
                           .attr("y", 6)
                           .attr("dy", ".71em")
                           .style("text-anchor", "end")
                           .text("Temperature (ºF)");
                        
                        var city = svg.selectAll(".city")
                                      .data(cities)
                                      .enter().append("g")
                                      .attr("class", "city");

                        city.append("path")
                            .attr("class", "line")
                            .attr("d", function(d) { return line(d.values); })
                            .style("stroke", function(d) { return color(d.name); })
                            .style("fill", "transparent");
                        
                        city.append("text")
                            .datum(function(d) { return {name: d.name, value: d.values[d.values.length - 1]}; })
                            .attr("transform", function(d) { return "translate(" + x(d.value.date) + "," + y(d.value.temperature) + ")"; })
                            .attr("x", 3)
                            .attr("dy", ".35em")
                            .text(function(d) { return d.name; });
                    }

//                    render_panel();
                }
            };

        });

    });
});