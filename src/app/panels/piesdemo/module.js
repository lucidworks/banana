/*
  ## pies

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
  'kbn'

],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.pies', []);
  app.useModule(module);

  module.controller('piesdemo', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
      sortBy  : 'count',
      order   : 'descending',
      fontsize   : 12,
      donut   : false,
      tilt    : false,
      display:'block',

      icon:"icon-caret-down",
      labels  : true,
	  ylabels :true,
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'pie',
        solrFq :filterSrv.getSolrFq(),
      exportSize : 10000,
        linkage_id:'a',
        value_sort:'rs_timestamp',
        defaulttimestamp:true,
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
          if($scope.panel.display=='none'){
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
          if(!$scope.panel.defaulttimestamp){
              fq = fq.replace(filterSrv.getTimeField(),$scope.panel.value_sort);
          }
      }
      var wt_json = '&wt=' + filetype;
      var rows_limit = isForExport ? '&rows=0' : ''; // for pies, we do not need the actual response doc, so set rows=0
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
        kbn.download_response(response, filetype, "pies");
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
        if(($scope.panel.linkage_id==dashboard.current.linkage_id)||dashboard.current.enable_linkage){
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
                $scope.label = [];
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
            $scope.label = [];
            $scope.radardata = [];
            $scope.maxdata = 0;


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
                            if ($scope.maxdata < count) {
                                $scope.maxdata = count;
                            }
                            // if count = 0, do not add it to the chart, just skip it
                            if (count === 0) {
                                continue;
                            }
                            term = term.replace(/[\r\n]/g, "");

                            var slice = {value: count, name: term};
                            $scope.label.push(term);
                            $scope.data.push(slice);
                            $scope.radardata.push(count);
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
                return $scope.panel.sortBy === 'index' ? d.name : d.value;
            });
            if ($scope.panel.order === 'descending') {
                $scope.data.reverse();
                $scope.label.reverse();
                $scope.radardata.reverse();
            }

            // Slice it according to panel.size, and then set the x-axis values with k.
            // $scope.data = $scope.data.slice(0,$scope.panel.size);
            //_.each($scope.data, function(v) {
            // v.data[0][0] = k;
            // k++;
            // });

            if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("T") > -1) {
                $scope.hits = sum;
            }

            // $scope.data.push({label:'Missing field',
            // data:[[k,results.facets.pies.missing]],meta:"missing",color:'#aaa',opacity:0});
            // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
            //data:[[k,missing]],meta:"missing",color:'#aaa',opacity:0});
            //  $scope.data.push({label:'Other values',
            // data:[[k+1,results.facets.pies.other]],meta:"other",color:'#444'});
            // TODO: Hard coded to 0 for now. Solr faceting does not provide 'other' value.
            // data:[[k+1,$scope.hits-sum]],meta:"other",color:'#444'});

            $scope.$emit('render');
        });
    }
    };

    $scope.build_search = function(term,negate) {
            if (_.isUndefined(term.meta)) {
                filterSrv.set({
                    type: 'terms', field: $scope.panel.field, value: term.name,
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

  module.directive('piesdemoChart', function(querySrv,dashboard,filterSrv) {
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
          var plot;
          var colors = [];

          // IE doesn't work without this
            elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
		  
        

          if (filterSrv.idsByTypeAndField('pies',scope.panel.field).length > 0) {
            colors.push(scope.panel.lastColor);
          } else {
            colors = scope.panel.chartColors;
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
          //require(['oldechart','liquidfillchart'], function(){
            // Populate element
            try {
				 var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'dashboard') {
				  
				  

				  
			var myChart = echarts.init(document.getElementById(idd));

        
			var option =  {

                legend: {
                   bottom:'1%',
                    itemWidth:18,
                    itemHeight:12,
                    textStyle: {
                        color: 'auto',
                        fontSize:8
                    },
                    data: ['响应平均值', '响应最大值']
                },
                grid: {
                    top:'4%',
                    left: '2%',
                    right: '2%',
                    bottom: '0%',
                    containLabel: true
                },
                xAxis: {
                    show:false,
                    type: 'value',
                    axisTick: {
                        show: false
                    },
                    axisLine: {
                        show: false,
                        lineStyle: {
                            color: '#fff',
                        }
                    },
                    splitLine: {
                        show: false
                    },
                },
                yAxis: [{
                    type: 'category',
                    axisTick: {
                        show: false
                    },
                    axisLine: {
                        show: false,
                        lineStyle: {
                            color: '#fff',
                        }
                    },
                    data: ['充值', '购机', '查询', '业务变更', '资料修改']
                }, {
                    type: 'category',
                    axisLine: {
                        show: false
                    },
                    axisTick: {
                        show: false
                    },
                    axisLabel: {
                        show: false
                    },
                    splitArea: {
                        show: false
                    },
                    splitLine: {
                        show: false
                    },
                    data: ['充值', '购机', '查询', '业务变更', '资料修改']
                },

                ],
                series: [{
                    name: '响应最大值',
                    type: 'bar',
                    yAxisIndex: 1,
                    label: {
                        normal: {
                            show: true,
                            formatter: '最大'+'{c}'+'ms',
                            position: 'right',
                            offset: [0, -2],
                            textStyle: {
                                fontWeight: 'bold',
                                color:  '#fff',
                                fontSize:10
                            }
                        }
                    },
                    itemStyle: {
                        normal: {
                            show: true,
                            color: '#277ace',
                            barBorderRadius: 20,
                            borderWidth: 0,
                            borderColor: '#333',
                        }
                    },
                    barGap: '0%',
                    barCategoryGap: '50%',
                    data: [800, 1100, 1182, 1330, 1600]
                }, {
                    name: '响应平均值',
                    type: 'bar',
                    label: {
                        normal: {
                            show: true,
                            formatter: '{c}'+'ms',
                            position: 'inside',
                            offset: [0, -2],
                            textStyle: {
                                fontWeight: 'bold',
                                color:  '#4F4F4F',
                                fontSize:14
                            }
                        }
                    },
                    itemStyle: {
                        normal: {
                            show: true,
                            color: '#5de3e1',
                            barBorderRadius: 20,
                            borderWidth: 0,
                            borderColor: '#333',
                        }
                    },
                    barGap: '0%',
                    barCategoryGap: '50%',
                    data: [600, 900, 982, 1030, 1200]
                }

                ]
            };
        // 使用刚指定的配置项和数据显示图表。
			  myChart.setOption(option);
			  
			  }
				 
			            if(scope.panel.chart === 'pie') {
							  
			var myChart1 = echarts.init(document.getElementById(idd));
            
        
			var option1 = {
                backgroundColor: '#1f2227',
                // title: {
                //     left:'10%',
                //     textStyle:{
                //         color:'#fff',
                //         fontSize:38
                //     },
                //     text: 'APP应用业务办理量年度统计（单位：亿）'
                // },
                color: ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'],
                tooltip : {
                    trigger: 'axis',
                    axisPointer : {            // 坐标轴指示器，坐标轴触发有效
                        type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
                    }
                },
                grid: {
                    top: '6%',
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: true
                },
                xAxis : [
                    {
                        type : 'category',
                        axisLabel:{
                            textStyle:{
                                color:'#fff',
                                fontSize:16
                            },
                        },
                        data : ['13年', '14年', '15年', '16年', '17年预计'],
                        axisTick: {
                            alignWithLabel: true
                        }
                    }
                ],
                yAxis : [
                    {
                        type : 'value',
                        splitLine:{
                            show:false
                        },
                        axisLabel:{
                            textStyle:{
                                color:'#fff',
                                fontSize:14
                            },
                        },
                    }
                ],
                series : [
                    {
                        name:'业务量',
                        type:'bar',
                        barWidth: '60%',
                        label:{
                            normal:{
                                show:true,
                                position:'top',
                                textStyle:{

                                    fontSize:16
                                },

                            }
                        },
                        data:[2, 4, 8, 10, 14],
                        itemStyle: {
                            normal: {
                                color: function(params) {
                                    var colorList = ['#42d3f0', '#1acef9', '#1ab0f9', '#1a93f9', '#1a75f9', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
                                    return colorList[params.dataIndex]
                                },
                                shadowColor: '#fff',
                                barBorderRadius: 5

                            },
                            emphasis: {
                                color: function(params) {
                                    var colorList = ['#ff951f', '#ff951f', '#ff951f', '#ff951f', '#ff951f', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
                                    return colorList[params.dataIndex]
                                },
                                shadowColor: '#fff',
                                barBorderRadius: 5

                            }
                        }
                    }
                ]
            };


		if(scope.data.length==0){
				myChart1.setOption(option_nodata);}else{
					myChart1.setOption(option1);
					myChart1.on('click', function (params) {
						// 点击联动
						scope.build_search(params);

					});

				}

			  }
			    
			  
			  if(scope.panel.chart === 'rosepie') {
					  
					var myChart2 = echarts.init(document.getElementById(idd));
				  var option2 = {
                      backgroundColor: '#1f2227',
                      color: ['#3398DB','#339855'],
                      // title: {
                      //     left:'25%',
                      //     textStyle:{
                      //         color:'#fff',
                      //         fontSize:36
                      //     },
                      //     text: '充值及购机业务办理趋势'
                      // },
                      tooltip: {
                          trigger: 'axis'
                      },
                      legend: {
                          data:['购机','充值'],
                          right:'10%',
                          textStyle:{
                              color:'#fff',
                              fontSize:12
                          },

                      },
                      grid: {
                          top: '12%',
                          left: '3%',
                          right: '7%',
                          bottom: '3%',
                          containLabel: true
                      },

                      xAxis: {
                          type: 'category',
                          boundaryGap: false,
                          axisLabel:{
                              textStyle:{
                                  color:'#fff',
                                  fontSize:16
                              },
                          },
                          data: ['13年','14年','15年','16年','17年']
                      },
                      yAxis: {
                          type: 'value',
                          splitLine: {
                              show :true,
                              lineStyle:{
                                  type:'dotted',
                                  color: '#0d394a'
                              }
                          },
                          axisLabel:{
                              textStyle:{
                                  color:'#fff',
                                  fontSize:14
                              },
                          },
                      },
                      series: [
                          {
                              name:'购机',
                              type:'line',

                              data:[70, 82, 99,111, 124]
                          },
                          {
                              name:'充值',
                              type:'line',

                              data:[60, 82, 102, 130, 140]
                          }
                      ]
                  };

         if(scope.data.length==0){
				myChart2.setOption(option_nodata);}else{
					myChart2.setOption(option2);
					myChart2.on('click', function (params) {
						// 点击联动
						scope.build_search(params);
					});
				}  
              }
			  
			  if(scope.panel.chart === 'bar') {
				  var myChart3 = echarts.init(document.getElementById(idd));
				  var option3 = {
                      backgroundColor: '#1f2227',
                      // title: {
                      //     left:'10%',
                      //     textStyle:{
                      //         color:'#fff',
                      //         fontSize:38
                      //     },
                      //     text: 'APP应用业务办理量年度统计（单位：亿）'
                      // },
                      color: ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'],
                      tooltip : {
                          trigger: 'axis',
                          axisPointer : {            // 坐标轴指示器，坐标轴触发有效
                              type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
                          }
                      },
                      grid: {
                          top: '10%',
                          left: '3%',
                          right: '4%',
                          bottom: '3%',
                          containLabel: true
                      },
                      xAxis : [
                          {
                              type : 'category',
                              axisLabel:{
                                  textStyle:{
                                      color:'#fff',
                                      fontSize:16
                                  },
                              },
                              data : ['13年', '14年', '15年', '16年', '17年预计'],
                              axisTick: {
                                  alignWithLabel: true
                              }
                          }
                      ],
                      yAxis : [
                          {
                              type : 'value',
                              splitLine:{
                                  show:false
                              },
                              axisLabel:{
                                  textStyle:{
                                      color:'#fff',
                                      fontSize:14
                                  },
                              },
                          }
                      ],
                      series : [
                          {
                              name:'访问量',
                              type:'bar',
                              barWidth: '60%',
                              label:{
                                  normal:{
                                      show:true,
                                      position:'top',
                                      textStyle:{

                                          fontSize:16
                                      },

                                  }
                              },
                              data:[0.5, 0.8, 1.2, 1.8, 2.5],
                              itemStyle: {
                                  normal: {
                                      color: function(params) {
                                          var colorList = ['#42d3f0', '#1acef9', '#1ab0f9', '#1a93f9', '#1a75f9', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
                                          return colorList[params.dataIndex]
                                      },
                                      shadowColor: '#fff',
                                      barBorderRadius: 5

                                  },
                                  emphasis: {
                                      color: function(params) {
                                          var colorList = ['#ff951f', '#ff951f', '#ff951f', '#ff951f', '#ff951f', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'];
                                          return colorList[params.dataIndex]
                                      },
                                      shadowColor: '#fff',
                                      barBorderRadius: 5

                                  }
                              }
                          }
                      ]
                  };
				 //没有数据显示NO DATA  
				 
				 if(scope.data.length==0){
				myChart3.setOption(option_nodata);}else{
					myChart3.setOption(option3);
					myChart3.on('click', function (params) {
						// 点击联动
						scope.build_search(params);
					});
				}
				  
			  }

                if(scope.panel.chart === 'horizontalBar') {

                    var myChart33 = echarts.init(document.getElementById(idd));
                    var option33 =
                        option = {
                            backgroundColor: "#1f2227",
                            color: ['#ffd285', '#ff733f', '#ec4863'],

                            title: [{
                                text: '本周空气质量指数',
                                left: '5%',
                                top: '6%',
                                textStyle: {
                                    color: '#ffd285'
                                }
                            }, {
                                text: '污染占比分析',
                                left: '83%',
                                top: '6%',
                                textAlign: 'center',
                                textStyle: {
                                    color: '#ffd285'
                                }
                            }],
                            tooltip: {
                                trigger: 'axis'
                            },
                            legend: {
                                x: 200,
                                top: '6%',
                                textStyle: {
                                    color: '#ffd285',
                                },
                                data: ['上海', '濮阳', '北京']
                            },
                            grid: {
                                left: '1%',
                                right: '35%',
                                top: '16%',
                                bottom: '6%',
                                containLabel: true
                            },
                            toolbox: {
                                "show": false,
                                feature: {
                                    saveAsImage: {}
                                }
                            },
                            xAxis: {
                                type: 'category',
                                "axisLine": {
                                    lineStyle: {
                                        color: '#c0576d'
                                    }
                                },
                                "axisTick": {
                                    "show": false
                                },
                                axisLabel: {
                                    textStyle: {
                                        color: '#ffd285'
                                    }
                                },
                                boundaryGap: false,
                                data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
                            },
                            yAxis: {
                                "axisLine": {
                                    lineStyle: {
                                        color: '#c0576d'
                                    }
                                },
                                splitLine: {
                                    show: true,
                                    lineStyle: {
                                        color: '#c0576d'
                                    }
                                },
                                "axisTick": {
                                    "show": false
                                },
                                axisLabel: {
                                    textStyle: {
                                        color: '#ffd285'
                                    }
                                },
                                type: 'value'
                            },
                            series: [{
                                name: '上海',
                                smooth: true,
                                type: 'line',
                                symbolSize: 8,
                                symbol: 'circle',
                                data: [90, 50, 39, 50, 120, 82, 80]
                            }, {
                                name: '濮阳',
                                smooth: true,
                                type: 'line',
                                symbolSize: 8,
                                symbol: 'circle',
                                data: [70, 162, 50, 87, 90, 147, 60]
                            }, {
                                name: '北京',
                                smooth: true,
                                type: 'line',
                                symbolSize: 8,
                                symbol: 'circle',
                                data: [290, 335, 80, 132, 187, 330, 39]
                            },
                                {
                                    type: 'pie',
                                    center: ['83%', '33%'],
                                    radius: ['25%', '30%'],
                                    label: {
                                        normal: {
                                            position: 'center'
                                        }
                                    },
                                    data: [{
                                        value: 335,
                                        name: '污染来源分析',
                                        itemStyle: {
                                            normal: {
                                                color: '#ffd285'
                                            }
                                        },
                                        label: {
                                            normal: {
                                                formatter: '{d} %',
                                                textStyle: {
                                                    color: '#ffd285',
                                                    fontSize: 20

                                                }
                                            }
                                        }
                                    }, {
                                        value: 310,
                                        name: '占位',
                                        tooltip: {
                                            show: false
                                        },
                                        itemStyle: {
                                            normal: {
                                                color: '#b04459'
                                            }
                                        },
                                        label: {
                                            normal: {
                                                textStyle: {
                                                    color: '#ffd285',
                                                },
                                                formatter: '\n汽车尾气'
                                            }
                                        }
                                    }]
                                },


                                {
                                    type: 'pie',
                                    center: ['83%', '72%'],
                                    radius: ['25%', '30%'],
                                    label: {
                                        normal: {
                                            position: 'center'
                                        }
                                    },
                                    data: [{
                                        value: 335,
                                        name: '污染来源分析',
                                        itemStyle: {
                                            normal: {
                                                color: '#ff733f'
                                            }
                                        },
                                        label: {
                                            normal: {
                                                formatter: '{d} %',
                                                textStyle: {
                                                    color: '#ff733f',
                                                    fontSize: 20

                                                }
                                            }
                                        }
                                    }, {
                                        value: 210,
                                        name: '占位',
                                        tooltip: {
                                            show: false
                                        },
                                        itemStyle: {
                                            normal: {
                                                color: '#b04459'


                                            }
                                        },
                                        label: {
                                            normal: {
                                                textStyle: {
                                                    color: '#ff733f',
                                                },
                                                formatter: '\n工业污染'
                                            }
                                        }
                                    }]
                                }]
                        }
                    //没有数据显示NO DATA

                    if(scope.data.length==0){
                        myChart33.setOption(option_nodata);}else{
                        myChart33.setOption(option33);
                        // myChart33.on('click', function (params) {
                        //     // 点击联动
                        //     scope.build_search(params);
                        // });
                    }

                }
			 
			  if(scope.panel.chart === 'radar') {


                  var myChart4 = echarts.init(document.getElementById(idd));
					var option4 = {
                        backgroundColor: "#1f2227",
                        color: ['#ffd285', '#ff733f', '#ec4863'],

                        title: [{
                            left: '5%',
                            top: '6%',
                            textStyle: {
                                color: '#ffd285'
                            }
                        }
                        // , {
                        //     text: '月用户活跃度（17年）',
                        //     left: '70%',
                        //     top: '3%',
                        //     textAlign: 'center',
                        //     textStyle: {
                        //         color: '#ffd285'
                        //     }
                        // }
                        ],
                        tooltip: {
                            trigger: 'axis'
                        },
                        legend: {
                            x: 200,
                            top: '6%',
                            left:'8%',
                            textStyle: {
                                color: '#ffd285',
                            },
                            data: ['每月访问量']
                        },
                        grid: {
                            left: '1%',
                            right: '35%',
                            top: '16%',
                            bottom: '6%',
                            containLabel: true
                        },
                        toolbox: {
                            "show": false,
                            feature: {
                                saveAsImage: {}
                            }
                        },
                        xAxis: {
                            type: 'category',
                            "axisLine": {
                                lineStyle: {
                                    color: '#fe8b53'
                                }
                            },
                            "axisTick": {
                                "show": false
                            },
                            axisLabel: {
                                textStyle: {
                                    color: '#ffd285'
                                }
                            },
                            boundaryGap: false,
                            data: ['1月', '2月', '3月', '4月','5月']
                        },
                        yAxis: {
                            "axisLine": {
                                lineStyle: {
                                    color: '#fe8b53'
                                }
                            },
                            splitLine: {
                                show :true,
                                lineStyle:{
                                    type:'dotted',
                                    color: '#0d394a'
                                }
                            },
                            "axisTick": {
                                "show": false
                            },
                            axisLabel: {
                                textStyle: {
                                    color: '#ffd285'
                                }
                            },
                            type: 'value'
                        },
                        series: [{
                            name: '每月访问量',
                            smooth: true,
                            type: 'line',
                            symbolSize: 8,
                            symbol: 'circle',
                            data: [2200, 1900, 2051, 2150,2000]
                        },
                            {
                                name: '',
                                type: 'pie',
                                center: ['83%', '18%'],
                                clockWise: true,
                                hoverAnimation: false,
                                radius: [200, 200],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 0,
                                    label: {
                                        normal: {
                                            formatter: '2000',
                                            textStyle: {
                                                color: '#fe8b53',
                                                fontSize: 18,
                                                fontWeight: 'bold'
                                            }
                                        }
                                    }
                                }, {
                                    tooltip: {
                                        show: false
                                    },
                                    label: {
                                        normal: {
                                            formatter: '\n5月访问量',
                                            textStyle: {
                                                color: '#fe8b53',
                                                fontSize: 14
                                            }
                                        }
                                    }
                                }]
                            },
                            {
                                name: '',
                                type: 'pie',
                                center: ['83%', '47%'],
                                clockWise: true,
                                hoverAnimation: false,
                                radius: [200, 200],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 0,
                                    label: {
                                        normal: {
                                            formatter: '2150',
                                            textStyle: {
                                                color: '#ffd285',
                                                fontSize: 18,
                                                fontWeight: 'bold'
                                            }
                                        }
                                    }
                                }, {
                                    tooltip: {
                                        show: false
                                    },
                                    label: {
                                        normal: {
                                            formatter: '\n4月访问量',
                                            textStyle: {
                                                color: '#ffd285',
                                                fontSize: 14
                                            }
                                        }
                                    }
                                }]
                            },


                            {
                                type: 'pie',
                                center: ['83%', '82%'],
                                radius: ['32%', '36%'],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 150,

                                    itemStyle: {
                                        normal: {
                                            color: '#ff733f'
                                        }
                                    },
                                    label: {
                                        normal: {
                                            formatter: '{d} %',
                                            textStyle: {
                                                color: '#ff733f',
                                                fontSize: 14

                                            }
                                        }
                                    }
                                }, {
                                    value: 2000,

                                    tooltip: {
                                        show: false
                                    },
                                    itemStyle: {
                                        normal: {
                                            color: '#ff733f'


                                        }
                                    },
                                    label: {
                                        normal: {
                                            textStyle: {
                                                color: '#ff733f',
                                            },
                                            formatter: '\n环比下降'
                                        }
                                    }
                                }]
                            }]
                    };
				if(scope.data.length==0){
				myChart4.setOption(option_nodata);}else{
					myChart4.setOption(option4);
				}
			  }
         
		 if(scope.panel.chart === 'bars'){
	

				  
	var myChart5 = echarts.init(document.getElementById(idd));
	var option5 = {
        title:{
            text: '性能评分',
            top:'32%',
            left:'5%',
            textStyle:{
                color:'#1a93f9',
                fontSize:14
            }
        },
        series: [{
            center: ['50%', '40%'],
            radius: '60%',
            backgroundStyle: {
                color: 'none',
                borderColor: '#696969',
                borderWidth: 1
            },
            type: 'liquidFill',
            shape:"path://M551.470837 0 176.108494 0C129.19184 0 90.79093 38.40091 90.79093 85.317563l0 853.204748c0 46.93121 38.40091 85.317563 85.317563 85.317563l375.362343 0c46.93121 0 85.317563-38.40091 85.317563-85.317563L636.7884 85.317563C636.802957 38.40091 598.402047 0 551.470837 0M312.651532 68.256962l102.363608 0c9.40371 0 17.060601 7.613221 17.060601 17.060601 0 9.418267-7.671448 17.060601-17.060601 17.060601l-102.363608 0c-9.418267 0-17.060601-7.642334-17.060601-17.060601C295.576374 75.870183 303.218708 68.256962 312.651532 68.256962M363.818779 989.718672c-28.313029 0-51.196361-22.883332-51.196361-51.196361 0-28.327585 22.883332-51.196361 51.196361-51.196361 28.283915 0 51.196361 22.868775 51.196361 51.196361C415.01514 966.83534 392.102694 989.718672 363.818779 989.718672M602.710868 853.204748 124.941247 853.204748l0-682.569621 477.769621 0L602.710868 853.204748zM853.393987 66.757609 635.172592 66.757609c1.339228 5.982856 2.11074 12.184064 2.11074 18.559955L637.283332 130.574739l88.549179 0c8.792324 0 15.954282 7.118288 15.954282 15.954282 0 8.80688-7.161959 15.954282-15.954282 15.954282l-88.549179 0 0 63.802573 264.017173 0 0 638.054844L637.268775 864.340721l0 54.850124c8.399289-13.727088 23.407378-22.941559 40.700888-22.941559 26.435198 0 47.848291 21.369422 47.848291 47.848291 0 26.464312-21.413093 47.848291-47.848291 47.848291-19.95741 0-37.003454-12.184064-44.194527-29.521245-10.408131 35.37309-43.204663 61.415253-81.823925 61.415253l301.442775 0c43.85972 0 79.756855-35.897136 79.756855-79.756855l0-797.568555C933.150842 102.654744 897.268264 66.757609 853.393987 66.757609z",
            data:[0.8, 0.6, 0.3],
            outline: {
                show: false
            },
            label: {
                normal: {
                    position: 'inside',
                    distance: 20,
                    formatter: "92分",
                    textStyle: {
                        color: '#178ad9',
                        fontSize: 32
                    }
                }
            }
        },
            {
                name: '',
                type: 'pie',
                center: ['13%', '85%'],
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
                            formatter: '平均执行时间',
                            textStyle: {
                                color: '#d9e0e7',
                                fontSize: 13
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
                            formatter: '\n1.65S',
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 22,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            },{
                name: '',
                type: 'pie',
                center: ['37%', '85%'],
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
                            formatter: '崩溃率',
                            textStyle: {
                                color: '#d9e0e7',
                                fontSize: 13
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
                            formatter: '\n1%',
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 22,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            },{
                name: '',
                type: 'pie',
                center: ['62%', '85%'],
                clockWise: true,
                hoverAnimation: false,
                radius: [60, 60],
                label: {
                    normal: {
                        position: 'center'
                    }
                },
                data: [{
                    value: 100,
                    label: {
                        normal: {
                            formatter: 'HTTP错误率',
                            textStyle: {
                                color: '#d9e0e7',
                                fontSize: 13
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
                            formatter: '\n8%',
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 22,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            },{
                name: '',
                type: 'pie',
                center: ['88%', '85%'],
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
                            formatter: '网络错误率',
                            textStyle: {
                                color: '#d9e0e7',
                                fontSize: 13

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
                            formatter: '\n12%',
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 22,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            }
        ],
        tooltip: {
            show: false
        }
    };
				   if(scope.data.length==0){
				myChart5.setOption(option_nodata);}else{
					myChart5.setOption(option5);
					myChart5.on('click', function (params) {
						// 点击联动
						scope.build_search(params);
					});
				}
				  
			  }
			  
	if(scope.panel.chart === 'funnel'){
		
		
	var myChart6 = echarts.init(document.getElementById(idd));
	var option6 = {
        backgroundColor: "#1f2227",
        color: ['#ffd285', '#ff733f', '#ec4863'],

        title: [{
            left: '5%',
            top: '6%',
            textStyle: {
                color: '#ffd285'
            }
        }
        // , {
        //     text: '日用户活跃度',
        //     left: '83%',
        //     top: '3%',
        //     textAlign: 'center',
        //     textStyle: {
        //         color: '#ffd285'
        //     }
        // }
        ],
        tooltip: {
            trigger: 'axis'
        },
        legend: {
            x: 200,
            top: '6%',
            left:'8%',
            textStyle: {
                color: '#ffd285',
            },
            data: ['每日访问量']
        },
        grid: {
            left: '1%',
            right: '35%',
            top: '16%',
            bottom: '6%',
            containLabel: true
        },
        toolbox: {
            "show": false,
            feature: {
                saveAsImage: {}
            }
        },
        xAxis: {
            type: 'category',
            "axisLine": {
                lineStyle: {
                    color: '#fe8b53'
                }
            },
            "axisTick": {
                "show": false
            },
            axisLabel: {
                textStyle: {
                    color: '#ffd285'
                }
            },
            boundaryGap: false,
            data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
        },
        yAxis: {
            "axisLine": {
                lineStyle: {
                    color: '#fe8b53'
                }
            },
            splitLine: {
                show :true,
                lineStyle:{
                    type:'dotted',
                    color: '#0d394a'
                }
            },
            "axisTick": {
                "show": false
            },
            axisLabel: {
                textStyle: {
                    color: '#ffd285'
                }
            },
            type: 'value'
        },
        series: [{
            name: '每日访问量',
            smooth: true,
            type: 'line',
            symbolSize: 8,
            symbol: 'circle',
            data: [90, 50, 39, 50, 120, 82, 80]
        },
            {
                name: '',
                type: 'pie',
                center: ['83%', '18%'],
                clockWise: true,
                hoverAnimation: false,
                radius: [200, 200],
                label: {
                    normal: {
                        position: 'center'
                    }
                },
                data: [{
                    value: 0,
                    label: {
                        normal: {
                            formatter: '80',
                            textStyle: {
                                color: '#fe8b53',
                                fontSize: 18,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }, {
                    tooltip: {
                        show: false
                    },
                    label: {
                        normal: {
                            formatter: '\n今日访问量',
                            textStyle: {
                                color: '#fe8b53',
                                fontSize: 14
                            }
                        }
                    }
                }]
            },
            {
                name: '',
                type: 'pie',
                center: ['83%', '47%'],
                clockWise: true,
                hoverAnimation: false,
                radius: [200, 200],
                label: {
                    normal: {
                        position: 'center'
                    }
                },
                data: [{
                    value: 0,
                    label: {
                        normal: {
                            formatter: '82',
                            textStyle: {
                                color: '#ffd285',
                                fontSize: 18,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }, {
                    tooltip: {
                        show: false
                    },
                    label: {
                        normal: {
                            formatter: '\n昨日访问量',
                            textStyle: {
                                color: '#ffd285',
                                fontSize: 14
                            }
                        }
                    }
                }]
            },


            {
                type: 'pie',
                center: ['83%', '82%'],
                radius: ['32%', '36%'],
                label: {
                    normal: {
                        position: 'center'
                    }
                },
                data: [{
                    value: 2,

                    itemStyle: {
                        normal: {
                            color: '#ff733f'
                        }
                    },
                    label: {
                        normal: {
                            formatter: '{d} %',
                            textStyle: {
                                color: '#ff733f',
                                fontSize: 14

                            }
                        }
                    }
                }, {
                    value: 82,

                    tooltip: {
                        show: false
                    },
                    itemStyle: {
                        normal: {
                            color: '#ff733f'


                        }
                    },
                    label: {
                        normal: {
                            textStyle: {
                                color: '#ff733f',
                            },
                            formatter: '\n环比上涨'
                        }
                    }
                }]
            }]
    };

	
	
		
	 if(scope.data.length==0){
				myChart6.setOption(option_nodata);}else{
					myChart6.setOption(option6);
					myChart6.on('click', function (params) {
						// 点击联动
						scope.build_search(params);
					});
				}
	}

       if(scope.panel.chart === 'ebar') {


                    var myChart7 = echarts.init(document.getElementById(idd));


                    var option7 = {
                        backgroundColor: "#1f2227",
                        color: ['#ffd285', '#ff733f', '#ec4863'],

                        title: [{
                            left: '5%',
                            top: '6%',
                            textStyle: {
                                color: '#ffd285'
                            }
                        }
                        // , {
                        //     text: '周用户活跃度（5月）',
                        //     left: '73%',
                        //     top: '3%',
                        //     textAlign: 'center',
                        //     textStyle: {
                        //         color: '#ffd285'
                        //     }
                        // }
                        ],
                        tooltip: {
                            trigger: 'axis'
                        },
                        legend: {
                            x: 200,
                            top: '6%',
                            left:'8%',
                            textStyle: {
                                color: '#ffd285',
                            },
                            data: ['每周访问量']
                        },
                        grid: {
                            left: '1%',
                            right: '35%',
                            top: '16%',
                            bottom: '6%',
                            containLabel: true
                        },
                        toolbox: {
                            "show": false,
                            feature: {
                                saveAsImage: {}
                            }
                        },
                        xAxis: {
                            type: 'category',
                            "axisLine": {
                                lineStyle: {
                                    color: '#fe8b53'
                                }
                            },
                            "axisTick": {
                                "show": false
                            },
                            axisLabel: {
                                textStyle: {
                                    color: '#ffd285'
                                }
                            },
                            boundaryGap: false,
                            data: ['第一周', '第二周', '第三周', '第四周']
                        },
                        yAxis: {
                            "axisLine": {
                                lineStyle: {
                                    color: '#fe8b53'
                                }
                            },
                            splitLine: {
                                show :true,
                                lineStyle:{
                                    type:'dotted',
                                    color: '#0d394a'
                                }
                            },
                            "axisTick": {
                                "show": false
                            },
                            axisLabel: {
                                textStyle: {
                                    color: '#ffd285'
                                }
                            },
                            type: 'value'
                        },
                        series: [{
                            name: '每周访问量',
                            smooth: true,
                            type: 'line',
                            symbolSize: 8,
                            symbol: 'circle',
                            data: [510, 550, 620, 500]
                        },
                            {
                                name: '',
                                type: 'pie',
                                center: ['83%', '18%'],
                                clockWise: true,
                                hoverAnimation: false,
                                radius: [200, 200],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 0,
                                    label: {
                                        normal: {
                                            formatter: '500',
                                            textStyle: {
                                                color: '#fe8b53',
                                                fontSize: 18,
                                                fontWeight: 'bold'
                                            }
                                        }
                                    }
                                }, {
                                    tooltip: {
                                        show: false
                                    },
                                    label: {
                                        normal: {
                                            formatter: '\n这周访问量',
                                            textStyle: {
                                                color: '#fe8b53',
                                                fontSize: 14
                                            }
                                        }
                                    }
                                }]
                            },
                            {
                                name: '',
                                type: 'pie',
                                center: ['83%', '47%'],
                                clockWise: true,
                                hoverAnimation: false,
                                radius: [200, 200],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 0,
                                    label: {
                                        normal: {
                                            formatter: '620',
                                            textStyle: {
                                                color: '#ffd285',
                                                fontSize: 18,
                                                fontWeight: 'bold'
                                            }
                                        }
                                    }
                                }, {
                                    tooltip: {
                                        show: false
                                    },
                                    label: {
                                        normal: {
                                            formatter: '\n上周访问量',
                                            textStyle: {
                                                color: '#ffd285',
                                                fontSize: 14
                                            }
                                        }
                                    }
                                }]
                            },


                            {
                                type: 'pie',
                                center: ['83%', '82%'],
                                radius: ['32%', '36%'],
                                label: {
                                    normal: {
                                        position: 'center'
                                    }
                                },
                                data: [{
                                    value: 120,

                                    itemStyle: {
                                        normal: {
                                            color: '#ff733f'
                                        }
                                    },
                                    label: {
                                        normal: {
                                            formatter: '{d} %',
                                            textStyle: {
                                                color: '#ff733f',
                                                fontSize: 14

                                            }
                                        }
                                    }
                                }, {
                                    value: 500,

                                    tooltip: {
                                        show: false
                                    },
                                    itemStyle: {
                                        normal: {
                                            color: '#ff733f'


                                        }
                                    },
                                    label: {
                                        normal: {
                                            textStyle: {
                                                color: '#ff733f',
                                            },
                                            formatter: '\n环比下降'
                                        }
                                    }
                                }]
                            }]
                    };

                    // 使用刚指定的配置项和数据显示图表。
                    if(scope.data.length==0){
                        myChart7.setOption(option_nodata);}else{
                        myChart7.setOption(option7);
                        myChart7.on('click', function (params) {
                            // 控制台打印数据的名称
                            scope.build_search(params);
                        });
                    }
                }

                if(scope.panel.chart === 'liquidfill') {


                    var myChart8 = echarts.init(document.getElementById(idd));
                    var series = [];
                    var titles = [];


                    for (var i = 0; i < scope.radardata.length; i++) {

                        var xla = scope.label[i].replace(" ","\n");
                        var x =  (i+0.5) / scope.radardata.length * 100 + '%';

                        titles.push({
                            text: xla,
                            textAlign: 'center',
                            left: x,
                            bottom: 10,
                            padding: 0,
                            textStyle: {
                                color: labelcolor?'#fff':'#696969',
                                fontSize: 12,
                                fontWeight: 'normal'
                            }
                        })

                        series.push({
                            animation: true,
                            waveAnimation: true,

                            color: ['#178ad9'],
                            center: [x, '50%'],
                            radius: '65%',

                            type: 'liquidFill',
                            shape:'path://M229.844,151.547v-166.75c0-11.92-9.662-21.582-21.58-21.582s-21.581,9.662-21.581,21.582v166.75c-9.088,6.654-14.993,17.397-14.993,29.524c0,20.2,16.374,36.575,36.574,36.575c20.199,0,36.574-16.375,36.574-36.575C244.838,168.944,238.932,158.201,229.844,151.547z',
                            //shape: 'path://M479.232622,0.563387605 C479.232622,0.563387605 581.318924,34.9465747 595.916359,117.247124 C610.513793,199.547674 712.946576,234.277341 712.946576,234.277341 L282.844461,664.379456 C251.594162,695.539776 210.032528,712.700992 165.814244,712.700992 C121.595959,712.700992 80.0620523,695.5408 48.7840267,664.379456 C-15.71599,600.034368 -15.71599,495.32832 48.8117536,430.984256 L479.232622,0.563387605 Z',
                            outline: {
                                show: false
                            },
                            amplitude: 3,
                            waveLength: '20%',
                            backgroundStyle: {
                                color: 'none',
                                borderColor: labelcolor?'#fff':'#696969',
                                borderWidth: 1
                            },
                            data: [{
                                // -60 到 100 度
                                name:scope.label[i],
                                value: scope.radardata[i]  / scope.maxdata,
                                rawValue: scope.radardata[i]
                            }],
                            itemStyle: {
                                normal: {
                                    shadowBlur: 0
                                }
                            },
                            label: {
                                normal: {
                                    position: 'insideBottom',
                                    distance: 20,
                                    formatter: function(item) {
                                        return ' ' + item.data.rawValue  ;
                                    },
                                    textStyle: {
                                        color: '#178ad9',
                                        fontSize: 15
                                    }
                                }
                            }
                        })
                    }




                    // 使用刚指定的配置项和数据显示图表。
                    if(scope.data.length==0){
                        myChart8.setOption(option_nodata);}else{
                        myChart8.setOption({
                           tooltip: {
                                show: true,
                                confine:true,
                                formatter: function(item) {
                                    return item.data.name +" : " +item.data.rawValue ;
                                }
                           },
                            title: titles,
                            series: series
                        });
                        myChart8.on('click', function (params) {
                            // 控制台打印数据的名称
                            scope.build_search(params);
                        });
                    }
                }

              // Populate legend


            } catch(e) {
              elem.text(e);
            }
         // });
        }
      

        var $tooltip = $('<div>');
      

      }
    };
  });

});