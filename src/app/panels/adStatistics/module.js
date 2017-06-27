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
    ],
    function (angular, app, _, $, kbn) {
        'use strict';
        var DEBUG = false;

        var module = angular.module('kibana.panels.adStatistics', []);
        app.useModule(module);

        module.controller('adStatistics', function($scope, $timeout, $filter, timer, querySrv, dashboard, filterSrv) {
            $scope.panelMeta = {
                exportfile: true,
                editorTabs : [
                    {title:'Queries', src:'app/partials/querySelect.html'}
                ],
                status  : "Stable",
                description : "Displays the results of a Solr facet as a pie chart, bar chart, or a table. Newly added functionality displays min/max/mean/sum of a stats field, faceted by the Solr facet field, again as a pie chart, bar chart or a table."
            };

            // Set and populate defaults
            var _d = {
                queries     : {
                    mode        : 'all',
                    ids         : [],
                    query       : '*:*',
                    custom      : ''
                },
                mode    : 'count', // mode to tell which number will be used to plot the chart.
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
                }
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

            $scope.get_time_range = function () {
                var range = filterSrv.timeRange('min');
                return range;
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
                if($scope.panel.display==='none'){
                    $scope.panel.display='block';
                    $scope.panel.icon="icon-caret-down";
                }else{
                    $scope.panel.display='none';
                    $scope.panel.icon="icon-caret-up";
                }
            };
            $scope.build_search = function(term) {
                _.defaults(dashboard.current,{main_bn_node_name:''});
                dashboard.current.main_bn_node_name = term.term;
                dashboard.refresh();
            };
            /**
             *
             *
             * @param {String} filetype -'json', 'xml', 'csv'
             */
            $scope.build_query = function(filetype, isForExport) {
                // Build Solr query
                var fq = '';
                if (filterSrv.getSolrFq()) {
                    fq = '&' + filterSrv.getSolrFq();
                }
                if (dashboard.current.anomaly_fq) {
                    fq = fq + '&' + dashboard.current.anomaly_fq;
                }
                var wt_json = '&wt=' + filetype;
                var rows_limit = isForExport ? '&rows=0' : ''; // for terms, we do not need the actual response doc, so set rows=0
                var facet = '';
                {
                    // stats does not support something like facet.limit, so we have to sort and limit the results manually.
                    facet = '&stats=true&stats.facet='+$scope.panel.stats_field + '&stats.field=value_f' + '&facet.missing=true';
                }

                var exclude_length = $scope.panel.exclude.length;
                var exclude_filter = '';
                if(exclude_length > 0){
                    for (var i = 0; i < exclude_length; i++) {
                        if($scope.panel.exclude[i] !== "") {
                            exclude_filter += '&fq=-' + $scope.panel.field +":"+ $scope.panel.exclude[i];
                        }
                    }
                }
                return querySrv.getORquery() + wt_json + rows_limit + fq + exclude_filter + facet + ($scope.panel.queries.custom !== null ? $scope.panel.queries.custom : '');
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
                $scope.panel.mode = 'all';
                if(($scope.panel.linkage_id===dashboard.current.linkage_id)||dashboard.current.enable_linkage){
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
                    results.then(function (results) {
                        // Check for error and abort if found
                        if (!(_.isUndefined(results.error))) {
                            $scope.panel.error = $scope.parse_error(results.error.msg);
                            $scope.data = [];
                            $scope.panelMeta.loading = false;
                            $scope.$emit('render');
                            return;
                        }

                        // Function for validating HTML color by assign it to a dummy <div id="colorTest">
                        // and let the browser do the work of validation.
                        var isValidHTMLColor = function (color) {
                            // clear attr first, before comparison
                            $('#colorTest').removeAttr('style');
                            var valid = $('#colorTest').css('color');
                            $('#colorTest').css('color', color);

                            if (valid === $('#colorTest').css('color')) {
                                return false;
                            } else {
                                return true;
                            }
                        };

                        // Function for customizing chart color by using field values as colors.
                        var addSliceColor = function (slice, color) {
                            if ($scope.panel.useColorFromField && isValidHTMLColor(color)) {
                                slice.color = color;
                            }
                            return slice;
                        };

                        var sum = 0;
                        var k = 0;
                        $scope.panelMeta.loading = false;
                        $scope.hits = results.response.numFound;
                        $scope.data = [];

                        {
                            // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
                            $scope.yaxis_min = null;
                            _.each(results.stats.stats_fields.value_f.facets.stats_field_s, function (stats_obj, stats_field) {
                                k = k + 1;
                                //var slice = {label: facet_field, data: [[k, stats_obj['mean'], stats_obj['count'], stats_obj['max'], stats_obj['min'], stats_obj['stddev'], facet_field]], actions: true};
                                var term = stats_field;
                                if (term.length > 50) { term = term.substring(0,40) + ' ...'; }
                                var slice = {term: term, index: k, name: dashboard.current.anomaly_name, count: stats_obj['count'], max: stats_obj['max'], min: stats_obj['min'], stddev: stats_obj['stddev'], actions: true};
                                $scope.data.push(slice);
                            });
                        }


                        // Slice it according to panel.size, and then set the x-axis values with k.
                        // $scope.data = $scope.data.slice(0, $scope.panel.size);

                        if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("T") > -1) {
                            $scope.hits = sum;
                        }
                        /*
                        $scope.data.push({
                            label: 'Missing field',
                            // data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});
                            // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
                            data: [[k, missing]], meta: "missing", color: '#aaa', opacity: 0
                        });
                        $scope.data.push({
                            label: 'Other values',
                            // data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});
                            // TODO: Hard coded to 0 for now. Solr faceting does not provide 'other' value.
                            data: [[k + 1, $scope.hits - sum]], meta: "other", color: '#444'
                        });
                        */

                        $scope.$emit('render');

                        $scope.sortingOrder = 'term';
                        $scope.reverse = false;
                        $scope.filteredItems = [];
                        $scope.groupedItems = [];
                        $scope.itemsPerPage = 10;
                        $scope.pagedItems = [];
                        $scope.currentPage = 0;

                        // init the filtered items
                        var searchMatch = function (haystack, needle) {
                            if (!needle) {
                                return true;
                            }
                            var res = haystack.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
                            return res;
                        };

                        $scope.search = function () {
                            $scope.filteredItems = $filter('filter')($scope.data, function (item) {
                                if (searchMatch(item.term, $scope.query)) {
                                    return true;
                                }
                                return false;
                            });
                            if ($scope.sortingOrder !== '') {
                                $scope.filteredItems = $filter('orderBy')($scope.filteredItems, $scope.sortingOrder, $scope.reverse);
                            }
                            $scope.currentPage = 0;
                            $scope.groupToPages();
                        };


                        // calculate page in place
                        $scope.groupToPages = function () {
                            $scope.pagedItems = [];

                            for (var i = 0; i < $scope.filteredItems.length; i++) {
                                if (i % $scope.itemsPerPage === 0) {
                                    $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)] = [ $scope.filteredItems[i] ];
                                } else {
                                    $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)].push($scope.filteredItems[i]);
                                }
                            }
                        };

                        $scope.prevPage = function () {
                            if ($scope.currentPage > 0) {
                                $scope.currentPage--;
                            }
                        };

                        $scope.nextPage = function () {
                            if ($scope.currentPage < $scope.pagedItems.length - 1) {
                                $scope.currentPage++;
                            }
                        };

                        $scope.setPage = function () {
                            $scope.currentPage = this.n;
                        };

                        // functions have been describe process the data for display
                        $scope.range = function (size,start, end) {
                            var ret = [];

                            if (size < end) {
                                end = size;
                                if(size<$scope.gap){
                                    start = 0;
                                }else{
                                    start = size-$scope.gap;
                                }

                            }
                            for (var i = start; i < end; i++) {
                                ret.push(i);
                            }
                            return ret;
                        };
                        $scope.search();

                        $scope.sort_by = function(newSortingOrder) {
                            if ($scope.sortingOrder === newSortingOrder){
                                $scope.reverse = !$scope.reverse;
                                $scope.filteredItems.reverse();
                            }
                            else {
                                $scope.reverse = true;
                                $scope.sortingOrder = newSortingOrder;
                                $scope.filteredItems = _.sortBy($scope.data, $scope.sortingOrder);
                                $scope.filteredItems.reverse();
                            }
                            $scope.groupToPages();
                            // icon setup

                            $('th i').each(function(){
                                // icon reset
                                $(this).removeClass().addClass('icon-sort');
                            });
                            if (!$scope.reverse)
                            { $('th.'+newSortingOrder+' i').removeClass().addClass('icon-chevron-up'); }
                            else
                            { $('th.'+newSortingOrder+' i').removeClass().addClass('icon-chevron-down');}

                        };

                    });

                }
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
