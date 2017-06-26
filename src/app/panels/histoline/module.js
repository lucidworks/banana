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
             You probably should just use a line chart without histoline
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

  var module = angular.module('kibana.panels.histoline', []);
  app.useModule(module);

  module.controller('histoline', function($scope, $q, querySrv, dashboard, filterSrv) {
    var _d;
      $scope.panelMeta = {

      editorTabs : [
        {
          title:'Queries',
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Stable",
        description : ""
      };

    // Set and populate defaults
      _d = {
          mode: 'value',
          queries: {
              mode: 'all',
              ids: [],
              query: '*:*',
              custom: ''
          },
          max_rows: 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
          reverse: 0,
          segment: 4,
          display:'block',
          icon:"icon-caret-down",
          threshold_first: 300,
          threshold_second: 400,
          threshold_third: 3000,
          group_field: null,
          linkage_id:'a',
          auto_int: true,
          area:false,
          total_first: '%',
          fontsize: 12,
          field_color: '#2ce41b',
          resolution: 100,
          value_sort: 'rs_timestamp',
          interval: '5m',
          intervals: ['auto', '1s', '1m', '5m', '10m', '30m', '1h', '3h', '12h', '1d', '1w', '1M', '1y'],
          fill: 0,
          linewidth: 3,
          chart: 'histoline',
          chartColors: ['#f48a52', '#f4d352', '#ccf452', '#8cf452', '#3cee2b', '#f467d8', '#1a93f9', '#2fd7ee'],
          timezone: 'browser', // browser, utc or a standard timezone
          spyable: true,
          linkage: false,
          zoomlinks: true,
          bars: true,
          average: false,
          label: true,
          points: false,
          lines: false,
          lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
          legend: true,
          'x-axis': true,
          'y-axis': true,
          percentage: false,
          interactive: true,
          options: false,
          show_queries: true,
          tooltip: {
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
          if($scope.panel.display==='none'){
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
        if(($scope.panel.linkage_id===dashboard.current.linkage_id)||dashboard.current.enable_linkage){
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
        var sort_s = '&sort=' + $scope.panel.value_sort + '%20asc';
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

                    // Solr facet counts response is in one big array.
                    // So no need to get each segment like Elasticsearch does.

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

   module.directive('histolineChart', function(querySrv,dashboard,filterSrv) {
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
          var  chartData;
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
		  var selecttime = [];

		  var secondtime ;
		  var maxdata= 0;
		  var sum_data = 0;
		  var sum_normal = 0;
		  var sum_risk = 0;
		  var sum_warning = 0;
         var xAxis = [],
             yAxis = [],
             data = [],
             series = [],
             seriesItem;
		  for (var i =0;i<chartData[0].length;i++){
		      var color_c= '#1a93f9';
		      var name_c = 'Normal';
			  sum_data++;
			  selecttime[i] =Date.parse(chartData[0][i][scope.panel.value_sort]);
			  secondtime = new Date(selecttime[i]);
              xAxis.push(secondtime.toLocaleString());
              yAxis.push(chartData[0][i][scope.panel.value_field]);
              data.push([secondtime.toLocaleString(),chartData[0][i][scope.panel.value_field]]);
			  if(maxdata<chartData[0][i][scope.panel.value_field]){
				   maxdata=chartData[0][i][scope.panel.value_field];
			  }
			  
			 if(chartData[0][i][scope.panel.value_field]>scope.panel.threshold_second){
				 sum_risk++;
                 name_c ='Risk';
                 color_c = '#ec4653';
				//  valuedata[i] ={name:"Risk",value:chartData[0][i][scope.panel.value_field],itemStyle:{normal:{color:'#c55249'}}};
			 }else if(chartData[0][i][scope.panel.value_field]<scope.panel.threshold_first){
				 sum_normal++;

			//	  valuedata[i] ={name:"Normal",value:chartData[0][i][scope.panel.value_field],itemStyle:{normal:{color:'#1a93f9'}}};
			}else{
				sum_warning++;
                 name_c ='Warning';
                 color_c = '#f48a52';
				//  valuedata[i] ={name:"Warning",value:chartData[0][i][scope.panel.value_field],itemStyle:{normal:{color:'#f48a52'}}};
			  }
              seriesItem = {
                  name: name_c,
                  type: 'line',
                  smooth: true,
                  symbolSize: 1,
                  data: data,
                  areaStyle: {
                      normal: {
                          color: color_c,
                          opacity: 0.8
                      }
                  },
                  itemStyle: {
                      normal: {
                          color: color_c,
                          borderWidth: 1,
                          borderType: 'solid'
                      }
                  }
              };
              series.push(seriesItem);
              data = [
                  [secondtime.toLocaleString(),chartData[0][i][scope.panel.value_field]]
              ];
		  }
		sum_risk= sum_risk*100/sum_data;
		sum_normal=sum_normal*100/sum_data;
		sum_warning=sum_warning*100/sum_data;
		sum_risk = sum_risk.toFixed(2);
	    sum_normal = sum_normal.toFixed(2); 
		sum_warning = sum_warning.toFixed(2);




		var idd = scope.$id;
          var echarts = require('echarts');
          if(myChart) {
            myChart.dispose();
          }
            // Populate element
            try {
				
				 var labelcolor = false;
				 var isspan = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
                if (scope.panel.span <5){
					    isspan = true;
                }
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'histoline') {
				  
				  

				  
			 myChart = echarts.init(document.getElementById(idd));
        
var option = {
    grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
    },
        legend: {

        data: [{
            name: 'Normal',
            icon: 'circle',
            textStyle: {
                color: labelcolor?'#DCDCDC':'#696969',
                fontSize: '14'
            }
        }, {
            name: 'Warning',
            icon: 'circle',
            textStyle: {
                color: labelcolor?'#DCDCDC':'#696969',
                fontSize: '14'
            }
        },{
            name: 'Risk',
            icon: 'circle',
            textStyle: {
                color: labelcolor?'#DCDCDC':'#696969',
                fontSize: '14'
            }
        }

        ]
    },

    dataZoom: [{
        type: 'inside',
        xAxisIndex: [0]
    }],
    tooltip : {
        trigger: 'axis'
    },
    xAxis : [
        {
            type : 'category',
            axisLine: {onZero: true},
            axisLabel:{
                textStyle:{
                    color:labelcolor?'#DCDCDC':'#696969'
                }
            },
            data : xAxis
        }
    ],

    yAxis : [
        {
            type : 'value',
            nameTextStyle:{
                color:labelcolor?'#DCDCDC':'#696969'
            },
            axisLine:{
                lineStyle:{
                    color:'#46474C'
                }
            },
            splitLine:{
                lineStyle:{
                    color:['#46474C']
                }
            },
            axisLabel:{
                textStyle:{
                    color:labelcolor?'#DCDCDC':'#696969'
                }
            }
        }
    ],
    series: series
};


        // 使用刚指定的配置项和数据显示图表。
			  myChart.setOption(option);
			  
			  myChart.on('datazoom', function (params) {

                  if (scope.panel.linkage) {
                      filterSrv.set({
                          type: 'time',
                          // from  : moment.utc(ranges.xaxis.from),
                          // to    : moment.utc(ranges.xaxis.to),
                          from: moment.utc(selecttime[params.batch[0].startValue]).toDate(),
                          to: moment.utc(selecttime[params.batch[0].endValue]).toDate(),
                          field: filterSrv.getTimeField()
                      });
                      dashboard.current.linkage_id = scope.panel.linkage_id;
                      dashboard.current.enable_linkage = false;
                      dashboard.refresh();
                  }

				});
			  
			  }

              // Populate legend
              

            } catch(e) {
              elem.text(e);
            }
         
        }
      

        
      }
    };
  });

});
