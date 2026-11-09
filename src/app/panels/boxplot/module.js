/*
  ## Boxplot

  Draws one box plot per value of the first facet pivot field, from the values of the second (numeric) field.

  ### Parameters
  * facet_pivot_strings :: The two fields, as an array: the one that groups, then the numeric one
  * facet_limit :: Maximum number of rows Solr returns for each of them
  * unique_facet_values :: true: every distinct value counts once. false: a value counts as often as it occurs
  * labels :: Write the quartiles and whiskers next to each box
  * axes_labels :: Write the field names along the axes
*/
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'kbn',
    'd3'
  ],
  function (angular, app, _, $, kbn, d3) {
    'use strict';

    var module = angular.module('kibana.panels.boxplot', []);
    app.useModule(module);

    module.controller('boxplot', function ($scope, querySrv, dashboard, filterSrv) {
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
        status: "Experimental",
        description: "Display a box plot of a numeric field for each value of another field. Set the facet pivot " +
          "string to two fields separated by a comma: the field that makes the boxes, then the numeric field."
      };

      // default values
      var _d = {
        queries: {
          mode: 'all',
          ids: [],
          query: '*:*',
          custom: ''
        },
        facet_limit: 1000, // maximum number of rows returned from Solr
        labels: true,
        axes_labels: true,
        unique_facet_values: true,
        spyable: true,
        show_queries: true
      };

      _.defaults($scope.panel, _d);

      $scope.init = function () {
        $scope.$on('refresh', function () {
          $scope.get_data();
        });
        $scope.get_data();
      };

      // The value at position i (0-based) of the values in `points` when each is repeated as often as its
      // count says, without building that list. `points` is sorted by value.
      function valueAt(points, i) {
        var seen = 0;
        for (var p = 0; p < points.length; p++) {
          seen += points[p].count;
          if (i < seen) {
            return points[p].value;
          }
        }
        return points[points.length - 1].value;
      }

      // The p-quantile (0 to 1) with linear interpolation between the neighbouring values.
      function quantile(points, total, p) {
        var h = (total - 1) * p;
        var lower = Math.floor(h);
        var upper = Math.min(lower + 1, total - 1);
        var a = valueAt(points, lower);
        return a + (h - lower) * (valueAt(points, upper) - a);
      }

      /**
       * The numbers a box plot is drawn from.
       *
       * @param {Array} points - {value, count} objects sorted by value
       * @param {number} k - how many inter-quartile ranges past a quartile a whisker may reach (1.5 by default)
       * @return {Object} n, the quartiles (q1, median, q3), the ends of the whiskers (low, high), and the values
       *   beyond the whiskers (outliers)
       */
      $scope.box_stats = function (points, k) {
        k = _.isUndefined(k) ? 1.5 : k;
        var total = _.reduce(points, function (sum, p) { return sum + p.count; }, 0);
        var q1 = quantile(points, total, 0.25);
        var median = quantile(points, total, 0.5);
        var q3 = quantile(points, total, 0.75);
        var reach = (q3 - q1) * k;
        var inside = _.filter(points, function (p) {
          return p.value >= q1 - reach && p.value <= q3 + reach;
        });
        return {
          n: total,
          q1: q1,
          median: median,
          q3: q3,
          low: inside.length ? inside[0].value : q1,
          high: inside.length ? inside[inside.length - 1].value : q3,
          outliers: _.pluck(_.difference(points, inside), 'value')
        };
      };

      // Turns the facet pivot answer into one entry per box. Values that are not numbers are left out, and so
      // are boxes that have none.
      $scope.parse_facet_pivot = function (data, facetNames) {
        var nodes = [];
        var min = Infinity,
          max = -Infinity;

        _.each(data, function (facet) {
          var byValue = {};
          _.each(facet.pivot, function (facet2) {
            var value = Number(facet2.value);
            if (facet2.value === '' || facet2.value === null || isNaN(value)) {
              return;
            }
            var count = $scope.panel.unique_facet_values ? 1 : (parseInt(facet2.count, 10) || 0);
            if (count > 0) {
              byValue[value] = (byValue[value] || 0) + count;
            }
          });
          var points = _.sortBy(_.map(byValue, function (count, value) {
            return { value: Number(value), count: count };
          }), 'value');
          if (!points.length) {
            return;
          }
          min = Math.min(min, points[0].value);
          max = Math.max(max, points[points.length - 1].value);
          nodes.push({ name: "" + facet.value, points: points });
        });

        return {
          nodes: nodes,
          x: facetNames[0],
          y: facetNames[1],
          min: min,
          max: max
        };
      };

      $scope.get_data = function () {
        // Show progress by displaying a spinning wheel icon on panel
        $scope.panelMeta.loading = true;
        delete $scope.panel.error;

        var pivotFields = _.isArray($scope.panel.facet_pivot_strings) ? $scope.panel.facet_pivot_strings : [];
        pivotFields = _.map(pivotFields, function (f) { return ("" + f).replace(/ /g, ''); });
        if (pivotFields.length < 2) {
          $scope.panel.error = "Set the facet pivot string to two fields: the one that makes the boxes, then the numeric one.";
          $scope.panelMeta.loading = false;
          return;
        }
        pivotFields = pivotFields.slice(0, 2);

        var request, results;
        // Set Solr server
        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
        // This could probably be changed to a BoolFilter
        var boolQuery = $scope.sjs.BoolQuery();
        _.each($scope.panel.queries.ids, function (id) {
          boolQuery = boolQuery.should(querySrv.getEjsObj(id));
        });
        request = $scope.sjs.Request().indices(dashboard.indices);
        request = request.query(
          $scope.sjs.FilteredQuery(
            boolQuery,
            filterSrv.getBoolFilter(filterSrv.ids)
          ));
        $scope.populate_modal(request);

        // Construct Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
          fq = '&' + filterSrv.getSolrFq();
        }
        var wt_json = '&wt=json';
        var rows = '&rows=0';
        var facet = '&facet=true';
        var pivot = pivotFields.join();
        var facet_pivot = '&facet.pivot=' + pivot;
        var facet_limits = '&facet.limit=' + $scope.panel.facet_limit;
        $scope.panel.queries.query = querySrv.getOPQuery() + fq + wt_json + facet + facet_pivot + facet_limits + rows;
        // Set the additional custom query
        if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
        } else {
          request = request.setQuery($scope.panel.queries.query);
        }

        // Execute the search and get results
        results = request.doSearch();
        results.then(function (results) {
          var pivots = results.facet_counts && results.facet_counts.facet_pivot;
          $scope.data = $scope.parse_facet_pivot(pivots && pivots[pivot], pivotFields);
          $scope.render();
        }, function (response) {
          $scope.panel.error = $scope.request_error(response);
          $scope.panelMeta.loading = false;
        });
      };

      $scope.dash = dashboard;
      $scope.set_refresh = function (state) {
        $scope.refresh = state;
      };

      $scope.close_edit = function () {
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

      $scope.render = function () {
        $scope.$emit('render');
      };

      $scope.populate_modal = function (request) {
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
      };
    });

    module.directive('boxplotChart', function () {
      return {
        restrict: 'A',
        link: function (scope, element) {
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
            element.html("");
            scope.panelMeta.loading = false;
            if (!scope.data || !scope.data.nodes.length) {
              return;
            }

            var margin = {top: 30, right: 50, bottom: 90, left: 80};
            var width = Math.max(element.parent().width() - margin.left - margin.right, 50);
            var height = Math.max(parseInt(scope.row.height, 10) - margin.top - margin.bottom, 50);

            var lo = scope.data.min, hi = scope.data.max;
            if (lo === hi) {
              lo -= 1;
              hi += 1;
            }
            var x = d3.scale.ordinal()
              .domain(_.pluck(scope.data.nodes, 'name'))
              .rangeRoundBands([0, width], 0.3, 0.15);
            var y = d3.scale.linear()
              .domain([lo, hi])
              .nice()
              .range([height, 0]);
            var format = y.tickFormat(8);
            var boxWidth = x.rangeBand();

            var svg = d3.select(element[0]).append("svg")
              .attr("width", width + margin.left + margin.right)
              .attr("height", height + margin.top + margin.bottom)
              .attr("class", "box")
              .append("g")
              .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

            // The text is set with text(), never as HTML, because group names and values come from the index.
            _.each(scope.data.nodes, function (node) {
              var s = scope.box_stats(node.points);
              var g = svg.append("g")
                .attr("class", "boxplot-group")
                .attr("transform", "translate(" + x(node.name) + ",0)");
              var mid = boxWidth / 2;

              g.append("title").text(node.name + "\nn: " + s.n + "\nmedian: " + format(s.median) +
                "\nquartiles: " + format(s.q1) + " to " + format(s.q3) + "\nwhiskers: " + format(s.low) + " to " + format(s.high));

              g.append("line").attr("class", "center").attr("x1", mid).attr("x2", mid).attr("y1", y(s.low)).attr("y2", y(s.high));
              g.append("rect").attr("class", "box").attr("x", 0).attr("width", boxWidth)
                .attr("y", y(s.q3)).attr("height", Math.max(y(s.q1) - y(s.q3), 0));
              g.append("line").attr("class", "median").attr("x1", 0).attr("x2", boxWidth).attr("y1", y(s.median)).attr("y2", y(s.median));
              _.each([s.low, s.high], function (v) {
                g.append("line").attr("class", "whisker").attr("x1", 0).attr("x2", boxWidth).attr("y1", y(v)).attr("y2", y(v));
              });
              _.each(s.outliers, function (v) {
                g.append("circle").attr("class", "outlier").attr("r", 4).attr("cx", mid).attr("cy", y(v));
              });

              if (scope.panel.labels) {
                _.each([s.q1, s.median, s.q3], function (v, i) {
                  g.append("text").attr("class", "box").attr("dy", ".3em")
                    .attr("dx", i === 1 ? 6 : -6).attr("x", i === 1 ? boxWidth : 0).attr("y", y(v))
                    .attr("text-anchor", i === 1 ? "start" : "end").text(format(v));
                });
                _.each([s.low, s.high], function (v) {
                  g.append("text").attr("class", "whisker").attr("dy", ".3em")
                    .attr("dx", 6).attr("x", boxWidth).attr("y", y(v)).text(format(v));
                });
              }
            });

            // the y axis
            var yAxis = svg.append("g").attr("class", "y axis").call(d3.svg.axis().scale(y).orient("left"));
            if (scope.panel.axes_labels) {
              yAxis.append("text")
                .attr("transform", "rotate(-90)")
                .attr("y", 6)
                .attr("dy", ".71em")
                .style("text-anchor", "end")
                .style("font-size", "16px")
                .text(scope.data.y);
            }

            // the x axis
            var xAxis = svg.append("g").attr("class", "x axis")
              .attr("transform", "translate(0," + (height + 10) + ")")
              .call(d3.svg.axis().scale(x).orient("bottom"));
            if (scope.panel.axes_labels) {
              xAxis.append("text")
                .attr("x", width / 2)
                .attr("y", 30)
                .attr("dy", ".71em")
                .style("text-anchor", "middle")
                .style("font-size", "16px")
                .text(scope.data.x);
            }
          }
        }
      };
    });
  });
