define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'kbn',
    'd3',
    'd3-box'
  ],
  function (angular, app, _, $, kbn, d3, d3box) {
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
        description: "Display a Boxplot diagram."
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
        show_queries: true,
      };

      _.defaults($scope.panel, _d);
      var DEBUG = true;

      $scope.init = function () {
        $scope.$on('refresh', function () {
          $scope.get_data();

        });
        $scope.get_data();
      };

      $scope.iqr = function (k) {
        return function (d, i) {
          var q1 = d.quartiles[0],
            q3 = d.quartiles[2],
            iqr = (q3 - q1) * k,
            j = d.length;
          i = -1;
          do { i++; } while (d[i] < q1 - iqr);
          do { --j; } while (d[j] > q3 + iqr);
          return [i, j];
        };
      };

      $scope.parse_facet_pivot = function (data, facetNames) {
        var result = [];
        var min = Infinity,
          max = -Infinity;

        data.forEach(function (facet) {
          var row = [], values = [];

          row.push(facet.value);
          facet.pivot.forEach(function (facet2) {
            if (facet2.value < min) {
              min = facet2.value;
            }
            if (facet2.value > max) {
              max = facet2.value;
            }

            if ($scope.panel.unique_facet_values) {
              values.push(facet2.value);
            } else {
              for(var i=0; i < facet2.count; i++) {
                values.push(facet2.value);
              }
            }
          });
          row.push(values);

          result.push(row);
        });

        return {
          nodes: result,
          x: facetNames[0],
          y: facetNames[1],
          min: min,
          max: max,
        };
      };

      $scope.parse_item = function (doc) {
        var t = {'name': doc.value, 'size': doc.count, 'children': []};
        for (var piv in doc.pivot) {
          t.children.push($scope.parse_item(doc.pivot[piv]));
        }
        return t;
      };

      $scope.get_data = function () {
        // Show progress by displaying a spinning wheel icon on panel
        $scope.panelMeta.loading = true;
        delete $scope.panel.error;

        var request, results;
        // Set Solr server
        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);
        // -------------------- TODO: REMOVE ALL ELASTIC SEARCH AFTER FIXING SOLRJS --------------
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
          )); // Set the size of query result
        $scope.populate_modal(request);
        // --------------------- END OF ELASTIC SEARCH PART ---------------------------------------

        // Construct Solr query
        var fq = '';
        if (filterSrv.getSolrFq()) {
          fq = '&' + filterSrv.getSolrFq();
        }
        var wt_json = '&wt=json';
        var rows = '&rows=0';
        var facet = '&facet=true';
        var facet_pivot = '&facet.pivot=' + $scope.panel.facet_pivot_strings.join().replace(/ /g, '');
        var facet_limits = '&facet.limit=' + $scope.panel.facet_limit;
        $scope.panel.queries.query = querySrv.getORquery() + fq + wt_json + facet + facet_pivot + facet_limits + rows;
        if (DEBUG) {
          console.log($scope.panel.queries.query);
        }
        // Set the additional custom query
        if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
        } else {
          request = request.setQuery($scope.panel.queries.query);
        }

        // Execute the search and get results
        results = request.doSearch();
        results.then(function (results) {
          var pivotStrings = $scope.panel.facet_pivot_strings.join().replace(/ /g, '');
          $scope.data = $scope.parse_facet_pivot(results.facet_counts.facet_pivot[pivotStrings], pivotStrings.split(","));
          $scope.render();
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

      $scope.pad = function (n) {
        return (n < 10 ? '0' : '') + n;
      };

      $scope.set_filters = function (d) {
        if (DEBUG) {
          console.log("Setting Filters to " + d);
        }
        for (var i = 0; i < d.length; i++) {
          filterSrv.set({
            type: 'terms',
            field: $scope.panel.facet_pivot_strings[i].replace(/ /g, ''),
            mandate: 'must',
            value: d[i]
          });
          console.log($scope.panel.facet_pivot_strings[i].replace(/ /g, '') + ' - ' + d[i]);

        }

        dashboard.refresh();
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

            var width = element.parent().width();
            var height = parseInt(scope.row.height);

            var margin = {top: 30, right: 50, bottom: 90, left: 80};
            width = width - margin.left - margin.right;
            height = height - margin.top - margin.bottom;

            var chart = d3box.box()
              .whiskers(scope.iqr(1.5))
              .height(height)
              .domain([scope.data.min, scope.data.max])
              .showLabels(scope.panel.labels);

            var svg = d3.select(element[0]).append("svg")
              .attr("width", width + margin.left + margin.right)
              .attr("height", height + margin.top + margin.bottom)
              .attr("class", "box")
              .append("g")
              .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

            // the x-axis
            var x = d3.scale.ordinal()
              .domain(scope.data.nodes.map(function (d) {
                return d[0];
              }))
              .rangeRoundBands([0, width], 0.7, 0.3);

            var xAxis = d3.svg.axis()
              .scale(x)
              .orient("bottom");

            // the y-axis
            var y = d3.scale.linear()
              .domain([scope.data.min, scope.data.max])
              .range([height + margin.top, 0 + margin.top]);

            var yAxis = d3.svg.axis()
              .scale(y)
              .orient("left");

            // draw the boxplots
            svg.selectAll(".box")
              .data(scope.data.nodes)
              .enter().append("g")
              .attr("transform", function (d) {
                return "translate(" + x(d[0]) + "," + margin.top + ")";
              })
              .call(chart.width(x.rangeBand()));

            // draw y axis
            var yaxis = svg.append("g")
              .attr("class", "y axis")
              .call(yAxis)
              .append("text"); // and text1

            if (scope.panel.axes_labels) {
              yaxis.attr("transform", "rotate(-90)")
                .attr("y", 6)
                .attr("dy", ".71em")
                .style("text-anchor", "end")
                .style("font-size", "16px")
                .text(scope.data.y);
            }

            // draw x axis
            var xaxis = svg.append("g")
              .attr("class", "x axis")
              .attr("transform", "translate(0," + (height + margin.top + 10) + ")")
              .call(xAxis)
              .append("text");             // text label for the x axis

            if (scope.panel.axes_labels) {
              xaxis.attr("x", (width / 2))
                .attr("y", 30)
                .attr("dy", ".71em")
                .style("text-anchor", "middle")
                .style("font-size", "16px")
                .text(scope.data.x);
            }

            scope.panelMeta.loading = false;
          }
        }
      };
    });
  });
