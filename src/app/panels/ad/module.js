/*

  ## Anomaly Detection

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
  var module = angular.module('kibana.panels.ad', []);
  app.useModule(module);

  var DEBUG = true;
  console.log('DEBUG : ' + DEBUG);
  module.controller('ad', function($scope, $q, $http, querySrv, dashboard, filterSrv, alertSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
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
      max_rows    : 1000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      cut_number  : 100,
      anomaly_th  : 0.70,
      reverse     : 0,
      group_field : null,
      auto_int    : true,
	  total_first : '%',
	  fontsize    : 20,
	  field_color : '#209bf8',
      resolution  : 100,
	  value_sort  : 'rs_timestamp',
      interval    : '5m',
      intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
      fill        : 0,
      linewidth   : 3,
	  chart       : 'stacking',
      chartColors : ['#209bf8', '#f4d352','#ccf452','#8cf452','#3cee2b','#f467d8','#2fd7ee'],
      timezone    : 'browser', // browser, utc or a standard timezone
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      stack       : true,
	  label       : true,
      points      : false,
      lines       : false,
      lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
      legend      : true,
      'x-axis'    : true,
      'y-axis'    : true,
      percentage  : false,
      interactive : true,
      options     : true,
      show_queries: true,
      tooltip     : {
        value_type: 'cumulative',
        query_as_alias: false
      },
      jobid : '',
      job_status: 'Ready',
      fields  : []
    };

    _.defaults($scope.panel,_d);

    $scope.init = function() {
      // Hide view options by default
      if (DEBUG) console.log('init');
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

    $scope.interval_label = function(interval) {
      return $scope.panel.auto_int && interval === $scope.panel.interval ? interval+" (auto)" : interval;
    };

    $scope.set_refresh = function (state) {
        $scope.refresh = state;
        // if 'count' mode is selected, set decimal_points to zero automatically.
        if ($scope.panel.mode === 'count') {
            $scope.panel.decimal_points = 0;
        }
        $scope.get_data();
    };
    $scope.toggle_field = function(field) {
        if (_.indexOf($scope.panel.fields, field) > -1) {
            $scope.panel.fields = _.without($scope.panel.fields, field);
        } else  {
            $scope.panel.fields.push(field);
        }
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
      if (DEBUG) console.log('get data start.');
      if (_.isUndefined(segment)) {
        segment = 0;
      }
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      var _range = $scope.get_time_range();
      var _interval = $scope.get_interval(_range);

      if ($scope.panel.auto_int) {
        $scope.panel.interval = kbn.secondsToHms(
          kbn.calculate_interval(_range.from,_range.to,$scope.panel.resolution,0)/1000);
      }

      $scope.panelMeta.loading = true;

      // Solr
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      var request = $scope.sjs.Request().indices(dashboard.indices[segment]);
      // $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      if (DEBUG) console.log($scope.panel.fields);

      $scope.panel.queries.query = "";
      // Build the query
      _.each($scope.panel.queries.ids, function(id) {
        var query = $scope.sjs.FilteredQuery(
          querySrv.getEjsObj(id),
          filterSrv.getBoolFilter(filterSrv.ids)
        );

        var facet = $scope.sjs.DateHistogramFacet(id);
        
      });

      if(_.isNull($scope.panel.value_field)) {
        $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
        return;
      }


      // Build Solr query
      var fq = '';
      if (filterSrv.getSolrFq()) {
        fq = '&' + filterSrv.getSolrFq();
      }

      var time_field = filterSrv.getTimeField();
      var start_time = filterSrv.getStartTime();
      var end_time = filterSrv.getEndTime();

      $scope.panel.start_time = start_time;
      $scope.panel.end_time = end_time;

      // facet.range.end does NOT accept * as a value, need to convert it to NOW
      if (end_time === '*') {
          end_time = 'NOW';
      }

      var wt_json = '&wt=json';
      var metric_field = $scope.panel.metric_field;
      var anomaly_th = $scope.panel.anomaly_th;
      var sort_field = '&sort='+'start_timestamp_l'+'%20asc';
      var rows_limit = '&rows='+$scope.panel.max_rows;
      var facet = '';
      var fl = '';
      fq = fq + '&fq=anomaly_f:[' + anomaly_th + '%20TO%20*]'; 
      fq = fq + '&fq=result_s:ad';
      var mypromises = [];
      var arr_id = [];
      var index = 0;
      _.each($scope.panel.fields, function(metric) {
        var temp_fq = fq + '&fq=ad_name_s:'+metric;
        var temp_q = 'q=*:*' + wt_json + rows_limit + temp_fq + facet + fl + sort_field;
        $scope.panel.queries.query += temp_q + "\n";
        if ($scope.panel.queries.custom !== null) {
          request = request.setQuery(temp_q + $scope.panel.queries.custom);
        } else {
          request = request.setQuery(temp_q);
        }
        mypromises.push(request.doSearch());
        arr_id.push(index);
        index += 1;
      });

      $scope.data = [];
      if (dashboard.current.services.query.ids.length >= 1) {
        $q.all(mypromises).then(function(results) {
          $scope.panelMeta.loading = false;
          // Convert facet ids to numbers
          // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
          //var facetIds = [0]; // Need to fix this

          // Make sure we're still on the same query/queries
          // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
          // if ($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
          var i = 0,
            time_series,
            hits;

          _.each(arr_id, function(id,index) {
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
              hits = 0;
              $scope.hits = 0;
            }
            var entry_time, entries, entry_value;
            $scope.data[i] = results[index].response.docs;
            i++;
          });

          // Tell the histogram directive to render.
          $scope.$emit('render');
        });
      }
    };
  });

  module.directive('adChart', function(querySrv,dashboard,filterSrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {

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
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
		  
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          var heatmap_id = scope.$id;
          require(['echarts'], function(ec){

            var echarts = require('echarts');
          if(myChart) {
            myChart.dispose();
          }
          var mertic = scope.panel.metric_field;
          var labelcolor = false;
          if (dashboard.current.style === 'dark'){
              labelcolor = true;
          }
          var cut_number = scope.panel.cut_number + 1;
          var myChart = echarts.init(document.getElementById(heatmap_id));
          var start_time = Date.parse(new Date(scope.get_time_range()['from']));
          var end_time = Date.parse(new Date(scope.get_time_range()['to']));
          var step = (end_time-start_time)/cut_number+1;
          var metrics = scope.panel.fields;
          var dates = [];
          var timestamps = [];
          if (DEBUG) console.log(scope.get_time_range());
          if (DEBUG) console.log(start_time);

          for (var timestamp = start_time; timestamp <= end_time; timestamp += step) {
              timestamps.push(timestamp);
              dates.push(
                  echarts.format.formatTime('yyyy/MM/dd hh:mm:ss', timestamp)
              );
          }
          var metric_index = 0;
          var arrays = [];
          if (DEBUG) console.log(metrics);
          for (var i = 0; i < dates.length; i++) {
              var array = [];
              for (var j = 0; j < metrics.length; j++) {
                  array.push([]);
              }
              arrays.push(array);
          }
          
          chartData.map(function (metric_anomaly) {
              metric_anomaly.map(function (anomaly) {
                  var date_index = Math.floor((anomaly['start_timestamp_l'] - start_time) / step);
                  if (date_index >= 0) {
                      var anomaly_date = echarts.format.formatTime('yyyy/MM/dd hh:mm:ss', anomaly['start_timestamp_l']);
                      var metric_value = anomaly.value_f;
                      var anomaly_value = anomaly.anomaly_f;
                      var from_timestamp = timestamps[date_index];
                      var to_timestamp = timestamps[date_index]+step;
                      var solr_reader_url = anomaly.solr_reader_url_s;
                      var solr_writer_url = anomaly.solr_writer_url_s;
                      var stats_facet = anomaly.stats_facet_s;
                      var facet_name = anomaly.facet_name_s;
                      arrays[date_index][metric_index].push({
                          date_index: date_index,
                          anomaly_date: dates[date_index],
                          anomaly_value: anomaly_value,
                          metric_value: metric_value,
                          from_timestamp: from_timestamp,
                          to_timestamp: to_timestamp,
                          solr_reader_url : solr_reader_url,
                          solr_writer_url :　solr_writer_url,
                          stats_facet : stats_facet,
                          facet_name : facet_name
                      });
                  }
              });
              metric_index += 1;
          });
          var data = [];
          var max_num = 0;
          for (var date_index = 0; date_index < dates.length; date_index++) {
              for (var metric_index = 0; metric_index < metrics.length; metric_index++) {
                  if (arrays[date_index][metric_index].length > 0) {
                      data.push([date_index,metric_index,arrays[date_index][metric_index].length]);
                  }
                  if (arrays[date_index][metric_index].length > max_num) {
                      max_num = arrays[date_index][metric_index].length;
                  }
              }
          }
          if (DEBUG) console.log(max_num);
          var option = {
              tooltip: {
                  show: false
              },
              animation: false,
              grid: {
                  height: '50%',
                  y: '10%'
              },
              xAxis: {
                  type: 'category',
                  data: dates,
                  splitArea: {
                      show: true
                  },
                  axisLine:{  
                      lineStyle:{
                          color:'#aaaaaa',  
                          width:1
                      }
                  }
              },
              yAxis: {
                  type: 'category',
                  data: metrics,
                  splitArea: {
                      show: true
                  },
                  axisLine:{  
                      lineStyle:{
                          color:'#aaaaaa',  
                          width:1
                      }
                  }
              },
              visualMap: {
                  min: 0,
                  max: max_num,
                  calculable: true,
                  orient: 'horizontal',
                  left: 'center',
                  bottom: '15%',
                  show: false
              },
              series: [{
                  name: 'anomaly',
                  type: 'heatmap',
                  data: data,
                  label: {
                      normal: {
                          show: true
                      }
                  }
              }]
          };

          myChart.setOption(option);

          myChart.on('click', function (params) {
              if (DEBUG) console.log(params);
              var anomaly_th = scope.panel.anomaly_th;
              var x = params.data[0];
              var y = params.data[1];
              var from_timestamp = arrays[x][y][0].from_timestamp;
              var to_timestamp = arrays[x][y][0].to_timestamp;
              var fq = 'fq=start_timestamp_l:[' + Math.floor(from_timestamp) + '%20TO%20' + Math.floor(to_timestamp)+']';
              fq = fq + '&fq=ad_name_s:' + metrics[params.data[1]];
              var anomaly_fq = fq + '&fq=anomaly_f:[' + anomaly_th + '%20TO%20*]'; 
              if (DEBUG) console.log(fq);
              _.defaults(dashboard.current,{anomaly_fq:''});
              _.defaults(dashboard.current,{anomaly_name:''});
              _.defaults(dashboard.current,{anomaly_solr_reader_url:''});
              _.defaults(dashboard.current,{anomaly_stats_facet:''});
              _.defaults(dashboard.current,{anomaly_facet_name:''});
              _.defaults(dashboard.current,{fq:''});
              dashboard.current.anomaly_fq = anomaly_fq;
              dashboard.current.fq = fq;
              dashboard.current.anomaly_name = metrics[params.data[1]];
              dashboard.current.anomaly_solr_reader_url = arrays[x][y][0].anomaly_solr_reader_url;
              dashboard.current.anomaly_stats_facet = arrays[x][y][0].anomaly_stats_facet;
              dashboard.current.anomaly_facet_name = arrays[x][y][0].anomaly_facet_name;
              /* filterSrv.set({
                  type  : 'time',
                  from  : moment.utc(Number(from_timestamp)).toDate(),
                  to    : moment.utc(Number(to_timestamp)).toDate(),
                  field : filterSrv.getTimeField()
              }); */
              dashboard.refresh();
          });
        });
        }
      }
    };
  });


});
