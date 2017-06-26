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
  'echarts-liquidfill',

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
                $scope.label = [];
                $scope.panelMeta.loading = false;
                $scope.$emit('render');
                return;
            }

            // Function for validating HTML color by assign it to a dummy <div id="colorTest">
            // and let the browser do the work of validation.
            /*var isValidHTMLColor = function (color) {
                // clear attr first, before comparison
                $('#colorTest').removeAttr('style');
                var valid = $('#colorTest').css('color');
                $('#colorTest').css('color', color);

                if (valid === $('#colorTest').css('color')) {
                    return false;
                } else {
                    return true;
                }
            };*/

            // Function for customizing chart color by using field values as colors.
            /*
            var addSliceColor = function (slice, color) {
                if ($scope.panel.useColorFromField && isValidHTMLColor(color)) {
                    slice.color = color;
                }
                return slice;
            };
            */

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

  module.directive('piesChart', function(querySrv,dashboard,filterSrv) {
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
          var labelcolor = false;
          if (dashboard.current.style === 'dark'){
              labelcolor = true;
          }
                // Add plot to scope so we can build out own legend
          var echarts = require('echarts');
          if(myChart) {
            myChart.dispose();
          }

          if(scope.panel.chart === 'dashboard') {

            var AP_1 = 0.0;
            var AP_2 = 0.0;
            var AP_n = 0.0;
            for (var i = 0; i < scope.data.length; i++) {
              AP_n = AP_n+scope.data[i].value;
              if(parseInt(scope.data[i].name)<=scope.panel.threshold_first ){
              AP_1+=scope.data[i].value;
              }else if(parseInt(scope.data[i].name)<scope.panel.threshold_second && parseInt(scope.data[i].name)>scope.panel.threshold_first){
              AP_2+=scope.data[i].value*0.5;
              }
            }
            var APdex =100;
            if(AP_n !== 0){
            APdex = parseInt(100*(AP_1+AP_2)/AP_n);
            //APdex = (AP_1+AP_2)/AP_n;
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

          if(scope.panel.chart === 'pie') {

            myChart = echarts.init(document.getElementById(idd));


            var option1 = {
      title : {
          show:false,
          x:'center'
      },
      color:colors,
      tooltip : {
          trigger: 'item',
          confine:true,
          formatter: "{a} <br/>{b} : {c} ({d}%)"
      },
      legend: {
      show:scope.panel.eLegend,
          orient: scope.panel.arrangement,
          left: 'left',
      top:'1%',
      bottom:'1%',

      textStyle:{
        fontSize:scope.panel.fontsize,
        color:'auto'
      },

          data: scope.data
      },
      series : [
          {
              name:scope.panel.title,
              type: 'pie',

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
              data:scope.data,
              itemStyle: {
          normal: {
            color: function(params) {
              var colorList = colors;
              return colorList[params.dataIndex];
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


            if(scope.data.length === 0){
                myChart.setOption(option_nodata);
            }else{
                myChart.setOption(option1);
                myChart.on('click', function (params) {
                  // 点击联动
                  scope.build_search(params);

            });

          }

          }

          if(scope.panel.chart === 'rosepie') {

            myChart = echarts.init(document.getElementById(idd));
            var option2 = {
              title: {
                  show:false,
                  x: "center"
                  },
              color:colors,
              tooltip: {
                  trigger: "item",
                                  confine:true,
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
                  data: scope.label
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
                        smooth: 0.6
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
              data: scope.data,
               itemStyle: {
                normal: {
                color: function(params) {
                                          var colorList = colors;
                                          return colorList[params.dataIndex];
                                          },
                shadowColor: '#fff',
                barBorderRadius: 5

                    }
                  }
      }]
    };

            if(scope.data.length === 0){
              myChart.setOption(option_nodata);}else{
              myChart.setOption(option2);
              myChart.on('click', function (params) {
                // 点击联动
                scope.build_search(params);
              });
            }
          }

          if(scope.panel.chart === 'bar') {
            myChart = echarts.init(document.getElementById(idd));
            var option3 = {
            color:colors,
            tooltip : {
            trigger: 'axis',
                          confine:true,
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
              data : scope.label,
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
              data:scope.data,
              itemStyle: {
                normal: {
                color: function(params) {
                                          var colorList = colors;
                                          return colorList[params.dataIndex];
                                          },
                shadowColor: '#fff',
                barBorderRadius: 5

                    }
                  }
          }
      ]
    };
           //没有数据显示NO DATA

            if(scope.data.length === 0){
              myChart.setOption(option_nodata);}else{
              myChart.setOption(option3);
              myChart.on('click', function (params) {
              // 点击联动
              scope.build_search(params);
            });
          }

          }

          if(scope.panel.chart === 'horizontalBar') {
            scope.label.reverse();
            myChart = echarts.init(document.getElementById(idd));
            var option33 = {
                          color: colors,
                          tooltip : {
                              trigger: 'axis',
                              confine:true,
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
                                      show:true,
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
                                      show:true,
                                  }
                              }
                          ],
                          yAxis : [
                              {
                                  show:scope.panel.ylabels,
                                  type : 'category',
                                  data : scope.label,
                                  axisLine:{
                                      show:false
                                  },
                                  axisLabel:{
                                      inside:!scope.panel.ylabels,
                                      show:scope.panel.ylabels,
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
                          series : [
                              {
                                  name:scope.panel.title,
                                  type:'bar',
                                  barWidth: '43%',
                                  data:scope.data,
                                  itemStyle: {
                                      normal: {
                                          color: function(params) {
                                              var colorList = colors;
                                              return colorList[params.dataIndex];
                                          },
                                          shadowColor: '#fff',
                                          barBorderRadius: 5

                                      }
                                  },
                                  label: {
                                      normal: {
                                          show: true,
                                          formatter:scope.panel.ylabels?'{c}':'{b}:{c}',
                                          position: scope.panel.ylabels?'right':'insideLeft',
                                          offset:[0,-2],
                                          textStyle: {
                                              fontWeight:'bold',
                                              color: labelcolor ? '#fff':'#4F4F4F',
                                              fontSize: scope.panel.fontsize
                                          }
                                      }
                                  }
                              }
                          ]
                      };
                      //没有数据显示NO DATA

            if(scope.data.length === 0){
                myChart.setOption(option_nodata);
            }else{
              myChart.setOption(option33);
              myChart.on('click', function (params) {
                  // 点击联动
                  scope.build_search(params);
              });
            }
          }

          if(scope.panel.chart === 'radar') {

            var radarlabel = [];

            for (var j = 0; j < scope.label.length; j++) {

              radarlabel[j] = {name:scope.label[j],max:scope.maxdata};
            }


            myChart = echarts.init(document.getElementById(idd));

            var dataBJ = [scope.radardata];

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
                 position: function (point) {
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
            if(scope.data.length === 0){
              myChart.setOption(option_nodata);
            }else{
              myChart.setOption(option4);
            }
          }

          if(scope.panel.chart === 'bars'){
            var islength = 0;
            if(scope.data.length>5){
              islength =1;
            }

            myChart = echarts.init(document.getElementById(idd));
            var option5 = {
      tooltip: {
          trigger: 'axis',
          confine:true,
          axisPointer: {
              type: 'none'
          },
          formatter: function(params) {
              return params[0].name + ': ' + params[0].value;
          }
      },
    color:['#1a75f9', '#1ab0f9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980','#bcf924','#f9ac24','#8224f9','#24e5f9','#f96524'],
    grid: {
        left: '0%',
        right: '3%',
        bottom: '3%',
        top: '3%',
        containLabel: true
      },
      xAxis: {
          data: scope.label,
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
          barCategoryGap: islength?'-60%':'-10%',
      symbolSize:['120%','100%'],
          // symbol: 'path://M0,10 L10,10 L5,0 L0,10 z',
          symbol: 'path://M0,10 L10,10 C5.5,10 5.5,5 5,0 C4.5,5 4.5,10 0,10 z',
         itemStyle: {
          normal: {
            color: function(params) {
                                          var colorList = ['#1a75f9', '#1ab0f9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980','#bcf924','#f9ac24','#8224f9','#24e5f9','#f96524'];
                                          return colorList[params.dataIndex];
                                          },
            shadowColor: '#fff',
            barBorderRadius: 5,
            opacity: 0.8

              },
        emphasis: {
                  opacity: 1
              }
          },
          data: scope.radardata,
          z: 10
      }]
    };
            if(scope.data.length === 0){
              myChart.setOption(option_nodata);
            }else{
              myChart.setOption(option5);
              myChart.on('click', function (params) {
                // 点击联动
                scope.build_search(params);
              });
            }

          }

          if(scope.panel.chart === 'funnel'){


            myChart = echarts.init(document.getElementById(idd));
            var option6 = {
          color: ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980','#bcf924','#f9ac24','#8224f9','#24e5f9','#f96524'],
      tooltip: {
          trigger: 'item',
          confine:true,
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
      data: scope.label
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
              max: scope.maxdata,
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
                                          return colorList[params.dataIndex];
                                          },
            opacity: 0.8

              },
        emphasis: {
                  opacity: 1
              }
          },
              data: scope.data

          }
      ]
    };

            if(scope.data.length === 0){
              myChart.setOption(option_nodata);
            }else{
              myChart.setOption(option6);
              myChart.on('click', function (params) {
              // 点击联动
                scope.build_search(params);
              });
            }
          }

          if(scope.panel.chart === 'ebar') {

            myChart = echarts.init(document.getElementById(idd));
            var option7 = {
                color: ['#1a75f9', '#1a93f9', '#1ab0f9', '#1acef9', '#42d3f0', '#e59d87', '#759aa0', '#dc6b67', '#efdd79', '#8dc1aa', '#ea7d52', '#8dace7', '#a6a1e1', '#FECDA3', '#FED980'],
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
                        data : scope.label,
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
                        data:scope.data,
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
            if(scope.data.length === 0){
              myChart.setOption(option_nodata);}else{
              myChart.setOption(option7);
              myChart.on('click', function (params) {
                    // 控制台打印数据的名称
                    console.log(params);
                    scope.build_search(params);
              });
            }
          }

          if(scope.panel.chart === 'liquidfill') {
            myChart = echarts.init(document.getElementById(idd));
            var series = [];
            var titles = [];

            for (var k = 0; k < scope.radardata.length; k++) {

                var xla = scope.label[k].replace(" ","\n");
                var x =  (k+0.5) / scope.radardata.length * 100 + '%';

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
                });

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
                        name:scope.label[k],
                        value: scope.radardata[k]  / scope.maxdata,
                        rawValue: scope.radardata[k]
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
                });
            }

            // 使用刚指定的配置项和数据显示图表。
            if(scope.data.length === 0){
                myChart.setOption(option_nodata);}else{
                myChart.setOption({
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
                myChart.on('click', function (params) {
                    // 控制台打印数据的名称
                    scope.build_search(params);
                });
            }
        }

        }
      }
    };
  });

});
