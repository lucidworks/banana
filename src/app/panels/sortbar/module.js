/*

 ## Histogram

 ### Parameters
 * auto_int :: Auto calculate data point interval?
 * resolution ::  If auto_int is enables, shoot for this many data points, rounding to
 sane intervals
 * interval :: Datapoint interval in elasticsearch date math format (eg 1d, 1w, 1y, 5y)
 * fill :: Only applies to line charts. Level of area shading from 0-10
 * linewidth ::  Only applies to line charts. How thick the line should be in pixels
 While the editor only exposes 0-10, this can be any numeric value.
 Set to 0 and you'll get something like a scatter plot
 * timezone :: This isn't totally functional yet. Currently only supports browser and utc.
 browser will adjust the x-axis labels to match the timezone of the user's
 browser
 * spyable ::  Dislay the 'eye' icon that show the last elasticsearch query
 * zoomlinks :: Show the zoom links?
 * bars :: Show bars in the chart
 * stack :: Stack multiple queries. This generally a crappy way to represent things.
 You probably should just use a line chart without stacking
 * points :: Should circles at the data points on the chart
 * lines :: Line chart? Sweet.
 * legend :: Show the legend?
 * x-axis :: Show x-axis labels and grid lines
 * y-axis :: Show y-axis labels and grid lines
 * interactive :: Allow drag to select time range

 */
define([
    'angular',
    'app',
    'jquery',
    'underscore',
    'kbn',
    'moment',
    './timeSeries'


  ],
  function (angular, app, $, _, kbn, moment, timeSeries) {
    'use strict';

    var module = angular.module('kibana.panels.sortbar', []);
    app.useModule(module);

    module.controller('sortbar', function($scope, $q, querySrv, dashboard, filterSrv) {
      $scope.panelMeta = {

        editorTabs : [
          {
            title:'Queries',
            src:'app/partials/querySelect.html'
          }
        ],
        status  : "Stable",
        description : "A bucketed time series chart of the current query, including all applied time and non-time filters, when used in <i>count</i> mode. Uses Solr’s facet.range query parameters. In <i>values</i> mode, it plots the value of a specific field over time, and allows the user to group field values by a second field."
      };

      // Set and populate defaults
      var _d = {
        mode        : 'value',
        queries     : {
          mode        : 'all',
          ids         : [],
          query       : '*:*',
          custom      : ''
        },
        max_rows    : 10,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
        reverse     :0,
        segment	  :4,
        threshold_first:1000,
        threshold_second:2000,
        threshold_third:3000,
        value_field : '',
        linkage_id:'a',
        group_field : null,
        auto_int    : true,
        total_first :'%',
        fontsize:12,
        ylabels:false,
        field_color:'#209bf8',
        resolution  : 100,
        value_sort  :'rs_timestamp',
        interval    : '5m',
        intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
        fill        : 0,
        linewidth   : 3,
        chart       :'sortbar',
        chartColors :querySrv.colors,
        timezone    : 'browser', // browser, utc or a standard timezone
        spyable     : true,
        linkage     :false,
        zoomlinks   : true,
        bars        : true,
        stack       : true,
        label       : true,
        points      : false,
        display:'block',
        icon:"icon-caret-down",
        lines       : false,
        lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
        legend      : true,
        'x-axis'    : true,
        'y-axis'    : true,
        percentage  : false,
        interactive : true,
        options     : true,
        show_queries:true,
        tooltip     : {
          value_type: 'cumulative',
          query_as_alias: false
        }
      };

      _.defaults($scope.panel,_d);

      $scope.init = function() {
        // Hide view options by default
        $scope.options = false;
        $scope.$on('refresh',function(){
          $scope.get_data();
        });

        $scope.get_data();

      };

      $scope.set_interval = function(interval) {
        if(interval !== 'auto') {
          $scope.panel.auto_int = false;
          $scope.panel.interval = interval;
        } else {
          $scope.panel.auto_int = true;
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

      $scope.interval_label = function(interval) {
        return $scope.panel.auto_int && interval === $scope.panel.interval ? interval+" (auto)" : interval;
      };

      /**
       * The time range effecting the panel
       * @return {[type]} [description]
       */
      $scope.get_time_range = function () {
        var range = $scope.range = filterSrv.timeRange('min');
        return range;
      };

      $scope.get_interval = function () {
        var interval = $scope.panel.interval,
          range;
        if ($scope.panel.auto_int) {
          range = $scope.get_time_range();
          if (range) {
            interval = kbn.secondsToHms(
              kbn.calculate_interval(range.from, range.to, $scope.panel.resolution, 0) / 1000
            );
          }
        }
        $scope.panel.interval = interval || '10m';
        return $scope.panel.interval;
      };

      /**
       * Fetch the data for a chunk of a queries results. Multiple segments occur when several indicies
       * need to be consulted (like timestamped logstash indicies)
       *
       * The results of this function are stored on the scope's data property. This property will be an
       * array of objects with the properties info, time_series, and hits. These objects are used in the
       * render_panel function to create the historgram.
       *
       * !!! Solr does not need to fetch the data in chunk because it uses a facet search and retrieve
       * !!! all events from a single query.
       *
       * @param {number} segment   The segment count, (0 based)
       * @param {number} query_id  The id of the query, generated on the first run and passed back when
       *                            this call is made recursively for more segments
       */
      $scope.get_data = function(segment, query_id) {
        if(($scope.panel.linkage_id === dashboard.current.linkage_id)||dashboard.current.enable_linkage){
          if (_.isUndefined(segment)) {
            segment = 0;
          }
          delete $scope.panel.error;

          // Make sure we have everything for the request to complete
          if (dashboard.indices.length === 0) {
            return;
          }
          var _range = $scope.get_time_range();
          var _interval = $scope.get_interval(_range);

          if ($scope.panel.auto_int) {
            $scope.panel.interval = kbn.secondsToHms(
              kbn.calculate_interval(_range.from, _range.to, $scope.panel.resolution, 0) / 1000);
          }

          $scope.panelMeta.loading = true;

          // Solr
          $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

          var request = $scope.sjs.Request().indices(dashboard.indices[segment]);
          $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);


          $scope.panel.queries.query = "";
          // Build the query
          _.each($scope.panel.queries.ids, function (id) {
            var query = $scope.sjs.FilteredQuery(
              querySrv.getEjsObj(id),
              filterSrv.getBoolFilter(filterSrv.ids)
            );

            var facet = $scope.sjs.DateHistogramFacet(id);
            if ($scope.panel.mode === 'count' || $scope.panel.mode === 'counts') {
              facet = facet.field(filterSrv.getTimeField());
            } else {
              if (_.isNull($scope.panel.value_field)) {
                $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
                return;
              }
              facet = facet.keyField(filterSrv.getTimeField()).valueField($scope.panel.value_field);
            }
            facet = facet.interval(_interval).facetFilter($scope.sjs.QueryFilter(query));
            request = request.facet(facet).size(0);

          });

          // Populate the inspector panel
          $scope.populate_modal(request);

          // Build Solr query
          var fq = '';
          if (filterSrv.getSolrFq()) {
            fq = '&' + filterSrv.getSolrFq();
          }
          var time_field = filterSrv.getTimeField();
          var start_time = filterSrv.getStartTime();
          var end_time = filterSrv.getEndTime();

          // facet.range.end does NOT accept * as a value, need to convert it to NOW
          if (end_time === '*') {
            end_time = 'NOW';
          }

          var wt_json = '&wt=json';
          var sort_s = '&sort=' + $scope.panel.value_sort + '%20desc';
          var rows_limit = '&rows=0'; // for histogram, we do not need the actual response doc, so set rows=0
          var facet_gap = $scope.sjs.convertFacetGap($scope.panel.interval);
          var facet = '&facet=true' +
            '&facet.range=' + time_field +
            '&facet.range.start=' + start_time +
            '&facet.range.end=' + end_time +
            '&facet.range.gap=' + facet_gap;
          var values_mode_query = '';

          // For mode = value
          if ($scope.panel.mode === 'values' || $scope.panel.mode === 'value') {
            if (!$scope.panel.value_field) {
              $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
              return;
            }
            values_mode_query = '&fl=' + time_field + ' ' + $scope.panel.value_field;

            rows_limit = '&rows=' + $scope.panel.max_rows;
            facet = '';

            // if Group By Field is specified
            if ($scope.panel.group_field) {
              values_mode_query += '&group=true&group.field=' + $scope.panel.group_field + '&group.limit=' + $scope.panel.max_rows;
            }
          }

          var mypromises = [];
          if ($scope.panel.mode === 'value' || $scope.panel.mode === 'counts') {
            var arr_id = [0];
            _.each(arr_id, function () {
              var temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + sort_s + rows_limit + fq + facet + values_mode_query;

              $scope.panel.queries.query += temp_q + "\n";
              if ($scope.panel.queries.custom !== null) {
                request = request.setQuery(temp_q + $scope.panel.queries.custom);
              } else {
                request = request.setQuery(temp_q);
              }
              mypromises.push(request.doSearch());
            });
          }
          $scope.data = [];

          if (dashboard.current.services.query.ids.length >= 1) {
            $q.all(mypromises).then(function (results) {
              $scope.panelMeta.loading = false;
              if (segment === 0) {
                $scope.hits = 0;
                $scope.data = [];
                query_id = $scope.query_id = new Date().getTime();
              }
              // Convert facet ids to numbers
              // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
              //var facetIds = [0]; // Need to fix this

              // Make sure we're still on the same query/queries
              // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
              // if ($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
              var i = 0,
                time_series,
                hits;

              _.each(arr_id, function (id, index) {
                // Check for error and abort if found
                if (!(_.isUndefined(results[index].error))) {
                  $scope.panel.error = $scope.parse_error(results[index].error.msg);
                  return;
                }
                // we need to initialize the data variable on the first run,
                // and when we are working on the first segment of the data.
                if (_.isUndefined($scope.data[i]) || segment === 0) {
                  time_series = new timeSeries.ZeroFilled({
                    interval: _interval,
                    start_date: _range && _range.from,
                    end_date: _range && _range.to,
                    fill_style: 'minimal'
                  });
                  hits = 0;
                } else {
                  time_series = $scope.data[i].time_series;
                  // Bug fix for wrong event count:
                  //   Solr don't need to accumulate hits count since it can get total count from facet query.
                  //   Therefore, I need to set hits and $scope.hits to zero.
                  // hits = $scope.data[i].hits;
                  hits = 0;
                  $scope.hits = 0;
                }


                $scope.data[i] = results[index].response.docs;


                i++;
              });

              // Tell the histogram directive to render.
              $scope.$emit('render');
              // }
            });
          }

        }
      };

      // function $scope.zoom
      // factor :: Zoom factor, so 0.5 = cuts timespan in half, 2 doubles timespan
      $scope.zoom = function(factor) {
        var _range = filterSrv.timeRange('min');
        var _timespan = (_range.to.valueOf() - _range.from.valueOf());
        var _center = _range.to.valueOf() - _timespan/2;

        var _to = (_center + (_timespan*factor)/2);
        var _from = (_center - (_timespan*factor)/2);

        // If we're not already looking into the future, don't.
        if(_to > Date.now() && _range.to < Date.now()) {
          var _offset = _to - Date.now();
          _from = _from - _offset;
          _to = Date.now();
        }

        var time_field = filterSrv.getTimeField();
        if(factor > 1) {
          filterSrv.removeByType('time');
        }

        filterSrv.set({
          type:'time',
          from:moment.utc(_from).toDate(),
          to:moment.utc(_to).toDate(),
          field:time_field
        });

        dashboard.refresh();
      };

      // I really don't like this function, too much dom manip. Break out into directive?
      $scope.populate_modal = function(request) {
        $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
      };

      $scope.set_refresh = function (state) {
        $scope.refresh = state;
      };

      $scope.close_edit = function() {
        if($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh =  false;
        $scope.$emit('render');
      };

      $scope.render = function() {
        $scope.$emit('render');
      };

    });

    module.directive('sortbarChart', function(querySrv,dashboard,filterSrv) {
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
            var chartData;
            var colors = [];

            // IE doesn't work without this
            elem.css({height:scope.panel.height||scope.row.height});

            // Make a clone we can operate on.

            chartData = _.clone(scope.data);
            chartData = scope.panel.missing ? chartData :
              _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
            chartData = scope.panel.other ? chartData :
              _.without(chartData,_.findWhere(chartData,{meta:'other'}));

            if (filterSrv.idsByTypeAndField('terms',scope.panel.field).length > 0) {
              colors.push(scope.panel.lastColor);
            } else {
              colors = scope.panel.chartColors;
            }

            var barData = [];
            var barDataLabel=[];
            var barLabel = scope.panel.value_field.split(" ");




            for (var i =0;i<chartData[0].length;i++){

              barData[i] = chartData[0][i][scope.panel.value_sort];
              barDataLabel[i] = chartData[0][i][barLabel[1]];
              barDataLabel[i] = barDataLabel[i].replace(/[\r\n]/g,"");

            }
            barData.reverse();
            barDataLabel.reverse();



            var option_nodata = {
              series: [{

                type: 'wordCloud',
                //size: ['9%', '99%'],
                sizeRange: [50, 50],
                //textRotation: [0, 45, 90, -45],
                rotationRange: [0, 0],
                //shape: 'circle',
                textPadding: 0,
                autoSize: {
                  enable: true,
                  minSize: 6
                },
                textStyle: {
                  normal: {
                    color: '#1a93f9'
                  },
                  emphasis: {
                    shadowBlur: 10,
                    shadowColor: '#333'
                  }
                },
                data: [{
                  name: "NO DATA",
                  value: 1
                }]
              }]
            };

            var idd = scope.$id;
            require(['echarts'], function(ec){
              var echarts = ec;
              if(myChart) {
                myChart.dispose();
              }
              // Populate element
              try {

                var labelcolor = false;
                if (dashboard.current.style === 'dark'){
                  labelcolor = true;
                }
                // Add plot to scope so we can build out own legend
                if(scope.panel.chart === 'sortbar') {

                  myChart = echarts.init(document.getElementById(idd));
                  var option33 = {
                    color: ['#3398DB'],
                    tooltip : {
                      trigger: 'axis',
                      confine:true,
                      axisPointer : {            // 坐标轴指示器，坐标轴触发有效
                        type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
                      }
                    },
                    grid: {
                      left: '3%',
                      right: '3%',
                      bottom: '3%',
                      top: '6%',
                      containLabel: true
                    },
                    xAxis : [
                      {
                        type : 'value',
                        splitLine: {
                          show :false,
                          lineStyle:{
                            type:'dotted',
                            axisTick: {
                              show:false
                            },
                            color: labelcolor ? '#4F4F4F':'#F8F8FF'
                          }
                        },
                        axisLabel:{
                          show:true,
                          textStyle:{
                            color:labelcolor ? '#fff':'#4F4F4F',
                            fontSize:scope.panel.fontsize+2,
                            fontStyle: 'italic'
                          }
                        },
                        nameTextStyle:{

                          color:labelcolor ? '#fff':'#4F4F4F',


                        },
                        axisLine:{
                          show:true,
                        }
                      }
                    ],
                    yAxis : [
                      {
                        show:scope.panel.ylabels,
                        type : 'category',
                        data : barDataLabel,
                        axisLine:{
                          show:false
                        },
                        axisLabel:{
                          inside:!scope.panel.ylabels,
                          show:scope.panel.ylabels,
                          textStyle:{
                            color:labelcolor ? '#fff':'#4F4F4F',
                            fontSize:scope.panel.fontsize,
                          }
                        },
                        axisTick: {
                          show:false,
                          alignWithLabel: false
                        }
                      }
                    ],
                    series : [
                      {
                        name:scope.panel.title,
                        type:'bar',
                        barWidth: '43%',
                        data:barData,
                        itemStyle: {
                          normal: {
                            color: function(params) {
                              var colorList = colors;
                              return colorList[params.dataIndex];
                            },
                            shadowColor: '#fff',
                            barBorderRadius: 5

                          }
                        },
                        label: {
                          normal: {
                            show: true,
                            formatter:scope.panel.ylabels?'{c}':'{b}:{c}',
                            position: scope.panel.ylabels?'right':'insideLeft',
                            offset:[0,-2],
                            textStyle: {
                              fontWeight:'bold',
                              color: labelcolor ? '#fff':'#4F4F4F',
                              fontSize: scope.panel.fontsize
                            }
                          }
                        }
                      }
                    ]
                  };
                  //没有数据显示NO DATA

                  if(scope.data.length === 0){
                    myChart.setOption(option_nodata);}else{
                    myChart.setOption(option33);
                    myChart.on('click', function (params) {
                      // 点击联动
                      scope.build_search(params);
                    });
                  }
                }


                // Populate legend


              } catch(e) {
                elem.text(e);
              }
            });
          }

        }
      };
    });

  });
