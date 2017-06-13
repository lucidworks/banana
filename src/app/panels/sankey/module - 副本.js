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
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
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
      labels  : true,
	  ylabels :true,
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'pie',
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
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      delete $scope.panel.error;
      $scope.panelMeta.loading = true;
      var request, results;

      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      request = $scope.sjs.Request().indices(dashboard.indices);
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var query = this.build_query('json', false);

      // Set the panel's query
      $scope.panel.queries.query = query;

      request.setQuery(query);

      results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error.msg);
          $scope.data = [];
          $scope.panelMeta.loading = false;
          $scope.$emit('render');
          return;
        }

        // Function for validating HTML color by assign it to a dummy <div id="colorTest">
        // and let the browser do the work of validation.
        var isValidHTMLColor = function(color) {
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
        var addSliceColor = function(slice,color) {
          if ($scope.panel.useColorFromField && isValidHTMLColor(color)) {
            slice.color = color;
          }
          return slice;
        };

        var sum = 0;
        var k = 0;
        var missing =0;
        $scope.panelMeta.loading = false;
        $scope.hits = results.response.numFound;
        $scope.data = [];

        if ($scope.panel.mode === 'count') {
          // In count mode, the y-axis min should be zero because count value cannot be negative.
          $scope.yaxis_min = 0;
          _.each(results.facet_counts.facet_fields, function(v) {
            for (var i = 0; i < v.length; i++) {
              var term = v[i];
              i++;
              var count = v[i];
              sum += count;
              if(term === null){
                missing = count;
              }else{
                // if count = 0, do not add it to the chart, just skip it
                if (count === 0) { continue; }
                var slice = { label : term, data : [[k,count]], actions: true};
                slice = addSliceColor(slice,term);
                $scope.data.push(slice);
              }
            }
          });
        } else {
          // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
          $scope.yaxis_min = null;
          _.each(results.stats.stats_fields[$scope.panel.stats_field].facets[$scope.panel.field], function(stats_obj,facet_field) {
            var slice = { label:facet_field, data:[[k,stats_obj[$scope.panel.mode]]], actions: true };
            $scope.data.push(slice);
          });
        }
        // Sort the results
        $scope.data = _.sortBy($scope.data, function(d) {
          return $scope.panel.sortBy === 'index' ? d.label : d.data[0][1];
        });
        if ($scope.panel.order === 'descending') {
          $scope.data.reverse();
        }

        // Slice it according to panel.size, and then set the x-axis values with k.
        $scope.data = $scope.data.slice(0,$scope.panel.size);
        _.each($scope.data, function(v) {
          v.data[0][0] = k;
          k++;
        });

        if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("T") > -1) {
          $scope.hits = sum;
        }

        $scope.data.push({label:'Missing field',
          // data:[[k,results.facets.pies.missing]],meta:"missing",color:'#aaa',opacity:0});
          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
          data:[[k,missing]],meta:"missing",color:'#aaa',opacity:0});
        $scope.data.push({label:'Other values',
          // data:[[k+1,results.facets.pies.other]],meta:"other",color:'#444'});
          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'other' value.
          data:[[k+1,$scope.hits-sum]],meta:"other",color:'#444'});

        $scope.$emit('render');
      });
    };

    $scope.build_search = function(term,negate) {
      if(_.isUndefined(term.meta)) {
        filterSrv.set({type:'pies',field:$scope.panel.field,value:term.label,
          mandate:(negate ? 'mustNot':'must')});
      } else if(term.meta === 'missing') {
        filterSrv.set({type:'exists',field:$scope.panel.field,
          mandate:(negate ? 'must':'mustNot')});
      } else {
        return;
      }
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
          require(['jquery.flot.pie'], function(){
            // Populate element
            try {
				 var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'dashboard') {
				  
				  
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
		if(AP_n!=0){
		APdex = parseInt(100*(AP_1+AP_2)/AP_n);
		//APdex = (AP_1+AP_2)/AP_n;
		}
				  
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
					min:scope.panel.dashboard_max,
					max:scope.panel.dashboard_min,
					splitNumber:scope.panel.dashboard_splitNumber,
					radius: '96%',
					axisLine: {            // 坐标轴线
							lineStyle: {       // 属性lineStyle控制线条样式
								color: [[0.6, colors[0]],[0.82, colors[1]],[1, colors[2]]],//'#1e90ff''#F6AB60''#EB5768'
								width: 5,
								shadowColor : labelcolor?'#ddfdfa':colors[7], //默认透明
								shadowBlur: 40
							}
					},
					axisLabel: {            // 坐标轴小标记
						textStyle: {       // 属性lineStyle控制线条样式
							fontWeight: 'bolder',
							color: labelcolor?'#fff':'#696969',
							shadowColor : labelcolor?'#fff':colors[7], //默认透明
							shadowBlur: 40,
							fontStyle: 'italic',
							fontSize:scope.panel.fontsize
						}
					},
					axisTick: {            // 坐标轴小标记
						length :18,        // 属性length控制线长
						lineStyle: {       // 属性lineStyle控制线条样式
							color: 'auto',
							shadowColor : labelcolor?'#fff':colors[7], //默认透明
							shadowBlur: 40
						}
					},
					splitLine: {           // 分隔线
						length :28,         // 属性length控制线长
						lineStyle: {       // 属性lineStyle（详见lineStyle）控制线条样式
							width:4,
							color: labelcolor?'#fff':colors[8],
							shadowColor : labelcolor?'#fff':colors[7], //默认透明
							shadowBlur: 40
						}
					},
					pointer: {           // 指针
						length:'90%',
						width:3
					},
					itemStyle:{
						normal:{
							color:labelcolor?'#fff':colors[6],
							shadowColor: colors[7],
							shadowBlur: 30,
							borderWidth:2,
							borderColor: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
								offset: 0, color: colors[4] // 0% 处的颜色
								}, {
								offset: 0.7, color: colors[5] // 70% 处的颜色
								},{
								offset: 1, color: '#fff' // 100% 处的颜色
							}], false)
						},
						emphasis:{
							color:labelcolor?'#fff':'#696969',
							shadowColor: colors[3],
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
							fontSize: scope.panel.fontsize+18,
							fontStyle: 'italic',
							color: labelcolor?'#fff':'#696969',
							shadowColor :labelcolor?'#fff':'#696969', //默认透明
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
					data:[{value: APdex, name: scope.panel.title}]
				}
     
    ]
};
        // 使用刚指定的配置项和数据显示图表。
			  myChart.setOption(option);
			  
			  }
			  var arrdata = [];	
			  var radardata = [];
				var arrlabel = [];	
				var radarmax = 0;
				  for (var i = 0; i < chartData.length; i++) {
					  arrlabel[i] = chartData[i].label;
					  arrdata[i] = {value:chartData[i].data[0][1],name:chartData[i].label};
						radardata[i] = chartData[i].data[0][1];
							if (chartData[i].data[0][1]>radarmax){
								radarmax = chartData[i].data[0][1];
							}
							
						
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
            center: ['60%', '50%'],
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

		if(arrlabel.length==0){
				myChart1.setOption(option_nodata);}else{
					myChart1.setOption(option1);
				}

			  }
			    
			  
			  if(scope.panel.chart === 'rosepie') {
					  
					var myChart2 = echarts.init(document.getElementById(idd));
				  var option2 = {
						title: {
								show:false,
								x: "center"
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
							center: ['50%', '60%'],
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
         if(arrlabel.length==0){
				myChart2.setOption(option_nodata);}else{
					myChart2.setOption(option2);
				}  
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
						show:scope.panel.ylabels, 
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
				 //没有数据显示NO DATA  
				 if(arrlabel.length==0){
				myChart3.setOption(option_nodata);}else{
					myChart3.setOption(option3);
				}
				  
			  }
			 
			  if(scope.panel.chart === 'radar') {
				  
				  var radarlabel = [];
				  
				  for (var i = 0; i < arrlabel.length; i++) {
				  
				  radarlabel[i] = {name:arrlabel[i],max:radarmax}
				  }
				  
				  
				  var myChart4 = echarts.init(document.getElementById(idd));

					var dataBJ = [radardata];
					


					var lineStyle = {
						normal: {
							width: 1,
							opacity: 0.5
						}
					};

					var option4 = {
						
						title: {
							left: 'center',
							textStyle: {
								color: '#eee'
							}
						},
						tooltip: {
							trigger: 'axis',
							 position: function (point, params, dom) {
									// 固定在顶部
								return [point[0], '10%'];
									}
						},
						legend: {
							bottom: 5,
							itemGap: 20,
							textStyle: {
								color: '#fff',
								fontSize: scope.panel.fontsize
							},
							selectedMode: 'single'
						},
						radar: {
							indicator: radarlabel,
							shape: 'circle',
							splitNumber: 5,
							name: {
								textStyle: {
									color: labelcolor ?'rgb(238, 197, 102)':'rgba(90, 78, 53)',
									fontSize: scope.panel.fontsize
								}
							},
							splitLine: {
								lineStyle: {
									color:labelcolor ? [
										'rgba(238, 197, 102, 0.1)', 'rgba(238, 197, 102, 0.2)',
										'rgba(238, 197, 102, 0.4)', 'rgba(238, 197, 102, 0.6)',
										'rgba(238, 197, 102, 0.8)', 'rgba(238, 197, 102, 1)'
									].reverse():[
										'rgba(90, 78, 53, 0.1)', 'rgba(90, 78, 53, 0.2)',
										'rgba(90, 78, 53, 0.4)', 'rgba(90, 78, 53, 0.6)',
										'rgba(90, 78, 53, 0.8)', 'rgba(90, 78, 53, 1)'
									].reverse()
								}
							},
							splitArea: {
								show: false
							},
							axisLine: {
								lineStyle: {
									color: labelcolor ?'rgba(238, 197, 102, 0.5)':'rgba(90, 78, 53, 0.5)'
								}
							}
						},	
						series: [
							{
								name: scope.panel.title,
								type: 'radar',
								tooltip: {
									trigger: 'item'
								},
								lineStyle: lineStyle,
								data: dataBJ,
								itemStyle: {
									normal: {
										color: '#F9713C'
									}
								},
								areaStyle: {
									normal: {
										opacity: 0.1
									}
								}
							}
						]
					};
				if(arrlabel.length==0){
				myChart4.setOption(option_nodata);}else{
					myChart4.setOption(option4);
				}
			  }
         
		 if(scope.panel.chart === 'bars'){
	
	var islength = 0;
	if(arrlabel.length>5){
		islength =1;
	}
				  
	var myChart5 = echarts.init(document.getElementById(idd));
	var option5 = {
    tooltip: {
        trigger: 'axis',
        axisPointer: {
            type: 'none'
        },
        formatter: function(params) {
            return params[0].name + ': ' + params[0].value;
        }
    },
	grid: {
			left: '0%',
			right: '3%',
			bottom: '3%',
			top: '3%',
			containLabel: true
		},
    xAxis: {
        data: arrlabel,
        axisTick: {
            show: false
        },
        axisLine: {
            show: false
        },
        axisLabel: {
			show:scope.panel.labels,
			textStyle:{
						color:'#24b2f9',
						fontSize:scope.panel.fontsize,
							}
        }
    },
    yAxis: {
        splitLine: {
            show: false
        },
        axisTick: {
            show: false
        },
        axisLine: {
            show: false
        },
        axisLabel: {
            show: scope.panel.ylabels,
			margin:52,
			textStyle:{
							color:labelcolor ? '#DCDCDC':'#4F4F4F',
							fontSize:scope.panel.fontsize+2,
							fontStyle: 'italic'
						}
        }
    },
    //color: ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'],
    series: [{
        name: scope.panel.title,
        type: 'pictorialBar',
        barCategoryGap: islength?'-100%':'-10%',
		symbolSize:['120%','100%'],
        // symbol: 'path://M0,10 L10,10 L5,0 L0,10 z',
        symbol: 'path://M0,10 L10,10 C5.5,10 5.5,5 5,0 C4.5,5 4.5,10 0,10 z',
       itemStyle: {
				normal: {
					color: function(params) {              
                                        var colorList = ['#1a75f9', '#1ab0f9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980','#bcf924','#f9ac24','#8224f9','#24e5f9','#f96524'];
                                        return colorList[params.dataIndex]
                                        },
					shadowColor: '#fff',
					barBorderRadius: 5,
					opacity: 0.8
                
            },
			emphasis: {
                opacity: 1
            }
        },
        data: radardata,
        z: 10
    }]
};
				   if(arrlabel.length==0){
				myChart5.setOption(option_nodata);}else{
					myChart5.setOption(option5);
				}
				  
			  }
			  
	if(scope.panel.chart === 'funnel'){
		
		
	var myChart6 = echarts.init(document.getElementById(idd));
	var option6 = {
    
    tooltip: {
        trigger: 'item',
        formatter: "{a} <br/>{b} : {c}%"
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
    calculable: true,
    series: [
        {
            name:scope.panel.title,
            type:'funnel',
            left: '10%',
            top: 6,
            //x2: 80,
            bottom: 6,
            width: '80%',
            // height: {totalHeight} - y - y2,
            min: 0,
            max: radarmax,
            sort: scope.panel.order,
            gap: 2,
            label: {
                normal: {
					show: scope.panel.labels,
                    position:'inside',
                     formatter:'{b}'
                },
                emphasis: {
					show: scope.panel.labels,
                    position:'inside',
                    formatter: '{b}:{c}%',
                    textStyle: {
                        
                        color:'#000'
                    }
                }
            },
            labelLine: {
                normal: {
                    show:false,
                    length: 10,
                    lineStyle: {
                        width: 1,
                        type: 'solid'
                    }
                }
            },
            itemStyle: {
				normal: {
					color: function(params) {              
                                        var colorList = ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980','#bcf924','#f9ac24','#8224f9','#24e5f9','#f96524'];
                                        return colorList[params.dataIndex]
                                        },
					opacity: 0.8
                
            },
			emphasis: {
                opacity: 1
            }
        },
            data: arrdata
            
        }
    ]
};

	
	
		
	 if(arrlabel.length==0){
				myChart6.setOption(option_nodata);}else{
					myChart6.setOption(option6);
				}
	}		  
			  
			  
	if(scope.panel.chart === 'china_map'){
		
		var myChart7 = echarts.init(document.getElementById(idd));
		
		var geoCoordMap = {
    "海门":[121.15,31.89],
    "鄂尔多斯":[109.781327,39.608266],
    "招远":[120.38,37.35],
    "舟山":[122.207216,29.985295],
    "齐齐哈尔":[123.97,47.33],
    "盐城":[120.13,33.38],
    "赤峰":[118.87,42.28],
    "青岛":[120.33,36.07],
    "乳山":[121.52,36.89],
    "金昌":[102.188043,38.520089],
    "泉州":[118.58,24.93],
    "莱西":[120.53,36.86],
    "日照":[119.46,35.42],
    "胶南":[119.97,35.88],
    "南通":[121.05,32.08],
    "拉萨":[91.11,29.97],
    "云浮":[112.02,22.93],
    "梅州":[116.1,24.55],
    "文登":[122.05,37.2],
    "上海":[121.48,31.22],
    "攀枝花":[101.718637,26.582347],
    "威海":[122.1,37.5],
    "承德":[117.93,40.97],
    "厦门":[118.1,24.46],
    "汕尾":[115.375279,22.786211],
    "潮州":[116.63,23.68],
    "丹东":[124.37,40.13],
    "太仓":[121.1,31.45],
    "曲靖":[103.79,25.51],
    "烟台":[121.39,37.52],
    "福州":[119.3,26.08],
    "瓦房店":[121.979603,39.627114],
    "即墨":[120.45,36.38],
    "抚顺":[123.97,41.97],
    "玉溪":[102.52,24.35],
    "张家口":[114.87,40.82],
    "阳泉":[113.57,37.85],
    "莱州":[119.942327,37.177017],
    "湖州":[120.1,30.86],
    "汕头":[116.69,23.39],
    "昆山":[120.95,31.39],
    "宁波":[121.56,29.86],
    "湛江":[110.359377,21.270708],
    "揭阳":[116.35,23.55],
    "荣成":[122.41,37.16],
    "连云港":[119.16,34.59],
    "葫芦岛":[120.836932,40.711052],
    "常熟":[120.74,31.64],
    "东莞":[113.75,23.04],
    "河源":[114.68,23.73],
    "淮安":[119.15,33.5],
    "泰州":[119.9,32.49],
    "南宁":[108.33,22.84],
    "营口":[122.18,40.65],
    "惠州":[114.4,23.09],
    "江阴":[120.26,31.91],
    "蓬莱":[120.75,37.8],
    "韶关":[113.62,24.84],
    "嘉峪关":[98.289152,39.77313],
    "广州":[113.23,23.16],
    "延安":[109.47,36.6],
    "太原":[112.53,37.87],
    "清远":[113.01,23.7],
    "中山":[113.38,22.52],
    "昆明":[102.73,25.04],
    "寿光":[118.73,36.86],
    "盘锦":[122.070714,41.119997],
    "长治":[113.08,36.18],
    "深圳":[114.07,22.62],
    "珠海":[113.52,22.3],
    "宿迁":[118.3,33.96],
    "咸阳":[108.72,34.36],
    "铜川":[109.11,35.09],
    "平度":[119.97,36.77],
    "佛山":[113.11,23.05],
    "海口":[110.35,20.02],
    "江门":[113.06,22.61],
    "章丘":[117.53,36.72],
    "肇庆":[112.44,23.05],
    "大连":[121.62,38.92],
    "临汾":[111.5,36.08],
    "吴江":[120.63,31.16],
    "石嘴山":[106.39,39.04],
    "沈阳":[123.38,41.8],
    "苏州":[120.62,31.32],
    "茂名":[110.88,21.68],
    "嘉兴":[120.76,30.77],
    "长春":[125.35,43.88],
    "胶州":[120.03336,36.264622],
    "银川":[106.27,38.47],
    "张家港":[120.555821,31.875428],
    "三门峡":[111.19,34.76],
    "锦州":[121.15,41.13],
    "南昌":[115.89,28.68],
    "柳州":[109.4,24.33],
    "三亚":[109.511909,18.252847],
    "自贡":[104.778442,29.33903],
    "吉林":[126.57,43.87],
    "阳江":[111.95,21.85],
    "泸州":[105.39,28.91],
    "西宁":[101.74,36.56],
    "宜宾":[104.56,29.77],
    "呼和浩特":[111.65,40.82],
    "成都":[104.06,30.67],
    "大同":[113.3,40.12],
    "镇江":[119.44,32.2],
    "桂林":[110.28,25.29],
    "张家界":[110.479191,29.117096],
    "宜兴":[119.82,31.36],
    "北海":[109.12,21.49],
    "西安":[108.95,34.27],
    "金坛":[119.56,31.74],
    "东营":[118.49,37.46],
    "牡丹江":[129.58,44.6],
    "遵义":[106.9,27.7],
    "绍兴":[120.58,30.01],
    "扬州":[119.42,32.39],
    "常州":[119.95,31.79],
    "潍坊":[119.1,36.62],
    "重庆":[106.54,29.59],
    "台州":[121.420757,28.656386],
    "南京":[118.78,32.04],
    "滨州":[118.03,37.36],
    "贵阳":[106.71,26.57],
    "无锡":[120.29,31.59],
    "本溪":[123.73,41.3],
    "克拉玛依":[84.77,45.59],
    "渭南":[109.5,34.52],
    "马鞍山":[118.48,31.56],
    "宝鸡":[107.15,34.38],
    "焦作":[113.21,35.24],
    "句容":[119.16,31.95],
    "北京":[116.46,39.92],
    "徐州":[117.2,34.26],
    "衡水":[115.72,37.72],
    "包头":[110,40.58],
    "绵阳":[104.73,31.48],
    "乌鲁木齐":[87.68,43.77],
    "枣庄":[117.57,34.86],
    "杭州":[120.19,30.26],
    "淄博":[118.05,36.78],
    "鞍山":[122.85,41.12],
    "溧阳":[119.48,31.43],
    "库尔勒":[86.06,41.68],
    "安阳":[114.35,36.1],
    "开封":[114.35,34.79],
    "济南":[117,36.65],
    "德阳":[104.37,31.13],
    "温州":[120.65,28.01],
    "九江":[115.97,29.71],
    "邯郸":[114.47,36.6],
    "临安":[119.72,30.23],
    "兰州":[103.73,36.03],
    "沧州":[116.83,38.33],
    "临沂":[118.35,35.05],
    "南充":[106.110698,30.837793],
    "天津":[117.2,39.13],
    "富阳":[119.95,30.07],
    "泰安":[117.13,36.18],
    "诸暨":[120.23,29.71],
    "郑州":[113.65,34.76],
    "哈尔滨":[126.63,45.75],
    "聊城":[115.97,36.45],
    "芜湖":[118.38,31.33],
    "唐山":[118.02,39.63],
    "平顶山":[113.29,33.75],
    "邢台":[114.48,37.05],
    "德州":[116.29,37.45],
    "济宁":[116.59,35.38],
    "荆州":[112.239741,30.335165],
    "宜昌":[111.3,30.7],
    "义乌":[120.06,29.32],
    "丽水":[119.92,28.45],
    "洛阳":[112.44,34.7],
    "秦皇岛":[119.57,39.95],
    "株洲":[113.16,27.83],
    "石家庄":[114.48,38.03],
    "莱芜":[117.67,36.19],
    "常德":[111.69,29.05],
    "保定":[115.48,38.85],
    "湘潭":[112.91,27.87],
    "金华":[119.64,29.12],
    "岳阳":[113.09,29.37],
    "长沙":[113,28.21],
    "衢州":[118.88,28.97],
    "廊坊":[116.7,39.53],
    "菏泽":[115.480656,35.23375],
    "合肥":[117.27,31.86],
    "武汉":[114.31,30.52],
    "大庆":[125.03,46.58]
};

var convertData = function (data) {
    var res = [];
    for (var i = 0; i < data.length; i++) {
        var geoCoord = geoCoordMap[data[i].name];
        if (geoCoord) {
            res.push({
                name: data[i].name,
                value: geoCoord.concat(data[i].value)
            });
        }
    }
    return res;
};

var option7 = {
    
    
    tooltip: {
        trigger: 'item',
        formatter: function (params) {
            return params.name + ' : ' + params.value[2];
        }
    },
    
    visualMap: {
        min: 0,
        max: 200,
        calculable: true,
        color: ['#2552f4','#37b2f6','#25f4a9'],
        textStyle: {
            color: '#fff'
        }
    },
    geo: {
        map: 'china',
        label: {
            emphasis: {
                show: false
            }
        },
		left:'1%',
        right:'1%',
        top:'1%',
        bottom:'1%',
        itemStyle: {
            normal: {
                areaColor: '#aeb2b0',
                borderColor: '#111'
            },
            emphasis: {
                areaColor: '#909292'
            }
        }
    },
    series: [
        {
            name: 'pm2.5',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: convertData([
                {name: "海门", value: 9},
                {name: "鄂尔多斯", value: 12},
                {name: "招远", value: 12},
                {name: "舟山", value: 12},
                {name: "齐齐哈尔", value: 14},
                {name: "盐城", value: 15},
                {name: "赤峰", value: 16},
                {name: "青岛", value: 18},
                {name: "乳山", value: 18},
                {name: "金昌", value: 19},
                {name: "泉州", value: 21},
                {name: "莱西", value: 21},
                {name: "日照", value: 21},
                {name: "胶南", value: 22},
                {name: "南通", value: 23},
                {name: "拉萨", value: 24},
                {name: "云浮", value: 24},
                {name: "梅州", value: 25},
                {name: "文登", value: 25},
                {name: "上海", value: 25},
                {name: "攀枝花", value: 25},
                {name: "威海", value: 25},
                {name: "承德", value: 25},
                {name: "厦门", value: 26},
                {name: "汕尾", value: 26},
                {name: "潮州", value: 26},
                {name: "丹东", value: 27},
                {name: "太仓", value: 27},
                {name: "曲靖", value: 27},
                {name: "烟台", value: 28},
                {name: "福州", value: 29},
                {name: "瓦房店", value: 30},
                {name: "即墨", value: 30},
                {name: "抚顺", value: 31},
                {name: "玉溪", value: 31},
                {name: "张家口", value: 31},
                {name: "阳泉", value: 31},
                {name: "莱州", value: 32},
                {name: "湖州", value: 32},
                {name: "汕头", value: 32},
                {name: "昆山", value: 33},
                {name: "宁波", value: 33},
                {name: "湛江", value: 33},
                {name: "揭阳", value: 34},
                {name: "荣成", value: 34},
                {name: "连云港", value: 35},
                {name: "葫芦岛", value: 35},
                {name: "常熟", value: 36},
                {name: "东莞", value: 36},
                {name: "河源", value: 36},
                {name: "淮安", value: 36},
                {name: "泰州", value: 36},
                {name: "南宁", value: 37},
                {name: "营口", value: 37},
                {name: "惠州", value: 37},
                {name: "江阴", value: 37},
                {name: "蓬莱", value: 37},
                {name: "韶关", value: 38},
                {name: "嘉峪关", value: 38},
                {name: "广州", value: 38},
                {name: "延安", value: 38},
                {name: "太原", value: 39},
                {name: "清远", value: 39},
                {name: "中山", value: 39},
                {name: "昆明", value: 39},
                {name: "寿光", value: 40},
                {name: "盘锦", value: 40},
                {name: "长治", value: 41},
                {name: "深圳", value: 41},
                {name: "珠海", value: 42},
                {name: "宿迁", value: 43},
                {name: "咸阳", value: 43},
                {name: "铜川", value: 44},
                {name: "平度", value: 44},
                {name: "佛山", value: 44},
                {name: "海口", value: 44},
                {name: "江门", value: 45},
                {name: "章丘", value: 45},
                {name: "肇庆", value: 46},
                {name: "大连", value: 47},
                {name: "临汾", value: 47},
                {name: "吴江", value: 47},
                {name: "石嘴山", value: 49},
                {name: "沈阳", value: 50},
                {name: "苏州", value: 50},
                {name: "茂名", value: 50},
                {name: "嘉兴", value: 51},
                {name: "长春", value: 51},
                {name: "胶州", value: 52},
                {name: "银川", value: 52},
                {name: "张家港", value: 52},
                {name: "三门峡", value: 53},
                {name: "锦州", value: 54},
                {name: "南昌", value: 54},
                {name: "柳州", value: 54},
                {name: "三亚", value: 54},
                {name: "自贡", value: 56},
                {name: "吉林", value: 56},
                {name: "阳江", value: 57},
                {name: "泸州", value: 57},
                {name: "西宁", value: 57},
                {name: "宜宾", value: 58},
                {name: "呼和浩特", value: 58},
                {name: "成都", value: 58},
                {name: "大同", value: 58},
                {name: "镇江", value: 59},
                {name: "桂林", value: 59},
                {name: "张家界", value: 59},
                {name: "宜兴", value: 59},
                {name: "北海", value: 60},
                {name: "西安", value: 61},
                {name: "金坛", value: 62},
                {name: "东营", value: 62},
                {name: "牡丹江", value: 63},
                {name: "遵义", value: 63},
                {name: "绍兴", value: 63},
                {name: "扬州", value: 64},
                {name: "常州", value: 64},
                {name: "潍坊", value: 65},
                {name: "重庆", value: 66},
                {name: "台州", value: 67},
                {name: "南京", value: 67},
                {name: "滨州", value: 70},
                {name: "贵阳", value: 71},
                {name: "无锡", value: 71},
                {name: "本溪", value: 71},
                {name: "克拉玛依", value: 72},
                {name: "渭南", value: 72},
                {name: "马鞍山", value: 72},
                {name: "宝鸡", value: 72},
                {name: "焦作", value: 75},
                {name: "句容", value: 75},
                {name: "北京", value: 79},
                {name: "徐州", value: 79},
                {name: "衡水", value: 80},
                {name: "包头", value: 80},
                {name: "绵阳", value: 80},
                {name: "乌鲁木齐", value: 84},
                {name: "枣庄", value: 84},
                {name: "杭州", value: 84},
                {name: "淄博", value: 85},
                {name: "鞍山", value: 86},
                {name: "溧阳", value: 86},
                {name: "库尔勒", value: 86},
                {name: "安阳", value: 90},
                {name: "开封", value: 90},
                {name: "济南", value: 92},
                {name: "德阳", value: 93},
                {name: "温州", value: 95},
                {name: "九江", value: 96},
                {name: "邯郸", value: 98},
                {name: "临安", value: 99},
                {name: "兰州", value: 99},
                {name: "沧州", value: 100},
                {name: "临沂", value: 103},
                {name: "南充", value: 104},
                {name: "天津", value: 105},
                {name: "富阳", value: 106},
                {name: "泰安", value: 112},
                {name: "诸暨", value: 112},
                {name: "郑州", value: 113},
                {name: "哈尔滨", value: 114},
                {name: "聊城", value: 116},
                {name: "芜湖", value: 117},
                {name: "唐山", value: 119},
                {name: "平顶山", value: 119},
                {name: "邢台", value: 119},
                {name: "德州", value: 120},
                {name: "济宁", value: 120},
                {name: "荆州", value: 127},
                {name: "宜昌", value: 130},
                {name: "义乌", value: 132},
                {name: "丽水", value: 133},
                {name: "洛阳", value: 134},
                {name: "秦皇岛", value: 136},
                {name: "株洲", value: 143},
                {name: "石家庄", value: 147},
                {name: "莱芜", value: 148},
                {name: "常德", value: 152},
                {name: "保定", value: 153},
                {name: "湘潭", value: 154},
                {name: "金华", value: 157},
                {name: "岳阳", value: 169},
                {name: "长沙", value: 175},
                {name: "衢州", value: 177},
                {name: "廊坊", value: 193},
                {name: "菏泽", value: 194},
                {name: "合肥", value: 229},
                {name: "武汉", value: 273},
                {name: "大庆", value: 279}
            ]),
            symbolSize: 12,
            label: {
                normal: {
                    show: false
                },
                emphasis: {
                    show: false
                }
            },
            itemStyle: {
                emphasis: {
                    borderColor: '#fff',
                    borderWidth: 1
                }
            }
        }
    ]
}
		
		 if(arrlabel.length==0){
				myChart7.setOption(option_nodata);}else{
					myChart7.setOption(option7);
				}
		
		
	}		  
			  
			  
              // Populate legend
              if(elem.is(":visible")){
                setTimeout(function(){
                 // scope.legend = plot.getData();
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