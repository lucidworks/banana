/*
## HeatMap D3 Panel
*/
define([
'angular',
'app',
'underscore',
'jquery',
'd3'
],
function (angular, app, _, $, d3) {
    'use strict';

    var module = angular.module('kibana.panels.heatmap', []);
    app.useModule(module);

    var DEBUG = true;

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
            description: "Heatmap D3 Experimental Panel"
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
            spyable: true
        };

        // Set panel's default values
        _.defaults($scope.panel, _d);

        $scope.init = function () {
            $scope.panel.editor_size = $scope.panel.row_size;
            $scope.$on('refresh', function () {
                $scope.get_data();
            });
            $scope.get_data();
        };

        $scope.get_data = function () {
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
                console.log('heatmap:\n\trequest=', request, '\n\trequest.toString()=', request.toString());
            }
            // --------------------- END OF ELASTIC SEARCH PART ---------------------------------------

            var wt_json = '&wt=json';
            var fq = '';
            var rows_limit = '&rows=' + $scope.panel.size;
            var facet = '&facet=true';
            var facet_pivot = '&facet.pivot=' + $scope.panel.row_field + ',' + $scope.panel.col_field;
            var facet_limit = '&facet.limit=' + $scope.panel.row_size;
            var facet_pivot_mincount = '&facet.pivot.mincount=0';
            
            $scope.panel.queries.query = querySrv.getQuery(0) + fq + wt_json + rows_limit + facet + facet_pivot + facet_limit + facet_pivot_mincount;

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
                var facets = results.facet_counts.facet_pivot;
                var key = Object.keys(facets)[0];
                
                facets = facets[key];
                
                $scope.data = [];
                $scope.row_labels = [];
                $scope.col_labels = [];
                $scope.hcrow = [];
                $scope.hccol = [];
                
//                _.each(facets, function(d, i){
//                    // build the arrays to be used 
//                    var count = d.count;
//                    
//                    $scope.row_labels.push(d.value);
//                    $scope.hcrow.push($scope.row_labels.length);
//                    
//                    _.each(d.pivot, function(p, j) {
//                        // columns in each row
//                        var entry = {};
//                        
//                        var v = p.value;
//                        
//                        if($scope.col_labels.indexOf(v) == -1) {
//                            $scope.col_labels.push(v);
//                            $scope.hccol.push($scope.col_labels.length);
//                        }
//                        
//                        var index = $scope.col_labels.indexOf(v); // index won't be -1 as we count in the facets with count = 0
//                        
//                        entry.row = i + 1;
//                        entry.col = index + 1;
//                        entry.value = Math.ceil((p.count.toFixed(2) / count.toFixed(2)) * 10);
//                        
//                        $scope.data.push(entry);
//                    });
//                });
                
                _.each(facets, function(d, i){
                    // build the arrays to be used 
                    var count = d.count;
                    
                    $scope.col_labels.push(d.value);
                    $scope.hccol.push($scope.col_labels.length);
                    
                    _.each(d.pivot, function(p, j) {
                        // columns in each row
                        var entry = {};
                        
                        var v = p.value;
                        
                        if($scope.row_labels.indexOf(v) == -1) {
                            $scope.row_labels.push(v);
                            $scope.hcrow.push($scope.row_labels.length);
                        }
                        
                        var index = $scope.row_labels.indexOf(v); // index won't be -1 as we count in the facets with count = 0
                        
                        entry.col = i + 1;
                        entry.row = index + 1;
                        entry.value = Math.ceil((p.count.toFixed(2) / count.toFixed(2)) * 10);
                        
                        $scope.data.push(entry);
                    });
                });
                
                $scope.render();
            });
            // Hide the spinning wheel icon
            $scope.panelMeta.loading = false;
        };

        $scope.set_refresh = function (state) {
            $scope.refresh = state;
        };

        $scope.close_edit = function () {
            var valid = $scope.validateLimit();
            if (valid && $scope.refresh) {
                $scope.panel.row_size = $scope.panel.editor_size;
                $scope.get_data();
            } else if (!valid) {
                alert('invalid rows number');
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
                    element.html('<div id="tooltip" class="hidden"><p><span id="value"></p></div>'); // make the ui element empty to re-fill it
                    var el = element[0];
                    
                    var data = jQuery.extend(true, [], scope.data);
                    
                    var margin = {
                        top: 150,
                        right: 10,
                        bottom: 20,
                        left: 100
                    };

                    var rowSortOrder = false;
                    var colSortOrder = false;
                    
                    var cellSize = 15,
                        col_number = scope.col_labels.length, //TODO: size to be determined
                        row_number = scope.row_labels.length, //TODO: size to be determined
                        width = cellSize * col_number, // - margin.left - margin.right,
                        height = cellSize * row_number, // - margin.top - margin.bottom,
                        legendElementWidth = cellSize * 2.5;

                    var colorBuckets = 11,
                        colors = ['#FFFFFF', '#F1EEF6', '#E6D3E1', '#DBB9CD', '#D19EB9', '#C684A4', '#BB6990', '#B14F7C', '#A63467', '#9B1A53', '#91003F'];
                    
                    var hcrow = jQuery.extend(true, [], scope.hcrow),
                        hccol = jQuery.extend(true, [], scope.hccol),
                        rowLabel = jQuery.extend(true, [], scope.row_labels),
                        colLabel = jQuery.extend(true, [], scope.col_labels);
                    
                    // Colors Scale for heatmap (white to red to dark red)
                    var colorScale = d3.scale.quantile()
                        .domain([0, 10])
                        .range(colors);
                    
                    var svg = d3.select(el).append("svg")
                        .attr("width", width + margin.left + margin.right)
                        .attr("height", height + margin.top + margin.bottom)
                        .append("g")
                        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
                    
                    // Row Labels
                    var rowLabels = svg.append("g")
                        .selectAll(".rowLabelg")
                        .data(rowLabel)
                        .enter()
                        .append("text")
                        .text(function (d) {
                            return d;
                        })
                        .attr("x", 0)
                        .attr("y", function (d, i) {
                            return hcrow.indexOf(i + 1) * cellSize;
                        })
                        .style("text-anchor", "end")
                        .attr("transform", "translate(-6," + cellSize / 1.5 + ")")
                        .attr("class", function (d, i) {
                            return "rowLabel mono r" + i;
                        })
                        .on("mouseover", function (d) {
                            d3.select(this).classed("text-hover", true);
                        })
                        .on("mouseout", function (d) {
                            d3.select(this).classed("text-hover", false);
                        })
                        .on("click", function (d, i) {
                            rowSortOrder = !rowSortOrder;
                            sortbylabel("r", i, rowSortOrder);
                        });
                    
                    // Column labels
                    var colLabels = svg.append("g")
                        .selectAll(".colLabelg")
                        .data(colLabel)
                        .enter()
                        .append("text")
                        .text(function (d) {
                            return d;
                        })
                        .attr("x", 0)
                        .attr("y", function (d, i) {
                            return hccol.indexOf(i + 1) * cellSize;
                        })
                        .style("text-anchor", "left")
                        .attr("transform", "translate(" + cellSize / 2 + ",-6) rotate (-90)")
                        .attr("class", function (d, i) {
                            return "colLabel mono c" + i;
                        })
                        .on("mouseover", function (d) {
                            d3.select(this).classed("text-hover", true);
                        })
                        .on("mouseout", function (d) {
                            d3.select(this).classed("text-hover", false);
                        })
                        .on("click", function (d, i) {
                            colSortOrder = !colSortOrder;
                            sortbylabel("c", i, colSortOrder);
                        });

                    // Heatmap component
                    var heatMap = svg.append("g").attr("class", "g3")
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
                            return "cell cell-border cr" + (d.row - 1) + " cc" + (d.col - 1);
                        })
                        .attr("width", cellSize)
                        .attr("height", cellSize)
                        .style("fill", function (d) {
                            return colorScale(d.value);
                        })
                        .on("mouseover", function (d) {
                            //highlight text
                            d3.select(this).classed("cell-hover", true);
                            d3.selectAll(".rowLabel").classed("text-highlight", function (r, ri) {
                                return ri == (d.row - 1);
                            });
                            d3.selectAll(".colLabel").classed("text-highlight", function (c, ci) {
                                return ci == (d.col - 1);
                        });

                            //Update the tooltip position and value
                        d3.select("#tooltip")
                            .style("left", (d3.event.layerX + 10) + "px")
                            .style("top", (d3.event.layerY - 10) + "px")
                            .select("#value")
                            .text("lables:" + rowLabel[d.row - 1] + "," + colLabel[d.col - 1] + "\ndata:" + d.value + "\nrow-col-idx:" + d.col + "," + d.row + "\ncell-xy " + this.x.baseVal.value + ", " + this.y.baseVal.value);
                        //Show the tooltip
                        d3.select("#tooltip").classed("hidden", false);
                    })
                    .on("mouseout", function () {
                        d3.select(this).classed("cell-hover", false);
                        d3.selectAll(".rowLabel").classed("text-highlight", false);
                        d3.selectAll(".colLabel").classed("text-highlight", false);
                        d3.select("#tooltip").classed("hidden", true);
                    }); 
                    
                    
                    // -------------------------------------------------------------------------------
                    var sa = d3.select(".g3")
                        .on("mousedown", function () {
                            if (!d3.event.altKey) {
                                d3.selectAll(".cell-selected").classed("cell-selected", false);
                                d3.selectAll(".rowLabel").classed("text-selected", false);
                                d3.selectAll(".colLabel").classed("text-selected", false);
                            }
                            var p = d3.mouse(this);
                            sa.append("rect")
                                .attr({
                                    rx: 0,
                                    ry: 0,
                                    class: "selection",
                                    x: p[0],
                                    y: p[1],
                                    width: 1,
                                    height: 1
                                })
                        })
                        .on("mousemove", function () {
                            var s = sa.select("rect.selection");

                            if (!s.empty()) {
                                var p = d3.mouse(this),
                                    d = {
                                        x: parseInt(s.attr("x"), 10),
                                        y: parseInt(s.attr("y"), 10),
                                        width: parseInt(s.attr("width"), 10),
                                        height: parseInt(s.attr("height"), 10)
                                    },
                                    move = {
                                        x: p[0] - d.x,
                                        y: p[1] - d.y
                                    };

                                if (move.x < 1 || (move.x * 2 < d.width)) {
                                    d.x = p[0];
                                    d.width -= move.x;
                                } else {
                                    d.width = move.x;
                                }

                                if (move.y < 1 || (move.y * 2 < d.height)) {
                                    d.y = p[1];
                                    d.height -= move.y;
                                } else {
                                    d.height = move.y;
                                }
                                s.attr(d);

                                // deselect all temporary selected state objects
                                d3.selectAll('.cell-selection.cell-selected').classed("cell-selected", false);
                                d3.selectAll(".text-selection.text-selected").classed("text-selected", false);

                                d3.selectAll('.cell').filter(function (cell_d, i) {
                                    if (!d3.select(this).classed("cell-selected") &&
                                        // inner circle inside selection frame
                                        (this.x.baseVal.value) + cellSize >= d.x && (this.x.baseVal.value) <= d.x + d.width &&
                                        (this.y.baseVal.value) + cellSize >= d.y && (this.y.baseVal.value) <= d.y + d.height
                                    ) {

                                        d3.select(this)
                                            .classed("cell-selection", true)
                                            .classed("cell-selected", true);

                                        d3.select(".r" + (cell_d.row - 1))
                                            .classed("text-selection", true)
                                            .classed("text-selected", true);

                                        d3.select(".c" + (cell_d.col - 1))
                                            .classed("text-selection", true)
                                            .classed("text-selected", true);
                                    }
                                });
                            }
                        })
                        .on("mouseup", function () {
                            // remove selection frame
                            sa.selectAll("rect.selection").remove();

                            // remove temporary selection marker class
                            d3.selectAll('.cell-selection').classed("cell-selection", false);
                            d3.selectAll(".text-selection").classed("text-selection", false);
                        })
                        .on("mouseout", function () {
                            if (d3.event.relatedTarget.tagName == 'html') {
                                // remove selection frame
                                sa.selectAll("rect.selection").remove();
                                // remove temporary selection marker class
                                d3.selectAll('.cell-selection').classed("cell-selection", false);
                                d3.selectAll(".rowLabel").classed("text-selected", false);
                                d3.selectAll(".colLabel").classed("text-selected", false);
                            }
                        });                    
                    // -------------------------------------------------------------------------------
                    function sortbylabel(rORc, i, sortOrder) {
                        // rORc .. r for row, c for column
                        var t = svg.transition().duration(1200);
                        var log2r = [];
                        var sorted; // sorted is zero-based index
                        d3.selectAll(".c" + rORc + i)
                            .filter(function (ce) {
                                log2r.push(ce.value);
                            });
                        if (rORc == "r") { // sort log2ratio of a gene
                            sorted = d3.range(col_number).sort(function (a, b) {
                                if (sortOrder) {
                                    return log2r[b] - log2r[a];
                                } else {
                                    return log2r[a] - log2r[b];
                                }
                            });
                            t.selectAll(".cell")
                                .attr("x", function (d) {
                                    return sorted.indexOf(d.col - 1) * cellSize;
                                });
                            t.selectAll(".colLabel")
                                .attr("y", function (d, i) {
                                    return sorted.indexOf(i) * cellSize;
                                });
                        } else { // sort log2ratio of a contrast
                            sorted = d3.range(row_number).sort(function (a, b) {
                                if (sortOrder) {
                                    return log2r[b] - log2r[a];
                                } else {
                                    return log2r[a] - log2r[b];
                                }
                            });
                            t.selectAll(".cell")
                                .attr("y", function (d) {
                                    return sorted.indexOf(d.row - 1) * cellSize;
                                });
                            t.selectAll(".rowLabel")
                                .attr("y", function (d, i) {
                                    return sorted.indexOf(i) * cellSize;
                                });
                        }
                    }                    
                }

                render_panel();
            }
        };
    });
});