/*
  ## tagcloud

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
    'kbn',
    'd3',
    './d3.layout.cloud'
  ],
  function(angular, app, _, $, kbn, d3) {
    'use strict';

    var module = angular.module('kibana.panels.tagcloud', []);
    app.useModule(module);

    module.controller('tagcloud', function($scope, querySrv, dashboard, filterSrv) {
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
        status: "Stable",
        description: "Displays the results of a Solr facet as a pie chart, bar chart, or a table. Newly added functionality displays min/max/mean/sum of a stats field, faceted by the Solr facet field, again as a pie chart, bar chart or a table."
      };

      // Set and populate defaults
      var _d = {
        queries: {
          mode: 'all',
          ids: [],
          query: '*:*',
          custom: ''
        },
        mode: 'count', // mode to tell which number will be used to plot the chart.
        field: '',
        stats_field: '',
        decimal_points: 0, // The number of digits after the decimal point
        exclude: [],
        missing: true,
        other: true,
        size: 10,
        // order   : 'count',
        order: 'descending',
        style: {
          "font-size": '10pt'
        },
        donut: false,
        tilt: false,
        labels: true,
        logAxis: false,
        arrangement: 'horizontal',
        chart: 'bar',
        counter_pos: 'above',
        lastColor: '',
        spyable: true,
        show_queries: true,
        error: '',
        chartColors: querySrv.colors
      };
      _.defaults($scope.panel, _d);

      $scope.init = function() {
        $scope.hits = 0;
        // $scope.testMultivalued();
        $scope.$on('refresh', function() {
          $scope.get_data();
        });
        $scope.get_data();
      };

      $scope.testMultivalued = function() {
        if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("M") > -1) {
          $scope.panel.error = "Can't proceed with Multivalued field";
          return;
        }

        if ($scope.panel.stats_field && $scope.fields.typeList[$scope.panel.stats_field].schema.indexOf("M") > -1) {
          $scope.panel.error = "Can't proceed with Multivalued field";
          return;
        }
      };

      $scope.get_data = function() {
        // Make sure we have everything for the request to complete
        if (dashboard.indices.length === 0) {
          return;
        }

        $scope.panelMeta.loading = true;
        var request, results;

        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

        request = $scope.sjs.Request().indices(dashboard.indices);
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

        // Build Solr query
        var fq = '';
        if (filterSrv.getSolrFq() && filterSrv.getSolrFq() != '') {
          fq = '&' + filterSrv.getSolrFq();
        }
        var wt_json = '&wt=json';
        var rows_limit = '&rows=0'; // for terms, we do not need the actual response doc, so set rows=0
        var facet = '';

        if ($scope.panel.mode === 'count') {
          facet = '&facet=true&facet.field=' + $scope.panel.field + '&facet.limit=' + $scope.panel.size + '&facet.missing=true';
        } else {
          // if mode != 'count' then we need to use stats query
          // stats does not support something like facet.limit, so we have to sort and limit the results manually.
          facet = '&stats=true&stats.facet=' + $scope.panel.field + '&stats.field=' + $scope.panel.stats_field + '&facet.missing=true';;
        }

        var exclude_length = $scope.panel.exclude.length;
        var exclude_filter = '';
        if (exclude_length > 0) {
          for (var i = 0; i < exclude_length; i++) {
            exclude_filter += '&fq=-' + $scope.panel.field + ":" + $scope.panel.exclude[i];
          }
        }

        // Set the panel's query
        $scope.panel.queries.query = querySrv.getQuery(0) + wt_json + rows_limit + fq + exclude_filter + facet;

        // Set the additional custom query
        if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
        } else {
          request = request.setQuery($scope.panel.queries.query);
        }

        results = request.doSearch();

        // Populate scope when we have results
        results.then(function(results) {
          // Check for error and abort if found
          if (!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error.msg);
            return;
          }

          // Function for validating HTML color by assign it to a dummy <div id="colorTest">
          // and let the browser do the work of validation.
          var isValidHTMLColor = function(color) {
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
          var addSliceColor = function(slice, color) {
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
          $scope.labels = [];
          $scope.sizes = [];

          if ($scope.panel.mode === 'count') {
            // In count mode, the y-axis min should be zero because count value cannot be negative.
            $scope.yaxis_min = 0;
            _.each(results.facet_counts.facet_fields, function(v) {
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
                  var slice = {
                    label: term,
                    data: count,
                    actions: true
                  };
                  slice = addSliceColor(slice, term);
                  $scope.data.push(slice);
                  $scope.labels.push(term);
                  $scope.sizes.push(count);
                }
              }
            });
          } else {
            // In stats mode, set y-axis min to null so jquery.flot will set the scale automatically.
            $scope.yaxis_min = null;
            _.each(results.stats.stats_fields[$scope.panel.stats_field].facets[$scope.panel.field], function(stats_obj, facet_field) {
              var slice = {
                label: facet_field,
                data: [
                  [k, stats_obj[$scope.panel.mode]]
                ],
                actions: true
              };
              $scope.data.push(slice);
            });
          }

          // // Slice it according to panel.size, and then set the x-axis values with k.
          // $scope.data = $scope.data.slice(0, $scope.panel.size);
          // _.each($scope.data, function(v) {
          //   v.data[0][0] = k;
          //   k++;
          // });
          $scope.$emit('render');
        });
      };

      $scope.build_search = function(term, negate) {
        if (_.isUndefined(term.meta)) {
          filterSrv.set({
            type: 'terms',
            field: $scope.panel.field,
            value: term.label,
            mandate: (negate ? 'mustNot' : 'must')
          });
        } else if (term.meta === 'missing') {
          filterSrv.set({
            type: 'exists',
            field: $scope.panel.field,
            mandate: (negate ? 'must' : 'mustNot')
          });
        } else {
          return;
        }
        dashboard.refresh();
      };

      $scope.set_refresh = function(state) {
        $scope.refresh = state;
        // if 'count' mode is selected, set decimal_points to zero automatically.
        if ($scope.panel.mode === 'count') {
          $scope.panel.decimal_points = 0;
        }
      };

      $scope.close_edit = function() {
        if ($scope.refresh) {
          // $scope.testMultivalued();
          $scope.get_data();
        }
        $scope.refresh = false;
        $scope.$emit('render');
      };

      $scope.showMeta = function(term) {
        if (_.isUndefined(term.meta)) {
          return true;
        }
        if (term.meta === 'other' && !$scope.panel.other) {
          return false;
        }
        if (term.meta === 'missing' && !$scope.panel.missing) {
          return false;
        }
        return true;
      };

    });

    module.directive('tagcloudChart', function(querySrv, dashboard, filterSrv) {
      return {
        restrict: 'A',
        link: function(scope, element) {

          // Receive render events
          scope.$on('render', function() {
            render_panel();
          });

          // Re-render if the window is resized
          angular.element(window).bind('resize', function() {
            render_panel();
          });

          // Function for rendering panel
          function render_panel() {
            console.log(scope.data);
            for (var i = 0; i < scope.data.length; i++) {

            };
            element.html("");

            var el = element[0];
            var parent_width = element.parent().width(),
              height = parseInt(scope.row.height);

            var fill = d3.scale.category20();
            var color = d3.scale.linear()
              .domain([0, 1, 2, 3, 4, 5, 6, 10, 15, 20, 100])
              .range(["#7EB26D", "#EAB839", "#6ED0E0", "#EF843C", "#E24D42", "#1F78C1", "#BA43A9", "#705DA0", "#890F02", "#0A437C", "#6D1F62", "#584477"]);

            d3.layout.cloud().size([300, 300])
              .words(scope.data.map(function(d) {
                return {
                  text: d.label,
                  size: 10 + (d.data / scope.hits) * 1000
                };
              })).rotate(function() {
                return~~ (Math.random() * 2) * 90;
                //return 0;
              })
              .font("Impact")
              .fontSize(function(d) {
                return d.size;
              })
              .on("end", draw)
              .start();

            function draw(words) {
              d3.select(el).append("svg")
                .attr("width", parent_width)
                .attr("height", height)
                .append("g")
                .attr("transform", "translate(150,150)")
                .selectAll("text")
                .data(words)
                .enter().append("text")
                .style("font-size", function(d) {
                  return d.size + "px";
                })
                .style("font-family", "Impact")
                .style("fill", function(d, i) {
                  //return  color(i);
                  return fill(i);
                })
                .attr("text-anchor", "middle")
                .attr("transform", function(d) {
                  return "translate(" + [d.x, d.y] + ")rotate(" + d.rotate + ")";
                })
                .text(function(d) {
                  return d.text;
                });
            }
          }

        }
      };
    });

  });