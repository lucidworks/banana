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
  './timeSeries',

  'jquery.flot',
  'jquery.flot.pie',
  'jquery.flot.selection',
  'jquery.flot.time',
  'jquery.flot.stack',
  'jquery.flot.stackpercent',
  'jquery.flot.axislabels'
],
function (angular, app, $, _, kbn, moment, timeSeries) {
  'use strict';

  var module = angular.module('kibana.panels.bmwdashboard', []);
  app.useModule(module);

  module.controller('bmwdashboard', function($scope, $translate,$q, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {

      editorTabs : [
        {
          title:$translate.instant('Queries'),
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Stable",
      description : ""
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
      max_rows    : 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      reverse     :0,
	  segment	  :4,
	  threshold_first:1000,
	  threshold_second:2000,
	  cpu_first:50,
	  cpu_second:70,
	  memory_first:1500,
	  memory_second:1800,
	  value_field : null,
      group_field : null,
      auto_int    : true,
        linkage_id:'a',
	  total_first :'%',
	  fontsize:20,
	  field_color:'#209bf8',
      resolution  : 100,
      interval    : '5m',
      intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
      fill        : 0,
      linewidth   : 3,
      timezone    : 'browser', // browser, utc or a standard timezone
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      display:'block',
      icon:"icon-caret-down",
      stack       : true,
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
        var threshold_1 = '*';
        var threshold_2 = '*';

          var temp_q = "";
          if ($scope.panel.mode === 'value' || $scope.panel.mode === 'counts') {
            var arr_id = [0];
            if ($scope.panel.segment === 4) {
                arr_id = [0, 1, 2, 3];

                threshold_1 = String($scope.panel.threshold_first);
                threshold_2 = String($scope.panel.threshold_second);
                // = String($scope.panel.threshold_third);
            }

            _.each(arr_id, function (id) {
                if (id === 0) {
                    //temp_q = temp_q.replace(/responseElapsed%3A%5B0%20TO%2020000%5D/,"connectElapsed%3A%5B0%20TO%2020000%5D");
                     temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
                }
                else if (id === 1) {
                    //temp_q = temp_q.replace(/responseElapsed%3A%5B20000%20TO%2030000%5D/,"connectElapsed%3A%5B20000%20TO%2030000%5D");
                     temp_q = 'q=' + $scope.panel.value_field1 + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + '&fl=' + time_field + ' ' + $scope.panel.value_field1;
                } else if (id === 2) {
                    //temp_q = temp_q.replace("responseElapsed%3A%5B30000%20TO%20*%5D","connectElapsed%3A%5B30000%20TO%20*%5D");
                    temp_q = 'q=' + $scope.panel.value_field2 + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + '&fl=' + time_field + ' ' + $scope.panel.value_field2;
                } else if (id === 3) {
                    //var temp_q = 'q='+$scope.panel.value_field + '%3A%5B' +threshold_3+'%20TO%20'+'*'+'%5D'+wt_json + rows_limit + fq + facet + values_mode_query;
                     temp_q = 'q=' + $scope.panel.value_field3 + '%3A%5B' + '*' + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + '&fl=' + time_field + ' ' + $scope.panel.value_field3;

                }


                $scope.panel.queries.query += temp_q + "\n";
                if ($scope.panel.queries.custom !== null) {
                    request = request.setQuery(temp_q + $scope.panel.queries.custom);
                } else {
                    request = request.setQuery(temp_q);
                }
                mypromises.push(request.doSearch());
            });


        } else {

            _.each($scope.panel.queries.ids, function (id) {
                 temp_q = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet + values_mode_query;

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

                _.each($scope.panel.queries.ids, function (id, index) {
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
                    $scope.data[3] = results[3].response.docs;


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

   module.directive('bmwdashboardChart', function(querySrv,dashboard,filterSrv) {
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
		 
		  var AP_1 = 0.0;
		  var AP_2 = 0.0;
		  var AP_n = 0.0;
		  AP_n = AP_n+chartData[0].length;
		  for (var i = 0; i < chartData[0].length; i++) {
			  if(parseInt(chartData[0][i].responseElapsed)<=scope.panel.threshold_first ){
			  AP_1+=1;
			  }else if(parseInt(chartData[0][i].responseElapsed)<scope.panel.threshold_second && parseInt(chartData[0][i].responseElapsed)>scope.panel.threshold_first){
			  AP_2+=1*0.5;
			  }
		  }
		var APdex_1 =100;
		if(AP_n !== 0){
		APdex_1 = parseInt(100*(AP_1+AP_2)/AP_n);
		
		}
		
		 var AP_1_conn = 0.0;
		  var AP_2_conn = 0.0;
		  var AP_n_conn = 0.0;
		  AP_n_conn = AP_n_conn+chartData[1].length;
		  for (var i1 = 0; i1 < chartData[1].length; i1++) {
			  if(parseInt(chartData[1][i1].connectElapsed)<=scope.panel.threshold_first ){
			  AP_1_conn+=1;
			  }else if(parseInt(chartData[1][i1].connectElapsed)<scope.panel.threshold_second && parseInt(chartData[1][i1].connectElapsed)>scope.panel.threshold_first){
			  AP_2_conn+=1*0.5;
			  }
		  }
		var APdex_conn =100;
		if(AP_n_conn!==0){
		APdex_conn = parseInt(100*(AP_1_conn+AP_2_conn)/AP_n_conn);
		
		}
		
		var AP_1_cpu = 0.0;
		  var AP_2_cpu = 0.0;
		  var AP_n_cpu = 0.0;
		  AP_n_cpu = AP_n_cpu+chartData[2].length;
		  for (var i2 = 0; i2 < chartData[2].length; i2++) {
			  if(parseInt(chartData[2][i2].cpu)<=scope.panel.cpu_first){
			  AP_1_cpu+=1;
			  }else if(parseInt(chartData[2][i2].cpu)<scope.panel.cpu_second&& parseInt(chartData[2][i2].cpu)>scope.panel.cpu_first){
			  AP_2_cpu+=1*0.5;
			  }
		  }
		var APdex_cpu =100;
		if(AP_n_cpu!==0){
		APdex_cpu = parseInt(100*(AP_1_cpu+AP_2_cpu)/AP_n_cpu);
		
		}
		
		var AP_1_me = 0.0;
		  var AP_2_me = 0.0;
		  var AP_n_me = 0.0;
		  AP_n_me = AP_n_me+chartData[3].length;
		  for (var i3 = 0; i3 < chartData[3].length; i3++) {
			  if(parseInt(chartData[3][i3].UsedMemery)<=scope.panel.memory_first ){
			  AP_1_me+=1;
			  }else if(parseInt(chartData[3][i3].UsedMemery)<scope.panel.memory_second && parseInt(chartData[3][i3].UsedMemery)>scope.panel.memory_first){
			  AP_2_me+=1*0.5;
			  }
		  }
		var APdex_me =100;
		if(AP_n_me!==0){
		APdex_me = parseInt(100*(AP_1_me+AP_2_me)/AP_n_me);
		
		}
		var APdex = 100;
		if(APdex>APdex_1){
			APdex = APdex_1;
		}
		if (APdex>APdex_conn){
			APdex=APdex_conn;
		}
		if (APdex>APdex_cpu){
			APdex=APdex_cpu;
		}
		if (APdex>APdex_me){
			APdex=APdex_me;
		}
		//APdex = parseInt(0.1*APdex_1+0.1*APdex_conn+0.4*APdex_cpu+0.4*APdex_me);
		//APdex = parseInt(0.5*APdex_cpu+0.5*APdex_me);

		
		var idd = scope.$id;
          var echarts = require('echarts');

          // Populate element
            try {
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'dashboard') {
				  
				  
		/*		  var g1 = new JustGage({
        id: idd,
        value: health,
        min: 0,
        max: 500,
        symbol: '%',
        pointer: true,
        pointerOptions: {
          toplength: -15,
          bottomlength: 10,
          bottomwidth: 12,
          color: '#8e8e93',
          stroke: '#ffffff',
          stroke_width: 3,
          stroke_linecap: 'round'
        },
        gaugeWidthScale: 0.6,
        counter: true
        
      });
		*/		  
				  
			var myChart = echarts.init(document.getElementById(idd));

        // 指定图表的配置项和数据
    /*    var option = {
    tooltip : {
        formatter: "{a} <br/>{b} : {c}%"
    },
   
    series: [
        {
            name: 'Health',
            type: 'gauge',
			radius:'100%',
			startAngle:225,
			endAngle:-45,
			axisLine: {
				 lineStyle: { 
				   color:[[0.6, '#28B294'], [0.8, '#F6AB60'], [1, '#EB5768']]
				 }
				
			},
			title:{
				
				textStyle:{
					color:'#d9d9d9',
					fontWeight:'bold',
					fontFamily:'Microsoft YaHei'
				}
			},
            detail: {formatter:'{value}%'},
            data: [{value:health , name: 'Health State'}]
        }
    ]
};
*/
var option = {
   
   
    toolbox: {
        show : false,
        feature : {
            mark : {show: false},
            restore : {show: false},
            saveAsImage : {show: false}
        }
    },
	grid: {
        left: '0%',
        right: '0%',
        bottom: '0%',
		top: 90
    },
    series : [
        {
            name:'Health',
			 
            type:'gauge',
            min:100,
            max:0,
            splitNumber:10,
            radius: '96%',
            axisLine: {            // 坐标轴线
                lineStyle: {       // 属性lineStyle控制线条样式
                    color: [[0.5, '#1e90ff'],[0.8, '#F6AB60'],[1, '#EB5768']],
                    width: 5,
                    shadowColor : '#ddfdfa', //默认透明
                    shadowBlur: 40
                }
            },
            axisLabel: {            // 坐标轴小标记
                textStyle: {       // 属性lineStyle控制线条样式
                    fontWeight: 'bolder',
                    color: '#fff',
                    shadowColor : '#fff', //默认透明
                    shadowBlur: 40,
					fontStyle: 'italic',
					fontSize:scope.panel.fontsize
                }
            },
            axisTick: {            // 坐标轴小标记
                length :18,        // 属性length控制线长
                lineStyle: {       // 属性lineStyle控制线条样式
                    color: 'auto',
                    shadowColor : '#fff', //默认透明
                    shadowBlur: 40
                }
            },
            splitLine: {           // 分隔线
                length :28,         // 属性length控制线长
                lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                    width:4,
                    color: '#fff',
                    shadowColor : '#fff', //默认透明
                    shadowBlur: 40
                }
            },
            pointer: {           // 分隔线
               length:'90%',
				width:3
            },
			itemStyle:{
				normal:{
					color:'#fff',
					shadowColor: '#f55351',
					shadowBlur: 30,
					borderWidth:2,
					borderColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
						offset: 0, color: 'red' // 0% 处的颜色
						}, {
						offset: 0.7, color: '#f8750d' // 100% 处的颜色
						},{
					offset: 1, color: '#fff' // 100% 处的颜色
					}], false)
				},
				emphasis:{
					color:'#fff',
					shadowColor: '#fff',
					shadowBlur: 30,
					borderWidth:2,
					borderColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
						offset: 0, color: 'red' // 0% 处的颜色
						}, {
						offset: 0.7, color: '#50d1f1' // 100% 处的颜色
						},{
					offset: 1, color: '#fff' // 100% 处的颜色
					}], false)
					
				}
			},
            title : {
                textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                    fontWeight: 'bolder',
                    fontSize: scope.panel.fontsize+20,
                    fontStyle: 'italic',
                    color: '#fff',
                    shadowColor : '#fff', //默认透明
                    shadowBlur: 40
                }
            },
            detail : {
				formatter:'{value}%',
                      // x, y，单位px
                textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                    fontWeight: 'bolder',
                    color: '#fff',
					fontSize:scope.panel.fontsize+10
                }
            },
            data:[{value: APdex, name: 'Health State'}]
        }
     
    ]
};


        // 使用刚指定的配置项和数据显示图表。
			  myChart.setOption(option);
			  }
			  
			  
			  
			  
			 
             

              // Populate legend
              

            } catch(e) {
              elem.text(e);
            }
         
        }

        elem.bind("plotclick", function (event, pos, object) {
          if(object) {
            scope.build_search(scope.data[object.seriesIndex]);
            scope.panel.lastColor = object.series.color;
          }
        });

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar'  ? item.datapoint[1] : item.datapoint[1][0][1];
            // if (scope.panel.mode === 'count') {
            //   value = value.toFixed(0);
            // } else {
            //   value = value.toFixed(scope.panel.decimal_points);
            // }
            $tooltip
              .html(
                kbn.query_color_dot(item.series.color, 20) + ' ' +
                item.series.label + " (" + dashboard.numberWithCommas(value.toFixed(scope.panel.decimal_points)) +")"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });

      }
    };
  });

});
