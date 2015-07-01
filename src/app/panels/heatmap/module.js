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
],
    function (angular, app, _, $, d3, localRequire) {
        'use strict';

        var module = angular.module('kibana.panels.heatmap', []);
        app.useModule(module);

        module.controller('heatmap', function ($scope, dashboard, querySrv, filterSrv) {
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
                row_field: 'start_station_name',
                col_field: 'gender',
                row_size: 300,
                editor_size: 0,
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
                $scope.panel.editor_size = $scope.panel.row_size;
                $scope.generated_id = "tooltip_" + $scope.randomNumberRange(1,1000000);
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
                var valid = $scope.validateLimit();
                if (valid && $scope.refresh) {
                    $scope.panel.row_size = $scope.panel.editor_size;
                    $scope.get_data();
                    $scope.formatData($scope.facets, $scope.panel.transposed);
                    $scope.render();
                } else if (!valid) {
                    alert('invalid rows number');
                }
                $scope.refresh = false;
            };

            $scope.render = function () {
                $scope.$emit('render');
            };

            $scope.populate_modal = function (request) {
                $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
            };

            $scope.validateLimit = function() {
                var el = $('#rows_limit');
                var min = +el.attr('min');
                var max = +el.attr('max');
                var value = +el.attr('value');

                var valid = value >= min && value <= max;

                if(!valid) {
                    el.attr('value', $scope.panel.row_size);
                }

                return valid;
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
                        element.html('<div id="' + scope.generated_id +'" class="popup hidden"><p><span id="value"></p></div>');
                        var el = element[0];

                        var data = jQuery.extend(true, [], scope.data); // jshint ignore:line

                        var labels_columns = [];
                        var intensity_domain = d3.scale.linear().domain(scope.domain).range([0,10]);

                        _.each(scope.internal_domain, function(d){
                            var d_range = d3.scale.linear().domain(d).range([0,10]);
                            labels_columns.push(d_range);
                        });

                        data = _.map(data, function(d){
                            return{
                                row: +d.row,
                                col: +d.col,
                                value: +intensity_domain(d.value)
                            };
                        });

                        var margin = {
                            top: 70,
                            right: 10,
                            bottom: 20,
                            left: 100
                        };

                        var rowSortOrder = false,
                            colSortOrder = false;

                        var brightrange = d3.scale.linear().domain([0,300]).range([0,3]),
                            colr_domain = d3.range(11),
                            otherRange  = d3.scale.linear().domain([0,10]).range([-255,255]); // we have 255 intensities for a color range

                        var cell_color = scope.panel.color;

                        function color(shift) {
                            if (shift >= 0) {return d3.hsl(cell_color).darker(brightrange(shift));}
                            else {return d3.hsl(cell_color).brighter(brightrange(-shift));}
                        }

                        var hcrow, hccol, rowLabel, colLabel;
                        // jshint ignore:start
                            hcrow    = jQuery.extend(true, [], scope.hcrow),
                            hccol    = jQuery.extend(true, [], scope.hccol),
                            rowLabel = jQuery.extend(true, [], scope.row_labels),
                            colLabel = jQuery.extend(true, [], scope.col_labels);
                        // jshint ignore:end

                        var cellSize = 15,
                            col_number = colLabel.length,
                            row_number = rowLabel.length,
                            width = cellSize * col_number,
                            height = cellSize * row_number;

                        var colors = [];

                        _.each(colr_domain, function(n){
                            colors.push(color(otherRange(n)).toString());
                        });

                        var colorScale   = d3.scale.quantile().domain([0, 10]).range(colors);

                        var $tooltip = $('<div>');

                        var svg = d3.select(el).append("svg")
                            .attr("width", width + margin.left + margin.right)
                            .attr("height", height + margin.top + margin.bottom)
                            .append("g")
                            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

                        // Row Labels
                        var rowLabels = svg.append("g") // jshint ignore:line
                            .selectAll(".rowLabelg")
                            .data(rowLabel)
                            .enter()
                            .append("text")
                            .text(function (d) {
                                if(d.length > 8) {
                                    return d.substring(0,8)+'..';
                                } else {
                                    return d;
                                }
                            })
                            .attr("x", 0)
                            .attr("y", function (d, i) {
                                return hcrow.indexOf(i + 1) * cellSize;
                            })
                            .style("text-anchor", "end")
                            .attr("transform", "translate(-6," + cellSize / 1.5 + ")")
                            .attr("class", function (d, i) {
                                return "rowLabel_" + scope.generated_id + " mono r" + i;
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

                        // Column labels
                        var colLabels = svg.append("g") // jshint ignore:line
                            .selectAll(".colLabelg")
                            .data(colLabel)
                            .enter()
                            .append("text")
                            .text(function (d) {
                                if(d.length > 6) {
                                    return d.substring(0,6)+'..';
                                } else {
                                    return d;
                                }
                            })
                            .attr("x", 0)
                            .attr("y", function (d, i) {
                                return hccol.indexOf(i + 1) * cellSize;
                            })
                            .style("text-anchor", "left")
                            .attr("transform", "translate(" + cellSize / 2 + ",-6) rotate (-90)")
                            .attr("class", function (d, i) {
                                return "colLabel_" + scope.generated_id + " mono c" + i;
                            })
                            .on("mouseover", function (d) {
                                d3.select(this).classed("text-hover", true);

                                // var offsetX = d3.event.offsetX || d3.event.layerX;
                                // var p = $('#' + scope.generated_id).parent();
                                // var scrollLeft = $(p).parent().scrollLeft();

                                // var layerX = d3.event.offsetX ? d3.event.layerX : Math.abs(scrollLeft - offsetX);

                                // var offsetY = d3.event.layerY;
                                // var scrollTop = $(p).parent().scrollTop();

                                // var layerY = d3.event.offsetY ? d3.event.layerY : Math.abs(offsetY - scrollTop);

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

                        // Heatmap component
                        var heatMap = svg.append("g").attr("class", "g3") // jshint ignore:line
                            .selectAll(".cellg")
                            .data(data, function (d) {
                                return d.row + ":" + d.col;
                            })
                            .enter()
                            .append("rect")
                            .attr("x", function (d) {
                                return hccol.indexOf(d.col) * cellSize;
                            })
                            .attr("y", function (d) {
                                return hcrow.indexOf(d.row) * cellSize;
                            })
                            .attr("class", function (d) {
                                return "cell_" + scope.generated_id  +  " cell-border cr" + (d.row - 1) + "_" + scope.generated_id + " cc" + (d.col - 1) + "_" + scope.generated_id;
                            })
                            .attr("width", cellSize)
                            .attr("height", cellSize)
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

                                $tooltip.html(rowLabel[d.row - 1] + "," + colLabel[d.col - 1] + " (" + scope.data[i].value + ")").place_tt(d3.event.pageX, d3.event.pageY);
                            })
                            .on("mouseout", function () {
                                d3.select(this).classed("cell-hover", false);
                                d3.selectAll(".rowLabel_" + scope.generated_id).classed("text-highlight", false);
                                d3.selectAll(".colLabel_" + scope.generated_id).classed("text-highlight", false);

                                $tooltip.detach();
                            });

                        // Function to sort the cells with respect to selected row or column
                        function sortbylabel(rORc, i, sortOrder) {
                            // rORc .. r for row, c for column
                            var t = svg.transition().duration(1200);

                            var values = []; // holds the values in this specific row
                            for(var j = 0; j < col_number; j++) { values.push(0); }

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
                                    return sorted.indexOf(d.col - 1) * cellSize;
                                });
                                t.selectAll(".colLabel_" + scope.generated_id)
                                .attr("y", function (d, i) {
                                    return sorted.indexOf(i) * cellSize;
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
                                    return sorted.indexOf(d.row - 1) * cellSize;
                                });
                                t.selectAll(".rowLabel_" + scope.generated_id)
                                .attr("y", function (d, i) {
                                    return sorted.indexOf(i) * cellSize;
                                });
                            }
                        }
                    }
                }
            };
        });
    });
