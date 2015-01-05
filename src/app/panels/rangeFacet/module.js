/*

  ## RangeFacet

  ### Parameters
  * fill :: Only applies to line charts. Level of area shading from 0-10
  * linewidth ::  Only applies to line charts. How thick the line should be in pixels
                  While the editor only exposes 0-10, this can be any numeric value.
                  Set to 0 and you'll get something like a scatter plot
  * spyable ::  Dislay the 'eye' icon that show the last elasticsearch query
  * zoomlinks :: Show the zoom links?
  * bars :: Show bars in the chart
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

  var module = angular.module('kibana.panels.rangeFacet', []);
  app.useModule(module);

  module.controller('rangeFacet', function($scope, $q, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {
          title:'Queries',
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Beta",
      description : "Histogram view across any numeric field using Solr’s range.facet functionality. Works similar to the time series histogram, allowing selection of ranges, and zooming in/out to the desired numeric range. Range selections in panel are reflected across the entire dashboard."
    };

    // Set and populate defaults
    var _d = {
      mode        : 'count',
      time_field  : 'timestamp',
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      max_rows    : 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      value_field : null,
      group_field : null,
      fill        : 0,
      linewidth   : 3,
      auto_int    : true,
      resolution  : 100,
      interval    : '10',
      resolutions : [5,10,25,50,75,100],
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      stack       : true,
      points      : false,
      lines       : false,
      lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
      legend      : true,
      'x-axis'    : true,
      'y-axis'    : true,
      percentage  : false,
      interactive : true,
      options     : true,
      tooltip     : {
        value_type: 'cumulative',
        query_as_alias: false
      },
      showChart:true,
      show_queries:true,
    };

    _.defaults($scope.panel,_d);

    $scope.init = function() {
      // Hide view options by default
      $scope.options = false;
      $scope.$on('refresh',function(){
        $scope.get_data();
        if (filterSrv.idsByTypeAndField('range',$scope.panel.range_field).length > 0) {
          $scope.panel.showChart =  true;
        } else {
          $scope.panel.showChart =  false;
        }
      });

      $scope.get_data();

    };

    $scope.set_precision = function(precision) {
      $scope.panel.resolution = precision;
    };

    $scope.set_interval = function(interval) {
      if(interval !== 'auto') {
        $scope.panel.auto_int = false;
        $scope.panel.interval = interval;
      } else {
        $scope.panel.auto_int = true;
      }
    };

    $scope.interval_label = function(interval) {
      // return $scope.panel.auto_int && interval === $scope.panel.interval ? interval+" (auto)" : interval;
      return interval;
    };

    /**
     * The facet range effecting the panel
     * return type {from:number, to:number}
     */
    $scope.get_facet_range = function () {
      var range = $scope.facet_range = filterSrv.facetRange($scope.panel.range_field);
      return range;
    };

    /*
     * get interval to be used
     */
    $scope.get_interval = function () {
      var interval = $scope.panel.interval,
                      range;
      if ($scope.panel.auto_int) {
        range = $scope.get_facet_range();
        if (range) {
          interval = kbn.calculate_gap(range.from, range.to, $scope.panel.resolution, 0);
        }
      }
      $scope.panel.interval = interval || '10';
      return $scope.panel.interval;
    };

    $scope.set_range_filter = function(from,to){
      filterSrv.removeByTypeAndField('range',$scope.panel.range_field);
      filterSrv.set({
        type: 'range',
        from: parseInt(from),
        to: parseInt(to),
        field: $scope.panel.range_field
      });
      dashboard.refresh();
    };

    // set the configrations in settings 
    $scope.set_configrations = function(from,to){
      $scope.panel.minimum = parseInt(from);
      $scope.panel.maximum = parseInt(to);
    };

    //set the range filter from old configrations
    $scope.range_apply = function(){
      filterSrv.set({
        type: 'range',
        from: parseInt($scope.panel.minimum),
        to: parseInt($scope.panel.maximum),
        field: $scope.panel.range_field
      });
      dashboard.refresh();
    };
    
    /**
     * Fetch the data for a chunk of a queries results. Multiple segments occur when several indicies
     * need to be consulted (like timestamped logstash indicies)
     *
     * The results of this function are stored on the scope's data property. This property will be an
     * array of objects with the properties info, numeric_series, and hits. These objects are used in the
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
      if (_.isUndefined(segment)) {
        segment = 0;
      }
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      var _range = $scope.get_facet_range();

      if ($scope.panel.auto_int) {
        $scope.panel.interval = kbn.calculate_gap(_range.from, _range.to, $scope.panel.resolution, 0);
      }

      $scope.panelMeta.loading = true;

      // Solr
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      var request = $scope.sjs.Request().indices(dashboard.indices[segment]);
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      
      // Build the query
      _.each($scope.panel.queries.ids, function(id) {
        var query = $scope.sjs.FilteredQuery(
          querySrv.getEjsObj(id),
          filterSrv.getBoolFilter(filterSrv.ids)
        );

        var facet = $scope.sjs.DateHistogramFacet(id);

        if($scope.panel.mode === 'count') {
          facet = facet.field($scope.panel.time_field);
        } else {
          if(_.isNull($scope.panel.value_field)) {
            $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
            return;
          }
          facet = facet.keyField($scope.panel.time_field).valueField($scope.panel.value_field);
        }
        facet = facet.facetFilter($scope.sjs.QueryFilter(query));

        request = request.facet(facet).size(0);
      });

      // Populate the inspector panel
      $scope.populate_modal(request);

      // Build Solr query
      var fq = '';
      if (filterSrv.getSolrFq() && filterSrv.getSolrFq() != '') {
        fq = '&' + filterSrv.getSolrFq();
      }
      var wt_json = '&wt=json';
      var rows_limit = '&rows=0'; // for RangeFacet, we do not need the actual response doc, so set rows=0
      var facet = '&facet=true' +
                  '&facet.range=' + $scope.panel.range_field +
                  '&facet.range.start=' + $scope.panel.minimum +
                  '&facet.range.end=' + (parseInt($scope.panel.maximum)+1) +
                  '&facet.range.gap=' + $scope.panel.interval;

      var promises = [];
      $scope.panel.queries.query = "";

       _.each($scope.panel.queries.ids, function(id) {
        var temp_q =  querySrv.getQuery(id) + wt_json + rows_limit + fq + facet ;
        $scope.panel.queries.query += temp_q + "\n";
        if ($scope.panel.queries.custom !== null) {
          request = request.setQuery(temp_q + $scope.panel.queries.custom);
        } else {
          request = request.setQuery(temp_q);
        }
        promises.push(request.doSearch());
      });
      // Populate scope when we have results
      $q.all(promises).then(function(results) {
        var _range = $scope.get_facet_range();

        $scope.panelMeta.loading = false;
        if(segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        }

        // Convert facet ids to numbers
        // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
        // TODO: change this, Solr do faceting differently
        var facetIds = [0]; // Need to fix this

        // Make sure we're still on the same query/queries
        // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
        // if($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
          var i = 0,
            numeric_series,
            hits;

          _.each($scope.panel.queries.ids, function(id,index) {

            // Check for error and abort if found
            if (!(_.isUndefined(results[index].error))) {
              $scope.panel.error = $scope.parse_error(results[index].error.msg);
              return;
            }
            // we need to initialize the data variable on the first run,
            // and when we are working on the first segment of the data.
            if(_.isUndefined($scope.data[i]) || segment === 0) {
              numeric_series = new timeSeries.ZeroFilled({
                start_date: _range && _range.from,
                end_date: _range && _range.to,
                fill_style: 'minimal'
              });
              hits = 0;
            } else {
              numeric_series = $scope.data[i].numeric_series;
              // Bug fix for wrong event count:
              //   Solr don't need to accumulate hits count since it can get total count from facet query.
              //   Therefore, I need to set hits and $scope.hits to zero.
              // hits = $scope.data[i].hits;
              hits = 0;
              $scope.hits = 0;
            }
            $scope.range_count = 0;
            // Solr facet counts response is in one big array.
            // So no need to get each segment like Elasticsearch does.
            // Entries from facet_ranges counts
            var entries = results[index].facet_counts.facet_ranges[$scope.panel.range_field].counts;
            for (var j = 0; j < entries.length; j++) {
              var entry_time = entries[j]; // convert to millisec
              j++;
              var entry_count = entries[j];
              numeric_series.addValue(entry_time, entry_count);
              hits += entry_count; // The series level hits counter
              $scope.hits += entry_count; // Entire dataset level hits counter
              $scope.range_count += 1; // count the number of ranges to help later in bar width
            }

            $scope.data[i] = {
              info: querySrv.list[id],
              numeric_series: numeric_series,
              hits: hits
            };

            i++;
          });

          // Tell the RangeFacet directive to render.
          $scope.$emit('render');

          // Don't need this for Solr unless we need to support multiple queries.
          // If we still have segments left, get them
          // if(segment < dashboard.indices.length-1) {
          //   $scope.get_data(segment+1,query_id);
          // }
        // }
      });
    };

    // function $scope.zoom
    // factor :: Zoom factor, so 0.5 = cuts timespan in half, 2 doubles timespan
    $scope.zoom = function(factor) {
      var _range = filterSrv.facetRange($scope.panel.range_field)[1];
      if (_.isUndefined(_range)){
        _range = {
          from: $scope.panel.minimum,
          to: $scope.panel.maximum
        };
      }

      var _timespan = (_range.to.valueOf() - _range.from.valueOf());
      var _center = _range.to.valueOf() - _timespan/2;

      var _to = (_center + (_timespan*factor)/2);
      var _from = (_center - (_timespan*factor)/2);

      $scope.set_range_filter(_from, _to);
      $scope.set_configrations(_from, _to);
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
      $scope.set_range_filter($scope.panel.minimum,$scope.panel.maximum);
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.render = function() {
      $scope.$emit('render');
    };

  });

  module.directive('rangefacetChart', function(dashboard) {
    return {
      restrict: 'A',
      template: '<div></div>',
      link: function(scope, elem) {

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        scope.set_range_filter(scope.panel.minimum,scope.panel.maximum);
        // Re-render if the window is resized
        angular.element(window).bind('resize', function(){
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          // IE doesn't work without this
          elem.css({height:scope.panel.height || scope.row.height});

          // Populate from the query service
          try {
            _.each(scope.data, function(series) {
              series.label = series.info.alias;
              series.color = series.info.color;
            });
          } catch(e) {return;}

          // Set barwidth based on specified interval
          var barwidth = scope.panel.maximum - scope.panel.minimum;
          // var count = scope.range_count > 15 ? scope.range_count : 15;
          var stack = scope.panel.stack ? true : null;
          var facet_range = scope.get_facet_range();
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
                  barWidth: barwidth/(1.8*scope.range_count),
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
                min: 0,
                max: scope.panel.percentage && scope.panel.stack ? 100 : null,
                axisLabel: 'count'
              },
              xaxis: {
                show: scope.panel['x-axis'],
                min: facet_range.from - 1,
                max: facet_range.to + 1,
                autoscaleMargin : scope.panel.interval,
                minTickSize : scope.panel.interval,
                tickDecimals: 0,
                axisLabel: scope.panel.range_field
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
                return query.numeric_series.getOrderedTimes();
              }));
              required_times = _.uniq(required_times.sort(function (a, b) {
                // decending numeric sort
                return a-b;
              }), true);
            }

            for (var i = 0; i < scope.data.length; i++) {
              scope.data[i].data = scope.data[i].numeric_series.getFlotPairs(required_times);
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
            console.log(e);
          }
        }

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          var group, value;
          if (item) {
            if (item.series.info.alias || scope.panel.tooltip.query_as_alias) {
              group = '<small style="font-size:0.9em;">' +
                '<i class="icon-circle" style="color:'+item.series.color+';"></i>' + ' ' +
                (item.series.info.alias || item.series.info.query)+
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
                group + dashboard.numberWithCommas(value) + " [" + item.datapoint[0]+" - "+ (item.datapoint[0] + (scope.panel.interval-1)) +"]"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.detach();
          }
        });

        elem.bind("plotselected", function (event, ranges) {
          scope.set_range_filter(ranges.xaxis.from, ranges.xaxis.to);
          scope.set_configrations(ranges.xaxis.from, ranges.xaxis.to);
          dashboard.refresh();
        });
      }
    };
  });

});
