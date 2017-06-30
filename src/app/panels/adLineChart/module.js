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
        'kbn'
    ],
    function (angular, app, _, $, kbn) {
        'use strict';
        var DEBUG = true;
        console.log('adLineChart DEBUG : ' + DEBUG);

        var module = angular.module('kibana.panels.adLineChart', []);
        app.useModule(module);

        module.controller('adLineChart', function($scope, $timeout, $filter, timer, querySrv, dashboard, filterSrv) {
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
                max_rows : 1000,
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
                _.defaults(dashboard.current,{line_chart_fq:''});
                dashboard.current.main_bn_node_name = term.term;
                if (dashboard.current.fq) {
                  dashboard.current.line_chart_fq = dashboard.current.fq + '&fq=' + panel.metric_field + ':' + term.term;
                } else {
                  dashboard.current.line_chart_fq = 'fq=' + panel.metric_field + ':' + term.term;
                }
                dashboard.refresh();
            };
            /**
             *
             *
             * @param {String} filetype -'json', 'xml', 'csv'
             */
            $scope.build_query = function(filetype, ex_fq) {
                // Build Solr query
                var fq = '';
                if (filterSrv.getSolrFq()) {
                    fq = '&' + filterSrv.getSolrFq();
                }
                fq = fq + '&' + ex_fq;
                var wt_json = '&wt=' + filetype;
                var rows_limit = '&rows=' + $scope.panel.max_rows; // for terms, we do not need the actual response doc, so set rows=0
                var facet = '';
                var sort = '&sort=start_timestamp_l%20asc'
                return querySrv.getORquery() + wt_json + rows_limit + fq + sort + facet + ($scope.panel.queries.custom !== null ? $scope.panel.queries.custom : '');
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

                    if (dashboard.current.line_chart_fq === undefined) {return ;}
                    if (dashboard.current.line_chart_anomaly_fq === undefined) {return ;}
                    var total_query = this.build_query('json', dashboard.current.line_chart_fq);
                    var anomaly_query = this.build_query('json', dashboard.current.line_chart_anomaly_fq);

                    if (DEBUG) {console.log(total_query);}
                    if (DEBUG) {console.log(anomaly_query);}
                    // Set the panel's query
                    $scope.panel.queries.query = total_query + '\n' + anomaly_query;

                    request.setQuery(total_query);
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

                        $scope.panelMeta.loading = false;
                        $scope.data = [];
                        {
                            // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
                            $scope.yaxis_min = null;
                            if (DEBUG) { console.log(results); }
                            _.each(results.response.docs, function (doc) {
                                //var slice = {label: facet_field, data: [[k, stats_obj['mean'], stats_obj['count'], stats_obj['max'], stats_obj['min'], stats_obj['stddev'], facet_field]], actions: true};
                                var slice = {value: doc.value_f, timestamp: doc.start_timestamp_l, l: doc.down_margin_f, u:doc.up_margin_f};
                                $scope.data.push(slice);
                            });
                        }
                    });
                  $scope.$emit('render');
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

      module.directive('lineChart', function(querySrv,dashboard,filterSrv) {
        return {
          restrict: 'A',
          link: function(scope, elem) {
            var myChart;
            // Receive render events
            scope.$on('render',function(){
              render_panel();
            });

            // Re-render if the window is resized
            angular.element(window).bind('resize', function(){
              render_panel();
            });

            // Function for rendering panel
            function render_panel() {
              var plot, chartData;
              var colors = [];

              // IE doesn't work without this
              elem.css({height: scope.panel.height || scope.row.height});

              // Make a clone we can operate on.

              chartData = _.clone(scope.data);
              chartData = scope.panel.missing ? chartData :
                _.without(chartData, _.findWhere(chartData, {meta: 'missing'}));
              chartData = scope.panel.other ? chartData :
                _.without(chartData, _.findWhere(chartData, {meta: 'other'}));
              var line_id = scope.$id;
              require(['echarts'], function (ec) {
                var echarts = ec;
                if(myChart){
                  myChart.dispose();
                }
                myChart = echarts.init(document.getElementById(line_id));
                myChart.showLoading();
                if (chartData === []) return ;
                myChart.hideLoading();
                var base = -chartData.reduce(function (min, val) {
                  return Math.floor(Math.min(min, val.l));
                }, Infinity);
                var option = {
                  title: {
                    text: dashboard.current.line_chart_name,
                    left: 'center'
                  },
                  tooltip: {
                    trigger: 'axis',
                    formatter: function (params) {
                      return params[2].name + '<br />' + params[2].value;
                    }
                  },
                  grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: false
                  },
                  xAxis: {
                    type: 'category',
                    data: chartData.map(function (item) {
                      var date = echarts.format.formatTime('yyyy/MM/dd hh:mm:ss', item.timestamp);
                      return date;
                    }),
                    splitLine: {
                      show: false
                    },
                    boundaryGap: false,
                    axisLine:{
                      lineStyle:{
                        color:'#aaaaaa',
                        width:1
                      }
                    }
                  },
                  yAxis: {
                    axisLabel: {
                      formatter: function (val) {
                        return (val - base);
                      }
                    },
                    axisPointer: {
                      label: {
                        formatter: function (params) {
                          console.log(params);
                          return (params.value - base).toFixed(1);
                        }
                      }
                    },
                    splitNumber: 3,
                    splitLine: {
                      show: false
                    },
                    axisLine:{
                      lineStyle:{
                        color:'#aaaaaa',
                        width:1
                      }
                    }
                  },
                  series: [{
                    name: 'L',
                    type: 'line',
                    data: chartData.map(function (item) {
                      return item.l + base;
                    }),
                    lineStyle: {
                      normal: {
                        opacity: 0
                      }
                    },
                    stack: 'confidence-band',
                    symbol: 'none'
                  }, {
                    name: 'U',
                    type: 'line',
                    data: chartData.map(function (item) {
                      return item.u - item.l;
                    }),
                    lineStyle: {
                      normal: {
                        opacity: 0
                      }
                    },
                    areaStyle: {
                      normal: {
                        color: '#ccc'
                      }
                    },
                    stack: 'confidence-band',
                    symbol: 'none'
                  }, {
                    type: 'line',
                    data: chartData.map(function (item) {
                      return item.value + base;
                    }),
                    hoverAnimation: false,
                    symbolSize: 6,
                    itemStyle: {
                      normal: {
                        color: '#c23531'
                      }
                    },
                    showSymbol: false
                  }]
                };
                myChart.setOption(option);
              });
            }
          }
        };
      });
});
