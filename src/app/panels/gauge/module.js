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
  'd3'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.gauge', []);
  app.useModule(module);

  module.controller('gauge', function($scope, $timeout,$translate, timer, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {

      exportfile: true,
      editorTabs : [
        {title:$translate.instant('Queries'), src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : ""
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
        display:'block',
        icon:"icon-caret-down",
      missing : false,
      clickEnable:false,
      other   : false,
      size    : 10000,
      sortBy  : 'count',
	  threshold_first:3000,
	  threshold_second:5000,
      order   : 'descending',
      style   : { "font-size": '10pt'},
	  fontsize:20,
	  title_defined:false,
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
        linkage_id:'a',
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



            var sum = 0;
            var k = 0;
            var missing = 0;
            $scope.panelMeta.loading = false;
            $scope.hits = results.response.numFound;
            $scope.data = [];

            var AP_1 = 0.0;
            var AP_2 = 0.0;
            var AP_n = 0.0;
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
                            AP_n += count;
                            if (parseInt(term) <= $scope.panel.threshold_first) {
                                AP_1 += count;
                            } else if (parseInt(term) < $scope.panel.threshold_second && parseInt(term) > $scope.panel.threshold_first) {
                                AP_2 += count * 0.5;
                            }

                        }
                    }
                });
                $scope.apdex = 100;
                if (AP_n !== 0) {
                    $scope.apdex = parseInt(100 * (AP_1 + AP_2) / AP_n);
                }
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
            filterSrv.set({
                type: 'terms', field: $scope.panel.field, value: term.label,
                mandate: (negate ? 'mustNot' : 'must')
            });
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

  module.directive('gaugeChart', function(querySrv,dashboard) {
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
			
			elem.html("");

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.

		var idd = scope.$id;
    var echarts = require('echarts');


            var audio = document.getElementById("bgMusic");

            // Populate element
            try {
				
				var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
              // Add plot to scope so we can build out own legend
        if(scope.panel.chart === 'gauge') {
				  if(scope.apdex<80){
                      //var audio = new Audio("vendor/alarm/alarm.wav");
                      dashboard.current.alarm = true;
                      audio.play();
                      audio.muted = dashboard.current.mute;

                  }

          if(scope.apdex>=80&&dashboard.current.alarm){
                      dashboard.current.alarm = false;
                      audio.pause();
                      audio.currentTime = 0;
                  }
          if(myChart) {
                  myChart.dispose();
                }
				  var term  = "告警";
          var color_term = "#F6AB60";
          if(scope.apdex<=20){
                      term  = "风险";
                      color_term = '#EB5768';
                  }else if(scope.apdex>60){
                      term  = "健康";
                      color_term = '#1e90ff';
                  }

          myChart = echarts.init(document.getElementById(idd));


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
                                      //默认透明
                                      shadowBlur: 50,
                                      type:'dotted',
                                      shadowColor : '#ddfdfa',
                                      opacity:labelcolor?1:0
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
                                  length :15,        // 属性length控制线长
                                  lineStyle: {       // 属性lineStyle控制线条样式
                                      color: 'auto',
                                      width:3,
                                      type:'dotted',
                                      shadowColor : labelcolor?'#fff':'#00008B',
                                      shadowBlur: 50
                                  }
                              },
                              splitLine: {           // 分隔线
                                  length :25,         // 属性length控制线长
                                  lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
                                      width:2,
                                      color:  labelcolor?'#fff':'auto',
                                      type:'dotted',
                                      shadowColor : labelcolor?'#fff':'#f55351', //默认透明
                                      shadowBlur: 25
                                  }
                              },
                              pointer: {           // 分隔线
                                  length:'90%',
                                  width:2
                              },
                              itemStyle:{

                                  normal:{
                                      color:'#f55351',
                                      shadowColor: '#f55351',
                                      shadowBlur: 30,
                                      borderWidth:2,
                                      borderColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
                                          offset: 0, color: '#f55351' // 0% 处的颜色
                                      }, {
                                          offset: 0.86, color: '#f8750d' // 100% 处的颜色
                                      },{
                                          offset: 1, color: '#fff' // 100% 处的颜色
                                      }], false)
                                  },
                                  emphasis:{
                                      color:'#f55351',
                                      shadowColor: '#f55351',
                                      shadowBlur: 30,
                                      borderWidth:2,
                                      borderColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
                                          offset: 0, color: 'red' // 0% 处的颜色
                                      }, {
                                          offset: 0.86, color: '#50d1f1' // 100% 处的颜色
                                      },{
                                          offset: 1, color: '#fff' // 100% 处的颜色
                                      }], false)

                                  }
                              },
                              title : {
                                  textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                                      fontWeight: 'bolder',
                                      fontSize: scope.panel.fontsize+14,
                                      fontStyle: 'italic',
                                      color: labelcolor?'#fff':'#696969',
                                      shadowColor : '#fff', //默认透明
                                      shadowBlur: 40
                                  }
                              },
                              detail : {
                                  formatter:term+'\n\n\n{value}%',
                                  // x, y，单位px
                                  textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                                      fontWeight: 'bolder',
                                      color:  color_term,
                                      fontSize:scope.panel.fontsize+12
                                  }
                              },
                              data:[{value: scope.apdex, name:scope.panel.title_defined? scope.panel.title:'Health State'}]
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
            data:[{value: 0, name: scope.panel.title_defined? scope.panel.title+'(no data)':'Health State(no data)'}]
        }
     
    ]
};

          if(scope.hits==0){
            myChart.setOption(option_health_nodata);}else{
            myChart.setOption(option);
            if(scope.panel.clickEnable){
              myChart.on('click', function (params) {
                // 点击联动
                dashboard.page_switch('App_Demo_Performance')

              });
            }
          }
        // 使用刚指定的配置项和数据显示图表。
			  
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
