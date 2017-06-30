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

  module.controller('alarm', function($translate,$scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
      missing : false,
      other   : false,
      size    : 10000,
      sortBy  : 'count',
      order   : 'descending',
      fontsize : 20,
      donut   : false,
      tilt    : false,
      display:'block',

      icon:"icon-caret-down",
      labels  : true,
	  ylabels :true,
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'alarm',
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
          if($scope.panel.display==='none'){
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
        if(($scope.panel.linkage_id===dashboard.current.linkage_id)||dashboard.current.enable_linkage){
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

  module.directive('alarmChart', function(querySrv,dashboard,filterSrv) {
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
          var low_value = 0;
          var middle_value = 0;
          var high_value=0;

		      for(var i1=0;i1<scope.data.length;i1++){
            if(scope.data[i1].name==="low"){
              low_value = scope.data[i1].value;
            }else if(scope.data[i1].name==="medium"){
              middle_value = scope.data[i1].value;
            }else if(scope.data[i1].name==="high"){
              high_value = scope.data[i1].value;
            }
          }

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

		     if(scope.panel.chart === 'alarm'){
	

				  
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
            shape:"path://M87.447,61.379c-1.172-4.259-2.385-8.663-2.385-13.184c0-19.13-11.611-35.58-27.469-39.633c-0.378-3.856-3.64-6.88-7.593-6.88s-7.215,3.023-7.593,6.88c-15.858,4.053-27.469,20.503-27.469,39.633c0,4.521-1.212,8.925-2.385,13.184c-1.866,6.775-3.627,13.175,0.224,18.532c3.382,4.703,10.479,7.326,22.796,8.36c0,0,1.273,0.15,4.321,0.279c0.189,5.424,4.636,9.767,10.106,9.767c5.468,0,9.913-4.34,10.106-9.762c3.078-0.13,4.321-0.284,4.321-0.284c12.317-1.034,19.414-3.657,22.796-8.36C91.074,74.555,89.313,68.155,87.447,61.379zM79.671,74.214c-2.095,2.914-8.766,4.703-19.826,5.317l-2.394,0.133l-0.002-0.005l-2.396,0.059c-1.601,0.04-3.277,0.061-5.053,0.061s-3.453-0.021-5.053-0.061l-2.396-0.059l-0.002,0.005l-2.394-0.133c-11.061-0.615-17.731-2.403-19.826-5.317c-1.74-2.42-0.551-6.739,0.826-11.74c1.172-4.256,2.5-9.081,2.5-14.278c0-15.883,9.907-29.35,23.044-31.325c0,0,1.613-0.243,3.302-0.243s3.302,0.243,3.302,0.243c13.137,1.976,23.044,15.442,23.044,31.325c0,5.197,1.328,10.022,2.5,14.278C80.223,67.475,81.412,71.793,79.671,74.214z",
            data:[0.8, 0.6, 0.3],
            outline: {
                show: false
            },
            label: {
                normal: {
                    position: 'bottom',
                    // formatter: '应用总数:'+scope.data.length+"个",
                    formatter: "告警",
                    textStyle: {
                        color: '#178ad9',
                        fontSize: scope.panel.fontsize
                    }
                }
            }
        },
          {
                name: '',
                type: 'pie',
                center: ['65%', '20%'],
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
                            formatter: '低级告警：'+low_value,
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 18,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            },{
                name: '',
                type: 'pie',
                center: ['65%', '45%'],
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
                            formatter: '中级告警：'+middle_value,
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 18,
                                fontWeight: 'bold'
                            }
                        }
                    }
                }]
            },{
                name: '',
                type: 'pie',
                center: ['65%', '70%'],
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
                            formatter: '高级告警：'+high_value,
                            textStyle: {
                                color: '#1a93f9',
                                fontSize: 18,
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

					myChart.setOption(option5);
					// myChart.on('click', function (params) {
					// 	// 点击联动
					// 	scope.build_search(params);
					// });

				  
			  }



              // Populate legend


            } catch(e) {
              elem.text(e);
            }
          });
        }
      


      

      }
    };
  });

});
