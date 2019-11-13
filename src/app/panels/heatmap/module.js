/*
## HeatMap D3 Panel
*/
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'd3',
    'require',
    'css!./module.css'
],
    function (angular, app, _, $, d3, localRequire) {
        'use strict';

        var module = angular.module('kibana.panels.heatmap', []);
        app.useModule(module);

        module.controller('heatmap', function ($scope, dashboard, querySrv, filterSrv) {
            
            $scope.MIN_ROWS = 1;
            $scope.MAX_ROWS = 100;

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
                status: "Experimental",
                description: "Heat Map for Representing Pivot Facet Counts",
                rotate: true
            };

            var _d = {
                queries: {
                    mode: 'all',
                    ids: [],
                    query: '*:*',
                    custom: ''
                },
                size: 0,
                row_field: '',
                col_field: '',
                row_size: 5,
                color:'gray',
                spyable: true,
                transpose_show: true,
                transposed: false,
                show_queries:true,
            };

            // Set panel's default values
            _.defaults($scope.panel, _d);
            $scope.requireContext = localRequire;

            $scope.init = function () {
                $scope.generated_id = $scope.randomNumberRange(1, 1000000);
                $scope.$on('refresh', function () {
                    $scope.get_data();
                });
                $scope.get_data();
            };

            $scope.randomNumberRange = function(min, max) {
                return Math.floor(Math.random() * (max - min + 1) + min);
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

                request = $scope.sjs.Request();

                request = request.query(
                    $scope.sjs.FilteredQuery(
                        boolQuery,
                        filterSrv.getBoolFilter(filterSrv.ids)
                    ))
                .size($scope.panel.size); // Set the size of query result

                $scope.populate_modal(request);
                // --------------------- END OF ELASTIC SEARCH PART ---------------------------------------

                var fq = '';
                if (filterSrv.getSolrFq()) {
                    fq = '&' + filterSrv.getSolrFq();
                }
                var wt_json = '&wt=json';
                var rows_limit = '&rows=' + $scope.panel.size;
                var facet = '&facet=true';
                var facet_pivot = '&facet.pivot=' + $scope.panel.row_field + ',' + $scope.panel.col_field;
                var facet_limit = '&facet.limit=' + $scope.panel.row_size;
                var facet_pivot_mincount = '&facet.pivot.mincount=0';

                $scope.panel.queries.query = querySrv.getORquery() + fq + wt_json + rows_limit + facet + facet_pivot + facet_limit + facet_pivot_mincount;

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
                    // Check for error and abort if found
                      if(!(_.isUndefined(results.error))) {
                        $scope.panel.error = $scope.parse_error(results.error.msg);
                        $scope.init_arrays();
                        $scope.render();
                        return;
                      }
                    // build $scope.data array
                    var facets = results.facet_counts.facet_pivot;
                    var key = Object.keys(facets)[0];

                    $scope.facets = facets[key];

                    $scope.init_arrays();
                    $scope.formatData($scope.facets, $scope.panel.transposed);

                    $scope.render();
                });
                // Hide the spinning wheel icon
                $scope.panelMeta.loading = false;
            };

            $scope.init_arrays = function() {
                $scope.data = [];
                $scope.row_labels = [];
                $scope.col_labels = [];
                $scope.hcrow = [];
                $scope.hccol = [];
                $scope.internal_sum = [];
                $scope.domain = [Number.MAX_VALUE,0];
                $scope.axis_labels = [$scope.panel.col_field, $scope.panel.row_field];
            };

            $scope.formatData = function(facets, flipped) {
                $scope.init_arrays();

                _.each(facets, function(d, i) {
                    // build the arrays to be used

                    if(!flipped) {
                        $scope.row_labels.push(d.value);
                        $scope.hcrow.push($scope.row_labels.length);
                    } else {
                        $scope.col_labels.push(d.value);
                        $scope.hccol.push($scope.col_labels.length);
                        [$scope.axis_labels[0], $scope.axis_labels[1]] = [$scope.axis_labels[1], $scope.axis_labels[0]];
                    }

                    _.each(d.pivot, function(p) {
                        // columns in each row
                        var entry = {};

                        var v = p.value;
                        var index;

                        if(!flipped) {
                            $scope.internal_sum.push(0);

                            if($scope.col_labels.indexOf(v) === -1) {
                                $scope.col_labels.push(v);
                                $scope.hccol.push($scope.col_labels.length);
                            }

                            index = $scope.col_labels.indexOf(v); // index won't be -1 as we count in the facets with count = 0

                            $scope.internal_sum[index] += p.count;

                            entry.row = i + 1;
                            entry.col = index + 1;
                        } else {
                            if($scope.row_labels.indexOf(v) === -1) {
                                $scope.row_labels.push(v);
                                $scope.hcrow.push($scope.row_labels.length);
                            }

                            index = $scope.row_labels.indexOf(v); // index won't be -1 as we count in the facets with count = 0

                            $scope.internal_sum[index] += p.count;

                            entry.col = i + 1;
                            entry.row = index + 1;
                        }
                        entry.value = p.count;

                        $scope.domain[0] = Math.min($scope.domain[0], p.count);
                        $scope.domain[1] = Math.max($scope.domain[1], p.count);

                        $scope.data.push(entry);
                    });
                });
            };

            $scope.flip = function() {
                $scope.panel.transposed = !$scope.panel.transposed;
                $scope.formatData($scope.facets, $scope.panel.transposed);
                $scope.render();
            };

            $scope.set_refresh = function (state) {
                $scope.refresh = state;
            };

            $scope.close_edit = function () {
                if ($scope.refresh) {
                    $scope.get_data();
                    $scope.formatData($scope.facets, $scope.panel.transposed);
                    $scope.render();
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

            $scope.build_search = function(x, y) {
                if (x && y) {
                  filterSrv.set({type: 'terms', field: $scope.panel.row_field, value: x, mandate: 'must'});
                  filterSrv.set({type: 'terms', field: $scope.panel.col_field, value: y, mandate: 'must'});
                } else {
                  return;
                }
                dashboard.refresh();
              };
        });

        module.directive('heatmapChart', function () {
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

                        var parent_width = element.parent().width(),
                        row_height = parseInt(scope.row.height);

                        const TICK_LENGTH = 10;
                        const MARGIN = 15;
                        const MAX_LABEL_LENGTH = 10;

                        const INTENSITY = 3;

                        const LEGEND = {
                            height: 20,
                            width: parent_width / 2,
                            margin: 10,
                            text_margin: 10,
                            text_height: 15
                        };

                        const labels = {
                            top: 90,
                            left: 120
                        };
                        
                        element.html('<div id="_' + scope.generated_id + '" style="height: 100%"></div>');
                        
                        var data = jQuery.extend(true, [], scope.data); // jshint ignore:line
                        
                        var intensity_domain = d3.scale.linear().domain(scope.domain).range([-INTENSITY, INTENSITY]);
                        
                        data = _.map(data, function(d){
                            return{
                                row: +d.row,
                                col: +d.col,
                                value: +intensity_domain(d.value)
                            };
                        });

                        var svg_width = parent_width,
                            svg_height = row_height,
                            canvas_height = svg_height - labels.top - MARGIN - LEGEND.margin
                                - LEGEND.height - LEGEND.text_margin - LEGEND.text_height,
                            canvas_width = svg_width - labels.left;
                        
                        var rowSortOrder = false,
                            colSortOrder = false;

                        var cell_color = scope.panel.color;

                        var hcrow, hccol, rowLabel, colLabel;
                        // jshint ignore:start
                            hcrow    = jQuery.extend(true, [], scope.hcrow),
                            hccol    = jQuery.extend(true, [], scope.hccol),
                            rowLabel = jQuery.extend(true, [], scope.row_labels),
                            colLabel = jQuery.extend(true, [], scope.col_labels);
                        // jshint ignore:end

                        var cell_width = canvas_width / colLabel.length,
                            cell_height = canvas_height / rowLabel.length,
                            col_number = colLabel.length,
                            row_number = rowLabel.length;

                        var colorScale = (shift) => { return d3.hsl(cell_color).darker(shift).toString(); };

                        var $tooltip = $('<div>');

                        var svg = d3.select("#_" + scope.generated_id).append("svg")
                            .attr("width", "98%")
                            .attr("height", "98%")
                            .append("g");

                        // Row Labels
                        var rowLabels = svg.append("g") // jshint ignore:line
                            .selectAll(".rowLabelg")
                            .data(rowLabel)
                            .enter()
                            .append("text")
                            .text(function (d) {
                                if(d.length > MAX_LABEL_LENGTH) {
                                    return d.substring(0, MAX_LABEL_LENGTH) + '...';
                                } else {
                                    return d;
                                }
                            })
                            .attr("x", 0)
                            .attr("y", function (d, i) {
                                return labels.top + MARGIN + hcrow.indexOf(i + 1) * cell_height;
                            })
                            .attr("transform", "translate(25, " + cell_height / 2 + ")")
                            .attr("alignment-baseline", "middle")
                            .attr("class", function () {
                                return "rowLabel_" + scope.generated_id + " axis-label";
                            })
                            .on("mouseover", function (d) {
                                d3.select(this).classed("text-hover", true);
                                $tooltip.html(d).place_tt(d3.event.pageX, d3.event.pageY);
                            })
                            .on("mouseout", function () {
                                d3.select(this).classed("text-hover", false);

                                d3.select(this).classed("cell-hover", false);
                                d3.selectAll(".rowLabel_" + scope.generated_id).classed("text-highlight", false);
                                d3.selectAll(".colLabel_" + scope.generated_id).classed("text-highlight", false);

                                $tooltip.detach();
                            })
                            .on("click", function (d, i) {
                                rowSortOrder = !rowSortOrder;
                                sortbylabel("r", i, rowSortOrder);
                            });

                        svg.append("text")
                            .attr("x", 0)
                            .attr("y", 0)
                            .text(scope.axis_labels[1])
                            .attr("transform", "translate(10, " + svg_height / 2 + ") rotate(-90)")
                            .attr("class", "axis-label");                            

                        // Column labels
                        var colLabels = svg.append("g") // jshint ignore:line
                            .selectAll(".colLabelg")
                            .data(colLabel)
                            .enter()
                            .append("text")
                            .text(function (d) {
                                if(d.length > MAX_LABEL_LENGTH) {
                                    return d.substring(0, MAX_LABEL_LENGTH) + '...';
                                } else {
                                    return d;
                                }
                            })
                            .attr("x", -labels.top)
                            .attr("y", function (d, i) {
                                return 100 + hccol.indexOf(i + 1) * cell_width;
                            })
                            .attr("text-anchor", "start")
                            .attr("alignment-baseline", "middle")
                            .attr("transform", "translate(" + cell_width / 2 + ", 0) rotate (-90)")
                            .attr("class", function () {
                                return "colLabel_" + scope.generated_id + " axis-label";
                            })
                            .on("mouseover", function (d) {
                                d3.select(this).classed("text-hover", true);

                                $tooltip.html(d).place_tt(d3.event.pageX, d3.event.pageY);
                            })
                            .on("mouseout", function () {
                                d3.select(this).classed("text-hover", false);

                                d3.select(this).classed("cell-hover", false);
                                d3.selectAll(".rowLabel_" + scope.generated_id).classed("text-highlight", false);
                                d3.selectAll(".colLabel_" + scope.generated_id).classed("text-highlight", false);

                                $tooltip.detach();
                            })
                            .on("click", function (d, i) {
                                colSortOrder = !colSortOrder;
                                sortbylabel("c", i, colSortOrder);
                            });

                        svg.append("text")
                            .attr("x", 0)
                            .attr("y", 0)
                            .text(scope.axis_labels[0])
                            .attr("transform", "translate(" + svg_width / 2 + ", 10)")
                            .attr("class", "axis-label");

                        // Heatmap component
                        var heatMap = svg.append("g"); // jshint ignore:line
                        
                        heatMap.attr("transform", "translate(100, " + (labels.top + MARGIN) + ")")
                            .selectAll(".cellg")
                            .data(data, function (d) {
                                return d.row + ":" + d.col;
                            })
                            .enter()
                            .append("rect")
                            .attr("x", function (d) {
                                return hccol.indexOf(d.col) * cell_width;
                            })
                            .attr("y", function (d) {
                                return hcrow.indexOf(d.row) * cell_height;
                            })
                            .attr("class", function (d) {
                                return "cell_" + scope.generated_id  +  " cell-border cr" + (d.row - 1) + "_" + scope.generated_id + " cc" + (d.col - 1) + "_" + scope.generated_id;
                            })
                            .attr("width", cell_width)
                            .attr("height", cell_height)
                            .style("fill", function (d) {
                                return colorScale(d.value);
                            })
                            .on("mouseover", function (d, i) {
                                //highlight text
                                d3.select(this).classed("cell-hover", true);
                                d3.selectAll(".rowLabel_" + scope.generated_id).classed("text-highlight", function (r, ri) {
                                    return ri === (d.row - 1);
                                });
                                d3.selectAll(".colLabel_" + scope.generated_id).classed("text-highlight", function (c, ci) {
                                    return ci === (d.col - 1);
                                });

                                $tooltip.html(rowLabel[d.row - 1] + ", " + colLabel[d.col - 1] + " (" + scope.data[i].value + ")").place_tt(d3.event.pageX, d3.event.pageY);
                            })
                            .on("mouseout", function () {
                                d3.select(this).classed("cell-hover", false);
                                d3.selectAll(".rowLabel_" + scope.generated_id).classed("text-highlight", false);
                                d3.selectAll(".colLabel_" + scope.generated_id).classed("text-highlight", false);

                                $tooltip.detach();
                            })
                            .on("click", (d) => {
                                d3.select(this).classed("cell-hover", false);
                                $tooltip.detach();
                                scope.build_search(rowLabel[d.row - 1], colLabel[d.col - 1]);
                            });

                        // Grid
                        heatMap.append("g")
                            .selectAll(".gridgv")
                            .data(d3.range(hccol.length + 1))
                            .enter()
                            .append("line")
                            .attr("x1", (d) => {
                                return d * cell_width;
                            })
                            .attr("y1", 0)
                            .attr("x2", (d) => {
                                return d * cell_width;
                            })
                            .attr("y2", hcrow.length * cell_height)
                            .attr("class", "grid");

                        heatMap.append("g")
                            .selectAll(".gridgh")
                            .data(d3.range(hcrow.length + 1))
                            .enter()
                            .append("line")
                            .attr("x1", 0)
                            .attr("y1", (d) => {
                                return d * cell_height;
                            })
                            .attr("x2", hccol.length * cell_width)
                            .attr("y2", (d) => {
                                return d * cell_height;
                            })
                            .attr("class", "grid");

                        // Column ticks
                        heatMap.append("g") // jshint ignore:line
                            .selectAll(".colLabelg")
                            .data(colLabel)
                            .enter()
                            .append("line")
                            .attr("x1", 0)
                            .attr("y1", 0)
                            .attr("x2", 0)
                            .attr("y2", TICK_LENGTH)
                            .attr("transform", (d, i) => {
                                return "translate(" + (hccol.indexOf(i + 1) * cell_width + cell_width / 2) + ", -5)";
                            })
                            .attr("class", "tick");

                        // Row ticks
                        heatMap.append("g") // jshint ignore:line
                            .selectAll(".rowLabelg")
                            .data(rowLabel)
                            .enter()
                            .append("line")
                            .attr("x1", 0)
                            .attr("y1", 0)
                            .attr("x2", 0)
                            .attr("y2", TICK_LENGTH)
                            .attr("transform", (d, i) => {
                                return "translate(5, " + (hcrow.indexOf(i + 1) * cell_height + cell_height / 2) + ") rotate (90)";
                            })
                            .attr("class", "tick");

                        // Legend
                        var linearGradient = svg.append("defs").append("linearGradient")
                            .attr("id", "legendGradient_" + scope.generated_id);

                        linearGradient.append("stop")
                           .attr("offset", "0%")
                           .attr("stop-color", colorScale(-INTENSITY));

                        linearGradient.append("stop")
                           .attr("offset", "50%")
                           .attr("stop-color", colorScale(0));

                        linearGradient.append("stop")
                           .attr("offset", "100%")
                           .attr("stop-color", colorScale(INTENSITY));

                        var legend = svg.append("svg");
                        legend.attr("x", parseInt((svg_width - LEGEND.width) / 2))
                            .attr("y", svg_height - LEGEND.margin - LEGEND.height - LEGEND.text_height).append("g"); 

                        legend.append("rect")
                            .attr("width", LEGEND.width)
                            .attr("height", LEGEND.height)
                            .attr("fill", "url('#legendGradient_" + scope.generated_id + "')");
                            
                        legend.append("g")
                            .selectAll(".legendt")
                            .data(d3.range(11))
                            .enter()
                            .append("line")
                            .attr("x1", (d) => {
                                return parseInt(d * LEGEND.width / 10);
                            })
                            .attr("y1", LEGEND.height - TICK_LENGTH)
                            .attr("x2", (d) => {
                                return parseInt(d * LEGEND.width / 10);
                            })
                            .attr("y2", LEGEND.height)
                            .attr("class", "tick");

                        legend.append("g")
                            .selectAll(".legendl")
                            .data(d3.range(11))
                            .enter()
                            .append("text")
                            .attr("x", (d) => {
                                return parseInt(d * LEGEND.width / 10);
                            })
                            .attr("y", parseInt(LEGEND.height + 15))
                            .text((d) => {
                                return Math.round(scope.domain[0] + (scope.domain[1] - scope.domain[0]) / 10 * d);
                            })
                            .attr("text-anchor", "middle")
                            .attr("class", "axis-label");

                        // Function to sort the cells with respect to selected row or column
                        function sortbylabel(rORc, i, sortOrder) {
                            // rORc .. r for row, c for column
                            var t = svg.transition().duration(1200);

                            var values = []; // holds the values in this specific row
                            for(var j = 0; j < col_number; j++) { values.push(-Infinity); }

                            var sorted; // sorted is zero-based index
                            d3.selectAll(".c" + rORc + i + "_" + scope.generated_id)
                            .filter(function (ce) {
                                if(rORc === "r") {
                                    values[ce.col - 1] = ce.value;
                                } else {
                                    values[ce.row - 1] = ce.value;
                                }
                            });
                            if (rORc === "r") { // sorting by rows
                                // can't be col_number
                                // must select from already there coluns (rows)
                                sorted = d3.range(col_number).sort(function (a, b) {
                                    var value;
                                    if (sortOrder) {
                                        value = values[b] - values[a];
                                        value = isNaN(value) ? Infinity : value;
                                    } else {
                                        value = values[a] - values[b];
                                        value = isNaN(value) ? Infinity : value;
                                    }
                                    return value;
                                });

                                t.selectAll(".cell_" + scope.generated_id)
                                .attr("x", function (d) {
                                    return sorted.indexOf(d.col - 1) * cell_width;
                                });
                                t.selectAll(".colLabel_" + scope.generated_id)
                                .attr("y", function (d, i) {
                                    return 100 + sorted.indexOf(i) * cell_width;
                                });
                            } else { // sorting by columns
                                sorted = d3.range(row_number).sort(function (a, b) {
                                    var value;
                                    if (sortOrder) {
                                        value = values[b] - values[a];
                                        value = isNaN(value) ? Infinity : value;
                                    } else {
                                        value = values[a] - values[b];
                                        value = isNaN(value) ? Infinity : value;
                                    }
                                    return value;
                                });
                                t.selectAll(".cell_" + scope.generated_id)
                                .attr("y", function (d) {
                                    return sorted.indexOf(d.row - 1) * cell_height;
                                });
                                t.selectAll(".rowLabel_" + scope.generated_id)
                                .attr("y", function (d, i) {
                                    return labels.top + MARGIN + sorted.indexOf(i) * cell_height;
                                });
                            }
                        }
                    }
                }
            };
        });
    });