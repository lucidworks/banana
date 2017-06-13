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

  var module = angular.module('kibana.panels.china', []);
  app.useModule(module);

  module.controller('china', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
        linkage_id:'a',
      logAxis : false,
      display:'block',
        isEN:false,
      icon:"icon-caret-down",
      chart       : 'china_map',
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
        kbn.download_response(response, filetype, "china");
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
      if(_.isUndefined(term.meta)) {
        filterSrv.set({type:'china',field:$scope.panel.field,value:term.label,
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

  module.directive('chinaChart', function(querySrv,dashboard,filterSrv) {
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

          if (filterSrv.idsByTypeAndField('china',scope.panel.field).length > 0) {
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
			 
				var arrlabel = [];	
				var radarmax = 0;
				  for (var i = 0; i < chartData.length; i++) {
					  arrlabel[i] = chartData[i].label;
					  arrdata[i] = {name:chartData[i].label,value:chartData[i].data[0][1]};
						
							if (chartData[i].data[0][1]>radarmax){
								radarmax = chartData[i].data[0][1];
							}
							
						
				  }
				 
			  
			  
			  
	if(scope.panel.chart === 'china_map'){
		
		var myChart7 = echarts.init(document.getElementById(idd));
		
	var geoCoordMap={'香港':[114.08,22.2],'澳门':[113.33,22.13],'台北市':[121.5,25.03],'基隆市':[121.73,25.13],'台中市':[120.67,24.15],'台南市':[120.2,23.0],'宜兰县':[121.75,24.77],'桃园县':[121.3,24.97],'苗栗县':[120.8,24.53],'台中县':[120.72,24.25],'彰化县':[120.53,24.08],'南投县':[120.67,23.92],'云林县':[120.53,23.72],'台南县':[120.32,23.32],'高雄县':[120.37,22.63],'屏东县':[120.48,22.67],'台东县':[121.15,22.75],'花莲县':[121.6,23.98],'澎湖县':[119.58,23.58],'石家庄市':[114.52,38.05],'唐山市':[118.2,39.63],'秦皇岛市':[119.6,39.93],'邯郸市':[114.48,36.62],'邢台市':[114.48,37.07],'保定市':[115.47,38.87],'张家口市':[114.88,40.82],'承德市':[117.93,40.97],'沧州市':[116.83,38.3],'廊坊市':[116.7,39.52],'衡水市':[115.68,37.73],'太原市':[112.55,37.87],'大同市':[113.3,40.08],'阳泉市':[113.57,37.85],'长治市':[113.12,36.2],'晋城市':[112.83,35.5],'朔州市':[112.43,39.33],'晋中市':[112.75,37.68],'运城市':[110.98,35.02],'忻州市':[112.73,38.42],'临汾市':[111.52,36.08],'吕梁市':[111.13,37.52],'呼和浩特市':[111.73,40.83],'包头市':[109.83,40.65],'乌海市':[106.82,39.67],'赤峰市':[118.92,42.27],'通辽市':[122.27,43.62],'鄂尔多斯市':[109.8,39.62],'呼伦贝尔市':[119.77,49.22],'巴彦淖尔市':[107.42,40.75],'乌兰察布市':[113.12,40.98],'兴安盟':[122.05,46.08],'锡林郭勒盟':[116.07,43.95],'阿拉善盟':[105.67,38.83],'沈阳市':[123.43,41.8],'大连市':[121.62,38.92],'鞍山市':[122.98,41.1],'抚顺市':[123.98,41.88],'本溪市':[123.77,41.3],'丹东市':[124.38,40.13],'锦州市':[121.13,41.1],'营口市':[122.23,40.67],'阜新市':[121.67,42.02],'辽阳市':[123.17,41.27],'盘锦市':[122.07,41.12],'铁岭市':[123.83,42.28],'朝阳市':[120.45,41.57],'葫芦岛市':[120.83,40.72],'长春市':[125.32,43.9],'吉林市':[126.55,43.83],'四平市':[124.35,43.17],'辽源市':[125.13,42.88],'通化市':[125.93,41.73],'白山市':[126.42,41.93],'松原市':[124.82,45.13],'白城市':[122.83,45.62],'延边州':[129.5,42.88],'哈尔滨市':[126.53,45.8],'齐齐哈尔市':[123.95,47.33],'鸡西市':[130.97,45.3],'鹤岗市':[130.27,47.33],'双鸭山市':[131.15,46.63],'大庆市':[125.03,46.58],'伊春市':[128.9,47.73],'佳木斯市':[130.37,46.82],'七台河市':[130.95,45.78],'牡丹江市':[129.6,44.58],'黑河市':[127.48,50.25],'绥化市':[126.98,46.63],'大兴安岭地区':[124.12,50.42],'南京市':[118.78,32.07],'无锡市':[120.3,31.57],'徐州市':[117.18,34.27],'常州市':[119.95,31.78],'苏州市':[120.58,31.3],'南通市':[120.88,31.98],'连云港市':[119.22,34.6],'淮安市':[119.02,33.62],'盐城市':[120.15,33.35],'扬州市':[119.4,32.4],'镇江市':[119.45,32.2],'泰州市':[119.92,32.45],'宿迁市':[118.28,33.97],'杭州市':[120.15,30.28],'宁波市':[121.55,29.88],'温州市':[120.7,28.0],'嘉兴市':[120.75,30.75],'湖州市':[120.08,30.9],'绍兴市':[120.57,30.0],'金华市':[119.65,29.08],'衢州市':[118.87,28.93],'舟山市':[122.2,30.0],'台州市':[121.43,28.68],'丽水市':[119.92,28.45],'合肥市':[117.25,31.83],'芜湖市':[118.38,31.33],'蚌埠市':[117.38,32.92],'淮南市':[117.0,32.63],'马鞍山市':[118.5,31.7],'淮北市':[116.8,33.95],'铜陵市':[117.82,30.93],'安庆市':[117.05,30.53],'黄山市':[118.33,29.72],'滁州市':[118.32,32.3],'阜阳市':[115.82,32.9],'宿州市':[116.98,33.63],'巢湖市':[117.87,31.6],'六安市':[116.5,31.77],'亳州市':[115.78,33.85],'池州市':[117.48,30.67],'宣城市':[118.75,30.95],'福州市':[119.3,26.08],'厦门市':[118.08,24.48],'莆田市':[119.0,25.43],'三明市':[117.62,26.27],'泉州市':[118.67,24.88],'漳州市':[117.65,24.52],'南平市':[118.17,26.65],'龙岩市':[117.03,25.1],'宁德市':[119.52,26.67],'南昌市':[115.85,28.68],'景德镇市':[117.17,29.27],'萍乡市':[113.85,27.63],'九江市':[116.0,29.7],'新余市':[114.92,27.82],'鹰潭市':[117.07,28.27],'赣州市':[114.93,25.83],'吉安市':[114.98,27.12],'宜春市':[114.38,27.8],'抚州市':[116.35,28.0],'上饶市':[117.97,28.45],'济南市':[116.98,36.67],'青岛市':[120.38,36.07],'淄博市':[118.05,36.82],'枣庄市':[117.32,34.82],'东营市':[118.67,37.43],'烟台市':[121.43,37.45],'潍坊市':[119.15,36.7],'菏泽市':[115.26,35.14],'济宁市':[116.58,35.42],'泰安市':[117.08,36.2],'威海市':[122.12,37.52],'日照市':[119.52,35.42],'莱芜市':[117.67,36.22],'临沂市':[118.35,35.05],'德州市':[116.3,37.45],'聊城市':[115.98,36.45],'滨州市':[117.97,37.38],'郑州市':[113.62,34.75],'开封市':[114.3,34.8],'洛阳市':[112.45,34.62],'平顶山市':[113.18,33.77],'安阳市':[114.38,36.1],'鹤壁市':[114.28,35.75],'新乡市':[113.9,35.3],'焦作市':[113.25,35.22],'济源市':[112.58,35.07],'濮阳市':[115.03,35.77],'许昌市':[113.85,34.03],'漯河市':[114.02,33.58],'三门峡市':[111.2,34.78],'南阳市':[112.52,33.0],'商丘市':[115.65,34.45],'信阳市':[114.07,32.13],'周口市':[114.65,33.62],'驻马店市':[114.02,32.98],'神农架林区':[110.67,31.75],'武汉市':[114.3,30.6],'黄石市':[115.03,30.2],'十堰市':[110.78,32.65],'宜昌市':[111.28,30.7],'鄂州市':[114.88,30.4],'荆门市':[112.2,31.03],'孝感市':[113.92,30.93],'荆州市':[112.23,30.33],'黄冈市':[114.87,30.45],'咸宁市':[114.32,29.85],'随州市':[113.37,31.72],'恩施州':[109.47,30.3],'仙桃市':[113.45,30.37],'潜江市':[112.88,30.42],'天门市':[113.17,30.67],'长沙市':[112.93,28.23],'株洲市':[113.13,27.83],'湘潭市':[112.93,27.83],'衡阳市':[112.57,26.9],'邵阳市':[111.47,27.25],'岳阳市':[113.12,29.37],'常德市':[111.68,29.05],'张家界市':[110.47,29.13],'益阳市':[112.32,28.6],'郴州市':[113.02,25.78],'永州市':[111.62,26.43],'怀化市':[110.0,27.57],'娄底市':[112.0,27.73],'湘西州':[109.73,28.32],'广州市': [113.5107,23.2196],'韶关市':[113.6,24.82],'深圳市':[114.05,22.55],'珠海市':[113.57,22.27],'汕头市':[116.68,23.35],'佛山市':[113.12,23.02],'江门市':[113.08,22.58],'湛江市':[110.35,21.27],'茂名市':[110.92,21.67],'肇庆市':[112.47,23.05],'惠州市':[114.42,23.12],'梅州市':[116.12,24.28],'汕尾市':[115.37,22.78],'河源市':[114.7,23.73],'阳江市':[111.98,21.87],'清远市':[113.03,23.7],'东莞市':[113.75,23.05],'中山市':[113.38,22.52],'潮州市':[116.62,23.67],'揭阳市':[116.37,23.55],'云浮市':[112.03,22.92],'南宁市':[108.37,22.82],'柳州市':[109.42,24.33],'防城港市':[108.35,21.7],'来宾市':[109.23,23.73],'崇左市':[107.37,22.4],'桂林市':[110.28,25.28],'梧州市':[111.27,23.48],'北海市':[109.12,21.48],'钦州市':[108.62,21.95],'贵港市':[109.6,23.1],'玉林市':[110.17,22.63],'百色市':[106.62,23.9],'贺州市':[111.55,24.42],'河池市':[108.07,24.7],'海口市':[110.32,20.03],'三亚市':[109.5,18.25],'五指山市':[109.52,18.78],'琼海市':[110.47,19.25],'儋州市':[109.57,19.52],'文昌市':[110.8,19.55],'万宁市':[110.4,18.8],'东方市':[108.63,19.1],'定安县':[110.32,19.7],'屯昌县':[110.1,19.37],'澄迈县':[110.0,19.73],'临高县':[109.68,19.92],'白沙黎族自治县':[109.45,19.23],'昌江黎族自治县':[109.05,19.25],'乐东黎族自治县':[109.17,18.75],'陵水黎族自治县':[110.03,18.5],'保亭黎族苗族自治县':[109.7,18.63],'琼中黎族苗族自治县':[109.83,19.03],'成都市':[104.07,30.67],'自贡市':[104.78,29.35],'攀枝花市':[101.72,26.58],'泸州市':[105.43,28.87],'德阳市':[104.38,31.13],'绵阳市':[104.73,31.47],'广元市':[105.83,32.43],'遂宁市':[105.57,30.52],'内江市':[105.05,29.58],'乐山市':[103.77,29.57],'南充市':[106.08,30.78],'眉山市':[103.83,30.05],'宜宾市':[104.62,28.77],'广安市':[106.63,30.47],'达州市':[107.5,31.22],'雅安市':[103.0,29.98],'巴中市':[106.77,31.85],'资阳市':[104.65,30.12],'阿坝州':[102.22,31.9],'甘孜州':[101.97,30.05],'凉山州':[102.27,27.9],'贵阳市':[106.63,26.65],'六盘水市':[104.83,26.6],'遵义市':[106.92,27.73],'安顺市':[105.95,26.25],'铜仁市':[109.18,27.72],'毕节市':[105.28,27.3],'黔东州':[107.97,26.58],'黔南州':[107.52,26.27],'昆明市':[102.72,25.05],'曲靖市':[103.8,25.5],'玉溪市':[102.55,24.35],'保山市':[99.17,25.12],'昭通市':[103.72,27.33],'丽江市':[100.23,26.88],'临沧市':[100.08,23.88],'楚雄州':[101.55,25.03],'红河州':[103.4,23.37],'文山州':[104.25,23.37],'西双州':[100.8,22.02],'大理州':[100.23,25.6],'德宏州':[98.58,24.43],'怒江州':[98.85,25.85],'迪庆州':[99.7,27.83],'拉萨市':[91.13,29.65],'山南地区':[91.77,29.23],'日喀则市':[88.88,29.27],'那曲地区':[92.07,31.48],'阿里地区':[80.1,32.5],'西安市':[108.93,34.27],'铜川市':[108.93,34.9],'宝鸡市':[107.13,34.37],'咸阳市':[108.7,34.33],'渭南市':[109.5,34.5],'延安市':[109.48,36.6],'汉中市':[107.02,33.07],'榆林市':[109.73,38.28],'安康市':[109.02,32.68],'商洛市':[109.93,33.87],'兰州市':[103.82,36.07],'嘉峪关市':[98.27,39.8],'金昌市':[102.18,38.5],'白银市':[104.18,36.55],'天水市':[105.72,34.58],'武威市':[102.63,37.93],'张掖市':[100.45,38.93],'平凉市':[106.67,35.55],'酒泉市':[98.52,39.75],'庆阳市':[107.63,35.73],'定西市':[104.62,35.58],'陇南市':[104.92,33.4],'临夏州':[103.22,35.6],'甘南州':[102.92,34.98],'西宁市':[101.78,36.62],'黄南州':[102.02,35.52],'海南州':[100.62,36.28],'果洛州':[100.23,34.48],'玉树州':[97.02,33.0],'海西州':[97.37,37.37],'北京市':[116.4,39.9],'天津市':[117.2,39.12],'上海市':[121.47,31.23],'重庆市':[106.55,29.57],'海北州':[100.9,36.97],'银川市':[106.28,38.47],'石嘴山市':[106.38,39.02],'吴忠市':[106.2,37.98],'固原市':[106.28,36.0],'中卫市':[105.18,37.52],'乌鲁木齐市':[87.62,43.82],'克拉玛依市':[84.87,45.6],'吐鲁番市':[89.17,42.95],'哈密地区':[93.52,42.83],'昌吉州':[87.3,44.02],'博尔塔拉州':[82.07,44.9],'巴音郭楞州':[86.15,41.77],'阿克苏地区':[80.27,41.17],'喀什地区':[75.98,39.47],'和田地区':[79.92,37.12],'伊犁州':[81.32,43.92],'塔城地区':[82.98,46.75],'阿勒泰地区':[88.13,47.85],'石河子市':[86.03,44.3],'阿拉尔市':[81.28,40.55],'图木舒克市':[79.13,39.85],'五家渠市':[87.53,44.17]};


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
        max: radarmax,
        calculable: true,
		inRange: {
            symbolSize: [5, 30],
			color: ['#25f49f','#25f4d4','#25c5f4','#2585f4'],
		},
        textStyle: {
            color: '#aeb2b0'
        }
    },
    geo: {
        map: 'china',
        label: {
            emphasis: {
                show: false
            }
        },
		left:'3%',
        right:'3%',
        top:'3%',
        bottom:'3%',
        itemStyle: {
            normal: {
                areaColor: '#aeb2b0',
                borderColor: '#F0FFFF'
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
            data: convertData(arrdata),
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
        },
        {
            name: 'Top 5',
            type: 'effectScatter',
            coordinateSystem: 'geo',
            data: convertData(arrdata.sort(function (a, b) {
                return b.value - a.value;
            }).slice(0, 6)),
            symbolSize: function (val) {
                return val[2] / 10;
            },
            showEffectOn: 'render',
            rippleEffect: {
                brushType: 'stroke'
            },
            hoverAnimation: true,
            label: {
                normal: {
                    formatter: '{b}',
                    position: 'right',
                    show: true
                }
            },
            itemStyle: {
                normal: {
                    color: '#f4e925',
                    shadowBlur: 10,
                    shadowColor: '#333'
                }
            },
            zlevel: 1
        }
    ]
}
		
		 if(arrlabel.length==0){
				myChart7.setOption(option_nodata);}else{
					myChart7.setOption(option7);
				}
		
		
	}		  
			

		if(scope.panel.chart === 'bmap'){
	
	
	var myChart8 = echarts.init(document.getElementById(idd));
	

	var geoCoordMap={'香港':[114.08,22.2],'澳门':[113.33,22.13],'台北市':[121.5,25.03],'基隆市':[121.73,25.13],'台中市':[120.67,24.15],'台南市':[120.2,23.0],'宜兰县':[121.75,24.77],'桃园县':[121.3,24.97],'苗栗县':[120.8,24.53],'台中县':[120.72,24.25],'彰化县':[120.53,24.08],'南投县':[120.67,23.92],'云林县':[120.53,23.72],'台南县':[120.32,23.32],'高雄县':[120.37,22.63],'屏东县':[120.48,22.67],'台东县':[121.15,22.75],'花莲县':[121.6,23.98],'澎湖县':[119.58,23.58],'石家庄市':[114.52,38.05],'唐山市':[118.2,39.63],'秦皇岛市':[119.6,39.93],'邯郸市':[114.48,36.62],'邢台市':[114.48,37.07],'保定市':[115.47,38.87],'张家口市':[114.88,40.82],'承德市':[117.93,40.97],'沧州市':[116.83,38.3],'廊坊市':[116.7,39.52],'衡水市':[115.68,37.73],'太原市':[112.55,37.87],'大同市':[113.3,40.08],'阳泉市':[113.57,37.85],'长治市':[113.12,36.2],'晋城市':[112.83,35.5],'朔州市':[112.43,39.33],'晋中市':[112.75,37.68],'运城市':[110.98,35.02],'忻州市':[112.73,38.42],'临汾市':[111.52,36.08],'吕梁市':[111.13,37.52],'呼和浩特市':[111.73,40.83],'包头市':[109.83,40.65],'乌海市':[106.82,39.67],'赤峰市':[118.92,42.27],'通辽市':[122.27,43.62],'鄂尔多斯市':[109.8,39.62],'呼伦贝尔市':[119.77,49.22],'巴彦淖尔市':[107.42,40.75],'乌兰察布市':[113.12,40.98],'兴安盟':[122.05,46.08],'锡林郭勒盟':[116.07,43.95],'阿拉善盟':[105.67,38.83],'沈阳市':[123.43,41.8],'大连市':[121.62,38.92],'鞍山市':[122.98,41.1],'抚顺市':[123.98,41.88],'本溪市':[123.77,41.3],'丹东市':[124.38,40.13],'锦州市':[121.13,41.1],'营口市':[122.23,40.67],'阜新市':[121.67,42.02],'辽阳市':[123.17,41.27],'盘锦市':[122.07,41.12],'铁岭市':[123.83,42.28],'朝阳市':[120.45,41.57],'葫芦岛市':[120.83,40.72],'长春市':[125.32,43.9],'吉林市':[126.55,43.83],'四平市':[124.35,43.17],'辽源市':[125.13,42.88],'通化市':[125.93,41.73],'白山市':[126.42,41.93],'松原市':[124.82,45.13],'白城市':[122.83,45.62],'延边州':[129.5,42.88],'哈尔滨市':[126.53,45.8],'齐齐哈尔市':[123.95,47.33],'鸡西市':[130.97,45.3],'鹤岗市':[130.27,47.33],'双鸭山市':[131.15,46.63],'大庆市':[125.03,46.58],'伊春市':[128.9,47.73],'佳木斯市':[130.37,46.82],'七台河市':[130.95,45.78],'牡丹江市':[129.6,44.58],'黑河市':[127.48,50.25],'绥化市':[126.98,46.63],'大兴安岭地区':[124.12,50.42],'南京市':[118.78,32.07],'无锡市':[120.3,31.57],'徐州市':[117.18,34.27],'常州市':[119.95,31.78],'苏州市':[120.58,31.3],'南通市':[120.88,31.98],'连云港市':[119.22,34.6],'淮安市':[119.02,33.62],'盐城市':[120.15,33.35],'扬州市':[119.4,32.4],'镇江市':[119.45,32.2],'泰州市':[119.92,32.45],'宿迁市':[118.28,33.97],'杭州市':[120.15,30.28],'宁波市':[121.55,29.88],'温州市':[120.7,28.0],'嘉兴市':[120.75,30.75],'湖州市':[120.08,30.9],'绍兴市':[120.57,30.0],'金华市':[119.65,29.08],'衢州市':[118.87,28.93],'舟山市':[122.2,30.0],'台州市':[121.43,28.68],'丽水市':[119.92,28.45],'合肥市':[117.25,31.83],'芜湖市':[118.38,31.33],'蚌埠市':[117.38,32.92],'淮南市':[117.0,32.63],'马鞍山市':[118.5,31.7],'淮北市':[116.8,33.95],'铜陵市':[117.82,30.93],'安庆市':[117.05,30.53],'黄山市':[118.33,29.72],'滁州市':[118.32,32.3],'阜阳市':[115.82,32.9],'宿州市':[116.98,33.63],'巢湖市':[117.87,31.6],'六安市':[116.5,31.77],'亳州市':[115.78,33.85],'池州市':[117.48,30.67],'宣城市':[118.75,30.95],'福州市':[119.3,26.08],'厦门市':[118.08,24.48],'莆田市':[119.0,25.43],'三明市':[117.62,26.27],'泉州市':[118.67,24.88],'漳州市':[117.65,24.52],'南平市':[118.17,26.65],'龙岩市':[117.03,25.1],'宁德市':[119.52,26.67],'南昌市':[115.85,28.68],'景德镇市':[117.17,29.27],'萍乡市':[113.85,27.63],'九江市':[116.0,29.7],'新余市':[114.92,27.82],'鹰潭市':[117.07,28.27],'赣州市':[114.93,25.83],'吉安市':[114.98,27.12],'宜春市':[114.38,27.8],'抚州市':[116.35,28.0],'上饶市':[117.97,28.45],'济南市':[116.98,36.67],'青岛市':[120.38,36.07],'淄博市':[118.05,36.82],'枣庄市':[117.32,34.82],'东营市':[118.67,37.43],'烟台市':[121.43,37.45],'潍坊市':[119.15,36.7],'菏泽市':[115.26,35.14],'济宁市':[116.58,35.42],'泰安市':[117.08,36.2],'威海市':[122.12,37.52],'日照市':[119.52,35.42],'莱芜市':[117.67,36.22],'临沂市':[118.35,35.05],'德州市':[116.3,37.45],'聊城市':[115.98,36.45],'滨州市':[117.97,37.38],'郑州市':[113.62,34.75],'开封市':[114.3,34.8],'洛阳市':[112.45,34.62],'平顶山市':[113.18,33.77],'安阳市':[114.38,36.1],'鹤壁市':[114.28,35.75],'新乡市':[113.9,35.3],'焦作市':[113.25,35.22],'济源市':[112.58,35.07],'濮阳市':[115.03,35.77],'许昌市':[113.85,34.03],'漯河市':[114.02,33.58],'三门峡市':[111.2,34.78],'南阳市':[112.52,33.0],'商丘市':[115.65,34.45],'信阳市':[114.07,32.13],'周口市':[114.65,33.62],'驻马店市':[114.02,32.98],'神农架林区':[110.67,31.75],'武汉市':[114.3,30.6],'黄石市':[115.03,30.2],'十堰市':[110.78,32.65],'宜昌市':[111.28,30.7],'鄂州市':[114.88,30.4],'荆门市':[112.2,31.03],'孝感市':[113.92,30.93],'荆州市':[112.23,30.33],'黄冈市':[114.87,30.45],'咸宁市':[114.32,29.85],'随州市':[113.37,31.72],'恩施州':[109.47,30.3],'仙桃市':[113.45,30.37],'潜江市':[112.88,30.42],'天门市':[113.17,30.67],'长沙市':[112.93,28.23],'株洲市':[113.13,27.83],'湘潭市':[112.93,27.83],'衡阳市':[112.57,26.9],'邵阳市':[111.47,27.25],'岳阳市':[113.12,29.37],'常德市':[111.68,29.05],'张家界市':[110.47,29.13],'益阳市':[112.32,28.6],'郴州市':[113.02,25.78],'永州市':[111.62,26.43],'怀化市':[110.0,27.57],'娄底市':[112.0,27.73],'湘西州':[109.73,28.32],'广州市': [113.5107,23.2196],'韶关市':[113.6,24.82],'深圳市':[114.05,22.55],'珠海市':[113.57,22.27],'汕头市':[116.68,23.35],'佛山市':[113.12,23.02],'江门市':[113.08,22.58],'湛江市':[110.35,21.27],'茂名市':[110.92,21.67],'肇庆市':[112.47,23.05],'惠州市':[114.42,23.12],'梅州市':[116.12,24.28],'汕尾市':[115.37,22.78],'河源市':[114.7,23.73],'阳江市':[111.98,21.87],'清远市':[113.03,23.7],'东莞市':[113.75,23.05],'中山市':[113.38,22.52],'潮州市':[116.62,23.67],'揭阳市':[116.37,23.55],'云浮市':[112.03,22.92],'南宁市':[108.37,22.82],'柳州市':[109.42,24.33],'防城港市':[108.35,21.7],'来宾市':[109.23,23.73],'崇左市':[107.37,22.4],'桂林市':[110.28,25.28],'梧州市':[111.27,23.48],'北海市':[109.12,21.48],'钦州市':[108.62,21.95],'贵港市':[109.6,23.1],'玉林市':[110.17,22.63],'百色市':[106.62,23.9],'贺州市':[111.55,24.42],'河池市':[108.07,24.7],'海口市':[110.32,20.03],'三亚市':[109.5,18.25],'五指山市':[109.52,18.78],'琼海市':[110.47,19.25],'儋州市':[109.57,19.52],'文昌市':[110.8,19.55],'万宁市':[110.4,18.8],'东方市':[108.63,19.1],'定安县':[110.32,19.7],'屯昌县':[110.1,19.37],'澄迈县':[110.0,19.73],'临高县':[109.68,19.92],'白沙黎族自治县':[109.45,19.23],'昌江黎族自治县':[109.05,19.25],'乐东黎族自治县':[109.17,18.75],'陵水黎族自治县':[110.03,18.5],'保亭黎族苗族自治县':[109.7,18.63],'琼中黎族苗族自治县':[109.83,19.03],'成都市':[104.07,30.67],'自贡市':[104.78,29.35],'攀枝花市':[101.72,26.58],'泸州市':[105.43,28.87],'德阳市':[104.38,31.13],'绵阳市':[104.73,31.47],'广元市':[105.83,32.43],'遂宁市':[105.57,30.52],'内江市':[105.05,29.58],'乐山市':[103.77,29.57],'南充市':[106.08,30.78],'眉山市':[103.83,30.05],'宜宾市':[104.62,28.77],'广安市':[106.63,30.47],'达州市':[107.5,31.22],'雅安市':[103.0,29.98],'巴中市':[106.77,31.85],'资阳市':[104.65,30.12],'阿坝州':[102.22,31.9],'甘孜州':[101.97,30.05],'凉山州':[102.27,27.9],'贵阳市':[106.63,26.65],'六盘水市':[104.83,26.6],'遵义市':[106.92,27.73],'安顺市':[105.95,26.25],'铜仁市':[109.18,27.72],'毕节市':[105.28,27.3],'黔东州':[107.97,26.58],'黔南州':[107.52,26.27],'昆明市':[102.72,25.05],'曲靖市':[103.8,25.5],'玉溪市':[102.55,24.35],'保山市':[99.17,25.12],'昭通市':[103.72,27.33],'丽江市':[100.23,26.88],'临沧市':[100.08,23.88],'楚雄州':[101.55,25.03],'红河州':[103.4,23.37],'文山州':[104.25,23.37],'西双州':[100.8,22.02],'大理州':[100.23,25.6],'德宏州':[98.58,24.43],'怒江州':[98.85,25.85],'迪庆州':[99.7,27.83],'拉萨市':[91.13,29.65],'山南地区':[91.77,29.23],'日喀则市':[88.88,29.27],'那曲地区':[92.07,31.48],'阿里地区':[80.1,32.5],'西安市':[108.93,34.27],'铜川市':[108.93,34.9],'宝鸡市':[107.13,34.37],'咸阳市':[108.7,34.33],'渭南市':[109.5,34.5],'延安市':[109.48,36.6],'汉中市':[107.02,33.07],'榆林市':[109.73,38.28],'安康市':[109.02,32.68],'商洛市':[109.93,33.87],'兰州市':[103.82,36.07],'嘉峪关市':[98.27,39.8],'金昌市':[102.18,38.5],'白银市':[104.18,36.55],'天水市':[105.72,34.58],'武威市':[102.63,37.93],'张掖市':[100.45,38.93],'平凉市':[106.67,35.55],'酒泉市':[98.52,39.75],'庆阳市':[107.63,35.73],'定西市':[104.62,35.58],'陇南市':[104.92,33.4],'临夏州':[103.22,35.6],'甘南州':[102.92,34.98],'西宁市':[101.78,36.62],'黄南州':[102.02,35.52],'海南州':[100.62,36.28],'果洛州':[100.23,34.48],'玉树州':[97.02,33.0],'海西州':[97.37,37.37],'北京市':[116.4,39.9],'天津市':[117.2,39.12],'上海市':[121.47,31.23],'重庆市':[106.55,29.57],'海北州':[100.9,36.97],'银川市':[106.28,38.47],'石嘴山市':[106.38,39.02],'吴忠市':[106.2,37.98],'固原市':[106.28,36.0],'中卫市':[105.18,37.52],'乌鲁木齐市':[87.62,43.82],'克拉玛依市':[84.87,45.6],'吐鲁番市':[89.17,42.95],'哈密地区':[93.52,42.83],'昌吉州':[87.3,44.02],'博尔塔拉州':[82.07,44.9],'巴音郭楞州':[86.15,41.77],'阿克苏地区':[80.27,41.17],'喀什地区':[75.98,39.47],'和田地区':[79.92,37.12],'伊犁州':[81.32,43.92],'塔城地区':[82.98,46.75],'阿勒泰地区':[88.13,47.85],'石河子市':[86.03,44.3],'阿拉尔市':[81.28,40.55],'图木舒克市':[79.13,39.85],'五家渠市':[87.53,44.17]};

	var baiducolor = [{
                'featureType': 'water',
                'elementType': 'all',
                'stylers': {
                    'color': '#000'
                }
            }, {
                'featureType': 'land',
                'elementType': 'all',
                'stylers': {
                    'color': '#e1e1e0'
                }
            }, {
                'featureType': 'railway',
                'elementType': 'all',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'highway',
                'elementType': 'all',
                'stylers': {
                    'color': '#fdfdfd'
                }
            }, {
                'featureType': 'highway',
                'elementType': 'labels',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'arterial',
                'elementType': 'geometry',
                'stylers': {
                    'color': '#ffffff'
                }
            }, {
                'featureType': 'arterial',
                'elementType': 'geometry.fill',
                'stylers': {
                    'color': '#ffffff'
                }
            }, {
                'featureType': 'poi',
                'elementType': 'all',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'green',
                'elementType': 'all',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'subway',
                'elementType': 'all',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'manmade',
                'elementType': 'all',
                'stylers': {
                    'color': '#c2c2c2'
                }
            }, {
                'featureType': 'local',
                'elementType': 'all',
                'stylers': {
                    'color': '#c2c2c2'
                }
            }, {
                'featureType': 'arterial',
                'elementType': 'labels',
                'stylers': {
                    'visibility': 'off'
                }
            }, {
                'featureType': 'boundary',
                'elementType': 'all',
                'stylers': {
                    'color': '#ffffff'
                }
            }, {
                'featureType': 'building',
                'elementType': 'all',
                'stylers': {
                    'color': '#c2c2c2'
                }
            }, {
                'featureType': 'label',
                'elementType': 'labels.text.fill',
                'stylers': {
                    'color': '#999999'
                }
            }];
			
if (dashboard.current.style === 'dark'){
	baiducolor = [{
                    'featureType': 'land', //调整土地颜色
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#081734'
                    }
                }, {
                    'featureType': 'building', //调整建筑物颜色
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#04406F'
                    }
                }, {
                    'featureType': 'building', //调整建筑物标签是否可视
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'highway', //调整高速道路颜色
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#050a15'
                    }
                }, {
                    'featureType': 'highway', //调整高速名字是否可视
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'arterial', //调整一些干道颜色
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#003051'
                    }
                }, {
                    'featureType': 'arterial',
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'green',
                    'elementType': 'geometry',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'water',
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#044161'
                    }
                }, {
                    'featureType': 'subway', //调整地铁颜色
                    'elementType': 'geometry.stroke',
                    'stylers': {
                        'color': '#003051'
                    }
                }, {
                    'featureType': 'subway',
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'railway',
                    'elementType': 'geometry',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'railway',
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'all', //调整所有的标签的边缘颜色
                    'elementType': 'labels.text.stroke',
                    'stylers': {
                        'color': '#313131'
                    }
                }, {
                    'featureType': 'all', //调整所有标签的填充颜色
                    'elementType': 'labels.text.fill',
                    'stylers': {
                        'color': '#FFFFFF'
                    }
                }, {
                    'featureType': 'manmade',
                    'elementType': 'geometry',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'manmade',
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'local',
                    'elementType': 'geometry',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'local',
                    'elementType': 'labels',
                    'stylers': {
                        'visibility': 'off'
                    }
                }, {
                    'featureType': 'subway',
                    'elementType': 'geometry',
                    'stylers': {
                        'lightness': -65
                    }
                }, {
                    'featureType': 'railway',
                    'elementType': 'all',
                    'stylers': {
                        'lightness': -40
                    }
                }, {
                    'featureType': 'boundary',
                    'elementType': 'geometry',
                    'stylers': {
                        'color': '#8b8787',
                        'weight': '1',
                        'lightness': -29
                    }
                }];
	
}

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



var option8 = {
    
    tooltip : {
        trigger: 'item'
    },
	visualMap: {
        min: 0,
        max: radarmax,
        calculable: false,
		inRange: {
            symbolSize: [10, 30],
			color: ['#4defe0','#4dd4ef','#4daeef','#4d8eef'],
		},
        textStyle: {
            color: '#aeb2b0'
        }
    },
    bmap: {
        center: [104.114129, 37.550339],
        zoom: 5,
        roam: true,
          mapStyle: {
            styleJson: baiducolor
        }
    },
    series : [
        {
            
            type: 'scatter',
            coordinateSystem: 'bmap',
            data: convertData(arrdata),
            symbolSize: function (val) {
                return val[2] / 10;
            },
            label: {
                normal: {
                    formatter: '{b}',
                    position: 'right',
                    show: false
                },
                emphasis: {
                    show: true
                }
            },
            itemStyle: {
                normal: {
                    color: 'purple'
                }
            }
        },
        {
            name: 'Top 5',
            type: 'effectScatter',
            coordinateSystem: 'bmap',
            data: convertData(arrdata.sort(function (a, b) {
                return b.value - a.value;
            }).slice(0, 5)),
            symbolSize: function (val) {
                return val[2] / 10;
            },
            showEffectOn: 'render',
            rippleEffect: {
                brushType: 'stroke'
            },
            hoverAnimation: true,
            label: {
                normal: {
                    formatter: '{b}',
                    position: 'right',
                    show: true
                }
            },
            itemStyle: {
                normal: {
                    color: 'purple',
                    shadowBlur: 10,
                    shadowColor: '#333'
                }
            },
            zlevel: 1
        }
    ]
};
	 if(arrlabel.length==0){
				myChart8.setOption(option_nodata);}else{
					myChart8.setOption(option8);
				}
	
		}		


if(scope.panel.chart === 'cmap'){
	
	var myChart= echarts.init(document.getElementById(idd));
	
	var geoCoordMap={'香港':[114.08,22.2],'澳门':[113.33,22.13],'台北市':[121.5,25.03],'基隆市':[121.73,25.13],'台中市':[120.67,24.15],'台南市':[120.2,23.0],'宜兰县':[121.75,24.77],'桃园县':[121.3,24.97],'苗栗县':[120.8,24.53],'台中县':[120.72,24.25],'彰化县':[120.53,24.08],'南投县':[120.67,23.92],'云林县':[120.53,23.72],'台南县':[120.32,23.32],'高雄县':[120.37,22.63],'屏东县':[120.48,22.67],'台东县':[121.15,22.75],'花莲县':[121.6,23.98],'澎湖县':[119.58,23.58],'石家庄市':[114.52,38.05],'唐山市':[118.2,39.63],'秦皇岛市':[119.6,39.93],'邯郸市':[114.48,36.62],'邢台市':[114.48,37.07],'保定市':[115.47,38.87],'张家口市':[114.88,40.82],'承德市':[117.93,40.97],'沧州市':[116.83,38.3],'廊坊市':[116.7,39.52],'衡水市':[115.68,37.73],'太原市':[112.55,37.87],'大同市':[113.3,40.08],'阳泉市':[113.57,37.85],'长治市':[113.12,36.2],'晋城市':[112.83,35.5],'朔州市':[112.43,39.33],'晋中市':[112.75,37.68],'运城市':[110.98,35.02],'忻州市':[112.73,38.42],'临汾市':[111.52,36.08],'吕梁市':[111.13,37.52],'呼和浩特市':[111.73,40.83],'包头市':[109.83,40.65],'乌海市':[106.82,39.67],'赤峰市':[118.92,42.27],'通辽市':[122.27,43.62],'鄂尔多斯市':[109.8,39.62],'呼伦贝尔市':[119.77,49.22],'巴彦淖尔市':[107.42,40.75],'乌兰察布市':[113.12,40.98],'兴安盟':[122.05,46.08],'锡林郭勒盟':[116.07,43.95],'阿拉善盟':[105.67,38.83],'沈阳市':[123.43,41.8],'大连市':[121.62,38.92],'鞍山市':[122.98,41.1],'抚顺市':[123.98,41.88],'本溪市':[123.77,41.3],'丹东市':[124.38,40.13],'锦州市':[121.13,41.1],'营口市':[122.23,40.67],'阜新市':[121.67,42.02],'辽阳市':[123.17,41.27],'盘锦市':[122.07,41.12],'铁岭市':[123.83,42.28],'朝阳市':[120.45,41.57],'葫芦岛市':[120.83,40.72],'长春市':[125.32,43.9],'吉林市':[126.55,43.83],'四平市':[124.35,43.17],'辽源市':[125.13,42.88],'通化市':[125.93,41.73],'白山市':[126.42,41.93],'松原市':[124.82,45.13],'白城市':[122.83,45.62],'延边州':[129.5,42.88],'哈尔滨市':[126.53,45.8],'齐齐哈尔市':[123.95,47.33],'鸡西市':[130.97,45.3],'鹤岗市':[130.27,47.33],'双鸭山市':[131.15,46.63],'大庆市':[125.03,46.58],'伊春市':[128.9,47.73],'佳木斯市':[130.37,46.82],'七台河市':[130.95,45.78],'牡丹江市':[129.6,44.58],'黑河市':[127.48,50.25],'绥化市':[126.98,46.63],'大兴安岭地区':[124.12,50.42],'南京市':[118.78,32.07],'无锡市':[120.3,31.57],'徐州市':[117.18,34.27],'常州市':[119.95,31.78],'苏州市':[120.58,31.3],'南通市':[120.88,31.98],'连云港市':[119.22,34.6],'淮安市':[119.02,33.62],'盐城市':[120.15,33.35],'扬州市':[119.4,32.4],'镇江市':[119.45,32.2],'泰州市':[119.92,32.45],'宿迁市':[118.28,33.97],'杭州市':[120.15,30.28],'宁波市':[121.55,29.88],'温州市':[120.7,28.0],'嘉兴市':[120.75,30.75],'湖州市':[120.08,30.9],'绍兴市':[120.57,30.0],'金华市':[119.65,29.08],'衢州市':[118.87,28.93],'舟山市':[122.2,30.0],'台州市':[121.43,28.68],'丽水市':[119.92,28.45],'合肥市':[117.25,31.83],'芜湖市':[118.38,31.33],'蚌埠市':[117.38,32.92],'淮南市':[117.0,32.63],'马鞍山市':[118.5,31.7],'淮北市':[116.8,33.95],'铜陵市':[117.82,30.93],'安庆市':[117.05,30.53],'黄山市':[118.33,29.72],'滁州市':[118.32,32.3],'阜阳市':[115.82,32.9],'宿州市':[116.98,33.63],'巢湖市':[117.87,31.6],'六安市':[116.5,31.77],'亳州市':[115.78,33.85],'池州市':[117.48,30.67],'宣城市':[118.75,30.95],'福州市':[119.3,26.08],'厦门市':[118.08,24.48],'莆田市':[119.0,25.43],'三明市':[117.62,26.27],'泉州市':[118.67,24.88],'漳州市':[117.65,24.52],'南平市':[118.17,26.65],'龙岩市':[117.03,25.1],'宁德市':[119.52,26.67],'南昌市':[115.85,28.68],'景德镇市':[117.17,29.27],'萍乡市':[113.85,27.63],'九江市':[116.0,29.7],'新余市':[114.92,27.82],'鹰潭市':[117.07,28.27],'赣州市':[114.93,25.83],'吉安市':[114.98,27.12],'宜春市':[114.38,27.8],'抚州市':[116.35,28.0],'上饶市':[117.97,28.45],'济南市':[116.98,36.67],'青岛市':[120.38,36.07],'淄博市':[118.05,36.82],'枣庄市':[117.32,34.82],'东营市':[118.67,37.43],'烟台市':[121.43,37.45],'潍坊市':[119.15,36.7],'菏泽市':[115.26,35.14],'济宁市':[116.58,35.42],'泰安市':[117.08,36.2],'威海市':[122.12,37.52],'日照市':[119.52,35.42],'莱芜市':[117.67,36.22],'临沂市':[118.35,35.05],'德州市':[116.3,37.45],'聊城市':[115.98,36.45],'滨州市':[117.97,37.38],'郑州市':[113.62,34.75],'开封市':[114.3,34.8],'洛阳市':[112.45,34.62],'平顶山市':[113.18,33.77],'安阳市':[114.38,36.1],'鹤壁市':[114.28,35.75],'新乡市':[113.9,35.3],'焦作市':[113.25,35.22],'济源市':[112.58,35.07],'濮阳市':[115.03,35.77],'许昌市':[113.85,34.03],'漯河市':[114.02,33.58],'三门峡市':[111.2,34.78],'南阳市':[112.52,33.0],'商丘市':[115.65,34.45],'信阳市':[114.07,32.13],'周口市':[114.65,33.62],'驻马店市':[114.02,32.98],'神农架林区':[110.67,31.75],'武汉市':[114.3,30.6],'黄石市':[115.03,30.2],'十堰市':[110.78,32.65],'宜昌市':[111.28,30.7],'鄂州市':[114.88,30.4],'荆门市':[112.2,31.03],'孝感市':[113.92,30.93],'荆州市':[112.23,30.33],'黄冈市':[114.87,30.45],'咸宁市':[114.32,29.85],'随州市':[113.37,31.72],'恩施州':[109.47,30.3],'仙桃市':[113.45,30.37],'潜江市':[112.88,30.42],'天门市':[113.17,30.67],'长沙市':[112.93,28.23],'株洲市':[113.13,27.83],'湘潭市':[112.93,27.83],'衡阳市':[112.57,26.9],'邵阳市':[111.47,27.25],'岳阳市':[113.12,29.37],'常德市':[111.68,29.05],'张家界市':[110.47,29.13],'益阳市':[112.32,28.6],'郴州市':[113.02,25.78],'永州市':[111.62,26.43],'怀化市':[110.0,27.57],'娄底市':[112.0,27.73],'湘西州':[109.73,28.32],'广州市': [113.5107,23.2196],'韶关市':[113.6,24.82],'深圳市':[114.05,22.55],'珠海市':[113.57,22.27],'汕头市':[116.68,23.35],'佛山市':[113.12,23.02],'江门市':[113.08,22.58],'湛江市':[110.35,21.27],'茂名市':[110.92,21.67],'肇庆市':[112.47,23.05],'惠州市':[114.42,23.12],'梅州市':[116.12,24.28],'汕尾市':[115.37,22.78],'河源市':[114.7,23.73],'阳江市':[111.98,21.87],'清远市':[113.03,23.7],'东莞市':[113.75,23.05],'中山市':[113.38,22.52],'潮州市':[116.62,23.67],'揭阳市':[116.37,23.55],'云浮市':[112.03,22.92],'南宁市':[108.37,22.82],'柳州市':[109.42,24.33],'防城港市':[108.35,21.7],'来宾市':[109.23,23.73],'崇左市':[107.37,22.4],'桂林市':[110.28,25.28],'梧州市':[111.27,23.48],'北海市':[109.12,21.48],'钦州市':[108.62,21.95],'贵港市':[109.6,23.1],'玉林市':[110.17,22.63],'百色市':[106.62,23.9],'贺州市':[111.55,24.42],'河池市':[108.07,24.7],'海口市':[110.32,20.03],'三亚市':[109.5,18.25],'五指山市':[109.52,18.78],'琼海市':[110.47,19.25],'儋州市':[109.57,19.52],'文昌市':[110.8,19.55],'万宁市':[110.4,18.8],'东方市':[108.63,19.1],'定安县':[110.32,19.7],'屯昌县':[110.1,19.37],'澄迈县':[110.0,19.73],'临高县':[109.68,19.92],'白沙黎族自治县':[109.45,19.23],'昌江黎族自治县':[109.05,19.25],'乐东黎族自治县':[109.17,18.75],'陵水黎族自治县':[110.03,18.5],'保亭黎族苗族自治县':[109.7,18.63],'琼中黎族苗族自治县':[109.83,19.03],'成都市':[104.07,30.67],'自贡市':[104.78,29.35],'攀枝花市':[101.72,26.58],'泸州市':[105.43,28.87],'德阳市':[104.38,31.13],'绵阳市':[104.73,31.47],'广元市':[105.83,32.43],'遂宁市':[105.57,30.52],'内江市':[105.05,29.58],'乐山市':[103.77,29.57],'南充市':[106.08,30.78],'眉山市':[103.83,30.05],'宜宾市':[104.62,28.77],'广安市':[106.63,30.47],'达州市':[107.5,31.22],'雅安市':[103.0,29.98],'巴中市':[106.77,31.85],'资阳市':[104.65,30.12],'阿坝州':[102.22,31.9],'甘孜州':[101.97,30.05],'凉山州':[102.27,27.9],'贵阳市':[106.63,26.65],'六盘水市':[104.83,26.6],'遵义市':[106.92,27.73],'安顺市':[105.95,26.25],'铜仁市':[109.18,27.72],'毕节市':[105.28,27.3],'黔东州':[107.97,26.58],'黔南州':[107.52,26.27],'昆明市':[102.72,25.05],'曲靖市':[103.8,25.5],'玉溪市':[102.55,24.35],'保山市':[99.17,25.12],'昭通市':[103.72,27.33],'丽江市':[100.23,26.88],'临沧市':[100.08,23.88],'楚雄州':[101.55,25.03],'红河州':[103.4,23.37],'文山州':[104.25,23.37],'西双州':[100.8,22.02],'大理州':[100.23,25.6],'德宏州':[98.58,24.43],'怒江州':[98.85,25.85],'迪庆州':[99.7,27.83],'拉萨市':[91.13,29.65],'山南地区':[91.77,29.23],'日喀则市':[88.88,29.27],'那曲地区':[92.07,31.48],'阿里地区':[80.1,32.5],'西安市':[108.93,34.27],'铜川市':[108.93,34.9],'宝鸡市':[107.13,34.37],'咸阳市':[108.7,34.33],'渭南市':[109.5,34.5],'延安市':[109.48,36.6],'汉中市':[107.02,33.07],'榆林市':[109.73,38.28],'安康市':[109.02,32.68],'商洛市':[109.93,33.87],'兰州市':[103.82,36.07],'嘉峪关市':[98.27,39.8],'金昌市':[102.18,38.5],'白银市':[104.18,36.55],'天水市':[105.72,34.58],'武威市':[102.63,37.93],'张掖市':[100.45,38.93],'平凉市':[106.67,35.55],'酒泉市':[98.52,39.75],'庆阳市':[107.63,35.73],'定西市':[104.62,35.58],'陇南市':[104.92,33.4],'临夏州':[103.22,35.6],'甘南州':[102.92,34.98],'西宁市':[101.78,36.62],'黄南州':[102.02,35.52],'海南州':[100.62,36.28],'果洛州':[100.23,34.48],'玉树州':[97.02,33.0],'海西州':[97.37,37.37],'北京市':[116.4,39.9],'天津市':[117.2,39.12],'上海市':[121.47,31.23],'重庆市':[106.55,29.57],'海北州':[100.9,36.97],'银川市':[106.28,38.47],'石嘴山市':[106.38,39.02],'吴忠市':[106.2,37.98],'固原市':[106.28,36.0],'中卫市':[105.18,37.52],'乌鲁木齐市':[87.62,43.82],'克拉玛依市':[84.87,45.6],'吐鲁番市':[89.17,42.95],'哈密地区':[93.52,42.83],'昌吉州':[87.3,44.02],'博尔塔拉州':[82.07,44.9],'巴音郭楞州':[86.15,41.77],'阿克苏地区':[80.27,41.17],'喀什地区':[75.98,39.47],'和田地区':[79.92,37.12],'伊犁州':[81.32,43.92],'塔城地区':[82.98,46.75],'阿勒泰地区':[88.13,47.85],'石河子市':[86.03,44.3],'阿拉尔市':[81.28,40.55],'图木舒克市':[79.13,39.85],'五家渠市':[87.53,44.17]};

	var data = arrdata;
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

var convertedData = [
    convertData(data),
    convertData(data.sort(function (a, b) {
        return b.value - a.value;
    }).slice(0, 6))
];


var option = {
    backgroundColor: labelcolor?'#404a59':'rgba(91, 192, 222, 0.0)',
    animation: true,
    animationDuration: 1000,
    animationEasing: 'cubicInOut',
    animationDurationUpdate: 1000,
    animationEasingUpdate: 'cubicInOut',
    title: [
        
        {
            id: 'statistic',
            right: 120,
            top: 40,
            width: 100,
            textStyle: {
                color: labelcolor?'#fff':'#363636',
                fontSize: 20
            }
        }
    ],
    toolbox: {
        iconStyle: {
            normal: {
                borderColor: labelcolor?'#fff':'#9aa3b7'
            },
            emphasis: {
                borderColor: labelcolor?'#b1e4ff':'#102b37'
            }
        }
    },
    brush: {
        outOfBrush: {
            color: labelcolor?'#abc':'#ddedfe'
        },
        brushStyle: {
            borderWidth: 2,
            color: 'rgba(0,0,0,0.2)',
            borderColor: 'rgba(0,0,0,0.5)',
        },
        seriesIndex: [0, 1],
        throttleType: 'debounce',
        throttleDelay: 300,
        geoIndex: 0
    },
    geo: {
        map: 'china',
        left: '5%',
		top: '5%',
        bottom: '5%',
        
        label: {
            emphasis: {
                show: false
            }
        },
        roam: true,
        itemStyle: {
            normal: {
                areaColor: labelcolor?'#323c48':'#9aa3b7',
                borderColor: '#111'
            },
            emphasis: {
                areaColor: labelcolor?'#2a333d':'#91949c'
            }
        }
    },
    tooltip : {
        trigger: 'item'
    },
	visualMap: {
		show:false,
        min: 0,
        max: radarmax,
        calculable: false,
        inRange: {
            symbolSize: [5, 15],
             
            
        },
        textStyle: {
            color: '#fff'
        }
    },
    
    grid: {
        right: '5%',
        top: 100,
        bottom: 40,
        width: '30%'
    },
    xAxis: {
        type: 'value',
        scale: true,
        position: 'top',
        boundaryGap: false,
        splitLine: {show: false},
        axisLine: {show: false},
        axisTick: {show: false},
        axisLabel: {margin: 2, textStyle: {color: labelcolor?'#aaa':'#363636'}},
    },
    yAxis: {
        type: 'category',
        
        nameGap: 16,
        axisLine: {show: false, lineStyle: {color: '#ddd'}},
        axisTick: {show: false, lineStyle: {color: '#ddd'}},
        axisLabel: {interval: 0, textStyle: {color: labelcolor?'#ddd':'#363636'}},
        data: []
    },
    series : [
        {
            
            type: 'scatter',
            coordinateSystem: 'geo',
            data: convertedData[0],
            symbolSize: function (val) {
                return Math.max(val[2] / 10, 8);
            },
            label: {
                normal: {
                    formatter: '{b}',
                    position: 'right',
                    show: false
                },
                emphasis: {
                    show: true
                }
            },
            itemStyle: {
                normal: {
                    color: '#347fef'
                }
            }
        },
        {
            name: 'Top 5',
            type: 'effectScatter',
            coordinateSystem: 'geo',
            data: convertedData[1],
            symbolSize: function (val) {
                return Math.max(val[2] / 10, 8);
            },
            showEffectOn: 'render',
            rippleEffect: {
                brushType: 'stroke'
            },
            hoverAnimation: true,
            label: {
                normal: {
                    formatter: '{b}',
                    position: 'right',
                    show: true
                }
            },
            itemStyle: {
                normal: {
                    color: '#f4cf25',
                    shadowBlur: 10,
                    shadowColor: '#333'
                }
            },
            zlevel: 1
        },
        {
            id: 'bar',
            zlevel: 2,
            type: 'bar',
            symbol: 'none',
            itemStyle: {
                normal: {
                    color: '#347fef'
                }
            },
            data: []
        }
    ]
};


myChart.on('brushselected', renderBrushed);

myChart.setOption(option);


setTimeout(function () {
    myChart.dispatchAction({
        type: 'brush',
        areas: [
            {
                geoIndex: 0,
                brushType: 'polygon',
				coordRange: [[98.289152,39.77313],[123.97,47.33],[121.15,31.89],[102.52,24.35]]
            }
        ]
    });
}, 0);

function renderBrushed(params) {
    var mainSeries = params.batch[0].selected[0];

    var selectedItems = [];
    var categoryData = [];
    var barData = [];
    var maxBar = 30;
    var sum = 0;
    var count = 0;

    for (var i = 0; i < mainSeries.dataIndex.length; i++) {
        var rawIndex = mainSeries.dataIndex[i];
        var dataItem = convertedData[0][rawIndex];
        var pmValue = dataItem.value[2];

        sum += pmValue;
        count++;

        selectedItems.push(dataItem);
    }

    selectedItems.sort(function (a, b) {
        return a.value[2] - b.value[2];
    });

    for (var i = 0; i < Math.min(selectedItems.length, maxBar); i++) {
        categoryData.push(selectedItems[i].name);
        barData.push(selectedItems[i].value[2]);
    }

    this.setOption({
        yAxis: {
            data: categoryData
        },
        xAxis: {
            axisLabel: {show: !!count}
        },
        title: {
            id: 'statistic',
			right:'15%',
            text: count ? (scope.panel.isEN?'Average Click: ':'平均点击量: ') + (sum / count).toFixed(0) : ''
        },
        series: {
            id: 'bar',
            data: barData
        }
    });
}
	
}

                if(scope.panel.chart === 'zmap'){

                    var myChart= echarts.init(document.getElementById(idd));

                    var geoCoordMap={'香港':[114.08,22.2],'澳门':[113.33,22.13],'台北市':[121.5,25.03],'基隆市':[121.73,25.13],'台中市':[120.67,24.15],'台南市':[120.2,23.0],'宜兰县':[121.75,24.77],'桃园县':[121.3,24.97],'苗栗县':[120.8,24.53],'台中县':[120.72,24.25],'彰化县':[120.53,24.08],'南投县':[120.67,23.92],'云林县':[120.53,23.72],'台南县':[120.32,23.32],'高雄县':[120.37,22.63],'屏东县':[120.48,22.67],'台东县':[121.15,22.75],'花莲县':[121.6,23.98],'澎湖县':[119.58,23.58],'石家庄市':[114.52,38.05],'唐山市':[118.2,39.63],'秦皇岛市':[119.6,39.93],'邯郸市':[114.48,36.62],'邢台市':[114.48,37.07],'保定市':[115.47,38.87],'张家口市':[114.88,40.82],'承德市':[117.93,40.97],'沧州市':[116.83,38.3],'廊坊市':[116.7,39.52],'衡水市':[115.68,37.73],'太原市':[112.55,37.87],'大同市':[113.3,40.08],'阳泉市':[113.57,37.85],'长治市':[113.12,36.2],'晋城市':[112.83,35.5],'朔州市':[112.43,39.33],'晋中市':[112.75,37.68],'运城市':[110.98,35.02],'忻州市':[112.73,38.42],'临汾市':[111.52,36.08],'吕梁市':[111.13,37.52],'呼和浩特市':[111.73,40.83],'包头市':[109.83,40.65],'乌海市':[106.82,39.67],'赤峰市':[118.92,42.27],'通辽市':[122.27,43.62],'鄂尔多斯市':[109.8,39.62],'呼伦贝尔市':[119.77,49.22],'巴彦淖尔市':[107.42,40.75],'乌兰察布市':[113.12,40.98],'兴安盟':[122.05,46.08],'锡林郭勒盟':[116.07,43.95],'阿拉善盟':[105.67,38.83],'沈阳市':[123.43,41.8],'大连市':[121.62,38.92],'鞍山市':[122.98,41.1],'抚顺市':[123.98,41.88],'本溪市':[123.77,41.3],'丹东市':[124.38,40.13],'锦州市':[121.13,41.1],'营口市':[122.23,40.67],'阜新市':[121.67,42.02],'辽阳市':[123.17,41.27],'盘锦市':[122.07,41.12],'铁岭市':[123.83,42.28],'朝阳市':[120.45,41.57],'葫芦岛市':[120.83,40.72],'长春市':[125.32,43.9],'吉林市':[126.55,43.83],'四平市':[124.35,43.17],'辽源市':[125.13,42.88],'通化市':[125.93,41.73],'白山市':[126.42,41.93],'松原市':[124.82,45.13],'白城市':[122.83,45.62],'延边州':[129.5,42.88],'哈尔滨市':[126.53,45.8],'齐齐哈尔市':[123.95,47.33],'鸡西市':[130.97,45.3],'鹤岗市':[130.27,47.33],'双鸭山市':[131.15,46.63],'大庆市':[125.03,46.58],'伊春市':[128.9,47.73],'佳木斯市':[130.37,46.82],'七台河市':[130.95,45.78],'牡丹江市':[129.6,44.58],'黑河市':[127.48,50.25],'绥化市':[126.98,46.63],'大兴安岭地区':[124.12,50.42],'南京市':[118.78,32.07],'无锡市':[120.3,31.57],'徐州市':[117.18,34.27],'常州市':[119.95,31.78],'苏州市':[120.58,31.3],'南通市':[120.88,31.98],'连云港市':[119.22,34.6],'淮安市':[119.02,33.62],'盐城市':[120.15,33.35],'扬州市':[119.4,32.4],'镇江市':[119.45,32.2],'泰州市':[119.92,32.45],'宿迁市':[118.28,33.97],'杭州市':[120.15,30.28],'宁波市':[121.55,29.88],'温州市':[120.7,28.0],'嘉兴市':[120.75,30.75],'湖州市':[120.08,30.9],'绍兴市':[120.57,30.0],'金华市':[119.65,29.08],'衢州市':[118.87,28.93],'舟山市':[122.2,30.0],'台州市':[121.43,28.68],'丽水市':[119.92,28.45],'合肥市':[117.25,31.83],'芜湖市':[118.38,31.33],'蚌埠市':[117.38,32.92],'淮南市':[117.0,32.63],'马鞍山市':[118.5,31.7],'淮北市':[116.8,33.95],'铜陵市':[117.82,30.93],'安庆市':[117.05,30.53],'黄山市':[118.33,29.72],'滁州市':[118.32,32.3],'阜阳市':[115.82,32.9],'宿州市':[116.98,33.63],'巢湖市':[117.87,31.6],'六安市':[116.5,31.77],'亳州市':[115.78,33.85],'池州市':[117.48,30.67],'宣城市':[118.75,30.95],'福州市':[119.3,26.08],'厦门市':[118.08,24.48],'莆田市':[119.0,25.43],'三明市':[117.62,26.27],'泉州市':[118.67,24.88],'漳州市':[117.65,24.52],'南平市':[118.17,26.65],'龙岩市':[117.03,25.1],'宁德市':[119.52,26.67],'南昌市':[115.85,28.68],'景德镇市':[117.17,29.27],'萍乡市':[113.85,27.63],'九江市':[116.0,29.7],'新余市':[114.92,27.82],'鹰潭市':[117.07,28.27],'赣州市':[114.93,25.83],'吉安市':[114.98,27.12],'宜春市':[114.38,27.8],'抚州市':[116.35,28.0],'上饶市':[117.97,28.45],'济南市':[116.98,36.67],'青岛市':[120.38,36.07],'淄博市':[118.05,36.82],'枣庄市':[117.32,34.82],'东营市':[118.67,37.43],'烟台市':[121.43,37.45],'潍坊市':[119.15,36.7],'菏泽市':[115.26,35.14],'济宁市':[116.58,35.42],'泰安市':[117.08,36.2],'威海市':[122.12,37.52],'日照市':[119.52,35.42],'莱芜市':[117.67,36.22],'临沂市':[118.35,35.05],'德州市':[116.3,37.45],'聊城市':[115.98,36.45],'滨州市':[117.97,37.38],'郑州市':[113.62,34.75],'开封市':[114.3,34.8],'洛阳市':[112.45,34.62],'平顶山市':[113.18,33.77],'安阳市':[114.38,36.1],'鹤壁市':[114.28,35.75],'新乡市':[113.9,35.3],'焦作市':[113.25,35.22],'济源市':[112.58,35.07],'濮阳市':[115.03,35.77],'许昌市':[113.85,34.03],'漯河市':[114.02,33.58],'三门峡市':[111.2,34.78],'南阳市':[112.52,33.0],'商丘市':[115.65,34.45],'信阳市':[114.07,32.13],'周口市':[114.65,33.62],'驻马店市':[114.02,32.98],'神农架林区':[110.67,31.75],'武汉市':[114.3,30.6],'黄石市':[115.03,30.2],'十堰市':[110.78,32.65],'宜昌市':[111.28,30.7],'鄂州市':[114.88,30.4],'荆门市':[112.2,31.03],'孝感市':[113.92,30.93],'荆州市':[112.23,30.33],'黄冈市':[114.87,30.45],'咸宁市':[114.32,29.85],'随州市':[113.37,31.72],'恩施州':[109.47,30.3],'仙桃市':[113.45,30.37],'潜江市':[112.88,30.42],'天门市':[113.17,30.67],'长沙市':[112.93,28.23],'株洲市':[113.13,27.83],'湘潭市':[112.93,27.83],'衡阳市':[112.57,26.9],'邵阳市':[111.47,27.25],'岳阳市':[113.12,29.37],'常德市':[111.68,29.05],'张家界市':[110.47,29.13],'益阳市':[112.32,28.6],'郴州市':[113.02,25.78],'永州市':[111.62,26.43],'怀化市':[110.0,27.57],'娄底市':[112.0,27.73],'湘西州':[109.73,28.32],'广州市': [113.5107,23.2196],'韶关市':[113.6,24.82],'深圳市':[114.05,22.55],'珠海市':[113.57,22.27],'汕头市':[116.68,23.35],'佛山市':[113.12,23.02],'江门市':[113.08,22.58],'湛江市':[110.35,21.27],'茂名市':[110.92,21.67],'肇庆市':[112.47,23.05],'惠州市':[114.42,23.12],'梅州市':[116.12,24.28],'汕尾市':[115.37,22.78],'河源市':[114.7,23.73],'阳江市':[111.98,21.87],'清远市':[113.03,23.7],'东莞市':[113.75,23.05],'中山市':[113.38,22.52],'潮州市':[116.62,23.67],'揭阳市':[116.37,23.55],'云浮市':[112.03,22.92],'南宁市':[108.37,22.82],'柳州市':[109.42,24.33],'防城港市':[108.35,21.7],'来宾市':[109.23,23.73],'崇左市':[107.37,22.4],'桂林市':[110.28,25.28],'梧州市':[111.27,23.48],'北海市':[109.12,21.48],'钦州市':[108.62,21.95],'贵港市':[109.6,23.1],'玉林市':[110.17,22.63],'百色市':[106.62,23.9],'贺州市':[111.55,24.42],'河池市':[108.07,24.7],'海口市':[110.32,20.03],'三亚市':[109.5,18.25],'五指山市':[109.52,18.78],'琼海市':[110.47,19.25],'儋州市':[109.57,19.52],'文昌市':[110.8,19.55],'万宁市':[110.4,18.8],'东方市':[108.63,19.1],'定安县':[110.32,19.7],'屯昌县':[110.1,19.37],'澄迈县':[110.0,19.73],'临高县':[109.68,19.92],'白沙黎族自治县':[109.45,19.23],'昌江黎族自治县':[109.05,19.25],'乐东黎族自治县':[109.17,18.75],'陵水黎族自治县':[110.03,18.5],'保亭黎族苗族自治县':[109.7,18.63],'琼中黎族苗族自治县':[109.83,19.03],'成都市':[104.07,30.67],'自贡市':[104.78,29.35],'攀枝花市':[101.72,26.58],'泸州市':[105.43,28.87],'德阳市':[104.38,31.13],'绵阳市':[104.73,31.47],'广元市':[105.83,32.43],'遂宁市':[105.57,30.52],'内江市':[105.05,29.58],'乐山市':[103.77,29.57],'南充市':[106.08,30.78],'眉山市':[103.83,30.05],'宜宾市':[104.62,28.77],'广安市':[106.63,30.47],'达州市':[107.5,31.22],'雅安市':[103.0,29.98],'巴中市':[106.77,31.85],'资阳市':[104.65,30.12],'阿坝州':[102.22,31.9],'甘孜州':[101.97,30.05],'凉山州':[102.27,27.9],'贵阳市':[106.63,26.65],'六盘水市':[104.83,26.6],'遵义市':[106.92,27.73],'安顺市':[105.95,26.25],'铜仁市':[109.18,27.72],'毕节市':[105.28,27.3],'黔东州':[107.97,26.58],'黔南州':[107.52,26.27],'昆明市':[102.72,25.05],'曲靖市':[103.8,25.5],'玉溪市':[102.55,24.35],'保山市':[99.17,25.12],'昭通市':[103.72,27.33],'丽江市':[100.23,26.88],'临沧市':[100.08,23.88],'楚雄州':[101.55,25.03],'红河州':[103.4,23.37],'文山州':[104.25,23.37],'西双州':[100.8,22.02],'大理州':[100.23,25.6],'德宏州':[98.58,24.43],'怒江州':[98.85,25.85],'迪庆州':[99.7,27.83],'拉萨市':[91.13,29.65],'山南地区':[91.77,29.23],'日喀则市':[88.88,29.27],'那曲地区':[92.07,31.48],'阿里地区':[80.1,32.5],'西安市':[108.93,34.27],'铜川市':[108.93,34.9],'宝鸡市':[107.13,34.37],'咸阳市':[108.7,34.33],'渭南市':[109.5,34.5],'延安市':[109.48,36.6],'汉中市':[107.02,33.07],'榆林市':[109.73,38.28],'安康市':[109.02,32.68],'商洛市':[109.93,33.87],'兰州市':[103.82,36.07],'嘉峪关市':[98.27,39.8],'金昌市':[102.18,38.5],'白银市':[104.18,36.55],'天水市':[105.72,34.58],'武威市':[102.63,37.93],'张掖市':[100.45,38.93],'平凉市':[106.67,35.55],'酒泉市':[98.52,39.75],'庆阳市':[107.63,35.73],'定西市':[104.62,35.58],'陇南市':[104.92,33.4],'临夏州':[103.22,35.6],'甘南州':[102.92,34.98],'西宁市':[101.78,36.62],'黄南州':[102.02,35.52],'海南州':[100.62,36.28],'果洛州':[100.23,34.48],'玉树州':[97.02,33.0],'海西州':[97.37,37.37],'北京市':[116.4,39.9],'天津市':[117.2,39.12],'上海市':[121.47,31.23],'重庆市':[106.55,29.57],'海北州':[100.9,36.97],'银川市':[106.28,38.47],'石嘴山市':[106.38,39.02],'吴忠市':[106.2,37.98],'固原市':[106.28,36.0],'中卫市':[105.18,37.52],'乌鲁木齐市':[87.62,43.82],'克拉玛依市':[84.87,45.6],'吐鲁番市':[89.17,42.95],'哈密地区':[93.52,42.83],'昌吉州':[87.3,44.02],'博尔塔拉州':[82.07,44.9],'巴音郭楞州':[86.15,41.77],'阿克苏地区':[80.27,41.17],'喀什地区':[75.98,39.47],'和田地区':[79.92,37.12],'伊犁州':[81.32,43.92],'塔城地区':[82.98,46.75],'阿勒泰地区':[88.13,47.85],'石河子市':[86.03,44.3],'阿拉尔市':[81.28,40.55],'图木舒克市':[79.13,39.85],'五家渠市':[87.53,44.17]};

                    var data = arrdata;
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

                    var convertedData = [
                        convertData(data),
                        convertData(data.sort(function (a, b) {
                            return b.value - a.value;
                        }).slice(0, 6))
                    ];


                    var option = {
                        backgroundColor: labelcolor?'#202328':'rgba(91, 192, 222, 0.0)',
                        animation: true,
                        animationDuration: 1000,
                        animationEasing: 'cubicInOut',
                        animationDurationUpdate: 1000,
                        animationEasingUpdate: 'cubicInOut',
                        title: [

                            {
                                id: 'statistic',
                                right: 120,
                                top: 40,
                                width: 100,
                                textStyle: {
                                    color: labelcolor?'#fff':'#363636',
                                    fontSize: 20
                                }
                            }
                        ],
                        toolbox: {
                            iconStyle: {
                                normal: {
                                    borderColor: labelcolor?'#fff':'#9aa3b7'
                                },
                                emphasis: {
                                    borderColor: labelcolor?'#b1e4ff':'#102b37'
                                }
                            }
                        },
                        brush: {
                            outOfBrush: {
                                color: labelcolor?'#abc':'#ddedfe'
                            },
                            brushStyle: {
                                borderWidth: 2,
                                color: 'rgba(0,0,0,0.2)',
                                borderColor: 'rgba(0,0,0,0.5)',
                            },
                            seriesIndex: [0, 1],
                            throttleType: 'debounce',
                            throttleDelay: 300,
                            geoIndex: 0
                        },
                        geo: {
                            map: 'china',
                            left: '0%',
                            top: '18%',
                            right:'40%',
                            bottom: '18%',

                            label: {
                                emphasis: {
                                    show: false
                                }
                            },
                            roam: true,
                            itemStyle: {
                                normal: {
                                    areaColor: labelcolor?'#323c48':'#9aa3b7',
                                    borderColor: labelcolor?'#202328':'#111',
                                    borderWidth:1
                                },
                                emphasis: {
                                    areaColor: labelcolor?'#2a333d':'#91949c'
                                }
                            }
                        },
                        tooltip : {
                            trigger: 'item'
                        },
                        visualMap: {
                            show:false,
                            min: 0,
                            max: radarmax,
                            calculable: false,
                            inRange: {
                                symbolSize: [5, 15],


                            },
                            textStyle: {
                                color: '#fff'
                            }
                        },

                        grid: {
                            right: '5%',
                            top: 100,
                            bottom: 40,
                            width: '30%'
                        },
                        xAxis: {
                            type: 'value',
                            scale: true,
                            position: 'top',
                            boundaryGap: false,
                            splitLine: {show: false},
                            axisLine: {show: false},
                            axisTick: {show: false},
                            axisLabel: {margin: 2, textStyle: {color: labelcolor?'#aaa':'#363636'}},
                        },
                        yAxis: {
                            type: 'category',

                            nameGap: 16,
                            axisLine: {show: false, lineStyle: {color: '#ddd'}},
                            axisTick: {show: false, lineStyle: {color: '#ddd'}},
                            axisLabel: {interval: 0, textStyle: {color: labelcolor?'#ddd':'#363636'}},
                            data: []
                        },
                        series : [
                            {

                                type: 'scatter',
                                coordinateSystem: 'geo',
                                data: convertedData[0],
                                symbolSize: function (val) {
                                    return Math.max(val[2] / 10, 8);
                                },
                                label: {
                                    normal: {
                                        formatter: '{b}',
                                        position: 'right',
                                        show: false
                                    },
                                    emphasis: {
                                        show: true
                                    }
                                },
                                itemStyle: {
                                    normal: {
                                        color: '#f4cf25'
                                    }
                                }
                            },
                            {
                                name: 'Top 5',
                                type: 'effectScatter',
                                coordinateSystem: 'geo',
                                data: convertedData[1],
                                symbolSize: function (val) {
                                    return Math.max(val[2] / 10, 8);
                                },
                                showEffectOn: 'render',
                                rippleEffect: {
                                    brushType: 'stroke'
                                },
                                hoverAnimation: true,
                                label: {
                                    normal: {
                                        formatter: '{b}',
                                        position: 'right',
                                        show: true
                                    }
                                },
                                itemStyle: {
                                    normal: {
                                        color: '#f4cf25',
                                        shadowBlur: 10,
                                        shadowColor: '#333'
                                    }
                                },
                                zlevel: 1
                            },
                            {
                                id: 'bar',
                                zlevel: 2,
                                type: 'bar',
                                symbol: 'none',
                                itemStyle: {
                                    normal: {
                                        color: '#347fef'
                                    }
                                },
                                data: []
                            }
                        ]
                    };


                    myChart.on('brushselected', renderBrushed);

                    myChart.setOption(option);


                    setTimeout(function () {
                        myChart.dispatchAction({
                            type: 'brush',
                            areas: [
                                {
                                    geoIndex: 0,
                                    brushType: 'polygon',
                                    coordRange: [[98.289152,29.77313],[98.289152,47.33],[123.97,47.33],[123.97,29.77313]]
                                }
                            ]
                        });
                    }, 0);

                    function renderBrushed(params) {
                        var mainSeries = params.batch[0].selected[0];

                        var selectedItems = [];
                        var categoryData = [];
                        var barData = [];
                        var maxBar = 30;
                        var sum = 0;
                        var count = 0;

                        for (var i = 0; i < mainSeries.dataIndex.length; i++) {
                            var rawIndex = mainSeries.dataIndex[i];
                            var dataItem = convertedData[0][rawIndex];
                            var pmValue = dataItem.value[2];

                            sum += pmValue;
                            count++;

                            selectedItems.push(dataItem);
                        }

                        selectedItems.sort(function (a, b) {
                            return a.value[2] - b.value[2];
                        });

                        for (var i = 0; i < Math.min(selectedItems.length, maxBar); i++) {
                            categoryData.push(selectedItems[i].name);
                            barData.push(selectedItems[i].value[2]);
                        }

                        this.setOption({
                            yAxis: {
                                data: categoryData
                            },
                            xAxis: {
                                axisLabel: {show: !!count}
                            },
                            title: {
                                id: 'statistic',
                                right:'15%',
                                text: count ? (scope.panel.isEN?'Average Click: ':'平均点击量: ') + (sum / count).toFixed(0) : ''
                            },
                            series: {
                                id: 'bar',
                                data: barData
                            }
                        });
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