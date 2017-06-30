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
  var module = angular.module('kibana.panels.rc', []);
  app.useModule(module);

  var DEBUG = true;
  console.log('DEBUG : ' + DEBUG);
  module.controller('rc', function($scope, $q, $http, querySrv, dashboard, filterSrv, alertSrv) {
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

    $scope.build_anomaly_query = function(filetype, isForExport) {
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
        return querySrv.getORquery() + wt_json + rows_limit + fq + facet + ($scope.panel.queries.custom !== null ? $scope.panel.queries.custom : '');
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

      //*********************************** 拼查询url************
      var wt_json = '&wt=json';
      // var metric_field = $scope.panel.metric_field;
      //var anomaly_th = $scope.panel.anomaly_th;
      var sort_field = '&sort='+'timestamp_l'+'%20asc';
      //var rows_limit = '&rows='+$scope.panel.max_rows;
      // var facet = '';
      //var fl = '&fl=' + 'timestamp_l%20anomaly_value_d%20value_d';
      var fl = '&fl=' + 'nodes_s%20edges_s%20query_list';
      //fq = fq + '&fq=anomaly_value_d:[' + anomaly_th + '%20TO%20*]'; 
    
      //*********************************** end *******************

      var mypromises = [];
      //var temp_q = 'q=' + metric_field + ':' + metric + wt_json + rows_limit + fq + facet + fl + sort_field;
      var query_list = [];
      
      var temp_q = 'q=' + 'result_s:bn' +  wt_json ;
      query_list.push(temp_q);
    
      for (var i = 0; i < query_list.length; i++) {
      
        $scope.panel.queries.query += query_list[i] + "\n";
        
        if ($scope.panel.queries.custom !== null) {
          request = request.setQuery(query_list[i] + $scope.panel.queries.custom);
        } else {
          request = request.setQuery(query_list[i]);
        }
        mypromises.push(request.doSearch());
      }

      $scope.data = [];
      if (dashboard.current.services.query.ids.length >= 1) {
        $q.all(mypromises).then(function(results) {
          if (DEBUG) console.log(results);
          $scope.panelMeta.loading = false;
          // Convert facet ids to numbers
          // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
          //var facetIds = [0]; // Need to fix this

          // Make sure we're still on the same query/queries
          // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
          // if ($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
          var time_series, hits;
          for (var i = 0; i < query_list.length; i++) {
            if (!(_.isUndefined(results[i].error))) {
              $scope.panel.error = $scope.parse_error(results[i].error.msg);
              return;
            }
            $scope.data[i] = results[i].response.docs;
            if (DEBUG) console.log($scope.data[i]);
          }
          // Tell the histogram directive to render.
          $scope.$emit('render');
        });
      }
    };
  });

  module.directive('rcChart', function(querySrv,dashboard,filterSrv) {
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
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
		  
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));
          var cause_string = chartData[0][0][dashboard.current.bn_main_node+"_s"];
          var attr = [];
          var values = [];
          var cause2 = cause_string.split(",");

          for (var i = 0; i < cause2.length; i++) {
            var tmp = cause2[i].split(":");
            // alert(tmp[0]);
            // alert(tmp[1]);
            attr.push(tmp[0]);
            values.push(parseFloat(tmp[1]));
          }

          var graph_id = scope.$id;

          require(['echarts'], function(ec){
            var echarts = ec;
            if(myChart){
              myChart.dispose();
            }
            var labelcolor = false;
            if (dashboard.current.style === 'dark'){
              labelcolor = true;
            }
            var query_list = chartData[0][0].query_list_s.split("^");
            myChart = echarts.init(document.getElementById(graph_id));
            var x = parseInt(dashboard.current.bn_main_node);
            drawRelationChart(myChart, attr, values, query_list[x] + " 的根源性排序");

          });
          function drawRelationChart(myChart,attr, values, title_name) {

            var option = {
              title: {
                text: title_name
              },

              tooltip: {
                trigger: 'axis',
                axisPointer: {
                  type: 'shadow'
                }
              },

              grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
              },

              toolbox: {
                show: true,
                feature: {
                  dataView: {
                    show: true
                  },
                  restore: {
                    show: true
                  },
                  dataZoom: {
                    show: true
                  },
        //					saveAsImage: {
        //						show: true
        //					},
        //					magicType: {
        //						type: ['line', 'bar']
        //					}
                },

              },

              xAxis: {
                type: 'value',
                boundaryGap: [0, 0.01],
                'min' : 0,
                'max': 2
              },

              yAxis: {
                type: 'category',
                data: attr
              },

              series: [{
                name: title_name,
                type: 'bar',
                data: values
              }]
            };

            myChart.setOption(option);
          }




        }
      }
    };
  });


});
