/*

  ## Timeseries

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

    var module = angular.module('kibana.panels.timeseries', []);
    app.useModule(module);

    module.controller('timeseries', function ($scope, $q, $timeout, timer, querySrv, dashboard, filterSrv) {
      $scope.panelMeta = {
        modals: [
          {
            description: "Inspect",
            icon: "icon-info-sign",
            partial: "app/partials/inspector.html",
            show: $scope.panel.spyable
          }
        ],
        editorTabs: [
          {
            title: 'Queries',
            src: 'app/partials/querySelect.html'
          }
        ],
        status: "Stable",
        description: "A bucketed time series chart of the current query, including all applied time and non-time filters. When <i>count</i> metric is used, counts are plotted and no field is required. When other metrics are used, corresponding aggregates of the specified field over time are plotted."
      };

      // Set and populate defaults
      var _d = {
        queries: {
          mode: 'all',
          ids: [],
          query: '*:*',
          custom: ''
        },
        max_rows: 100000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
        value_field: null,
        group_field: null,
        sum_value: false,
        auto_int: true,
        resolution: 100,
        interval: '5m',
        intervals: ['auto', '1s', '1m', '5m', '10m', '30m', '1h', '3h', '12h', '1d', '1w', '1M', '1y'],
        fill: 0,
        linewidth: 3,
        timezone: 'browser', // browser, utc or a standard timezone
        spyable: true,
        zoomlinks: true,
        bars: true,
        stack: true,
        points: false,
        lines: false,
        lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
        legend: true,
        'x-axis': true,
        'y-axis': true,
        percentage: false,
        interactive: true,
        options: true,
        show_queries: true,
        tooltip: {
          value_type: 'cumulative',
          query_as_alias: false
        },
        refresh: {
          enable: false,
          interval: 2
        }
      };

      _.defaults($scope.panel, _d);

      $scope.init = function () {
        // Hide view options by default
        $scope.options = false;

        // Start refresh timer if enabled
        if ($scope.panel.refresh.enable) {
          $scope.set_timer($scope.panel.refresh.interval);
        }

        $scope.$on('refresh', function () {
          $scope.get_data();
        });

        $scope.get_data();
      };

      $scope.set_interval = function (interval) {
        if (interval !== 'auto') {
          $scope.panel.auto_int = false;
          $scope.panel.interval = interval;
        } else {
          $scope.panel.auto_int = true;
        }
      };

      $scope.interval_label = function (interval) {
        return $scope.panel.auto_int && interval === $scope.panel.interval ? interval + " (auto)" : interval;
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

      $scope.metric_changed = function () {
        if ($scope.panel.metric === 'count')
          $scope.panel.field = '*';
      };

      $scope.build_expression = function (q) {
        var expression = 'expr=timeseries(' + dashboard.current.solr.core_name + ',' + q + ')';

        return expression;
      };

      /**
       * Fetches data for ORed queries using Solr timeseries streaming expressions
       *
       * @param {number} segment   The segment count, (0 based)
       * @param {number} query_id  The id of the query, generated on the first run and passed back when
       *                            this call is made recursively for more segments
       */
      $scope.get_data = function (segment, query_id) {
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

        // Populate the inspector panel
        $scope.populate_modal(request);

        // Build Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
          fq = ',' + filterSrv.getSolrFq(false, ',');
        }
        var time_field = filterSrv.getTimeField();
        var start_time = filterSrv.getStartTime();
        var end_time = filterSrv.getEndTime();

        // timeseries does NOT accept * as a value, need to convert it to NOW
        if (end_time === '*') {
          end_time = 'NOW';
        }

        if (!$scope.panel.metric) {
          $scope.panel.error = "A metric must be specified";
          return;
        }
        if (!$scope.panel.field) {
          $scope.panel.error = "A field must be specified";
          return;
        }

        var gap = $scope.sjs.convertFacetGap($scope.panel.interval);
        var timeseries_params = ',field=' + time_field +
          ',start=' + start_time +
          ',end=' + end_time +
          ',gap=' + gap;
        var timeseries_metric = ',' + $scope.panel.metric + '(' + $scope.panel.field + ')';

        var promises = [];
        _.each($scope.panel.queries.ids, function (id) {
          var temp_q = querySrv.getQuery(id) /* + fq // fq seems not supported by timeseries */
            + timeseries_params + timeseries_metric;
          temp_q = $scope.build_expression(temp_q);
          $scope.panel.queries.query += temp_q + "\n";
          if ($scope.panel.queries.custom !== null) {
            request = request.setQuery(temp_q + $scope.panel.queries.custom);
          } else {
            request = request.setQuery(temp_q);
          }
          promises.push(request.streamExpression());
        });

        if (dashboard.current.services.query.ids.length >= 1) {
          $q.all(promises).then(function (results) {
            $scope.panelMeta.loading = false;
            if (segment === 0) {
              $scope.hits = 0;
              $scope.data = [];
              query_id = $scope.query_id = new Date().getTime();
            }

            var i = 0,
              time_series,
              hits;

            _.each($scope.panel.queries.ids, function (id, index) {
              // Check for error and abort if found
              if (_.isArray(results[index]['result-set'].docs)
                  && !(_.isUndefined(results[index]['result-set'].docs[0].EXCEPTION))) {
                $scope.panel.error = results[index]['result-set'].docs[0].EXCEPTION;
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
                hits = 0;
                $scope.hits = 0;
              }

              // Solr timeseries counts response is in one big array.
              var entry_time, entries, entry_value;
              // Filter out EOF
              entries = results[index]['result-set'].docs;
              entries.pop();
              for (var j = 0; j < entries.length; j++) {
                entry_time = new Date(entries[j][time_field]).getTime(); // convert to millisec
                var entry_count = entries[j][$scope.panel.metric + '(' + $scope.panel.field + ')'];
                if (!entry_count)
                  entry_count = 0;
                time_series.addValue(entry_time, entry_count);
                hits += entry_count; // The series level hits counter
                $scope.hits += entry_count; // Entire dataset level hits counter
              }

              $scope.data[i] = {
                info: querySrv.list[id],
                time_series: time_series,
                hits: hits
              };

              i++;
            });

            // Tell the histogram directive to render.
            $scope.$emit('render');
          });
        }
      };

      // function $scope.zoom
      // factor :: Zoom factor, so 0.5 = cuts timespan in half, 2 doubles timespan
      $scope.zoom = function (factor) {
        var _range = filterSrv.timeRange('min');
        var _timespan = (_range.to.valueOf() - _range.from.valueOf());
        var _center = _range.to.valueOf() - _timespan / 2;

        var _to = (_center + (_timespan * factor) / 2);
        var _from = (_center - (_timespan * factor) / 2);

        // If we're not already looking into the future, don't.
        if (_to > Date.now() && _range.to < Date.now()) {
          var _offset = _to - Date.now();
          _from = _from - _offset;
          _to = Date.now();
        }

        var time_field = filterSrv.getTimeField();
        if (factor > 1) {
          filterSrv.removeByType('time');
        }

        filterSrv.set({
          type: 'time',
          from: moment.utc(_from).toDate(),
          to: moment.utc(_to).toDate(),
          field: time_field
        });

        dashboard.refresh();

      };

      // I really don't like this function, too much dom manip. Break out into directive?
      $scope.populate_modal = function (request) {
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
      };

      $scope.set_refresh = function (state) {
        $scope.refresh = state;
      };

      $scope.close_edit = function () {
        // Start refresh timer if enabled
        if ($scope.panel.refresh.enable) {
          $scope.set_timer($scope.panel.refresh.interval);
        }
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

      $scope.render = function () {
        $scope.$emit('render');
      };
    });

    module.directive('timeseriesChart', function (dashboard, filterSrv) {
      return {
        restrict: 'A',
        template: '<div></div>',
        link: function (scope, elem) {

          // Receive render events
          scope.$on('render', function () {
            render_panel();
          });

          // Re-render if the window is resized
          angular.element(window).bind('resize', function () {
            render_panel();
          });

          // Function for rendering panel
          function render_panel() {
            // IE doesn't work without this
            elem.css({height: scope.panel.height || scope.row.height});

            // Populate from the query service
            try {
              _.each(scope.data, function (series) {
                series.label = series.info.alias;
                series.color = series.info.color;
              });
            } catch (e) {
              return;
            }

            // Set barwidth based on specified interval
            var barwidth = kbn.interval_to_ms(scope.panel.interval);

            var stack = scope.panel.stack ? true : null;

            // Populate element
            try {
              var options = {
                legend: {show: false},
                series: {
                  stackpercent: scope.panel.stack ? scope.panel.percentage : false,
                  stack: scope.panel.percentage ? null : stack,
                  lines: {
                    show: scope.panel.lines,
                    // Silly, but fixes bug in stacked percentages
                    fill: scope.panel.fill === 0 ? 0.001 : scope.panel.fill / 10,
                    lineWidth: scope.panel.linewidth,
                    steps: false
                  },
                  bars: {
                    show: scope.panel.bars,
                    fill: 1,
                    barWidth: barwidth / 1.8,
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
                  min: null, // TODO - make this adjusted dynamicmally, and add it to configuration panel
                  max: scope.panel.percentage && scope.panel.stack ? 100 : null,
                  axisLabel: scope.panel.metric + '(' + scope.panel.field + ')',
                },
                xaxis: {
                  timezone: scope.panel.timezone,
                  show: scope.panel['x-axis'],
                  mode: "time",
                  min: _.isUndefined(scope.range.from) ? null : scope.range.from.getTime(),
                  max: _.isUndefined(scope.range.to) ? null : scope.range.to.getTime(),
                  timeformat: time_format(scope.panel.interval),
                  label: "Datetime",
                  axisLabel: filterSrv.getTimeField(),
                },
                grid: {
                  backgroundColor: null,
                  borderWidth: 0,
                  hoverable: true,
                  color: '#c8c8c8'
                }
              };

              if (scope.panel.interactive) {
                options.selection = {mode: "x", color: '#666'};
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
                  return a - b;
                }), true);
              }

              for (var i = 0; i < scope.data.length; i++) {
                scope.data[i].data = scope.data[i].time_series.getFlotPairs(required_times);
              }

              // ISSUE: SOL-76
              // If 'lines_smooth' is enabled, loop through $scope.data[] and remove zero filled entries.
              // Without zero values, the line chart will appear smooth as SiLK ;-)
              if (scope.panel.lines_smooth) {
                for (var i = 0; i < scope.data.length; i++) { // jshint ignore: line
                  var new_data = [];
                  for (var j = 0; j < scope.data[i].data.length; j++) {
                    // if value of the timestamp !== 0, then add it to new_data
                    if (scope.data[i].data[j][1] !== 0) {
                      new_data.push(scope.data[i].data[j]);
                    }
                  }
                  scope.data[i].data = new_data;
                }
              }

              scope.plot = $.plot(elem, scope.data, options);
            } catch (e) {
              // TODO: Need to fix bug => "Invalid dimensions for plot, width = 0, height = 200"
              console.log(e);
            }
          }

          function time_format(interval) {
            var _int = kbn.interval_to_seconds(interval);
            if (_int >= 2628000) {
              return "%m/%y";
            }
            if (_int >= 86400) {
              return "%m/%d/%y";
            }
            if (_int >= 60) {
              return "%H:%M<br>%m/%d";
            }

            return "%H:%M:%S";
          }

          var $tooltip = $('<div>');
          elem.bind("plothover", function (event, pos, item) {
            var group, value;
            if (item) {
              if (item.series.info.alias || scope.panel.tooltip.query_as_alias) {
                group = '<small style="font-size:0.9em;">' +
                  '<i class="icon-circle" style="color:' + item.series.color + ';"></i>' + ' ' +
                  (item.series.info.alias || item.series.info.query) +
                  '</small><br>';
              } else {
                group = kbn.query_color_dot(item.series.color, 15) + ' ';
              }
              if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual') {
                value = item.datapoint[1] - item.datapoint[2];
              } else {
                value = item.datapoint[1];
              }

              var lnLastValue = value;

              var lbPositiveValue = (lnLastValue > 0);

              var lsItemTT = group + dashboard.numberWithCommas(value) + " @ " + (scope.panel.timezone === 'utc' ? moment.utc(item.datapoint[0]).format('MM/DD HH:mm:ss') : moment(item.datapoint[0]).format('MM/DD HH:mm:ss'));

              var hoverSeries = item.series;
              var x = item.datapoint[0];
              // y = item.datapoint[1];

              var lsTT = lsItemTT;
              var allSeries = scope.plot.getData();
              var posSerie = -1;
              for (var i = allSeries.length - 1; i >= 0; i--) {

                //if stack stop at the first positive value
                if (scope.panel.stack && lbPositiveValue) {
                  break;
                }

                var s = allSeries[i];
                i = parseInt(i);


                if (s === hoverSeries) {
                  posSerie = i;
                }

                //not consider serie "upper" the hover serie
                if (i >= posSerie) {
                  continue;
                }

                //search in current serie a point with de same position.
                for (var j = 0; j < s.data.length; j++) {
                  var p = s.data[j];
                  if (p[0] === x) {

                    if (scope.panel.stack && scope.panel.tooltip.value_type === 'individual' && !isNaN(p[2])) {
                      value = p[1] - p[2];
                    } else {
                      value = p[1];
                    }

                    lbPositiveValue = value > 0;

                    if (!scope.panel.stack && value !== lnLastValue) {
                      break;
                    }

                    posSerie = i;
                    lnLastValue = value;


                    if (s.info.alias || scope.panel.tooltip.query_as_alias) {
                      group = '<small style="font-size:0.9em;">' +
                        '<i class="icon-circle" style="color:' + s.color + ';"></i>' + ' ' +
                        (s.info.alias || s.info.query) +
                        '</small><br>';
                    } else {
                      group = kbn.query_color_dot(s.color, 15) + ' ';
                    }

                    lsItemTT = group + dashboard.numberWithCommas(value) + " @ " + (scope.panel.timezone === 'utc' ? moment.utc(p[0]).format('MM/DD HH:mm:ss') : moment(p[0]).format('MM/DD HH:mm:ss'));
                    lsTT = lsTT + "</br>" + lsItemTT;
                    break;
                  }
                }
              }


              $tooltip
                .html(lsTT)
                .place_tt(pos.pageX, pos.pageY);
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
            dashboard.refresh();
          });
        }
      };
    });

  });
