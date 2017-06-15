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
  'echarts',
  'd3',
  'viz',
  ],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.terms', []);
  app.useModule(module);

  module.controller('terms', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
          if($scope.panel.display === 'none'){
              $scope.panel.display='block';
              $scope.panel.icon="icon-caret-down";


          }else{
              $scope.panel.display='none';
              $scope.panel.icon="icon-caret-up";
          }
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
      var wt_json = '&wt=' + filetype;
      var rows_limit = isForExport ? '&rows=0' : ''; // for terms, we do not need the actual response doc, so set rows=0
      var facet = '';

      if ($scope.panel.mode === 'count') {
        facet = '&facet=true&facet.field=' + $scope.panel.field + '&facet.limit=' + $scope.panel.size + '&facet.missing=true';
      } else {
        // if mode != 'count' then we need to use stats query
        // stats does not support something like facet.limit, so we have to sort and limit the results manually.
        facet = '&stats=true&stats.facet=' + $scope.panel.field + '&stats.field=' + $scope.panel.stats_field + '&facet.missing=true';
      }
      facet += '&f.' + $scope.panel.field + '.facet.sort=' + ($scope.panel.sortBy || 'count');

      var exclude_length = $scope.panel.exclude.length;
      var exclude_filter = '';
      if(exclude_length > 0){
        for (var i = 0; i < exclude_length; i++) {
          if($scope.panel.exclude[i] !== "") {
            exclude_filter += '&fq=-' + $scope.panel.field +":"+ $scope.panel.exclude[i];
          }
        }
      }

      return querySrv.getORquery() + wt_json + rows_limit + fq + exclude_filter + facet + ($scope.panel.queries.custom != null ? $scope.panel.queries.custom : '');
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
        if(($scope.panel.linkage_id === dashboard.current.linkage_id)||dashboard.current.enable_linkage){
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
            var missing = 0;
            $scope.panelMeta.loading = false;
            $scope.hits = results.response.numFound;
            $scope.data = [];

            if ($scope.panel.mode === 'count') {
                // In count mode, the y-axis min should be zero because count value cannot be negative.
                $scope.yaxis_min = 0;
                _.each(results.facet_counts.facet_fields, function (v) {
                    for (var i = 0; i < v.length; i++) {
                        var term = v[i];
                        i++;
                        var count = v[i];
                        sum += count;
                        if (term === null) {
                            missing = count;
                        } else {
                            // if count = 0, do not add it to the chart, just skip it
                            if (count === 0) {
                                continue;
                            }
                            var slice = {label: term, data: [[k, count]], actions: true};
                            slice = addSliceColor(slice, term);
                            $scope.data.push(slice);
                        }
                    }
                });
            } else {
                // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
                $scope.yaxis_min = null;
                _.each(results.stats.stats_fields[$scope.panel.stats_field].facets[$scope.panel.field], function (stats_obj, facet_field) {
                    var slice = {label: facet_field, data: [[k, stats_obj[$scope.panel.mode]]], actions: true};
                    $scope.data.push(slice);
                });
            }
            // Sort the results
            $scope.data = _.sortBy($scope.data, function (d) {
                return $scope.panel.sortBy === 'index' ? d.label : d.data[0][1];
            });
            if ($scope.panel.order === 'descending') {
                $scope.data.reverse();
            }

            // Slice it according to panel.size, and then set the x-axis values with k.
            $scope.data = $scope.data.slice(0, $scope.panel.size);
            _.each($scope.data, function (v) {
                v.data[0][0] = k;
                k++;
            });

            if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("T") > -1) {
                $scope.hits = sum;
            }

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

            $scope.$emit('render');
        });
    }
    };

    $scope.build_search = function(term,negate) {

            if (_.isUndefined(term.meta)) {
                if ($scope.panel.chart === 'ebar') {
                    filterSrv.set({
                        type: 'terms', field: $scope.panel.field, value: term.name,
                        mandate: (negate ? 'mustNot' : 'must')
                    });
                } else {
                    filterSrv.set({
                        type: 'terms', field: $scope.panel.field, value: term.label,
                        mandate: (negate ? 'mustNot' : 'must')
                    });
                }
            } else if (term.meta === 'missing') {
                filterSrv.set({
                    type: 'exists', field: $scope.panel.field,
                    mandate: (negate ? 'must' : 'mustNot')
                });
            } else {
                return;
            }
            dashboard.current.linkage_id = $scope.panel.linkage_id;
            dashboard.current.enable_linkage = false;
            dashboard.refresh();


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

  module.directive('termsChart', function(querySrv,dashboard,filterSrv) {
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
			
			elem.html("");

                   // var el = elem[0];

                   // var parent_width = elem.parent().width();
                    //var    height = parseInt(scope.panel.height);

          //var 	outerRadius = height / 2 - 30;
         // var 	innerRadius = outerRadius / 3;
						
                    // var margin = {
                    //     top: 20,
                    //     right: 20,
                    //     bottom: 100,
                    //     left: 50
                    // };
                    //width = parent_width - margin.left - margin.right

                   
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
		 
		  var AP_1 = 0.0;
		  var AP_2 = 0.0;
		  var AP_n = 0.0;
		  for (var i = 0; i < chartData.length; i++) {
			  AP_n = AP_n+chartData[i].data[0][1];
			  if(parseInt(chartData[i].label)<=scope.panel.threshold_first ){
			  AP_1+=chartData[i].data[0][1];
			  }else if(parseInt(chartData[i].label)<scope.panel.threshold_second && parseInt(chartData[i].label)>scope.panel.threshold_first){
			  AP_2+=chartData[i].data[0][1]*0.5;
			  }
		  }
		var APdex =100;
		if(AP_n !== 0){
		APdex = parseInt(100*(AP_1+AP_2)/AP_n);
		//APdex = (AP_1+AP_2)/AP_n;
		}
		
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
    var echarts = require('echarts');
    //var d3 = require("d3");
    require(['jquery.flot.pie'], function(){
      // Populate element

				var labelcolor = false;
					if (dashboard.current.style === 'dark'){
            labelcolor = true;
          }
        // Add plot to scope so we can build out own legend
        if(scope.panel.chart === 'dashboard') {

          var myChart = echarts.init(document.getElementById(idd));

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
                          color: [[0.6, '#1e90ff'],[0.82, '#F6AB60'],[1, '#EB5768']],
                          width: 5,
                          shadowColor : '#ddfdfa', //默认透明
                          shadowBlur: 40
                      }
                  },
                  axisLabel: {            // 坐标轴小标记
                      textStyle: {       // 属性lineStyle控制线条样式
                          fontWeight: 'bolder',
                          color: labelcolor?'#fff':'#696969',
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
                          color: labelcolor?'#fff':'#696969',
                          shadowColor : '#fff', //默认透明
                          shadowBlur: 40
                      }
                  },
                  detail : {
              formatter:'{value}%',
                            // x, y，单位px
                      textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                          fontWeight: 'bolder',
                          color: labelcolor?'#fff':'#696969',
                fontSize:scope.panel.fontsize+10
                      }
                  },
                  data:[{value: APdex, name: 'Health State'}]
              }

          ]
      };

          var option_health_nodata = {


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
                          color: [[0.6, '#1e90ff'],[0.82, '#F6AB60'],[1, '#EB5768']],
                          width: 5,
                          shadowColor : '#ddfdfa', //默认透明
                          shadowBlur: 40
                      }
                  },
                  axisLabel: {            // 坐标轴小标记
                      textStyle: {       // 属性lineStyle控制线条样式
                          fontWeight: 'bolder',
                          color: labelcolor?'#fff':'#696969',
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
                          fontSize: scope.panel.fontsize+15,
                          fontStyle: 'italic',
                          color: labelcolor?'#fff':'#696969',
                          shadowColor : '#fff', //默认透明
                          shadowBlur: 40
                      }
                  },
                  detail : {
              formatter:'{value}%',
                            // x, y，单位px
                      textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                          fontWeight: 'bolder',
                          color: labelcolor?'#fff':'#696969',
                fontSize:scope.panel.fontsize+10
                      }
                  },
                  data:[{value: 0, name: 'Health State(no data)'}]
              }

          ]
      };

          if(chartData.length === 0){
              myChart.setOption(option_health_nodata);}else{
                 myChart.setOption(option);
              }
              // 使用刚指定的配置项和数据显示图表。


			  
			  }
			  
        if(scope.panel.chart === 'ebar') {
				  var arrdata = [];	
					var arrlabel = [];	
					var top4 = 5;
					if(top4>chartData.length){
						top4 = chartData.length;
					}
				  for (var i = 0; i < top4; i++) {
					  arrlabel[i] = chartData[i].label;
					  arrdata[i] = chartData[i].data[0][1];
				  }
				  
		
				  
			var myChart1 = echarts.init(document.getElementById(idd));

        
			var option1 = {
    color: ['#3398DB'],
    tooltip : {
        trigger: 'axis',
        axisPointer : {            // 坐标轴指示器，坐标轴触发有效
            type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
        }
    },
    grid: {
        left: '8%',
        right: '3%',
        bottom: '3%',
		top: '6%',
        containLabel: true
    },
    xAxis : [
        {
            type : 'category',
            data : arrlabel,
			axisLine:{
				show:false
			},
			axisLabel:{
				show:false,
				textStyle:{
					color:'#cde5fe',
					fontSize:16,
					
					
				}
				
			},
            axisTick: {
                alignWithLabel: false
            }
        }
    ],
    yAxis : [
        {
            type : 'value',
			splitLine: {
			show :true,
            lineStyle:{
                type:'dotted',
                color: '#0d394a'
            }
        },
		axisLabel:{
            textStyle:{
                color:labelcolor?'#fff':'#696969',
				fontSize:scope.panel.fontsize,
				fontStyle: 'italic'
            }
            
        },
			nameTextStyle:{
				
				color:'#fff',
				
				
			},
			axisLine:{
				show:false
			}
        }
    ],
    series : [
        {
            name:'Visit Top 5',
            type:'bar',
            barWidth: '43%',
            data:arrdata,
			itemStyle: {
				normal: {
					color: function(params) {              
            var colorList = ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
            return colorList[params.dataIndex];
            },
					shadowColor: '#fff',
					barBorderRadius: 5
                
            },
			emphasis: {
					color: function(params) {              
            var colorList = ['#ff951f', '#ff951f', '#ff951f', '#ff951f', '#ff951f', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
            return colorList[params.dataIndex];
            },
					shadowColor: '#fff',
					barBorderRadius: 5
                
            }
        }
        }
    ]
};


        // 使用刚指定的配置项和数据显示图表。
			  if(chartData.length === 0){
				myChart1.setOption(option_nodata);}else{
					myChart1.setOption(option1);
					myChart1.on('click', function (params) {
						// 控制台打印数据的名称
						scope.build_search(params);
					});
				}
			  }


			  
			  
			  if(scope.panel.chart === 'bar') {
				  
				  
               var yAxisConfig = {
                  show: true,
                  min: scope.yaxis_min,
                  color: "#c8c8c8"
                };
                if (scope.panel.logAxis) {
                  _.defaults(yAxisConfig, {
                    ticks: function (axis) {
                      var res = [], v, i = 1,
                        ticksNumber = 8,
                        max = axis.max === 0 ? 0 : Math.log(axis.max),
                        min = axis.min === 0 ? 0 : Math.log(axis.min),
                        interval = (max - min) / ticksNumber;
                      do {
                        v = interval * i;
                        res.push(Math.exp(v));
                        ++i;
                      } while (v < max);
                      return res;
                    },
                    transform: function (v) {
                      return v === 0 ? 0 : Math.log(v); },
                    inverseTransform: function (v) {
                      return v === 0 ? 0 : Math.exp(v); }
                  });
                }

                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    lines:  { show: false },
                    bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                    shadowSize: 1
                  },
                  // yaxis: { show: true, min: 0, color: "#c8c8c8" },
                  yaxis: yAxisConfig,
                  xaxis: { show: true },
                  grid: {
                    borderWidth: 0,
                    borderColor: '#eee',
                    color: "#eee",
                    hoverable: true,
                    clickable: true
                  },
                  colors: colors
                });
				
				if(chartData.length === 0){
				var myChart22222 = echarts.init(document.getElementById(idd));
				myChart22222.setOption(option_nodata);
					
				}
				
              }
              if(scope.panel.chart === 'pie') {

                var labelFormat = function(label, series){
                  return '<div ng-click="build_search(panel.field,\''+label+'\')'+
                    ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                    label+'<br/>'+Math.round(series.percent)+'%</div>';
                };
                // DEfulat style for labels that is implmented in jquery flot
                // var position = "";
                // if (scope.panel.counter_pos == "left")
                //   position = "nw";
                // else if (scope.panel.counter_pos == "right")
                //   position = "ne";

                plot = $.plot(elem, chartData, {
                  legend: {
                    show: false
                    // position: position,
                    // backgroundColor: "transparent"
                  },
                  series: {
                    pie: {
                      innerRadius: scope.panel.donut ? 0.4 : 0,
                      tilt: scope.panel.tilt ? 0.45 : 1,
                      radius: 1,
                      show: true,
                      combine: {
                        color: '#999',
                        label: 'The Rest'
                      },
                      stroke: {
                        width: 0
                      },
                      label: {
                        show: scope.panel.labels,
                        radius: 2/3,
                        formatter: labelFormat,
                        threshold: 0.1
                      }
                    }
                  },
                  //grid: { hoverable: true, clickable: true },
                  grid:   { hoverable: true, clickable: true },
                  colors: colors
                });
				if(chartData.length === 0){
				var myChart12222 = echarts.init(document.getElementById(idd));
				myChart12222.setOption(option_nodata);
					
				}
              }

              // Populate legend
              if(elem.is(":visible")){
                setTimeout(function(){
                  scope.legend = plot.getData();
                  if(!scope.$$phase) {
                    scope.$apply();
                  }
                });
              }

          });
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
