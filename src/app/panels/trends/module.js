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
    'kbn'
  ],
  function(angular, app, _, kbn) {
    'use strict';

    var module = angular.module('kibana.panels.trends', []);
    app.useModule(module);

    var DEBUG = true;

    module.controller('trends', function($scope, kbnIndex, querySrv, dashboard, filterSrv) {

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
        arrangement: 'vertical',
        spyable: true
      };
      _.defaults($scope.panel, _d);

      $scope.init = function() {
        $scope.hits = 0;

        $scope.$on('refresh', function() {
          $scope.get_data();
        });

        $scope.get_data();
      };

      $scope.get_data = function(segment, query_id) {
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
        $scope.old_time = {
          from: new Date($scope.time.from.getTime() - kbn.interval_to_ms($scope.panel.ago)),
          to: new Date($scope.time.to.getTime() - kbn.interval_to_ms($scope.panel.ago))
        };

        var _segment = _.isUndefined(segment) ? 0 : segment;
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
        if (DEBUG) {
          console.log('Elastic Search Request');
          console.log(request.toString());
        }
        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

        // If we're on the first segment we need to get our indices
        // if (_segment === 0) {
        //   kbnIndex.indices(
        //     $scope.old_time.from,
        //     $scope.old_time.to,
        //     dashboard.current.index.pattern,
        //     dashboard.current.index.interval
        //   ).then(function(p) {
        //     $scope.index = _.union(p, $scope.index);
        //     request = request.indices($scope.index[_segment]);
        //     process_results(request.doSearch(), _segment, query_id);
        //   });
        // } else {
        //   process_results(request.indices($scope.index[_segment]).doSearch(), _segment, query_id);
        // }

        // Build SOLR query
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
          '&facet.range.other=between';

        // time ago
        var facet_second_gap = '%2B' + diffDays($scope.old_time.from, $scope.old_time.to) + 'DAY';
        var facet_second_range = '&facet=true' +
          '&facet.range=' + time_field +
          '&facet.range.start=' + $scope.old_time.from.toISOString() +
          '&facet.range.end=' + $scope.old_time.to.toISOString() +
          '&facet.range.gap=' + facet_second_gap +
          '&facet.range.other=between';

        var first_request = querySrv.getQuery(0) + wt_json + rows_limit + facet_first_range;
        var second_request = querySrv.getQuery(0) + wt_json + rows_limit + facet_second_range;
        $scope.panel.queries.query = first_request + "\n" + second_request;

        request = request.setQuery(first_request);
        var results_new = request.doSearch();

        results_new.then(function(results_new) {
          // Second Query
          request = request.setQuery(second_request);
          var results_old = request.doSearch();

          results_old.then(function(results_old) {
            if (DEBUG) {
              console.log('new time')
              console.log($scope.time.from, $scope.time.to)
              console.log('old time')
              console.log($scope.old_time.from, $scope.old_time.to)
              console.log(results_new)
              console.log(results_old)
            }
            processSolrResults(results_new, results_old);
            $scope.$emit('render');
          });
        });

      };

      // Populate scope when we have results
      var process_results = function(results, _segment, query_id) {
        results.then(function(results) {
          $scope.panelMeta.loading = false;
          if (_segment === 0) {
            $scope.hits = {};
            $scope.data = [];
            query_id = $scope.query_id = new Date().getTime();
          }

          // Check for error and abort if found
          if (!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error.msg);
            return;
          }

          // Convert facet ids to numbers
          var facetIds = _.map(_.keys(results.facets), function(k) {
            if (!isNaN(k)) {
              return parseInt(k, 10);
            }
          });

          // Make sure we're still on the same query/queries
          if ($scope.query_id === query_id &&
            _.intersection(facetIds, $scope.panel.queries.ids).length === $scope.panel.queries.ids.length
          ) {
            var i = 0;
            _.each($scope.panel.queries.ids, function(id) {
              var n = results.facets[id].count;
              var o = results.facets['old_' + id].count;

              var hits = {
                new: _.isUndefined($scope.data[i]) || _segment === 0 ? n : $scope.data[i].hits.new + n,
                old: _.isUndefined($scope.data[i]) || _segment === 0 ? o : $scope.data[i].hits.old + o
              };

              $scope.hits.new += n;
              $scope.hits.old += o;

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

              i++;
            });
            $scope.$emit('render');
            if (_segment < $scope.index.length - 1) {
              $scope.get_data(_segment + 1, query_id);
            } else {
              $scope.trends = $scope.data;
            }
          }
        });
      };


      function processSolrResults(results_new, results_old) {
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
        $scope.data = [];

        var hits = {
          new: results_new.facet_counts.facet_ranges[filterSrv.getTimeField()]['between'],
          old: results_old.facet_counts.facet_ranges[filterSrv.getTimeField()]['between']
        }
        $scope.hits = hits;

        var percent = percentage(hits.old, hits.new) == null ?
          '?' : Math.round(percentage(hits.old, hits.new) * 100) / 100;
        // Create series
        $scope.data[0] = {
          info: querySrv.list[0],
          hits: {
            new: hits.new,
            old: hits.old
          },
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

      $scope.close_edit = function() {
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

    });
  });