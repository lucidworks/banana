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
  'echarts',
  'echarts-gl',
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.bar3d', []);
  app.useModule(module);

  module.controller('bar3d', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
        linkage_id:'a',
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'bar3d',
      exportSize : 10000,
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


            // Function for customizing chart color by using field values as colors.


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


                        if (term === null) {
                            missing = count;
                        } else {
                            // if count = 0, do not add it to the chart, just skip it
                            if (count === 0) {
                                continue;
                            }
                            var terms = term.split(",");


                            var slice = [parseFloat(terms[1]), parseFloat(terms[0]), count];
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

  module.directive('bar3dChart', function(querySrv,dashboard,filterSrv) {
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

          if(myChart) {
            myChart.dispose();
          }
          var idd = scope.$id;
          var echarts = require('echarts');

				  var labelcolor = false;
					if (dashboard.current.style === 'dark'){
							labelcolor = true;
          }
              // Add plot to scope so we can build out own legend

          if(scope.panel.chart === 'bar3d') {
              var hours = ['12a', '1a', '2a', '3a', '4a', '5a', '6a',
                  '7a', '8a', '9a','10a','11a',
                  '12p', '1p', '2p', '3p', '4p', '5p',
                  '6p', '7p', '8p', '9p', '10p', '11p'];
              var days = ['Saturday', 'Friday', 'Thursday',
                  'Wednesday', 'Tuesday', 'Monday', 'Sunday'];
              var data = [[0,0,5],[0,1,1],[0,2,0],[0,3,0],[0,4,0],
                [0,5,0],[0,6,0],[0,7,0],[0,8,0],[0,9,0],[0,10,0],
                [0,11,2],[0,12,4],[0,13,1],[0,14,1],[0,15,3],[0,16,4],
                [0,17,6],[0,18,4],[0,19,4],[0,20,3],[0,21,3],[0,22,2],
                [0,23,5],[1,0,7],[1,1,0],[1,2,0],[1,3,0],[1,4,0],[1,5,0],
                [1,6,0],[1,7,0],[1,8,0],[1,9,0],[1,10,5],[1,11,2],[1,12,2],
                [1,13,6],[1,14,9],[1,15,11],[1,16,6],[1,17,7],[1,18,8],[1,19,12],
                [1,20,5],[1,21,5],[1,22,7],[1,23,2],[2,0,1],[2,1,1],[2,2,0],[2,3,0],
                [2,4,0],[2,5,0],[2,6,0],[2,7,0],[2,8,0],[2,9,0],[2,10,3],[2,11,2],[2,12,1],
                [2,13,9],[2,14,8],[2,15,10],[2,16,6],[2,17,5],[2,18,5],[2,19,5],[2,20,7],[2,21,4],
                [2,22,2],[2,23,4],[3,0,7],[3,1,3],[3,2,0],[3,3,0],[3,4,0],[3,5,0],[3,6,0],[3,7,0],[3,8,1],
                [3,9,0],[3,10,5],[3,11,4],[3,12,7],[3,13,14],[3,14,13],[3,15,12],[3,16,9],[3,17,5],[3,18,5],[3,19,10],
                [3,20,6],[3,21,4],[3,22,4],[3,23,1],[4,0,1],[4,1,3],[4,2,0],[4,3,0],[4,4,0],[4,5,1],[4,6,0],[4,7,0],[4,8,0],
                [4,9,2],[4,10,4],[4,11,4],[4,12,2],[4,13,4],[4,14,4],[4,15,14],[4,16,12],[4,17,1],[4,18,8],[4,19,5],[4,20,3],[4,21,7],
                [4,22,3],[4,23,0],[5,0,2],[5,1,1],[5,2,0],[5,3,3],[5,4,0],[5,5,0],[5,6,0],[5,7,0],[5,8,2],[5,9,0],[5,10,4],[5,11,1],[5,12,5],
                [5,13,10],[5,14,5],[5,15,7],[5,16,11],[5,17,6],[5,18,0],[5,19,5],[5,20,3],[5,21,4],[5,22,2],[5,23,0],[6,0,1],[6,1,0],[6,2,0],[6,3,0],
                [6,4,0],[6,5,0],[6,6,0],[6,7,0],[6,8,0],[6,9,0],[6,10,1],[6,11,0],[6,12,2],[6,13,1],[6,14,3],[6,15,4],[6,16,0],[6,17,0],[6,18,0],[6,19,0],
                [6,20,1],[6,21,2],[6,22,2],[6,23,6]];
              var myChart = echarts.init(document.getElementById(idd));
              var option33 = {
                  tooltip: {},
                  visualMap: {
                      max: 20,
                      inRange: {
                          color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                      }
                  },
                  xAxis3D: {
                      type: 'category',
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      data: hours
                  },
                  yAxis3D: {
                      type: 'category',
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      data: days
                  },
                  zAxis3D: {
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      type: 'value'
                  },
                  grid3D: {
                      boxWidth: 200,
                      boxDepth: 80,
                      light: {
                          main: {
                              intensity: 1.2
                          },
                          ambient: {
                              intensity: 0.3
                          }
                      }
                  },
                  series: [{
                      type: 'bar3d',
                      data: data.map(function (item) {
                          return {
                              value: [item[1], item[0], item[2]]
                          };
                      }),
                      shading: 'color',

                      label: {
                          show: false,
                          textStyle: {
                              fontSize: 16,
                              borderWidth: 1
                          }
                      },

                      itemStyle: {
                          opacity: 0.4
                      },

                      emphasis: {
                          label: {
                              textStyle: {
                                  fontSize: 20,
                                  color: '#900'
                              }
                          },
                          itemStyle: {
                              color: '#900'
                          }
                      }
                  }]
              };

              if(scope.data.length === 0){
                myChart.setOption(option_nodata);}else{
                myChart.setOption(option33);
                myChart.on('click', function (params) {
                    // 点击联动
                    scope.build_search(params);
                });
              }
          }

          if(scope.panel.chart === 'bar') {

              myChart = echarts.init(document.getElementById(idd));

              var hours1 = ['12a', '1a', '2a', '3a', '4a', '5a', '6a',
                  '7a', '8a', '9a','10a','11a',
                  '12p', '1p', '2p', '3p', '4p', '5p',
                  '6p', '7p', '8p', '9p', '10p', '11p'];
              var days1 = ['Saturday', 'Friday', 'Thursday',
                  'Wednesday', 'Tuesday', 'Monday', 'Sunday'];

              var data1 = [[0,0,5],[0,1,1],[0,2,0],[0,3,0],[0,4,0],[0,5,0],[0,6,0],[0,7,0],[0,8,0],[0,9,0],[0,10,0],[0,11,2],[0,12,4],[0,13,1],[0,14,1],[0,15,3],[0,16,4],[0,17,6],[0,18,4],[0,19,4],[0,20,3],[0,21,3],[0,22,2],[0,23,5],
                [1,0,7],[1,1,0],[1,2,0],[1,3,0],[1,4,0],[1,5,0],[1,6,0],[1,7,0],[1,8,0],[1,9,0],[1,10,5],[1,11,2],[1,12,2],[1,13,6],[1,14,9],[1,15,11],[1,16,6],[1,17,7],[1,18,8],[1,19,12],[1,20,5],[1,21,5],[1,22,7],[1,23,2],[2,0,1],[2,1,1],
                [2,2,0],[2,3,0],[2,4,0],[2,5,0],[2,6,0],[2,7,0],[2,8,0],[2,9,0],[2,10,3],[2,11,2],[2,12,1],[2,13,9],[2,14,8],[2,15,10],[2,16,6],[2,17,5],[2,18,5],[2,19,5],[2,20,7],[2,21,4],[2,22,2],[2,23,4],[3,0,7],[3,1,3],[3,2,0],[3,3,0],[3,4,0],
                [3,5,0],[3,6,0],[3,7,0],[3,8,1],[3,9,0],[3,10,5],[3,11,4],[3,12,7],[3,13,14],[3,14,13],[3,15,12],[3,16,9],[3,17,5],[3,18,5],[3,19,10],[3,20,6],[3,21,4],[3,22,4],[3,23,1],[4,0,1],[4,1,3],[4,2,0],[4,3,0],[4,4,0],[4,5,1],[4,6,0],[4,7,0],[4,8,0],
                [4,9,2],[4,10,4],[4,11,4],[4,12,2],[4,13,4],[4,14,4],[4,15,14],[4,16,12],[4,17,1],[4,18,8],[4,19,5],[4,20,3],[4,21,7],[4,22,3],[4,23,0],[5,0,2],[5,1,1],[5,2,0],[5,3,3],[5,4,0],[5,5,0],[5,6,0],[5,7,0],[5,8,2],[5,9,0],[5,10,4],[5,11,1],[5,12,5],[5,13,10],
                [5,14,5],[5,15,7],[5,16,11],[5,17,6],[5,18,0],[5,19,5],[5,20,3],[5,21,4],[5,22,2],[5,23,0],[6,0,1],[6,1,0],[6,2,0],[6,3,0],[6,4,0],[6,5,0],[6,6,0],[6,7,0],[6,8,0],[6,9,0],[6,10,1],[6,11,0],[6,12,2],[6,13,1],[6,14,3],[6,15,4],[6,16,0],[6,17,0],[6,18,0],[6,19,0],[6,20,1],[6,21,2],[6,22,2],[6,23,6]];
              var option2 = {
                  tooltip: {},
                  visualMap: {
                      max: 20,
                      inRange: {
                          color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                      }
                  },
                  xAxis3D: {
                      type: 'category',
        nameTextStyle:{
          color:'#fff'
        },
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      data: hours1
                  },
                  yAxis3D: {
                      type: 'category',
        nameTextStyle:{
          color:'#fff'
        },
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      data: days1
                  },
                  zAxis3D: {
        nameTextStyle:{
          color:'#fff'
        },
        axisLabel:{
          textStyle:{
            color:'#fff'
          }
        },
                      type: 'value'
                  },
                  grid3D: {
                      boxWidth: 200,
                      boxDepth: 80,
                      viewControl: {
                          // projection: 'orthographic'
                      },
                      light: {
                          main: {
                              intensity: 1.2,
                              shadow: true
                          },
                          ambient: {
                              intensity: 0.3
                          }
                      }
                  },
                  series: [{
                      type: 'bar3d',
                      data: data1.map(function (item) {
                          return {
                              value: [item[1], item[0], item[2]],
                          };
                      }),
                      shading: 'lambert',

                      label: {
                          textStyle: {
                              fontSize: 16,
                              borderWidth: 1
                          }
                      },

                      emphasis: {
                          label: {
                              textStyle: {
                                  fontSize: 20,
                                  color: '#fff'
                              }
                          },
                          itemStyle: {
                              color: '#900'
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

          if(scope.panel.chart === 'flow') {

              myChart = echarts.init(document.getElementById(idd));
              var option1 = {
                  tooltip: {},

                  visualMap: {
                      show: false,
                      dimension: 2,
                      min: -1,
                      max: 1,
                      inRange: {
                          color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                      }
                  },
                  xAxis3D: {
                      type: 'value'
                  },
                  yAxis3D: {
                      type: 'value'
                  },
                  zAxis3D: {
                      type: 'value',
                      max: 1,
                      splitNumber: 2
                  },
                  grid3D: {
                      viewControl: {
                          // projection: 'orthographic'
                      },
                      boxHeight: 40
                  },
                  series: [{
                      type: 'surface',
                      wireframe: {
                          show: false
                      },
                      shading: 'color',
                      equation: {
                          x: {
                              step: 0.05,
                              min: -3,
                              max: 3,
                          },
                          y: {
                              step: 0.05,
                              min: -3,
                              max: 3,
                          },
                          z: function (x, y) {
                              return Math.sin(x * x + y * y) * x / 3.14;
                          }
                      }
                  }]
              };
              if(scope.data.length === 0){
                  myChart.setOption(option_nodata);}else{
                  myChart.setOption(option1);
                  myChart.on('click', function (params) {
                      // 点击联动
                      scope.build_search(params);
                  });
              }
          }

          if(scope.panel.chart === 'earth') {
             myChart = echarts.init(document.getElementById(idd));
             var option = {
                 backgroundColor: '#000',
                 globe: {
                     baseTexture: 'vendor/echarts/data-1491890179041-Hkj-elqpe.jpg',
                     heightTexture: 'vendor/echarts/data-1491889019097-rJQYikcpl.jpg',

                     displacementScale: 0.1,

                     shading: 'lambert',

                     environment: 'vendor/echarts/data-1491837999815-H1_44Qtal.jpg',

                     light: {
                         ambient: {
                             intensity: 0.1
                         },
                         main: {
                             intensity: 1.5
                         }
                     },

                     layers: [{
                         type: 'blend',
                         blendTo: 'emission',
                         texture: 'vendor/echarts/data-1491890291849-rJ2uee5ag.jpg'
                     }, {
                         type: 'overlay',
                         texture: 'vendor/echarts/data-1491890092270-BJEhJg96l.png',
                         shading: 'lambert',
                         distance: 5
                     }]
                 },
                 series: []
             };
              if(scope.data.length === 0){
                  myChart.setOption(option_nodata);}else{
                  myChart.setOption(option);
                  myChart.on('click', function (params) {
                      // 点击联动
                      scope.build_search(params);
                  });
              }
          }

          if(scope.panel.chart === 'earth1') {
            myChart = echarts.init(document.getElementById(idd));
                var data2 = scope.data.filter(function (dataItem) {
                    return dataItem[2] > 0;
                }).map(function (dataItem) {
                    return [dataItem[0], dataItem[1], Math.sqrt(dataItem[2])];
                });

                var option11 = {

                    globe: {
                        baseTexture: 'vendor/echarts/data-1491890179041-Hkj-elqpe.jpg',
                        heightTexture: 'vendor/echarts/data-1491889019097-rJQYikcpl.jpg',

                        displacementScale: 0.1,

                        shading: 'lambert',

                        environment: 'vendor/echarts/data-1491837999815-H1_44Qtal.jpg',

                        light: {
                            ambient: {
                                intensity: 0.1
                            },
                            main: {
                                intensity: 1.5
                            }
                        },

                        layers: [{
                            type: 'blend',
                            blendTo: 'emission',
                            texture: 'vendor/echarts/data-1491890291849-rJ2uee5ag.jpg'
                        }, {
                            type: 'overlay',
                            texture: 'vendor/echarts/data-1491890092270-BJEhJg96l.png',
                            shading: 'lambert',
                            distance: 5
                        }]
                    },
                    visualMap: {
                        max: 40,
                        calculable: true,
                        realtime: false,
                        inRange: {
                            color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                        },
                        textStyle: {
                            color: '#fff'
                        },
                        controller: {
                            inRange: {
                                color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                            }
                        },
                        outOfRange: {
                            colorAlpha: 0
                        }
                    },
                    series: [{
                        type: 'bar3d',
                        coordinateSystem: 'globe',
                        data: data2,
                        barSize: 0.6,
                        minHeight: 2,
                        maxHeight: 20,
                        silent: true,
                        itemStyle: {
                            color: 'orange'
                        }
                    }]
                };
                myChart.setOption(option11);
          }

          if(scope.panel.chart === 'world') {
              myChart = echarts.init(document.getElementById(idd));
              $.getJSON("vendor/echarts/data-1491887968120-rJODPy9ae.json", function () {
                  var data3 = scope.data.filter(function (dataItem) {
                      return dataItem[2] > 0;
                  }).map(function (dataItem) {
                      return [dataItem[0], dataItem[1], Math.sqrt(dataItem[2])];
                  });
                  var option5 = {

                      backgroundColor: '#cdcfd5',
                      geo3D: {
                          map: 'world',
                          shading: 'lambert',

                          lambertMaterial: {
                              baseTexture: 'vendor/echarts/data-1491896059428-B1QbPbq6e.jpg',
                              textureTiling: 20
                          },

                          postEffect: {
                              enable: true,
                              SSAO: {
                                  enable: true,
                                  radius: 3,
                                  quality: 'high'
                              }
                          },
                          groundPlane: {
                              show: true
                          },
                          light: {
                              main: {
                                  intensity: 1,
                                  shadow: true,
                                  shadowQuality: 'high',
                                  alpha: 30
                              },
                              ambient: {
                                  intensity: 0
                              },
                              ambientCubemap: {
                                  texture: 'vendor/echarts/data-1491896094618-H1DmP-5px.hdr',
                                  exposure: 2,
                                  diffuseIntensity: 0.3
                              }
                          },
                          viewControl: {
                              distance: 50
                          },

                          boxHeight: 0.5
                      },
                      visualMap: {
                          max: 40,
                          calculable: true,
                          realtime: false,
                          inRange: {
                              color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
                          },
                          outOfRange: {
                              colorAlpha: 0
                          }
                      },
                      series: [{
                          type: 'bar3d',
                          coordinateSystem: 'geo3D',
                          shading: 'lambert',
                          data: data3,
                          barSize: 0.1,
                          minHeight: 0.2,
                          maxHeight: 10,
                          silent: true,
                          itemStyle: {
                              color: 'orange'
                              // opacity: 0.8
                          }
                      }]
                  };
                  myChart.setOption(option5);
              });
          }
        }
      }
    };
  });

});
