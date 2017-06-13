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

  module.controller('pies', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
        display:'block',
        icon:"icon-caret-down",
      other   : false,
      size    : 10,
      sortBy  : 'count',
      order   : 'descending',
      fontsize   : 12,
      donut   : false,
      tilt    : false,
      labels  : true,
      enable_linkage:true,
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'pie',
      exportSize : 10000,
      lastColor : '',
        linkage_id:'a',
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
                // data:[[k,results.facets.pies.missing]],meta:"missing",color:'#aaa',opacity:0});
                // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
                data: [[k, missing]], meta: "missing", color: '#aaa', opacity: 0
            });
            $scope.data.push({
                label: 'Other values',
                // data:[[k+1,results.facets.pies.other]],meta:"other",color:'#444'});
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
                type: 'pies', field: $scope.panel.field, value: term.label,
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

  module.directive('piesChart', function(querySrv,dashboard,filterSrv) {
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

          if (filterSrv.idsByTypeAndField('pies',scope.panel.field).length > 0) {
            colors.push(scope.panel.lastColor);
          } else {
            colors = scope.panel.chartColors;
          }
		 
		  var AP_1 = 0.0;
		  var AP_2 = 0.0;
		  var AP_n = 0.0;
		  for (var i = 0; i < chartData.length; i++) {
			  AP_n = AP_n+chartData[i].data[0][1];
			  if(parseInt(chartData[i].label)<=20000 ){
			  AP_1+=chartData[i].data[0][1];
			  }else if(parseInt(chartData[i].label)<30000 && parseInt(chartData[i].label)>20000){
			  AP_2+=chartData[i].data[0][1]*0.5;
			  }
		  }
		var APdex =100;
		if(AP_n!=0){
		APdex = parseInt(100*(AP_1+AP_2)/AP_n);
		//APdex = (AP_1+AP_2)/AP_n;
		}
		
		var health = chartData[0].label;
		var idd = scope.$id;
          require(['jquery.flot.pie'], function(){
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
                    color: [[0.6, '#1e90ff'],[0.82, '#F6AB60'],[1, '#EB5768']],
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
					fontSize:25
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
                    fontSize: 47,
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
					fontSize:35
                }
            },
            data:[{value: APdex, name: 'Health State'}]
        }
     
    ]
};


        // 使用刚指定的配置项和数据显示图表。
			  myChart.setOption(option);
			  }
			  var arrdata = [];	
					var arrlabel = [];	
				  for (var i = 0; i < chartData.length; i++) {
					  arrlabel[i] = chartData[i].label;
					  arrdata[i] = {value:chartData[i].data[0][1],name:chartData[i].label};
					  //arrdata[i] = chartData[i].data[0][1];
				  }
				  var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
			            if(scope.panel.chart === 'pie') {
							  
			var myChart1 = echarts.init(document.getElementById(idd));

        
			var option1 = {
    title : {
        show:false,
        x:'center'
    },
    tooltip : {
        trigger: 'item',
        formatter: "{a} <br/>{b} : {c} ({d}%)"
    },
    legend: {
		show:scope.panel.eLegend,
        orient: scope.panel.arrangement,
        left: 'left',
		textStyle:{
			fontSize:scope.panel.fontsize,
			color:'auto'
		},
		
        data: arrlabel
    },
    series : [
        {
            name:scope.panel.title,
            type: 'pie',
			selectedMode:'single',
            radius : scope.panel.donut ?['60%','90%']:'90%',
			label :{
				normal:{
					show:scope.panel.donut ? false:scope.panel.labels,
					position:scope.panel.donut ?'center':'inside',
					textStyle:{
						fontSize:scope.panel.fontsize
					}
				},
				emphasis: {
                    show: scope.panel.donut,
                    textStyle: {
                        fontSize: scope.panel.fontsize,
                        fontWeight: 'bold'
                    }
                }
				
			},
            center: ['65%', '50%'],
            data:arrdata,
            itemStyle: {
				normal: {
					color: function(params) {              
                                        var colorList = colors;
                                        return colorList[params.dataIndex]
                                        },
					shadowColor: '#fff',
					barBorderRadius: 5
                
            },
                emphasis: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }
    ]
};


        // 使用刚指定的配置项和数据显示图表。
			  myChart1.setOption(option1);
			  }
			    
			  
			  if(scope.panel.chart === 'rosepie') {
					  
					var myChart2 = echarts.init(document.getElementById(idd));
				  var option2 = {
						title: {
								show:false,
								x: "center"
								},
						grid: {
						top: '5%'
						},
						tooltip: {
								trigger: "item",
								formatter: "{a} <br/>{b} : {c} ({d}%)"
									},
						legend: {
								show:scope.panel.eLegend,
								x: "left",
								orient: scope.panel.arrangement,
								textStyle:{
									fontSize:scope.panel.fontsize,
									color:'auto'
								},
								data: arrlabel
								},
								label: {
									normal: {
										formatter: "{b} ({d}%)",
										
										textStyle:{
													fontSize:scope.panel.fontsize
													}
										}
											},
								labelLine: {
									normal: {
											smooth: .6
											}
											},
							
						calculable: !0,
						series: [{
							name: scope.panel.title,
							type: "pie",
							roseType: scope.panel.RoseType,
							center: ['50%','68%'],
							label: {
								normal: {
									show: scope.panel.labels
										},
								emphasis: {
									show: scope.panel.labels
										}
									},
							lableLine: {
								normal: {
									show: !0
									},
							emphasis: {
									show: !0
								}
							},
						data: arrdata,
						 itemStyle: {
							normal: {
							color: function(params) {              
                                        var colorList = colors;
                                        return colorList[params.dataIndex]
                                        },
							shadowColor: '#fff',
							barBorderRadius: 5
                
									}
								}
    }]
};
          myChart2.setOption(option2);   
              }
			  
			  if(scope.panel.chart === 'bar') {
				  var myChart3 = echarts.init(document.getElementById(idd));
				  var option3 = {
					color: ['#3398DB'],
					tooltip : {
					trigger: 'axis',
					axisPointer : {            // 坐标轴指示器，坐标轴触发有效
							type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
								}
						},
					grid: {
						left: '3%',
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
							show:scope.panel.labels,
							textStyle:{
								color:labelcolor ? '#fff':'#4F4F4F',
								fontSize:scope.panel.fontsize,
								}
							},
							axisTick: {
							show:false, 
							alignWithLabel: false
							}
						}
						],
					yAxis : [
						{
						type : 'value',
						splitLine: {
						show :false,
						lineStyle:{
						type:'dotted',
						axisTick: {
						show:false
							},
						color: labelcolor ? '#4F4F4F':'#F8F8FF'
								}
						},
						axisLabel:{
						textStyle:{
							color:labelcolor ? '#fff':'#4F4F4F',
							fontSize:scope.panel.fontsize+2,
							fontStyle: 'italic'
						}
						},
						nameTextStyle:{
				
							color:labelcolor ? '#fff':'#4F4F4F',
				
				
						},
						axisLine:{
						show:false
						}
					}
				],
					series : [
					{
						name:scope.panel.title,
						type:'bar',
						barWidth: '43%',
						data:arrdata,
						itemStyle: {
							normal: {
							color: function(params) {              
                                        var colorList = colors;
                                        return colorList[params.dataIndex]
                                        },
							shadowColor: '#fff',
							barBorderRadius: 5
                
									}
								}
        }
    ]
};
				  
				  myChart3.setOption(option3);
				  
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

            } catch(e) {
              elem.text(e);
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