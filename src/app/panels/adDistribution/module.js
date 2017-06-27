/*

  ## Anomaly Detection Distribution

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
  var module = angular.module('kibana.panels.adDistribution', []);
  app.useModule(module);

  var DEBUG = true;
  console.log('DEBUG : ' + DEBUG);
  module.controller('adDistribution', function($scope, $q, $http, querySrv, dashboard, filterSrv, alertSrv) {
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


    $scope.build_query = function(filetype, isForExport) {
        // Build Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
            fq = '&' + filterSrv.getSolrFq();
        }
        if (dashboard.current.fq) {
            fq = fq + '&' + dashboard.current.fq;
        }
        var wt_json = '&wt=' + filetype;
        var rows_limit = isForExport ? '&rows=0' : ''; // for terms, we do not need the actual response doc, so set rows=0
        var facet = '';
        {
            // stats does not support something like facet.limit, so we have to sort and limit the results manually.
            facet = '&facet=on' + '&facet.range=anomaly_f' + '&facet.range.start=0.0' + '&facet.range.end=1.0' + '&facet.range.gap=0.1';
        }
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
      
      if (DEBUG) console.log($scope.panel.stats_field);

      var query = this.build_query('json', false);
      if (DEBUG) console.log(query);
      // Set the panel's query
      $scope.panel.queries.query = query;

      request.setQuery(query);

      results = request.doSearch();
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
          var missing = 0;
          $scope.panelMeta.loading = false;
          $scope.hits = results.response.numFound;
          $scope.data = [];

          {
              // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
              $scope.yaxis_min = null;
              if (DEBUG) console.log(results.facet_counts.facet_ranges.anomaly_f.counts);
              _.each(results.facet_counts.facet_ranges.anomaly_f.counts, function (facet_obj) {
                  k = k + 1;
                  if (k%2 === 0) {
                      $scope.data.push(facet_obj);
                  }
              });
              if (DEBUG) console.log($scope.data);
          }
          $scope.$emit('render');
      });
    };
  });

  module.directive('distributionChart', function(querySrv,dashboard,filterSrv) {
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

          var distribution_id = scope.$id;
          require(['echarts'], function(ec){
            var echarts = ec;
            if(myChart){
              myChart.dispose();
            }
            myChart = echarts.init(document.getElementById(distribution_id));
            var option = {
                title : {
                    text: '异常分值分布情况',
                    x:'center',
                    textStyle: {
                        fontWeight: 'bolder',
                        color: '#aaa'          // 主标题文字颜色
                    },

                },
                tooltip : {
                    trigger: 'item',
                    formatter: "异常分值在<big>{b}</big>之间的数量为: <big>{c} ({d}%)</big>"
                },
                legend: {
                    x : 'center',
                    y : 'bottom',
                    data:['[0.0 TO 0.1]','[0.1 TO 0.2]','[0.2 TO 0.3]','[0.3 TO 0.4]',
                    '[0.4 TO 0.5]','[0.5 TO 0.6]','[0.6 TO 0.7]','[0.7 TO 0.8]',
                    '[0.8 TO 0.9]', '[0.9 TO 1.0]']
                },
                toolbox: {
                    show : true,
                    feature : {
                        mark : {show: true},
                        dataView : {show: true, readOnly: false},
                        magicType : {
                            show: true,
                            type: ['pie', 'funnel']
                        },
                        restore : {show: true},
                        saveAsImage : {show: true}
                    }
                },
                calculable : true,
                series : [
                    {
                        name:'异常分布',
                        type:'pie',
                        radius : [30, 110],
                        roseType : 'area',
                        data:[
                            {value:scope.data[0], name:'[0.0 TO 0.1]'},
                            {value:scope.data[1], name:'[0.1 TO 0.2]'},
                            {value:scope.data[2], name:'[0.2 TO 0.3]'},
                            {value:scope.data[3], name:'[0.3 TO 0.4]'},
                            {value:scope.data[4], name:'[0.4 TO 0.5]'},
                            {value:scope.data[5], name:'[0.5 TO 0.6]'},
                            {value:scope.data[6], name:'[0.6 TO 0.7]'},
                            {value:scope.data[7], name:'[0.7 TO 0.8]'},
                            {value:scope.data[8], name:'[0.8 TO 0.9]'},
                            {value:scope.data[9], name:'[0.9 TO 1.0]'},
                        ]
                    }
                ]
            };
            myChart.setOption(option);
          });
        }
      }
    };
  });


});
