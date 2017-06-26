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
    'echarts-liquidfill',

],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.avegauge', []);
  app.useModule(module);

  module.controller('avegauge', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {

      exportfile: true,
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
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
        meanEnable:true,
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
      chart       : 'avegauge',
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
        facet = '&fl=' + $scope.panel.field + '&sort='+filterSrv.getTimeField()+'%20desc'+'&rows='+$scope.panel.size;
      } else {
        // if mode != 'count' then we need to use stats query
        // stats does not support something like facet.limit, so we have to sort and limit the results manually.
        facet = '&stats=true&stats.facet=' + $scope.panel.field + '&stats.field=' + $scope.panel.stats_field + '&facet.missing=true';
      }

      var exclude_length = $scope.panel.exclude.length;
      var exclude_filter = '';
      if(exclude_length > 0){
        for (var i = 0; i < exclude_length; i++) {
          if($scope.panel.exclude[i] !== "") {
            exclude_filter += '&fq=-' + $scope.panel.field +":"+ $scope.panel.exclude[i];
          }
        }
      }
  if($scope.panel.meanEnable){
        fq += '&stats=true&stats.field='+$scope.panel.field;
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
          $scope.meandata = 0;
          $scope.meandata = parseInt(results.stats.stats_fields[$scope.panel.field].mean*100);

            $scope.panelMeta.loading = false;
            $scope.hits = results.response.numFound;
            $scope.data = results.response.docs;
            for(var j1=0;j1<$scope.data.length;j1++){
              if(typeof($scope.data[j1][$scope.panel.field])!=="undefined"){
                $scope.apdex = $scope.data[j1][$scope.panel.field];
                break;
              }
            }
            $scope.apdex = parseInt($scope.apdex);

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

  module.directive('avegaugeChart', function(querySrv,dashboard) {
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




            // Populate element
            try {
				
				var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
              // Add plot to scope so we can build out own legend
        if(scope.panel.chart === 'avegauge') {
			// 	  if(scope.apdex<80){
          //             //var audio = new Audio("vendor/alarm/alarm.wav");
          //             dashboard.current.alarm = true;
          //             audio.play();
          //             audio.muted = dashboard.current.mute;
          //
          //         }
          //
          // if(scope.apdex>=80&&dashboard.current.alarm){
          //             dashboard.current.alarm = false;
          //             audio.pause();
          //             audio.currentTime = 0;
          //         }
          if(myChart) {
                  myChart.dispose();
                }
				  var term  = "告警";
          var color_term = "#F6AB60";
          if(scope.meandata<=20){
                      term  = "风险";
                      color_term = '#EB5768';
                  }else if(scope.meandata>40){
                      term  = "健康";
                      color_term = '#1e90ff';
                  }else  if(isNaN(scope.meandata)){
                    term  = "没有数据";
                     color_term = "#000";
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
                              data:[{value: scope.meandata, name:scope.panel.title_defined? scope.panel.title:''}]
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
              formatter:'',
              // x, y，单位px
              textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                fontWeight: 'bolder',
                color:  color_term,
                fontSize:scope.panel.fontsize+12
              }
            },
            data:[{value:0, name: 'No Data'}]
        }
     
    ]
};

          if(isNaN(scope.meandata)){
            myChart.setOption(option_health_nodata);}else{
            myChart.setOption(option);

          }
        // 使用刚指定的配置项和数据显示图表。
			  
			  }

        if(scope.panel.chart === 'lastgauge') {

                if(myChart) {
                  myChart.dispose();
                }
                var term  = "告警";
                var color_term = "#F6AB60";
                if(scope.apdex>=80){
                  term  = "风险";
                  color_term = '#EB5768';
                }else if(scope.apdex<60){
                  term  = "健康";
                  color_term = '#1e90ff';
                }else  if(isNaN(scope.apdex)){
                  term  = "没有数据";
                  color_term = "#000";
                }

                myChart = echarts.init(document.getElementById(idd));


                var option1 = {
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
                      min:0,
                      max:100,
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
                      data:[{value: scope.apdex, name:scope.panel.title_defined? scope.panel.title:'健康度'}]
                    }

                  ]
                };




                var option_health_nodata1 = {


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
                      min:0,
                      max:100,
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
                        formatter:'',
                        // x, y，单位px
                        textStyle: {       // 其余属性默认使用全局文本样式，详见TEXTSTYLE
                          fontWeight: 'bolder',
                          color:  color_term,
                          fontSize:scope.panel.fontsize+12
                        }
                      },
                      data:[{value: 0, name: 'No data'}]
                    }

                  ]
                };

                if(isNaN(scope.apdex)){
                  myChart.setOption(option_health_nodata1);}else{
                  myChart.setOption(option1);

                }
                // 使用刚指定的配置项和数据显示图表。

              }
        if(scope.panel.chart === 'user'){
          if(myChart) {
            myChart.dispose();
          }
                myChart = echarts.init(document.getElementById(idd));
                var option5 = {
                  // title:{
                  //     text: '应用总数',
                  //     top:'50%',
                  //     left:'35%',
                  //     textStyle:{
                  //         color:'#1a93f9',
                  //         fontSize:20
                  //     }
                  // },
                  series: [{
                    center: ['25%', '40%'],
                    radius: '60%',
                    backgroundStyle: {
                      color: 'none',
                      borderColor: '#696969',
                      borderWidth: 1
                    },
                    type: 'liquidFill',
                    shape:"path://M195.881 276.192a231.925 231.925 0 1 0 474.66 0 231.925 231.925 0 1 0-474.66 0z m319.302 245.892c-26.938-5.649-54.45-8.56-81.972-8.56-52.265 0-104.52 10.393-152.807 30.398-48.287 20.004-92.586 49.6-129.547 86.552-36.952 36.961-66.547 81.26-86.55 129.547-20.006 48.288-30.4 100.542-30.4 152.806h464.619c-47.529-48.271-76.867-114.504-76.867-187.6 0.001-81.291 36.28-154.1 93.524-203.143z m214.004-64.272c-147.69 0-267.414 119.726-267.414 267.414 0 147.69 119.724 267.415 267.414 267.415s267.414-119.725 267.414-267.415c0-147.688-119.724-267.414-267.414-267.414z m-50.968 433.226L525.35 738.264l63.726-63.651 89.144 89.09L869.3 572.784l63.727 63.636",
                    data:[0.8, 0.6, 0.3],
                    outline: {
                      show: false
                    },
                    label: {
                      normal: {
                        position: 'bottom',
                        // formatter: '应用总数:'+scope.data.length+"个",
                        formatter: "",
                        textStyle: {
                          color: '#178ad9',
                          fontSize: scope.panel.fontsize
                        }
                      }
                    }
                  },{
                    name: '',
                    type: 'pie',
                    center: ['65%', '40%'],
                    clockWise: true,
                    hoverAnimation: false,
                    radius: [60, 60],
                    label: {
                      normal: {
                        position: 'center'
                      }
                    },
                    data: [{
                      value: 10,
                      label: {
                        normal: {
                          formatter: '',
                          textStyle: {
                            color: '#1a93f9',
                            fontSize: scope.panel.fontsize
                          }
                        }
                      },
                      itemStyle:{
                        normal:{
                          color:'#1a93f9',
                        }
                      }
                    }, {
                      tooltip: {
                        show: false
                      },
                      label: {
                        normal: {
                          formatter: '在线用户:'+scope.apdex,
                          textStyle: {
                            color: '#1a93f9',
                            fontSize: scope.panel.fontsize,
                            fontWeight: 'bold'
                          }
                        }
                      }
                    }]
                  }
                    // ,
                    // {
                    //         name: '',
                    //         type: 'pie',
                    //         center: ['37%', '85%'],
                    //         clockWise: true,
                    //         hoverAnimation: false,
                    //         radius: [60, 60],
                    //         label: {
                    //             normal: {
                    //                 position: 'center'
                    //             }
                    //         },
                    //         data: [{
                    //             value: 10,
                    //             label: {
                    //                 normal: {
                    //                     formatter: '崩溃率',
                    //                     textStyle: {
                    //                         color: '#d9e0e7',
                    //                         fontSize: 13
                    //                     }
                    //                 }
                    //             },
                    //             itemStyle:{
                    //                 normal:{
                    //                     color:'#1a93f9',
                    //                 }
                    //             }
                    //         }, {
                    //             tooltip: {
                    //                 show: false
                    //             },
                    //             label: {
                    //                 normal: {
                    //                     formatter: '\n1%',
                    //                     textStyle: {
                    //                         color: '#1a93f9',
                    //                         fontSize: 22,
                    //                         fontWeight: 'bold'
                    //                     }
                    //                 }
                    //             }
                    //         }]
                    //     },{
                    //         name: '',
                    //         type: 'pie',
                    //         center: ['62%', '85%'],
                    //         clockWise: true,
                    //         hoverAnimation: false,
                    //         radius: [60, 60],
                    //         label: {
                    //             normal: {
                    //                 position: 'center'
                    //             }
                    //         },
                    //         data: [{
                    //             value: 100,
                    //             label: {
                    //                 normal: {
                    //                     formatter: 'HTTP错误率',
                    //                     textStyle: {
                    //                         color: '#d9e0e7',
                    //                         fontSize: 13
                    //                     }
                    //                 }
                    //             },
                    //             itemStyle:{
                    //                 normal:{
                    //                     color:'#1a93f9',
                    //                 }
                    //             }
                    //         }, {
                    //             tooltip: {
                    //                 show: false
                    //             },
                    //             label: {
                    //                 normal: {
                    //                     formatter: '\n8%',
                    //                     textStyle: {
                    //                         color: '#1a93f9',
                    //                         fontSize: 22,
                    //                         fontWeight: 'bold'
                    //                     }
                    //                 }
                    //             }
                    //         }]
                    //     },{
                    //         name: '',
                    //         type: 'pie',
                    //         center: ['88%', '85%'],
                    //         clockWise: true,
                    //         hoverAnimation: false,
                    //         radius: [60, 60],
                    //         label: {
                    //             normal: {
                    //                 position: 'center'
                    //             }
                    //         },
                    //         data: [{
                    //             value: 10,
                    //             label: {
                    //                 normal: {
                    //                     formatter: '网络错误率',
                    //                     textStyle: {
                    //                         color: '#d9e0e7',
                    //                         fontSize: 13
                    //
                    //                     }
                    //                 }
                    //             },
                    //             itemStyle:{
                    //                 normal:{
                    //                     color:'#1a93f9',
                    //                 }
                    //             }
                    //         }, {
                    //             tooltip: {
                    //                 show: false
                    //             },
                    //             label: {
                    //                 normal: {
                    //                     formatter: '\n12%',
                    //                     textStyle: {
                    //                         color: '#1a93f9',
                    //                         fontSize: 22,
                    //                         fontWeight: 'bold'
                    //                     }
                    //                 }
                    //             }
                    //         }]
                    //     }
                  ],
                  tooltip: {
                    show: false
                  }
                };

                myChart.setOption(option5);
                myChart.on('click', function (params) {
                  // 点击联动
                  scope.build_search(params);
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
