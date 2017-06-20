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
  'kbn',
  'echarts-liquidfill'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.pies', []);
  app.useModule(module);

  module.controller('appsum', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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

  module.directive('appsumChart', function(querySrv,dashboard,filterSrv) {
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
          require(['echarts'], function(ec){
            var echarts = ec;
            if(myChart) {
              myChart.dispose();
            }
            // Populate element
            try {
				 var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
						}
              // Add plot to scope so we can build out own legend


			    
			  
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

		     if(scope.panel.chart === 'java'){
	

				  
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
            shape:"path://M746.762 175.536c-29.661 20.894-58.555 38.684-90.296 64.505-23.997 19.615-67.321 46.428-69.657 82.553-3.616 54.939 81.016 105.75 36.125 175.407-17.023 26.558-45.916 37.917-82.553 54.171-4.383-7.999 9.535-14.718 15.487-23.23 56.25-81.528-58.555-108.597-43.868-208.94 14.175-96.983 128.468-130.804 234.762-144.466zM388.204 510.864c-26.558 12.383-70.938 14.719-90.296 41.276 19.614 14.719 48.252 14.175 74.81 15.487 108.853 4.895 245.064-4.384 337.92-20.638 3.103 6.72-12.895 18.302-23.23 25.79-58.555 42.811-240.682 54.938-366.302 46.427-42.044-2.848-138.26-13.919-139.315-51.58-1.28-45.659 116.597-50.554 165.104-54.17 9.536-0.768 27.358-4.64 41.277-2.592zM334.033 626.95c12.127 1.536-8.512 8.767-5.152 18.047 44.38 43.867 182.383 31.485 250.217 18.046 14.174-2.848 28.381-11.36 38.684-10.335 25.79 2.336 42.3 32.253 64.506 36.124-78.425 35.357-229.834 52.124-340.512 30.942-28.637-5.408-78.425-20.895-79.96-43.868-2.336-31.23 49.275-44.38 72.217-49.02z m33.533 105.782c7.999 2.592-2.848 6.976-2.592 10.335 23.486 40.765 139.57 26.302 198.637 12.895 11.871-2.848 23.742-11.103 33.533-10.335 29.917 2.048 41.276 33.277 67.066 38.684-82.297 50.3-281.702 70.682-363.742 7.744-3.872-45.916 33.02-51.067 67.066-59.323z m-74.81 77.401c-24.51 6.207-87.96-2.592-90.295 30.941-0.768 12.895 21.662 28.126 36.125 33.533 84.088 31.741 253.064 36.637 392.09 20.638 64.507-7.487 185.743-29.15 170.257-95.447 19.358 2.336 36.636 14.719 38.684 33.533 7.744 71.193-155.825 101.11-221.835 108.342-143.698 15.742-323.234 12.639-433.367-25.79-35.869-12.383-79.193-35.357-77.401-69.657 3.104-57.787 142.387-73.785 185.743-36.125z m219.276 213.836c-96.727-10.591-189.87-24.766-268.295-59.322 205.069 49.275 504.049 45.66 647.491-59.323 7.744-5.663 14.975-16.766 25.79-15.486-36.125 108.341-174.896 115.829-294.084 134.131H512zM579.098 0.096c18.046 17.022 30.94 48.763 30.94 82.552 0 99.83-105.75 157.617-157.36 224.427-11.36 14.975-26.046 37.917-25.79 61.914 0.512 54.427 56.763 115.318 77.4 159.953-36.124-23.741-79.96-55.45-110.933-92.855-30.941-37.148-61.914-97.495-33.533-149.618 42.556-78.425 169.232-125.108 214.124-208.94 10.847-20.382 19.358-51.58 5.152-77.401z m152.21 536.59c53.146-45.404 143.154-27.614 147.026 49.02 4.383 89.783-93.912 140.082-165.105 144.466 33.021-31.486 120.213-82.04 103.19-154.77-6.975-29.405-43.611-47.196-85.112-38.684z",
            data:[0.8, 0.6, 0.3],
            outline: {
                show: false
            },
            label: {
                normal: {
                    position: 'bottom',
                    // formatter: '应用总数:'+scope.data.length+"个",
                    formatter: "JAVA",
                    textStyle: {
                        color: '#178ad9',
                        fontSize: 20
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
                                fontSize: 20
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
                            formatter: '应用总数:'+scope.data.length+'个',
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 20,
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
				   if(scope.data.length==0){
				myChart.setOption(option_nodata);}else{
					myChart.setOption(option5);
					myChart.on('click', function (params) {
						// 点击联动
						scope.build_search(params);
					});
				}
				  
			  }

	       if(scope.panel.chart === 'php'){



           myChart = echarts.init(document.getElementById(idd));
           var option6 = {

             series: [{
               center: ['25%', '40%'],
               radius: '60%',
               backgroundStyle: {
                 color: 'none',
                 borderColor: '#696969',
                 borderWidth: 1
               },
               type: 'liquidFill',
               shape:"path://M728.284 330.762h-22.528l-9.252 56.182h21.049s25.61 0.788 26.818-36.398c1.203-21.366-16.087-19.784-16.087-19.784z m192.297 0h-22.523l-9.252 56.182h21.049s25.61 0.788 26.818-36.398c1.209-21.366-16.092-19.784-16.092-19.784z m-43.202-130.77l-237.835-40.545s10.64 39.47 10.69 81.782l0.329 220.344s-3.262 51.082-96.041 53.176c-92.78 2.1-99.282-57.784-96.031-59.566l-0.338-89.308s1.239-12.477 14.008-13.296c12.775-0.825 14.019 13.993 14.019 13.993l0.809 88.724s5.442 33.93 68.89 33.761c63.452-0.174 65.991-31.452 65.991-31.452l0.691-245.693s3.559-81.705-89.549-103.619c0 0-11.15-6.113-43.94-6.103l-161.72-0.102S185.98 106.342 164.224 275.44c0 0-3.901 30.633-3.948 52.454-0.04 21.821-0.317 381.394-0.317 381.394s-1.526 25.18-30.315 31.672c0 0-31.919 4.23-39.563-31.826l-0.701-104.289s-3.164-39.5-44.278-42.936c0 0-38.113-0.031-44.728 42.951l1.408 111.125s7.623 67.563 74.839 97.602c67.21 30.04 124.713-8.079 133.079-14.94 8.371-6.87 41.989-31.529 49.121-79.913 0 0 1.859-2.672 1.859-43.612l0.522-66.724s6.671-34.002 43.228-35.143 43.238 35.169 43.238 35.169v248.166s7.834 32.881 37.76 26.333l172.022-14.971s25.17-5.3 25.17-29.82V664.562s5.069-15.657 20.209-15.657c15.135 0 158.986 0.22 158.986 0.22s11.91 1.454 17.254 15.437c5.35 13.977-0.547 0-0.547 0l0.773 164.536s2.314 28.79 38.512 27.802l143.094 19.63 32.4 4.439s29.726-3.41 30.315-30.26V356.572c0.01 0-5.53-126.192-146.237-156.58z m-546.545 48.446l-12.109 13.906c-14.09-12.314-30.029-2.376-30.029-2.376-16.834 10.547-8.115 29.65-8.115 29.65l-13.906 4.378c-7.798 1.97-13.45-3.38-13.45-3.38-5.919-22.251 8.94-42.178 8.94-42.178 24.181-26.225 57.989-15.611 57.989-15.611 16.67 5.233 10.68 15.61 10.68 15.61z m385.649 159.396l-22.8-0.21-6.436 35.343h-24.402l21.99-132.94s31.248 0.47 51.759 0c20.516-0.477 40.699 16.634 31.247 55.393-11.264 46.213-51.358 42.414-51.358 42.414z m109.696 0s5.852-30.894 8.422-52.342c1.055-8.832 5.658-23.783-6.533-23.813-10.22-0.031-25.493-0.123-25.493-0.123L789.7 407.839h-24.136l22.523-133.576H812.8l-6.21 35.758h25.487s33.792-3.154 29.762 29.763c-4.019 32.921-11.53 68.055-11.53 68.055h-24.13z m133.964-42.414c-11.269 46.218-51.363 42.419-51.363 42.419l-22.795-0.21-6.436 35.343h-24.407l21.996-132.94s31.242 0.47 51.758 0c20.516-0.482 40.689 16.63 31.247 55.388z",
               data:[0.8, 0.6, 0.3],
               outline: {
                 show: false
               },
               label: {
                 normal: {
                   position: 'bottom',
                   // formatter: '应用总数:'+scope.data.length+"个",
                   formatter: "PHP",
                   textStyle: {
                     color: '#178ad9',
                     fontSize: 20
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
                       fontSize: 20
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
                     formatter: '应用总数:'+scope.data.length+'个',
                     textStyle: {
                       color: '#1a93f9',
                       fontSize: 20,
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
           if(scope.data.length==0){
             myChart.setOption(option_nodata);}else{
             myChart.setOption(option6);
             myChart.on('click', function (params) {
               // 点击联动
               scope.build_search(params);
             });
           }

         }

       if(scope.panel.chart === 'donet') {



         myChart = echarts.init(document.getElementById(idd));
         var option7 = {

           series: [{
             center: ['25%', '40%'],
             radius: '60%',
             backgroundStyle: {
               color: 'none',
               borderColor: '#696969',
               borderWidth: 1
             },
             type: 'liquidFill',
             shape:"path://M512 1024C230.4 1024 0 793.6 0 512S230.4 0 512 0s512 230.4 512 512-230.4 512-512 512zM112 617.6c-16 0-25.6 12.8-25.6 25.6 0 16 9.6 28.8 25.6 28.8s25.6-12.8 25.6-25.6c0-16-9.6-28.8-25.6-28.8zM448 352h-41.6v246.4l-160-246.4H192v320h41.6v-259.2l166.4 259.2H448V352z m233.6 278.4h-128v-96H672v-41.6h-118.4v-96h128V352H512v320h169.6v-41.6z m32-278.4v41.6h89.6V672h41.6v-278.4h89.6V352h-220.8z",
             data:[0.8, 0.6, 0.3],
             outline: {
               show: false
             },
             label: {
               normal: {
                 position: 'bottom',
                 // formatter: '应用总数:'+scope.data.length+"个",
                 formatter: ".NET",
                 textStyle: {
                   color: '#178ad9',
                   fontSize: 20
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
                     fontSize: 20
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
                   formatter: '应用总数:'+scope.data.length+'个',
                   textStyle: {
                     color: '#1a93f9',
                     fontSize: 20,
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
         if(scope.data.length==0){
           myChart.setOption(option_nodata);}else{
           myChart.setOption(option7);
           myChart.on('click', function (params) {
             // 点击联动
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
          });
        }
      

        var $tooltip = $('<div>');
      

      }
    };
  });

});
