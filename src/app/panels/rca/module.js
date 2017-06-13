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
	var bmw_total;
	var bmw_total_disk;
	var bmw_total_memory;
  var module = angular.module('kibana.panels.rca', []);
  app.useModule(module);

  module.controller('rca', function($scope, $q, querySrv, dashboard, filterSrv) {
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
        display:'block',
        icon:"icon-caret-down",
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      max_rows    : 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      reverse     :0,
	  segment	  :4,
	  threshold_first:1000,
	  threshold_second:2000,
	  threshold_third:3000,
      group_field : null,
      auto_int    : true,
	  total_first :'%',
	  fontsize:20,
	  field_color:'#209bf8',
      resolution  : 100,
	  value_sort  :'rs_timestamp',
      interval    : '5m',
      intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
      fill        : 0,
      linewidth   : 3,
	  chart       :'stacking',
      chartColors :['#209bf8', '#f4d352','#ccf452','#8cf452','#3cee2b','#f467d8','#2fd7ee'],
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
      $scope.display=function() {
          if($scope.panel.display=='none'){
              $scope.panel.display='block';
              $scope.panel.icon="icon-caret-down";


          }else{
              $scope.panel.display='none';
              $scope.panel.icon="icon-caret-up";
          }
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
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);


      $scope.panel.queries.query = "";
      // Build the query
      _.each($scope.panel.queries.ids, function(id) {
        var query = $scope.sjs.FilteredQuery(
          querySrv.getEjsObj(id),
          filterSrv.getBoolFilter(filterSrv.ids)
        );

        var facet = $scope.sjs.DateHistogramFacet(id);
        if($scope.panel.mode === 'count' || $scope.panel.mode === 'counts') {
          facet = facet.field(filterSrv.getTimeField());
        } else {
          if(_.isNull($scope.panel.value_field)) {
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
	  var sort_s = '&sort='+$scope.panel.value_sort+'%20asc';
      var rows_limit = '&rows=0'; // for histogram, we do not need the actual response doc, so set rows=0
      var facet_gap = $scope.sjs.convertFacetGap($scope.panel.interval);
      var facet = '&facet=true' +
                  '&facet.range=' + time_field +
                  '&facet.range.start=' + start_time +
                  '&facet.range.end=' + end_time +
                  '&facet.range.gap=' + facet_gap;
      var values_mode_query = '';

      // For mode = value
      if($scope.panel.mode === 'values' || $scope.panel.mode === 'value' ) {
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
	  var staticfield = $scope.panel.value_field;
	  if ($scope.panel.mode === 'value' || $scope.panel.mode === 'counts'){
	    var arr_id =[0, 1];
        _.each(arr_id, function(id) {
        if (id === 0) {
          var temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
        }
        else if( id === 1){
          var temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + '&fl=' + time_field + ' anomaly_timestamp_s anomaly_score_f&fq=anomaly_timestamp_s:[* TO *]';
        }
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
        $q.all(mypromises).then(function(results) {
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
                // Bug fix for wrong event count:
                //   Solr don't need to accumulate hits count since it can get total count from facet query.
                //   Therefore, I need to set hits and $scope.hits to zero.
                // hits = $scope.data[i].hits;
                hits = 0;
                $scope.hits = 0;
              }

              // Solr facet counts response is in one big array.
              // So no need to get each segment like Elasticsearch does.
              var entry_time, entries, entry_value;
              $scope.data[i] = results[index].response.docs;
              i++;
            });

            // Tell the histogram directive to render.
            $scope.$emit('render');
          // }
        });
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

   module.directive('rcaChart', function(querySrv,dashboard,filterSrv) {
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

          if (filterSrv.idsByTypeAndField('terms',scope.panel.field).length > 0) {
            colors.push(scope.panel.lastColor);
          } else {
            colors = scope.panel.chartColors;
          }

          var idd = scope.$id;
         
          try {

            var labelcolor = false;
            if (dashboard.current.style === 'dark'){
                labelcolor = true;
            }

            var myChart = echarts.init(document.getElementById(idd));
            var option = {
              title: {},
              tooltip: {
                  trigger: 'axis',
                  axisPointer: {
                      animation: false
                  }
              },
              color: scope.panel.chartColors,
              legend: {
                  data:['流量','降雨量'],
                  x: 'left'
              },
              toolbox: {
                  feature: {
                      dataZoom: {
                          yAxisIndex: 'none'
                      },
                      restore: {},
                      saveAsImage: {}
                  }
              },
              grid: [{
                  left: 50,
                  right: 50,
                  height: '45%'
              }, {
                  left: 50,
                  right: 50,
                  top: '70%',
                  height: '10%',
              }],
              xAxis : [
                  {
                      show: false,
                      type : 'category',
                      boundaryGap : false,
                      axisLine: {onZero: true},
                      data: scope.data[0].map(function (item) {
                          return item.rs_timestamp[0];
                      }),
                  },
                  {
                      show: false,
                      gridIndex: 1,
                      type : 'category',
                      boundaryGap : true,
                      axisLine: {onZero: true},
                      data: scope.data[1].map(function (item) {
                          return item.anomaly_timestamp_s;
                      }),
                  }
              ],
              yAxis : [
                  {
                      name : '',
                      type : 'value',
                  },
                  {
                      gridIndex: 1,
                      type : 'value',
                      max : 1,
                      axisLabel: {show: false},
                      axisLine: {show: false},
                      axisTick: {show: false},
                      splitLine: {show: false}
                  }
              ],
              series : [
                  {
                      name:'',
                      type:'line',
                      data: scope.data[0].map(function (item) {
                          return item.cpu_f;
                      }),
                  },
                  {
                      name:'',
                      type:'bar',
                      xAxisIndex: 1,
                      yAxisIndex: 1,
                      data: scope.data[1].map(function (item) {
                          return item.anomaly_score_f;
                      }),
                  }
              ],
              "visualMap": {
                  "seriesIndex": 1,
                  "top": "10",
                  "right": "10",
                  "show": false,
                  "pieces": [
                      {
                          "color": "#096",
                          "gt": 0,
                          "lte": 0.5
                      },
                      {
                          "color": "#f48a52",
                          "gt": 0.5,
                          "lte": 0.8
                      },
                      {
                          "color": "#cc0033",
                          "gt": 0.8
                      }
                  ]
              }
          }
          myChart.setOption(option);
          } catch(e) {
              elem.text(e);
          }

          myChart.on('click', function (params) {
            console.log(params);
            filterSrv.set({
              type  : 'time',
              from  : moment.utc(Number(params.name)).toDate(),
              to    : moment.utc(Number(params.name) + 3600000).toDate(),
              field : filterSrv.getTimeField()
            });
              dashboard.refresh();
          });


        }



      }
    };
  });

});
