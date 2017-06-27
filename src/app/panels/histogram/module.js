/*

  ## Histogram

  ### Parameters
  * auto_int :: Auto calculate data point interval?
  * resolution ::  If auto_int is enables, shoot for this many data points, rounding to
                    sane intervals
  * interval :: Datapoint interval in elasticsearch date math format (eg 1d, 1w, 1y, 5y)
  * fill :: Only applies to line charts. Level of area shading from 0-10
  * linewidth ::  Only applies to line charts. How thick the line should be in pixels
                  While the editor only exposes 0-10, this can be any numeric value.
                  Set to 0 and you'll get something like a scatter plot
  * timezone :: This isn't totally functional yet. Currently only supports browser and utc.
                browser will adjust the x-axis labels to match the timezone of the user's
                browser
  * spyable ::  Dislay the 'eye' icon that show the last elasticsearch query
  * zoomlinks :: Show the zoom links?
  * bars :: Show bars in the chart
  * stack :: Stack multiple queries. This generally a crappy way to represent things.
             You probably should just use a line chart without stacking
  * points :: Should circles at the data points on the chart
  * lines :: Line chart? Sweet.
  * legend :: Show the legend?
  * x-axis :: Show x-axis labels and grid lines
  * y-axis :: Show y-axis labels and grid lines
  * interactive :: Allow drag to select time range

*/
define([
  'angular',
  'app',
  'jquery',
  'underscore',
  'kbn',
  'moment',
  './timeSeries',

  'jquery.flot',
  'jquery.flot.pie',
  'jquery.flot.selection',
  'jquery.flot.time',
  'jquery.flot.stack',
  'jquery.flot.stackpercent',
  'jquery.flot.axislabels'
],
function (angular, app, $, _, kbn, moment, timeSeries) {
  'use strict';

  var module = angular.module('kibana.panels.histogram', []);
  app.useModule(module);

  module.controller('histogram', function($scope, $translate,$q, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {

      editorTabs : [
        {
          title:$translate.instant('Queries'),
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Stable",
      description : ""
    };

    // Set and populate defaults
    var _d = {
      mode        : 'count',
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      max_rows    : 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      reverse     :0,
	  segment	  :3,
	  threshold_first:1000,
	  threshold_second:2000,
	  threshold_third:3000,
	  value_field : null,
      group_field : null,
      auto_int    : true,
      resolution  : 100,
      interval    : '5m',
      intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
      fill        : 0,
      linewidth   : 3,
      timezone    : 'browser', // browser, utc or a standard timezone
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      stack       : true,
        linkage_id:'a',
      points      : false,
      display:'block',
      icon:"icon-caret-down",
      lines       : false,
      lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
      legend      : true,
      'x-axis'    : true,
      'y-axis'    : true,
      percentage  : false,
      interactive : true,
      options     : true,
      show_queries:true,
      tooltip     : {
        value_type: 'cumulative',
        query_as_alias: false
      }
    };

    _.defaults($scope.panel,_d);

    $scope.init = function() {
      // Hide view options by default
      $scope.options = false;
      $scope.$on('refresh',function(){
        $scope.get_data();
      });

      $scope.get_data();

    };

    $scope.set_interval = function(interval) {
      if(interval !== 'auto') {
        $scope.panel.auto_int = false;
        $scope.panel.interval = interval;
      } else {
        $scope.panel.auto_int = true;
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

    $scope.interval_label = function(interval) {
      return $scope.panel.auto_int && interval === $scope.panel.interval ? interval+" (auto)" : interval;
    };

    /**
     * The time range effecting the panel
     * @return {[type]} [description]
     */
    $scope.get_time_range = function () {
      var range = $scope.range = filterSrv.timeRange('min');
      return range;
    };

    $scope.get_interval = function () {
      var interval = $scope.panel.interval,
                      range;
      if ($scope.panel.auto_int) {
        range = $scope.get_time_range();
        if (range) {
          interval = kbn.secondsToHms(
            kbn.calculate_interval(range.from, range.to, $scope.panel.resolution, 0) / 1000
          );
        }
      }
      $scope.panel.interval = interval || '10m';
      return $scope.panel.interval;
    };

    /**
     * Fetch the data for a chunk of a queries results. Multiple segments occur when several indicies
     * need to be consulted (like timestamped logstash indicies)
     *
     * The results of this function are stored on the scope's data property. This property will be an
     * array of objects with the properties info, time_series, and hits. These objects are used in the
     * render_panel function to create the historgram.
     *
     * !!! Solr does not need to fetch the data in chunk because it uses a facet search and retrieve
     * !!! all events from a single query.
     *
     * @param {number} segment   The segment count, (0 based)
     * @param {number} query_id  The id of the query, generated on the first run and passed back when
     *                            this call is made recursively for more segments
     */
    $scope.get_data = function(segment, query_id) {
        if(($scope.panel.linkage_id === dashboard.current.linkage_id)||dashboard.current.enable_linkage){

        if (_.isUndefined(segment)) {
            segment = 0;
        }
        delete $scope.panel.error;

        // Make sure we have everything for the request to complete
        if (dashboard.indices.length === 0) {
            return;
        }
        var _range = $scope.get_time_range();
        var _interval = $scope.get_interval(_range);

        if ($scope.panel.auto_int) {
            $scope.panel.interval = kbn.secondsToHms(
                kbn.calculate_interval(_range.from, _range.to, $scope.panel.resolution, 0) / 1000);
        }

        $scope.panelMeta.loading = true;

        // Solr
        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

        var request = $scope.sjs.Request().indices(dashboard.indices[segment]);
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);


        $scope.panel.queries.query = "";
        // Build the query
        _.each($scope.panel.queries.ids, function (id) {
            var query = $scope.sjs.FilteredQuery(
                querySrv.getEjsObj(id),
                filterSrv.getBoolFilter(filterSrv.ids)
            );

            var facet = $scope.sjs.DateHistogramFacet(id);
            if ($scope.panel.mode === 'count' || $scope.panel.mode === 'counts') {
                facet = facet.field(filterSrv.getTimeField());
            } else {
                if (_.isNull($scope.panel.value_field)) {
                    $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
                    return;
                }
                facet = facet.keyField(filterSrv.getTimeField()).valueField($scope.panel.value_field);
            }
            facet = facet.interval(_interval).facetFilter($scope.sjs.QueryFilter(query));
            request = request.facet(facet).size(0);

        });

        // Populate the inspector panel
        $scope.populate_modal(request);

        // Build Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
            fq = '&' + filterSrv.getSolrFq();
        }
        var time_field = filterSrv.getTimeField();
        var start_time = filterSrv.getStartTime();
        var end_time = filterSrv.getEndTime();

        // facet.range.end does NOT accept * as a value, need to convert it to NOW
        if (end_time === '*') {
            end_time = 'NOW';
        }

        var wt_json = '&wt=json';
        var rows_limit = '&rows=0'; // for histogram, we do not need the actual response doc, so set rows=0
        var facet_gap = $scope.sjs.convertFacetGap($scope.panel.interval);
        var facet = '&facet=true' +
            '&facet.range=' + time_field +
            '&facet.range.start=' + start_time +
            '&facet.range.end=' + end_time +
            '&facet.range.gap=' + facet_gap;
        var values_mode_query = '';

        // For mode = value
        if ($scope.panel.mode === 'values' || $scope.panel.mode === 'value') {
            if (!$scope.panel.value_field) {
                $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
                return;
            }

            values_mode_query = '&fl=' + time_field + ' ' + $scope.panel.value_field;
            rows_limit = '&rows=' + $scope.panel.max_rows;
            facet = '';

            // if Group By Field is specified
            if ($scope.panel.group_field) {
                values_mode_query += '&group=true&group.field=' + $scope.panel.group_field + '&group.limit=' + $scope.panel.max_rows;
            }
        }

        var mypromises = [];
        var threshold_1 = '*';
        var threshold_1_1 = '*';
        var threshold_2 = '*';
        var threshold_2_1 = '*';
        var threshold_3 = '*';
        var threshold_3_1 = '*';
        if ($scope.panel.mode === 'value' || $scope.panel.mode === 'counts') {
            var arr_id = [0];
            if ($scope.panel.segment === 2) {
                arr_id = [1, 0];
                threshold_1 = String($scope.panel.threshold_first - 1);
                threshold_1_1 = String($scope.panel.threshold_first);
            } else if ($scope.panel.segment === 3) {
                arr_id = [2, 1, 0];
                threshold_1 = String($scope.panel.threshold_first - 1);
                threshold_1_1 = String($scope.panel.threshold_first);
                threshold_2 = String($scope.panel.threshold_second - 1);
                threshold_2_1 = String($scope.panel.threshold_second);
            } else if ($scope.panel.segment === 4) {
                arr_id = [3, 2, 1, 0];
                threshold_1 = String($scope.panel.threshold_first - 1);
                threshold_1_1 = String($scope.panel.threshold_first);
                threshold_2 = String($scope.panel.threshold_second - 1);
                threshold_2_1 = String($scope.panel.threshold_second);
                threshold_3 = String($scope.panel.threshold_third - 1);
                threshold_3_1 = String($scope.panel.threshold_third);
            }
            if ($scope.panel.reverse === 1) {
                arr_id = arr_id.reverse();
            }
            _.each(arr_id, function (id) {
                var temp_q;
                if (id === 0) {
                    //temp_q = temp_q.replace(/responseElapsed%3A%5B0%20TO%2020000%5D/,"connectElapsed%3A%5B0%20TO%2020000%5D");
                    temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + 0 + '%20TO%20' + threshold_1 + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
                }
                else if (id === 1) {
                    //temp_q = temp_q.replace(/responseElapsed%3A%5B20000%20TO%2030000%5D/,"connectElapsed%3A%5B20000%20TO%2030000%5D");
                    temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + threshold_1_1 + '%20TO%20' + threshold_2 + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
                } else if (id === 2) {
                    //temp_q = temp_q.replace("responseElapsed%3A%5B30000%20TO%20*%5D","connectElapsed%3A%5B30000%20TO%20*%5D");
                    temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + threshold_2_1 + '%20TO%20' + threshold_3 + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
                } else {
                    temp_q = 'q=' + $scope.panel.value_field + '%3A%5B' + threshold_3_1 + '%20TO%20' + '*' + '%5D' + wt_json + rows_limit + fq + facet + values_mode_query;
                }


                $scope.panel.queries.query += temp_q + "\n";
                if ($scope.panel.queries.custom !== null) {
                    request = request.setQuery(temp_q + $scope.panel.queries.custom);
                } else {
                    request = request.setQuery(temp_q);
                }
                mypromises.push(request.doSearch());
            });


        } else {

            _.each($scope.panel.queries.ids, function (id) {
                var temp_q = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet + values_mode_query;

                $scope.panel.queries.query += temp_q + "\n";
                if ($scope.panel.queries.custom !== null) {
                    request = request.setQuery(temp_q + $scope.panel.queries.custom);
                } else {
                    request = request.setQuery(temp_q);
                }
                mypromises.push(request.doSearch());
            });
        }

        if (dashboard.current.services.query.ids.length >= 1) {
            $q.all(mypromises).then(function (results) {
                $scope.panelMeta.loading = false;
                if (segment === 0) {
                    $scope.hits = 0;
                    $scope.data = [];
                    query_id = $scope.query_id = new Date().getTime();
                }
                // Convert facet ids to numbers
                // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
                //var facetIds = [0]; // Need to fix this

                // Make sure we're still on the same query/queries
                // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
                // if ($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
                var i = 0,
                    time_series,
                    hits;

                _.each($scope.panel.queries.ids, function (id, index) {
                    // Check for error and abort if found
                    if (!(_.isUndefined(results[index].error))) {
                        $scope.panel.error = $scope.parse_error(results[index].error.msg);
                        return;
                    }
                    // we need to initialize the data variable on the first run,
                    // and when we are working on the first segment of the data.
                    if (_.isUndefined($scope.data[i]) || segment === 0) {
                        time_series = new timeSeries.ZeroFilled({
                            interval: _interval,
                            start_date: _range && _range.from,
                            end_date: _range && _range.to,
                            fill_style: 'minimal'
                        });
                        hits = 0;
                    } else {
                        time_series = $scope.data[i].time_series;
                        // Bug fix for wrong event count:
                        //   Solr don't need to accumulate hits count since it can get total count from facet query.
                        //   Therefore, I need to set hits and $scope.hits to zero.
                        // hits = $scope.data[i].hits;
                        hits = 0;
                        $scope.hits = 0;
                    }

                    // Solr facet counts response is in one big array.
                    // So no need to get each segment like Elasticsearch does.
                    var entry_time, entries, entry_value;
                    if ($scope.panel.mode === 'count' || $scope.panel.mode === 'counts') {
                        // Entries from facet_ranges counts
                        entries = results[index].facet_counts.facet_ranges[time_field].counts;
                        for (var j = 0; j < entries.length; j++) {
                            entry_time = new Date(entries[j]).getTime(); // convert to millisec
                            j++;
                            var entry_count = entries[j];
                            var nowTime = new Date().getTime();
                            if(entry_time<=nowTime){
                                time_series.addValue(entry_time, entry_count);
                                hits += entry_count; // The series level hits counter
                                $scope.hits += entry_count;
                            }
                        }
                    } else if ($scope.panel.mode === 'values' || $scope.panel.mode === 'value') {
                        if ($scope.panel.group_field) {
                            // Group By Field is specified
                            var groups = results[index].grouped[$scope.panel.group_field].groups;

                            for (var j = 0; j < groups.length; j++) { // jshint ignore: line
                                var docs = groups[j].doclist.docs;
                                var group_time_series = new timeSeries.ZeroFilled({
                                    interval: _interval,
                                    start_date: _range && _range.from,
                                    end_date: _range && _range.to,
                                    fill_style: 'minimal'
                                });
                                hits = 0;

                                // loop through each group results
                                for (var k = 0; k < docs.length; k++) {
                                    entry_time = new Date(docs[k][time_field]).getTime(); // convert to millisec
                                    entry_value = docs[k][$scope.panel.value_field];
                                    group_time_series.addValue(entry_time, entry_value);
                                    hits += 1;
                                    $scope.hits += 1;
                                }

                                $scope.data[j] = {
                                    // info: querySrv.list[id],
                                    // Need to define chart info here according to the results, cannot use querySrv.list[id]
                                    info: {
                                        alias: groups[j].groupValue,
                                        color: querySrv.colors[j],

                                    },
                                    time_series: group_time_series,
                                    hits: hits
                                };
                            }
                        } else { // Group By Field is not specified
                            entries = results[index].response.docs;
                            for (var j = 0; j < entries.length; j++) { // jshint ignore: line
                                entry_time = new Date(entries[j][time_field]).getTime(); // convert to millisec
                                entry_value = entries[j][$scope.panel.value_field];
                                time_series.addValue(entry_time, entry_value);
                                hits += 1;
                                $scope.hits += 1;
                            }

                            $scope.data[i] = {
                                info: querySrv.list[id],
                                time_series: time_series,
                                hits: hits
                            };
                        }
                    }

                    if ($scope.panel.mode !== 'values' || $scope.panel.mode !== 'value') {
                        $scope.data[i] = {
                            info: querySrv.list[id],
                            time_series: time_series,
                            hits: hits
                        };
                    }

                    i++;
                });

                // Tell the histogram directive to render.
                $scope.$emit('render');
                // }
            });
        }
    }
    };

    // function $scope.zoom
    // factor :: Zoom factor, so 0.5 = cuts timespan in half, 2 doubles timespan
    $scope.zoom = function(factor) {
      var _range = filterSrv.timeRange('min');
      var _timespan = (_range.to.valueOf() - _range.from.valueOf());
      var _center = _range.to.valueOf() - _timespan/2;

      var _to = (_center + (_timespan*factor)/2);
      var _from = (_center - (_timespan*factor)/2);

      // If we're not already looking into the future, don't.
      if(_to > Date.now() && _range.to < Date.now()) {
        var _offset = _to - Date.now();
        _from = _from - _offset;
        _to = Date.now();
      }

      var time_field = filterSrv.getTimeField();
      if(factor > 1) {
        filterSrv.removeByType('time');
      }

      filterSrv.set({
        type:'time',
        from:moment.utc(_from).toDate(),
        to:moment.utc(_to).toDate(),
        field:time_field
      });

      dashboard.refresh();
    };

    // I really don't like this function, too much dom manip. Break out into directive?
    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.render = function() {
      $scope.$emit('render');
    };

  });

   module.directive('histogramChart', function(dashboard, filterSrv) {
    return {
      restrict: 'A',
      template: '<div></div>',
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
          // IE doesn't work without this
          elem.css({height:scope.panel.height || scope.row.height});
		
          // Populate from the query service
		   var num_all = 0;
		  
		   _.each(scope.data, function(seri) {
					num_all += seri.hits;
					});
          try {
			  var label_i = 0;
            _.each(scope.data, function(series) {
				series.color = series.info.color;
				label_i ++;
				//series.color = '%';
			  var mid = parseFloat((100*series.hits/num_all).toFixed(2));
			  series.hits = mid;
			  if(label_i === 2){
				  series.info.alias = "Warning% ";
			  }else if(label_i === 3){
				  series.info.alias = "Normal% ";
			  }else if(label_i === 1){
			  series.info.alias = "Risk% ";}
              series.label = series.info.alias;
				
            });
          } catch(e) {return;}

          // Set barwidth based on specified interval
          var barwidth = kbn.interval_to_ms(scope.panel.interval);

          var stack = scope.panel.stack ? true : null;
			
			var xLabel = "";
			var xunit =' ';
			
			if(scope.panel.value_field === 'cpu'){
				xunit ='%';
			}else if(scope.panel.value_field === 'UsedMemery'){
				xunit ='MB';
			}else if(scope.panel.value_field === 'FreeDiskSpace'){
				xunit ='GB';
			}
		   if(scope.panel.mode === 'value'||scope.panel.mode === 'counts'){
			   if (scope.panel.segment === 5){
			   xLabel = "Threshold:"+' '+scope.panel.threshold_first+' and '+scope.panel.threshold_second+' and '+scope.panel.threshold_third; 
			   }else if(scope.panel.segment === 3 ||scope.panel.segment === 4){
				xLabel = "Warning:>="+' '+scope.panel.threshold_first+xunit+' and <'+scope.panel.threshold_second+xunit+';'+'Risk:>='+scope.panel.threshold_second+xunit; 
				if(scope.panel.reverse){
					xLabel = "Warning:>"+' '+scope.panel.threshold_first+xunit+' and <='+scope.panel.threshold_second+xunit+';'+'Risk:<='+scope.panel.threshold_first+xunit; 
				   }
			   }else if(scope.panel.segment === 2){
				xLabel = "Threshold:"+scope.panel.threshold_first; 
			   }
		   }
          // Populate element
          try {
            var options = {
              legend: { show: false },
              series: {
                stackpercent: scope.panel.stack ? scope.panel.percentage : false,
                stack: scope.panel.percentage ? null : stack,
                lines:  {
                  show: scope.panel.lines,
                  // Silly, but fixes bug in stacked percentages
                  fill: scope.panel.fill === 0 ? 0.001 : scope.panel.fill/10,
                  lineWidth: scope.panel.linewidth,
                  steps: false
                },
                bars:   {
                  show: scope.panel.bars,
                  fill: 1,
                  barWidth: barwidth/1.8,
                  zero: false,
                  lineWidth: 0
                },
                points: {
                  show: scope.panel.points,
                  fill: 1,
                  fillColor: false,
                  radius: 5
                },
                shadowSize: 1
              },
               axisLabels: {
                show: true
              },
              yaxis: {
                show: scope.panel['y-axis'],
				min:0,
				 
                //min: null, // TODO - make this adjusted dynamicmally, and add it to configuration panel
                //max: scope.panel.percentage && scope.panel.stack ? 100 : null,
                axisLabel: scope.panel.mode,
              },
              xaxis: {
                timezone: scope.panel.timezone,
                show: 1,
                mode: "time",
				
                //min: _.isUndefined(scope.range.from) ? null : scope.range.from.getTime(),
                //max: _.isUndefined(scope.range.to) ? null : scope.range.to.getTime(),
                timeformat: time_format(scope.panel.interval),
                label: "Datetime",
                axisLabel: scope.panel['x-axis']?xLabel:'',
              },
              grid: {
                backgroundColor: null,
                borderWidth: 0,
                hoverable: true,
                color: '#c8c8c8'
              }
            };

            if(scope.panel.interactive) {
              options.selection = { mode: "x", color: '#666' };
            }

            // when rendering stacked bars, we need to ensure each point that has data is zero-filled
            // so that the stacking happens in the proper order
            var required_times = [];
            if (scope.data.length > 1) {
              required_times = Array.prototype.concat.apply([], _.map(scope.data, function (query) {
                return query.time_series.getOrderedTimes();
              }));
              required_times = _.uniq(required_times.sort(function (a, b) {
                // decending numeric sort
                return a-b;
              }), true);
            }

            for (var i = 0; i < scope.data.length; i++) {
              scope.data[i].data = scope.data[i].time_series.getFlotPairs(required_times);
            }

            // ISSUE: SOL-76
            // If 'lines_smooth' is enabled, loop through $scope.data[] and remove zero filled entries.
            // Without zero values, the line chart will appear smooth as SiLK ;-)
            if (scope.panel.lines_smooth) {
              for (var i=0; i < scope.data.length; i++) { // jshint ignore: line
                var new_data = [];
                for (var j=0; j < scope.data[i].data.length; j++) {
                  // if value of the timestamp !== 0, then add it to new_data
                  if (scope.data[i].data[j][1] !== 0) {
                    new_data.push(scope.data[i].data[j]);
                  }
                }
                scope.data[i].data = new_data;
              }
            }

            scope.plot = $.plot(elem, scope.data, options);
          } catch(e) {
            // TODO: Need to fix bug => "Invalid dimensions for plot, width = 0, height = 200"
            // console.log(e);
          }
        }

        function time_format(interval) {
          var _int = kbn.interval_to_seconds(interval);
          if(_int >= 2628000) {
            return "%m/%y";
          }
          if(_int >= 86400) {
            return "%m/%d/%y";
          }
          if(_int >= 60) {
            return "%H:%M<br>%m/%d";
          }

          return "%H:%M:%S";
        }

        var $tooltip = $('<div>');
		/*
        elem.bind("plothover", function (event, pos, item) {
          var group, value;
		  var allSeries = scope.plot.getData();
          if (item) {
			  
            if (item.series.info.alias.substring(0,item.series.info.alias.length-2) || scope.panel.tooltip.query_as_alias) {
              group = '<small style="font-size:0.9em;">' +
                '<i class="icon-circle" style="color:'+item.series.color+';"></i>' + ' ' +
                (item.series.info.alias.substring(0,item.series.info.alias.length-2) || item.series.info.query)+
              '</small><br>';
            } else {
              group = kbn.query_color_dot(item.series.color, 15) + ' ';
            }
            if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual')  {
              value = item.datapoint[1] - item.datapoint[2];
            } else {
              value = item.datapoint[1];
            }
            $tooltip
              .html(
                group + dashboard.numberWithCommas(value) + " @ " + (scope.panel.timezone === 'utc'? moment.utc(item.datapoint[0]).format('MM/DD HH:mm:ss') : moment(item.datapoint[0]).format('MM/DD HH:mm:ss'))
                // group + dashboard.numberWithCommas(value) + " @ " + moment(item.datapoint[0]).format('MM/DD HH:mm:ss')
                // group + dashboard.numberWithCommas(value) + " @ " + moment(item.datapoint[0])
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.detach();
          }
        });
		*/
		
		  elem.bind("plothover", function (event, pos, item) {
          var group, value;
          if (item) {
            if (item.series.info.alias.substring(0,item.series.info.alias.length-2) || scope.panel.tooltip.query_as_alias) {
              group = '<small style="font-size:0.9em;">' +
                '<i class="icon-circle" style="color:'+item.series.color+';"></i>' + ' ' +
                (item.series.info.alias.substring(0,item.series.info.alias.length-2) || item.series.info.query)+
              '</small><br>';
            } else {
              group = kbn.query_color_dot(item.series.color, 15) + ' ';
            }
            if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual')  {
              value = item.datapoint[1] - item.datapoint[2];
            } else {
              value = item.datapoint[1];
            }

            var lnLastValue = value;
			var isr =0;
			var isnormal = 3;
			
            var lbPositiveValue = (lnLastValue>0);
			
			var lsItemTT="";
			var lsTT="";
			var isgroup = group;
			var isvalue = value;
			if(scope.panel.mode !== 'value' || lnLastValue !==0){
            lsItemTT = group + dashboard.numberWithCommas(value) + " @ " + (scope.panel.timezone === 'utc'? moment.utc(item.datapoint[0]).format('MM/DD HH:mm:ss') : moment(item.datapoint[0]).format('MM/DD HH:mm:ss'));
			 lsTT = lsItemTT;
			 isr =1;
			}else{
				isnormal--;
			}
			
            var hoverSeries = item.series;
            var x = item.datapoint[0];
                // y = item.datapoint[1];

           
            var allSeries = scope.plot.getData();
            var posSerie = -1;
            for (var i= allSeries.length - 1 ; i>=0; i--) {

              //if stack stop at the first positive value
              if (scope.panel.stack && lbPositiveValue){
                break;
              }

              var s = allSeries[i];
              i = parseInt(i);


              if (s === hoverSeries ) {
                posSerie = i;
              }

              //not consider serie "upper" the hover serie
              if (  i >= posSerie ){
                continue;
              }

              //search in current serie a point with de same position.
              for(var j= 0; j< s.data.length;j++){
                var p = s.data[j];
                if (p[0] === x ){

                  if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual' && !isNaN(p[2]))  {
                    value = p[1] - p[2];
                  } else {
                    value = p[1];
                  }

                  lbPositiveValue = value > 0;

                  if (! scope.panel.stack && value !== lnLastValue){
                    break;
                  }

                  posSerie = i;
                  lnLastValue = value;


                  if (s.info.alias.substring(0,s.info.alias.length-2) || scope.panel.tooltip.query_as_alias) {
                    group = '<small style="font-size:0.9em;">' +
                        '<i class="icon-circle" style="color:'+s.color+';"></i>' + ' ' +
                        (s.info.alias.substring(0,s.info.alias.length-2) || s.info.query)+
                        '</small><br>';
                  } else {
                    group = kbn.query_color_dot(s.color, 15) + ' ';
                  }
					
				if(scope.panel.mode !== 'value' || lnLastValue !==0){
					
                  lsItemTT = group + dashboard.numberWithCommas(value) + " @ " + (scope.panel.timezone === 'utc'? moment.utc(p[0]).format('MM/DD HH:mm:ss') : moment(p[0]).format('MM/DD HH:mm:ss'));
                  lsTT = lsTT +"</br>"+ lsItemTT;
				  isr=1;
				  }else{
						isnormal--;
						}
                  break;
                }
              }
            }

			
			if(!isnormal){
				lsItemTT = isgroup + dashboard.numberWithCommas(isvalue) + " @ " + (scope.panel.timezone === 'utc'? moment.utc(item.datapoint[0]).format('MM/DD HH:mm:ss') : moment(item.datapoint[0]).format('MM/DD HH:mm:ss'));
				lsTT = lsItemTT;
				isr=1;
			}
			if(isr){
            $tooltip
              .html( lsTT )
              .place_tt(pos.pageX, pos.pageY);
			  }
          } else {
            $tooltip.detach();
          }
        });
        elem.bind("plotselected", function (event, ranges) {

            filterSrv.set({
                type: 'time',
                // from  : moment.utc(ranges.xaxis.from),
                // to    : moment.utc(ranges.xaxis.to),
                from: moment.utc(ranges.xaxis.from).toDate(),
                to: moment.utc(ranges.xaxis.to).toDate(),
                field: filterSrv.getTimeField()
            });
            dashboard.current.linkage_id = scope.panel.linkage_id;
            dashboard.current.enable_linkage =false;
            dashboard.refresh();

        });
      }
    };
  });

});
