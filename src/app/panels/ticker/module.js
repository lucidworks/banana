/*

  ## Trends

  ### Parameters
  * style :: A hash of css styles
  * arrangement :: How should I arrange the query results? 'horizontal' or 'vertical'
  * ago :: Date math formatted time to look back
  * ignore_time_picker :: Compare the last day, week, month or year with the one before it, not the time picker's range
  * trend_interval :: What to compare when ignore_time_picker is on
*/
define([
    'angular',
    'app',
    'underscore',
    'kbn',
    'moment',
    'config'
  ],
  function(angular, app, _, kbn, moment, config) {
    'use strict';

    var module = angular.module('kibana.panels.ticker', []);
    app.useModule(module);

    module.controller('ticker', function($scope,$q, kbnIndex, querySrv, dashboard, filterSrv) {

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
          " since 12:00-12:10pm. With \"Ignore Time Picker\" checked, the panel instead compares the last " +
          "day, week, month or year with the one before it, whatever the time picker says."
      };

      // What "Ignore Time Picker" can compare. Each is a number of Solr date math units: the panel asks
      // Solr for two ranges of that size that end now.
      var DAY_TO_DAY = 'Day to Day';
      var WEEK_TO_WEEK = 'Week to Week';
      var MONTH_TO_MONTH = 'Month to Month';
      var YEAR_TO_YEAR = 'Year to Year';
      $scope.trendIntervals = [DAY_TO_DAY, WEEK_TO_WEEK, MONTH_TO_MONTH, YEAR_TO_YEAR];

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
        ignore_time_picker: false, // when true, compare the last trend_interval with the one before it
        trend_interval: DAY_TO_DAY,
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

        // With "Ignore Time Picker" the time picker's range plays no part, and neither does a time filter:
        // the panel needs only a time field to ask Solr about, which the dashboard's settings provide.
        if ($scope.panel.ignore_time_picker) {
          getTrendData();
          return;
        }

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

        // var first_request = querySrv.getQuery(0) + wt_json + rows_limit + fq + facet_first_range;
        // var second_request = querySrv.getQuery(0) + wt_json + rows_limit + fq + facet_second_range;
        // $scope.panel.queries.query = first_request + "\n\n" + second_request;

        // request = request.setQuery(first_request);
        // var results_new = request.doSearch();

        // results_new.then(function(results_new) {
        //   // Second Query
        //   request = request.setQuery(second_request);
        //   var results_old = request.doSearch();

        //   results_old.then(function(results_old) {
        //     processSolrResults(results_new, results_old);
        //     $scope.$emit('render');
        //   });
        // });
        $scope.data = [];
        if (dashboard.current.services.query.ids.length >= 1) {
          $q.all(mypromises).then(function(results) {
            _.each($scope.panel.queries.ids, function(id, index) {
              // Check for error and abort if found
              if (!(_.isUndefined(results[index].error))) {
                $scope.panel.error = $scope.parse_error(results[index].error.msg);
                return;
              }
              processSolrResults(results[index * 2], results[index * 2 + 1], id, index, time_field);
            });
            // What the panel draws is this refresh's counts only: a query whose response had none is left out.
            $scope.trends = _.compact($scope.data);
          }, function (response) {
            $scope.panel.error = $scope.request_error(response);
            $scope.panelMeta.loading = false;
          });
        }

      };


      function processSolrResults(results_new, results_old, id, i, time_field) {
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

        // Read the field that was requested, not the dashboard's current one, which may have changed since.
        // A response without that field's counts leaves the panel without counts.
        var newCount = betweenCount(results_new, time_field);
        var oldCount = betweenCount(results_old, time_field);
        if (_.isUndefined(newCount) || _.isUndefined(oldCount)) {
          return;
        }
        var hits = {
          new: newCount,
          old: oldCount
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

      function betweenCount(results, field) {
        var ranges = results && results.facet_counts && results.facet_counts.facet_ranges;
        var range = ranges && ranges[field];
        return range ? range['between'] : undefined;
      }

      // The two ranges that "Ignore Time Picker" compares: [start, start + gap) and [start + gap, now].
      // Solr adds the gap itself, so the ranges do not depend on the browser's time zone or week start.
      function trendWindow(interval) {
        var now = moment();
        switch (interval) {
          case WEEK_TO_WEEK:
            return { start: now.clone().subtract(2, 'weeks'), end: now, gap: '+7DAYS' };
          case MONTH_TO_MONTH:
            return { start: now.clone().subtract(2, 'months'), end: now, gap: '+1MONTH' };
          case YEAR_TO_YEAR:
            return { start: now.clone().subtract(2, 'years'), end: now, gap: '+1YEAR' };
          default: // DAY_TO_DAY, and a panel whose saved interval is not one of the four
            return { start: now.clone().subtract(2, 'days'), end: now, gap: '+1DAY' };
        }
      }

      // The field the trend counts on: the dashboard's time filter field, or the configured time field when the
      // dashboard has no time filter (the panel does not need one with "Ignore Time Picker").
      function trendTimeField() {
        return filterSrv.getTimeField() || config.timefield;
      }

      function getTrendData() {
        var ids = $scope.panel.queries.ids;
        var range = trendWindow($scope.panel.trend_interval);
        var request = $scope.sjs.Request().indices(dashboard.indices);
        var time_field = trendTimeField();

        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

        // The time filter is left out on purpose: the range is the one chosen above.
        var fq = '';
        if (filterSrv.getSolrFq(true)) {
          fq = '&' + filterSrv.getSolrFq(true);
        }
        var wt_json = '&wt=json';
        var rows_limit = '&rows=0'; // only the counts are needed
        var facet_range = '&facet=true' +
          '&facet.range=' + time_field +
          '&facet.range.start=' + range.start.toISOString() +
          '&facet.range.end=' + range.end.toISOString() +
          '&facet.range.gap=' + encodeURIComponent(range.gap) +
          '&facet.range.hardend=true';

        var promises = [];
        $scope.panel.queries.query = '';
        _.each(ids, function(id) {
          var solrQuery = querySrv.getQuery(id) + wt_json + rows_limit + fq + facet_range;
          $scope.panel.queries.query += solrQuery + "\n\n";
          if ($scope.panel.queries.custom != null) {
            solrQuery += $scope.panel.queries.custom;
          }
          promises.push(request.setQuery(solrQuery).doSearch());
        });

        $scope.data = [];
        if (ids.length === 0) {
          $scope.panelMeta.loading = false;
          $scope.trends = $scope.data;
          return;
        }
        $q.all(promises).then(function(results) {
          $scope.panelMeta.loading = false;
          _.each(ids, function(id, index) {
            plotTrendData(results[index], id, index, time_field);
          });
          // As on the main path: draw this refresh's trends only, leaving out a query whose response had none.
          $scope.trends = _.compact($scope.data);
        }, function(response) {
          $scope.panel.error = $scope.request_error(response);
          $scope.panelMeta.loading = false;
        });
      }

      function plotTrendData(results, id, i, time_field) {
        if (!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error.msg);
          return;
        }

        var ranges = results.facet_counts && results.facet_counts.facet_ranges &&
          results.facet_counts.facet_ranges[time_field];
        // counts is [start of the first range, its count, start of the second range, its count, ...]
        var counts = ranges && ranges.counts;
        if (!counts || counts.length < 4) {
          $scope.panel.error = 'Cannot show the trend: Solr did not return two ranges.';
          return;
        }

        var hits = { old: counts[1], new: counts[3] };
        var percent = percentage(hits.old, hits.new) == null ?
          '?' : Math.round(percentage(hits.old, hits.new) * 100) / 100;
        $scope.data[i] = {
          info: querySrv.list[id],
          hits: hits,
          percent: percent
        };
        $scope.trends = $scope.data;
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

      $scope.comparing = function(interval) {
        switch (interval) {
          case WEEK_TO_WEEK: return 'Last week to this week';
          case MONTH_TO_MONTH: return 'Last month to this month';
          case YEAR_TO_YEAR: return 'Last year to this year';
          default: return 'Yesterday to today';
        }
      };

      $scope.close_edit = function() {
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

    });
  });
