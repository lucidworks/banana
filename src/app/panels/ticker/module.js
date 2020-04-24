/*

  ## Trends

  ### Parameters
  * style :: A hash of css styles
  * arrangement :: How should I arrange the query results? 'horizontal' or 'vertical'
  * ago :: Date math formatted time to look back
*/
define([
    'angular',
    'app',
    'underscore',
    'kbn',
    'moment'
  ],
  function(angular, app, _, kbn, moment) {
    'use strict';

    var module = angular.module('kibana.panels.ticker', []);
    app.useModule(module);

    module.controller('ticker', function($scope, $q, kbnIndex, querySrv, dashboard, filterSrv) {

      $scope.panelMeta = {
        modals: [{
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }],
        editorTabs: [{
          title: 'Queries',
          src: 'app/partials/querySelect.html'
        }],
        status: "Beta",
        description: "A stock-ticker style representation of how queries are moving over time. " +
          "For example, if the time is 1:10pm, your time picker was set to \"Last 10m\", and the \"Time " +
          "Ago\" parameter was set to '1h', the panel would show how much the query results have changed" +
          " since 12:00-12:10pm"
      };

      // Constants for selecting trend interval
      var DAY_TO_DAY = 'Day to Day';
      var WEEK_TO_WEEK = 'Week to Week';
      var MONTH_TO_MONTH = 'Month to Month';
      var YEAR_TO_YEAR = 'Year to Year';

      // Set and populate defaults
      var _d = {
        queries: {
          mode: 'all',
          ids: []
        },
        style: {
          "font-size": '14pt'
        },
        ago: '1d',
        ignore_time_picker: false, // If true, ignore the time picker and display data based on the selected trend_interval instead.
        trend_interval: DAY_TO_DAY,
        trend_interval_options: [DAY_TO_DAY, WEEK_TO_WEEK, MONTH_TO_MONTH, YEAR_TO_YEAR],
        arrangement: 'vertical',
        spyable: true,
        show_queries: true,
      };
      _.defaults($scope.panel, _d);

      $scope.init = function() {
        $scope.hits = 0;

        $scope.$on('refresh', function() {
          $scope.get_data();
        });

        $scope.get_data();
      };

      $scope.get_data = function(segment) {
        delete $scope.panel.error;
        $scope.panelMeta.loading = true;

        // Make sure we have everything for the request to complete
        if (dashboard.indices.length === 0) {
          return;
        } else {
          $scope.index = segment > 0 ? $scope.index : dashboard.indices;
        }

        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

        // Determine a time field
        var timeField = _.uniq(_.pluck(filterSrv.getByType('time'), 'field'));
        if (timeField.length > 1) {
          $scope.panel.error = "Time field must be consistent amongst time filters";
          return;
        } else if (timeField.length === 0) {
          $scope.panel.error = "A time filter must exist for this panel to function";
          return;
        } else {
          timeField = timeField[0];
        }

        $scope.time = filterSrv.timeRange('min');

        // If ignore_time_picker is enabled, we'll process the data differently and skip the rest of this code block.
        if ($scope.panel.ignore_time_picker) {
          getTrendData($scope.panel.trend_interval).then(function(trendData) {
            plotTrendData(trendData);
            $scope.panelMeta.loading = false;
          }, function(error) {
            console.error('Error getting trend data.', error);
          });

          return;
        }

        $scope.old_time = {
          from: new Date($scope.time.from.getTime() - kbn.interval_to_ms($scope.panel.ago)),
          to: new Date($scope.time.to.getTime() - kbn.interval_to_ms($scope.panel.ago))
        };

        var request = $scope.sjs.Request().indices(dashboard.indices);
        var _ids_without_time = _.difference(filterSrv.ids, filterSrv.idsByType('time'));

        // Build the question part of the query
        _.each($scope.panel.queries.ids, function(id) {
          var q = $scope.sjs.FilteredQuery(
            querySrv.getEjsObj(id),
            filterSrv.getBoolFilter(_ids_without_time).must(
              $scope.sjs.RangeFilter(timeField)
              .from($scope.time.from)
              .to($scope.time.to)
            ));

          request = request
            .facet($scope.sjs.QueryFacet(id)
              .query(q)
          ).size(0);
        });

        // And again for the old time period
        _.each($scope.panel.queries.ids, function(id) {
          var q = $scope.sjs.FilteredQuery(
            querySrv.getEjsObj(id),
            filterSrv.getBoolFilter(_ids_without_time).must(
              $scope.sjs.RangeFilter(timeField)
              .from($scope.old_time.from)
              .to($scope.old_time.to)
            ));
          request = request
            .facet($scope.sjs.QueryFacet("old_" + id)
              .query(q)
          ).size(0);
        });

        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

        // Build SOLR query
        var fq = '';
        if (filterSrv.getSolrFq(true)) {
          fq = '&' + filterSrv.getSolrFq(true);
        }
        var time_field = filterSrv.getTimeField();
        var wt_json = '&wt=json';
        var rows_limit = '&rows=0'; // for trends, we do not need the actual response doc, so set rows=0

        // current time
        // make the gap equal to the difference between the start and end date
        // this will help in reducing response size
        var facet_first_gap = '%2B' + diffDays($scope.time.from, $scope.time.to) + 'DAY';
        var facet_first_range = '&facet=true' +
          '&facet.range=' + time_field +
          '&facet.range.start=' + $scope.time.from.toISOString() +
          '&facet.range.end=' + $scope.time.to.toISOString() +
          '&facet.range.gap=' + facet_first_gap +
          '&facet.range.hardend=true' +
          '&facet.range.other=between';

        // time ago
        var facet_second_gap = '%2B' + diffDays($scope.old_time.from, $scope.old_time.to) + 'DAY';
        var facet_second_range = '&facet=true' +
          '&facet.range=' + time_field +
          '&facet.range.start=' + $scope.old_time.from.toISOString() +
          '&facet.range.end=' + $scope.old_time.to.toISOString() +
          '&facet.range.gap=' + facet_second_gap +
          '&facet.range.hardend=true' +
          '&facet.range.other=between';

        var mypromises = [];
        $scope.panel.queries.query = "";
        _.each($scope.panel.queries.ids, function(id) {
          var first_request = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet_first_range;
          var second_request = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet_second_range;
          var request_new;
          if ($scope.panel.queries.custom != null) {
            request_new = request.setQuery(first_request + $scope.panel.queries.custom);
          } else {
            request_new = request.setQuery(first_request);
          }
          $scope.panel.queries.query += first_request + "\n\n" ;
          mypromises.push(request_new.doSearch());
          var request_old;
          if ($scope.panel.queries.custom != null) {
            request_old = request.setQuery(second_request + $scope.panel.queries.custom);
          } else {
            request_old = request.setQuery(second_request);
          }
          $scope.panel.queries.query += second_request + "\n";
          mypromises.push(request_old.doSearch());
          $scope.panel.queries.query += "-----------\n" ;
        });

        $scope.data = [];
        if (dashboard.current.services.query.ids.length >= 1) {
          $q.all(mypromises).then(function(results) {
            _.each($scope.panel.queries.ids, function(id, index) {
              // Check for error and abort if found
              if (!(_.isUndefined(results[index].error))) {
                $scope.panel.error = $scope.parse_error(results[index].error.msg);
                return;
              }
              processSolrResults(results[index * 2], results[index * 2 + 1], id,index);
            });
          });
        }
      };

      function processSolrResults(results_new, results_old, id,i) {
        $scope.panelMeta.loading = false;

        // Check for error and abort if found
        if (!(_.isUndefined(results_new.error))) {
          $scope.panel.error = results_new.error.msg;
          return;
        }

        if (!(_.isUndefined(results_old.error))) {
          $scope.panel.error = results_old.error.msg;
          return;
        }

        $scope.hits = {};

        var hits = {
          new: results_new.facet_counts.facet_ranges[filterSrv.getTimeField()]['between'],
          old: results_old.facet_counts.facet_ranges[filterSrv.getTimeField()]['between']
        };
        $scope.hits = hits;

        var percent = percentage(hits.old, hits.new) == null ?
          '?' : Math.round(percentage(hits.old, hits.new) * 100) / 100;
        // Create series
        $scope.data[i] = {
          info: querySrv.list[id],
          hits: {
            new: hits.new,
            old: hits.old
          },
          percent: percent
        };
        $scope.trends = $scope.data;
      }

      function getTrendData(interval) {
        if (!interval) return;

        var startDate, gap;
        switch (interval) {
          case DAY_TO_DAY:
            startDate = moment().subtract(2, 'days');
            gap = encodeURIComponent('+1DAY');
            break;
          case WEEK_TO_WEEK:
            startDate = moment().subtract(2, 'weeks');
            gap = encodeURIComponent('+7DAYS');
            break;
          case MONTH_TO_MONTH:
            startDate = moment().subtract(2, 'months');
            gap = encodeURIComponent('+1MONTH');
            break;
          case YEAR_TO_YEAR:
            startDate = moment().subtract(2, 'years');
            gap = encodeURIComponent('+1YEAR');
            break;
          default:
            // DAY_TO_DAY
            startDate = moment().subtract(2, 'days');
            gap = encodeURIComponent('+1DAY');
        }

        // Compose Solr query
        var request = $scope.sjs.Request().indices(dashboard.indices);

        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

        // Build SOLR query
        var fq = '';
        if (filterSrv.getSolrFq(true)) {
          fq = '&' + filterSrv.getSolrFq(true);
        }
        var time_field = filterSrv.getTimeField();
        var wt_json = '&wt=json';
        var rows_limit = '&rows=0'; // for trends, we do not need the actual response doc, so set rows=0
        var facet_range = '&facet=true' +
          '&facet.range=' + time_field +
          '&facet.range.start=' + startDate.toISOString() +
          '&facet.range.end=' + new Date().toISOString() +
          '&facet.range.gap=' + gap +
          '&facet.range.hardend=true';
        var id = 0; // This only works for the first query, if there are multiple queries in the dashboard.
        var solrQuery = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet_range;

        if ($scope.panel.queries.custom != null) {
          request = request.setQuery(solrQuery + $scope.panel.queries.custom);
        } else {
          request = request.setQuery(solrQuery);
        }

        $scope.panel.queries.query = solrQuery;
        return request.doSearch();
      }

      function plotTrendData(solrResp) {
        var counts = solrResp.facet_counts.facet_ranges[filterSrv.getTimeField()].counts;

        if (!counts || counts.length < 4) {
          console.error('Cannot plot the trend data: Wrong data format.');
          return;
        }

        var oldHits = counts[1]; // counts[0] is the start datetime of the first range
        var newHits = counts[3]; // counts[2] is the start datetime of the second range
        var percent = oldHits === 0 ?
          newHits * 100 : Math.round((newHits - oldHits) / oldHits * 100);
        $scope.trends = [
          {
            info: querySrv.list[0],
            hits: {
              old: oldHits,
              new: newHits
            },
            percent: percent
          }
        ];
      }

      function diffDays(date1, date2) {
        // calculate the number of days between two dates
        var oneDay = 24 * 60 * 60 * 1000;
        return (Math.round(Math.abs((date2.getTime() - date1.getTime()) / (oneDay))) + 1);
      }

      function percentage(x, y) {
        return x === 0 ? null : 100 * (y - x) / x;
      }

      $scope.set_refresh = function(state) {
        $scope.refresh = state;
      };

      $scope.close_edit = function() {
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

      $scope.isDayToDay = function(interval) {
        return interval === DAY_TO_DAY;
      };

      $scope.isWeekToWeek = function(interval) {
        return interval === WEEK_TO_WEEK;
      };

      $scope.isMonthToMonth = function(interval) {
        return interval === MONTH_TO_MONTH;
      };

      $scope.isYearToYear = function(interval) {
        return interval === YEAR_TO_YEAR;
      };
    });
  });
