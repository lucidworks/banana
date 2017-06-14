/*
  ## sankey

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

  var module = angular.module('kibana.panels.sankey', []);
  app.useModule(module);

  module.controller('sankey', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
        linkage_id:'a',
      donut   : false,
      tilt    : false,
      labels  : true,
        display:'block',
        icon:"icon-caret-down",
	  ylabels :true,
      logAxis : false,
      arrangement : 'vertical',
	  RoseType	  : 'area',
      chart       : 'sankey',
	  sankeymode  :'count',
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
      var rows_limit = isForExport ? '&rows=0' : ''; // for sankey, we do not need the actual response doc, so set rows=0
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
      $scope.display=function() {
          if($scope.panel.display === 'none'){
              $scope.panel.display='block';
              $scope.panel.icon="icon-caret-down";


          }else{
              $scope.panel.display='none';
              $scope.panel.icon="icon-caret-up";
          }
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
        kbn.download_response(response, filetype, "sankey");
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
                // data:[[k,results.facets.sankey.missing]],meta:"missing",color:'#aaa',opacity:0});
                // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
                data: [[k, missing]], meta: "missing", color: '#aaa', opacity: 0
            });
            $scope.data.push({
                label: 'Other values',
                // data:[[k+1,results.facets.sankey.other]],meta:"other",color:'#444'});
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
                type: 'sankey', field: $scope.panel.field, value: term.label,
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

  module.directive('sankeyChart', function(querySrv,dashboard,filterSrv) {
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

          if (filterSrv.idsByTypeAndField('sankey',scope.panel.field).length > 0) {
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
           
			  var arrdata = [];	
			  var radardata = [];
				var arrlabel = [];
				var sankeydata = [];
				var sankey =[];
				var radarmax = 0;
				
				var nodesMap={};
				 for (var i = 0,j=0; i < chartData.length; i++) {
					 sankey = chartData[i].label.split("|");
					 sankeydata[i]={id:sankey[0],value:sankey[1],number:chartData[i].data[0][1]};
					 arrlabel = sankey[0].split(",");
					 nodesMap[arrlabel[0]]=1;
					 nodesMap[arrlabel[1]]=1;
					 //arrdata[j] = arrlabel[0];
					// j++;
					// arrdata[j] = arrlabel[1];
					// j++;
				}
				//产生nodes数据
				chartData = null;
		
				var nodes_data=[];
				
				for (var item in nodesMap) {
					nodes_data.push({
							name:item
						})
				}
				nodesMap = null;
			
				var links_data = [];
				var listMap = {};
				for(var i = 0,key,svalue; i < sankeydata.length; i++){ 
					key = sankeydata[i].id;
					svalue = sankeydata[i].number;
					if(scope.panel.sankeymode ==='sum' ){
						svalue = parseInt(sankeydata[i].value);
					}
						if (!!listMap[key]) {
								listMap[key]+=svalue;
							} else {
								listMap[key] = svalue;
								}
				}
				//产生links数据
				sankeydata = null;
				
				for (var item in listMap) {
					links_data.push({
						source: item.split(',')[0],
						target: item.split(',')[1],
						value: listMap[item]
					})
				}
				
		if(nodes_data.length == 0 || typeof(links_data[0].target)=="undefined"){
			
			nodes_data=[{"name": "Total"},{"name": "Environment"},{"name": "Land use"},{"name": "Cocoa butter (Organic)"},{"name": "Cocoa mass (Organic)"},{"name": "Hazelnuts (Organic)"},{"name": "Cane sugar (Organic)"},{"name": "Vegetables (Organic)"},{"name": "Climate change"},{"name": "Harmful substances"},{"name": "Water use"},{"name": "Resource depletion"},{"name": "Refrigeration"},{"name": "Packaging"},{"name": "Human rights"},{"name": "Child labour"},{"name": "Coconut oil (Organic)"},{"name": "Forced labour"},{"name": "Health safety"},{"name": "Access to water"},{"name": "Freedom of association"},{"name": "Access to land"},{"name": "Sufficient wage"},{"name": "Equal rights migrants"},{"name": "Discrimination"},{"name": "Working hours"}];
			links_data=[{"source": "Total", "target": "Environment", "value": 0.442284047256003},{"source": "Total", "target": "Environment", "value": 0.1},{"source": "Environment", "target": "Land use", "value": 0.32322870366987},{"source": "Land use", "target": "Cocoa butter (Organic)", "value": 0.177682517071359},{"source": "Land use", "target": "Cocoa mass (Organic)", "value": 0.137241325342711},{"source": "Land use", "target": "Hazelnuts (Organic)", "value": 0.00433076373512774},{"source": "Land use", "target": "Cane sugar (Organic)", "value": 0.00296956039863467},{"source": "Land use", "target": "Vegetables (Organic)", "value": 0.00100453712203756},{"source": "Environment", "target": "Climate change", "value": 0.0112886157414413},{"source": "Climate change", "target": "Cocoa butter (Organic)", "value": 0.00676852971933996},{"source": "Climate change", "target": "Cocoa mass (Organic)", "value": 0.00394686874786743},{"source": "Climate change", "target": "Cane sugar (Organic)", "value": 0.000315972058711838},{"source": "Climate change", "target": "Hazelnuts (Organic)", "value": 0.000218969462265292},{"source": "Climate change", "target": "Vegetables (Organic)", "value": 3.82757532567656e-05},{"source": "Environment", "target": "Harmful substances", "value": 0.00604275542495656},{"source": "Harmful substances", "target": "Cocoa mass (Organic)", "value": 0.0055125989240741},{"source": "Harmful substances", "target": "Cocoa butter (Organic)", "value": 0.000330017607892127},{"source": "Harmful substances", "target": "Cane sugar (Organic)", "value": 0.000200138892990337},{"source": "Harmful substances", "target": "Hazelnuts (Organic)", "value": 0},{"source": "Harmful substances", "target": "Vegetables (Organic)", "value": 0},{"source": "Environment", "target": "Water use", "value": 0.00148345269044703}, {"source": "Water use", "target": "Cocoa butter (Organic)", "value": 0.00135309891304186},{"source": "Water use", "target": "Cocoa mass (Organic)", "value": 0.000105714137908639},{"source": "Water use", "target": "Hazelnuts (Organic)", "value": 1.33452642581887e-05},{"source": "Water use", "target": "Cane sugar (Organic)", "value": 8.78074837009238e-06},{"source": "Water use", "target": "Vegetables (Organic)", "value": 2.5136268682477e-06},{"source": "Environment", "target": "Resource depletion", "value": 0.000240519729288764},{"source": "Resource depletion", "target": "Cane sugar (Organic)", "value": 0.000226237279345084},{"source": "Resource depletion", "target": "Vegetables (Organic)", "value": 1.42824499436793e-05},{"source": "Resource depletion", "target": "Hazelnuts (Organic)", "value": 0},{"source": "Resource depletion", "target": "Cocoa mass (Organic)", "value": 0},{"source": "Resource depletion", "target": "Cocoa butter (Organic)", "value": 0},{"source": "Environment", "target": "Refrigeration", "value": 0},{"source": "Environment", "target": "Packaging", "value": 0},{"source": "Total", "target": "Human rights", "value": 0.307574096993239},{"source": "Human rights", "target": "Child labour", "value": 0.0410641202645833},{"source": "Child labour", "target": "Hazelnuts (Organic)", "value": 0.0105339381639722},{"source": "Child labour", "target": "Cocoa mass (Organic)", "value": 0.0105},{"source": "Child labour", "target": "Cocoa butter (Organic)", "value": 0.0087294420777},{"source": "Child labour", "target": "Coconut oil (Organic)", "value": 0.00474399974233333},{"source": "Child labour", "target": "Cane sugar (Organic)", "value": 0.00388226450884445},{"source": "Child labour", "target": "Vegetables (Organic)", "value": 0.00267447577173333},{"source": "Human rights", "target": "Forced labour", "value": 0.0365458590642445},{"source": "Forced labour", "target": "Hazelnuts (Organic)", "value": 0.0114913076376389},{"source": "Forced labour", "target": "Cocoa butter (Organic)", "value": 0.0081134807347},{"source": "Forced labour", "target": "Cocoa mass (Organic)", "value": 0.00765230236575},{"source": "Forced labour", "target": "Cane sugar (Organic)", "value": 0.004},{"source": "Forced labour", "target": "Vegetables (Organic)", "value": 0.00296668823626667},{"source": "Forced labour", "target": "Coconut oil (Organic)", "value": 0.00232208008988889},{"source": "Human rights", "target": "Health safety", "value": 0.0345435327843611},{"source": "Health safety", "target": "Hazelnuts (Organic)", "value": 0.0121419536385},{"source": "Health safety", "target": "Cocoa mass (Organic)", "value": 0.00766772850678333},{"source": "Health safety", "target": "Cocoa butter (Organic)", "value": 0.0056245892061},{"source": "Health safety", "target": "Coconut oil (Organic)", "value": 0.00361616847688889},{"source": "Health safety", "target": "Cane sugar (Organic)", "value": 0.00277374682533333},{"source": "Health safety", "target": "Vegetables (Organic)", "value": 0.00271934613075556},{"source": "Human rights", "target": "Access to water", "value": 0.0340206659360667},{"source": "Access to water", "target": "Cocoa mass (Organic)", "value": 0.0105},{"source": "Access to water", "target": "Cocoa butter (Organic)", "value": 0.0089274160792},{"source": "Access to water", "target": "Hazelnuts (Organic)", "value": 0.0054148022845},{"source": "Access to water", "target": "Cane sugar (Organic)", "value": 0.00333938149786667},{"source": "Access to water", "target": "Vegetables (Organic)", "value": 0.00314663377488889},{"source": "Access to water", "target": "Coconut oil (Organic)", "value": 0.00269243229961111},{"source": "Human rights", "target": "Freedom of association", "value": 0.0320571523941667},{"source": "Freedom of association", "target": "Hazelnuts (Organic)", "value": 0.0132312483463611},{"source": "Freedom of association", "target": "Cocoa butter (Organic)", "value": 0.0077695200707},{"source": "Freedom of association", "target": "Cocoa mass (Organic)", "value": 0.00510606573995},{"source": "Freedom of association", "target": "Vegetables (Organic)", "value": 0.00354321156324444},{"source": "Freedom of association", "target": "Cane sugar (Organic)", "value": 0.00240710667391111},{"source": "Freedom of association", "target": "Coconut oil (Organic)", "value": 0},{"source": "Human rights", "target": "Access to land", "value": 0.0315022209894056},{"source": "Access to land", "target": "Hazelnuts (Organic)", "value": 0.00964970063322223},{"source": "Access to land", "target": "Cocoa mass (Organic)", "value": 0.00938530207965},{"source": "Access to land", "target": "Cocoa butter (Organic)", "value": 0.0060110791848},{"source": "Access to land", "target": "Cane sugar (Organic)", "value": 0.00380818314608889},{"source": "Access to land", "target": "Vegetables (Organic)", "value": 0.00264795594564445},{"source": "Access to land", "target": "Coconut oil (Organic)", "value": 0},{"source": "Human rights", "target": "Sufficient wage", "value": 0.0287776757227333},{"source": "Sufficient wage", "target": "Cocoa mass (Organic)", "value": 0.00883512456493333},{"source": "Sufficient wage", "target": "Cocoa butter (Organic)", "value": 0.0078343367268},{"source": "Sufficient wage", "target": "Coconut oil (Organic)", "value": 0.00347879026511111},{"source": "Sufficient wage", "target": "Hazelnuts (Organic)", "value": 0.00316254211388889},{"source": "Sufficient wage", "target": "Vegetables (Organic)", "value": 0.00281013722808889},{"source": "Sufficient wage", "target": "Cane sugar (Organic)", "value": 0.00265674482391111},{"source": "Human rights", "target": "Equal rights migrants", "value" : 0.0271146645119444},{"source": "Equal rights migrants", "target": "Cocoa butter (Organic)", "value": 0.0071042315061},{"source": "Equal rights migrants", "target": "Cocoa mass (Organic)", "value": 0.00636673210005},{"source": "Equal rights migrants", "target": "Hazelnuts (Organic)", "value": 0.00601459775836111},{"source": "Equal rights migrants", "target": "Coconut oil (Organic)", "value": 0.00429185583138889},{"source": "Equal rights migrants", "target": "Cane sugar (Organic)", "value": 0.00182647471915556},{"source": "Equal rights migrants", "target": "Vegetables (Organic)", "value": 0.00151077259688889},{"source": "Human rights", "target": "Discrimination", "value": 0.0211217763359833},{"source": "Discrimination", "target": "Cocoa mass (Organic)", "value": 0.00609671700306667},{"source": "Discrimination", "target": "Cocoa butter (Organic)", "value": 0.0047738806325},{"source": "Discrimination", "target": "Coconut oil (Organic)", "value": 0.00368119084494444},{"source": "Discrimination", "target": "Vegetables (Organic)", "value": 0.00286009813604444},{"source": "Discrimination", "target": "Cane sugar (Organic)", "value": 0.00283706180951111},{"source": "Discrimination", "target": "Hazelnuts (Organic)", "value": 0.000872827909916666},{"source": "Human rights", "target": "Working hours", "value": 0.02082642898975},{"source": "Working hours", "target": "Hazelnuts (Organic)", "value": 0.0107216773848333},{"source": "Working hours", "target": "Coconut oil (Organic)", "value": 0.00359009052944444},{"source": "Working hours", "target": "Vegetables (Organic)", "value": 0.00212300379075556},{"source": "Working hours", "target": "Cocoa butter (Organic)", "value": 0.0018518584356},{"source": "Working hours", "target": "Cocoa mass (Organic)", "value": 0.00158227069058333},{"source": "Working hours", "target": "Cane sugar (Organic)", "value": 0.000957528158533333}];
		}
				
				
		
			if(scope.panel.chart === 'sankey'){
				var myChart = echarts.init(document.getElementById(idd));
				var option = {
    
    tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove'
        },
		 
    series: [
        {
            
            color:colors,
            type: 'sankey',
            layout: 'none',
			label:{
                normal:{
                    textStyle:{
                        color:'#FFFAFA'
                    }
                }
            },
            data: nodes_data,
            links: links_data,
            itemStyle: {
                    normal: {
                        borderWidth: 1,
                        borderColor: '#aaa'
                    }
                },
                lineStyle: {
                    normal: {
						color:'#88bee7',
                        curveness: 0.5
                    }
                }
        }
    ]
}

	//if(chartData.length==0){
				//myChart.setOption(option_nodata);}else{
				//	myChart.setOption(option);
				//}
   myChart.setOption(option);

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
