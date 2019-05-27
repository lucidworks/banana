/*
  ## D3 Force Diagram Integrated with Banana.
*/

define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'kbn',
    'd3v5',
    'd3-force'
  ],
  function (angular, app, _, $, kbn, d3, d3force) {
    'use strict';

    var FORCE_SEARCH_FOR_NODE_EVENT = "force-search-for-node";

    var module = angular.module('kibana.panels.force', []);
    app.useModule(module);

    module.controller('force', function ($scope, querySrv, dashboard, filterSrv, $rootScope) {
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
        description: "Display a Force diagram."
      };

      // default values
      var _d = {
        queries: {
          mode: 'all',
          ids: [],
          query: '*:*',
          custom: ''
        },
        facet_limit: "10,20", // maximum number of rows returned from Solr
        node_size_weight: 0,
        link_width_weight: 0,
        link_strength_weight: 0,
        link_distance_weight: 0,
        strength: -400,
        colors: "#1f77b4, #ff7f0e, #2ca02c, #d62728, #9467bd, #8c564b, #e377c2, #7f7f7f, #bcbd22, #17becf",
        mute_category_1: false,
        mute_category_2: true,
        spheres: true,
        spyable: true,
        show_queries: true,
      };

      _.defaults($scope.panel, _d);
      var DEBUG = false;

      $scope.init = function () {
        $scope.$on('refresh', function () {
          $scope.get_data();

        });
        $scope.get_data();
      };

      $scope.searchQuery = "";
      $scope.searchForNode = function () {
        $rootScope.$emit(FORCE_SEARCH_FOR_NODE_EVENT, $scope.searchQuery);
      };
      $scope.clearSearchForNode = function () {
        $scope.searchQuery = "";
        $rootScope.$emit(FORCE_SEARCH_FOR_NODE_EVENT, $scope.searchQuery);
      };

      $scope.parse_facet_pivot = function (data) {
        var nodes = {};
        var links = [];
        var count = 0;

        var addNode = function (key, category, cnt) {
          var k = category + "-" + key;
          var existing = nodes[k];
          if (!!existing) {
            return existing.node;
          }

          var id = count++;
          nodes[k] = {
            node: id,
            name: "" + key,
            category: category,
            count: cnt,
          };

          return id;
        };

        for (var ob in data) {
          var id1 = addNode(data[ob].value, 1, data[ob].count);

          for (var p in data[ob].pivot) {
            var id2 = addNode(data[ob].pivot[p].value, 2, data[ob].pivot[p].count);

            links.push({
              source: id1,
              target: id2,
              value: data[ob].pivot[p].count
            });
          }
        }

        return {
          nodes: _.map(_.keys(nodes), function (key) {
            return nodes[key];
          }),
          links: links
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


        var limits = $scope.panel.facet_limit.split(",");
        var facet_limits = '&' + $scope.panel.facet_pivot_strings.map(function (f, index) {
          return "f." + f + ".facet.limit=" + parseInt(limits[index], 10);
        }).join("&");

        // f.effective_date_fiscal_facet.facet.limit=3&f.institution_facet.facet.limit=10';
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
          $scope.data = $scope.parse_facet_pivot(results.facet_counts.facet_pivot[$scope.panel.facet_pivot_strings.join().replace(/ /g, '')]);

          $scope.adjlist = [];
          $scope.selList = {};
          $scope.selListCopy = {};
          $scope.hoverList = {};
          $scope.taList = [];
          $scope.$on('typeahead-updated', function() {
            $scope.searchForNode();
          });

          $scope.data.nodes.forEach(function (d) {
            if ((d.category === 1 && $scope.panel.mute_category_1) || (d.category === 2 && $scope.panel.mute_category_2)) {
              $scope.selList["n" + d.node] = false;
            } else {
              $scope.selList["n" + d.node] = true;
            }

            $scope.taList.push(d.name);
          });

          $scope.selListCopy = _.extend({}, $scope.selList);

          $scope.data.links.forEach(function (d) {
            $scope.adjlist[d.source + "-" + d.target] = true;
            $scope.adjlist[d.target + "-" + d.source] = true;
          });

          $scope.render();
        }, function (error) {
          console.log(error);
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

    module.directive('forceChart', function ($rootScope) {
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

            var margin = {top: 20, right: 20, bottom: 20, left: 20};
            width = width - margin.left - margin.right;
            height = height - margin.top - margin.bottom;

            var color = d3.scaleOrdinal(scope.panel.colors.split(",").map(function (color) {
              return color.replace(/\s/g, '');
            }));

            var svg = d3.select(element[0]).append("svg")
              .attr("width", width + margin.left + margin.right)
              .attr("height", height + margin.top + margin.bottom);

            var container = svg.append("g").attr("class", "container");
            var zoom = d3.zoom()
              .scaleExtent([0.1, 4])
              .on("zoom", function () {
                container.attr("transform", d3.event.transform);
              });

            svg.call(zoom);

            var link_force = d3force.forceLink(scope.data.links)
              .id(function (d) {
                return d.index;
              });

            if (scope.panel.link_strength_weight !== 0) {
              link_force.strength(function (d) {
                return Math.sqrt(d.value * scope.panel.link_strength_weight);
              });
            }
            if (scope.panel.link_distance_weight !== 0) {
              link_force.distance(function (d) {
                return Math.sqrt(d.value * scope.panel.link_distance_weight);
              });
            }

            var simulation = d3force.forceSimulation()
              .force("charge_force", d3force.forceManyBody().strength(scope.panel.strength))
              .force("center_force", d3force.forceCenter(width / 2, height / 2))
              .nodes(scope.data.nodes)
              .force("links", link_force);
            // .alpha(0.5);

            var link = container.append("g")
              .attr("class", "links")
              .selectAll("line")
              .data(scope.data.links)
              .enter().append("line")
              .attr("stroke-width", function (d) {
                return scope.panel.link_width_weight > 0 ? (Math.sqrt(d.value) * scope.panel.link_width_weight) : 1.5;
              })
              .attr("stroke", "#cccccc")
              .attr("stroke-linecap", "round");


            var t = function () {
              return d3.transition()
                .duration(100)
                .ease(d3.easeLinear);
            };

            var nodeSize = function (d) {
              if (scope.panel.node_size_weight === 0) {
                return 5;
              } else {
                return (scope.panel.node_size_weight * Math.sqrt(d.count)) + 4;
              }
            };

            var gradientRadial = svg.append("defs").selectAll("radialGradient")
              .data(scope.data.nodes)
              .enter().append("radialGradient")
              .attr("id", function (d) {
                return "gradient-" + d.category;
              })
              .attr("cx", "30%")
              .attr("cy", "30%")
              .attr("r", "65%");

            gradientRadial.append("stop")
              .attr("offset", "0%")
              .attr("stop-color", function (d) {
                return d3.rgb(color(d.category)).brighter(1);
              });

            gradientRadial.append("stop")
              .attr("offset", "50%")
              .attr("stop-color", function (d) {
                return color(d.category);
              });

            gradientRadial.append("stop")
              .attr("offset", "100%")
              .attr("stop-color", function (d) {
                return d3.rgb(color(d.category)).darker(1.5);
              });

            var node = container.append("g")
              .attr("class", "nodes")
              .selectAll("circle")
              .data(scope.data.nodes)
              .enter()
              .append("circle")
              .attr("r", nodeSize)
              .attr("stroke-width", 1.5)
              .attr("stroke", "#f1f1f1")
              .attr("fill", function (d) {
                return scope.panel.spheres ? "url(#gradient-" + d.category + ")" : color(d.category);
              })
              .call(
                d3.drag()
                  .on("start", dragstarted)
                  .on("drag", dragged)
                  .on("end", dragended)
              );

            node.on("mouseover", dofocus).on("mouseout", unfocus);

            node.on("click", function (d) {
              scope.selList["n" + d.node] = scope.selList["n" + d.node] !== true;
              scope.selListCopy["n" + d.node] = scope.selList["n" + d.node];
              label.attr("display", labelDisplay).attr("opacity", labelOpacity);
            });

            function dragstarted(d) {
              d3.event.sourceEvent.stopPropagation();
              if (!d3.event.active) {
                simulation.alphaTarget(1).restart();
              }
              d.fx = d.x;
              d.fy = d.y;
            }

            function dragged(d) {
              d.fx = d3.event.x;
              d.fy = d3.event.y;
            }

            function dragended(d) {
              if (!d3.event.active) {
                simulation.alphaTarget(0);
              }
              d.fx = null;
              d.fy = null;
            }

            var labelDisplay = function (d) {
              return (scope.selList["n" + d.node] || !!scope.hoverList["n" + d.node]) ? "block" : "none";
            };
            var labelOpacity = function (d) {
              return (!scope.selList["n" + d.node] && !!scope.hoverList["n" + d.node]) ? 0.5 : 1;
            };

            var label = container.append("g")
              .attr("class", "labels")
              .selectAll("text")
              .data(scope.data.nodes)
              .enter()
              .append("text")
              .text(function (d) {
                return d.name;
              })
              .attr("display", labelDisplay).attr("opacity", labelOpacity)
              .style("pointer-events", "none");

            function dofocus() {
              var index = d3.select(d3.event.target).datum().index;

              node.transition(t()).attr("r", function (o) {
                return nodeSize(o) * (o.node === index ? 1.2 : 1);
              });

              scope.hoverList["n" + index] = true;
              label.attr("display", labelDisplay).attr("opacity", labelOpacity);
            }

            function unfocus() {
              var index = d3.select(d3.event.target).datum().index;

              node.transition(t()).attr("r", nodeSize);

              scope.hoverList["n" + index] = false;
              label.attr("display", labelDisplay).attr("opacity", labelOpacity);
            }

            simulation.on("tick", function () {
              node
                .attr("cx", function (d) {
                  return d.x;
                })
                .attr("cy", function (d) {
                  return d.y;
                });

              label
                .attr("x", function (d) {
                  return d.x + 5 + nodeSize(d);
                })
                .attr("y", function (d) {
                  return d.y + 5;
                });

              link
                .attr("x1", function (d) {
                  return d.source.x;
                })
                .attr("y1", function (d) {
                  return d.source.y;
                })
                .attr("x2", function (d) {
                  return d.target.x;
                })
                .attr("y2", function (d) {
                  return d.target.y;
                });

            });

            $rootScope.$on(FORCE_SEARCH_FOR_NODE_EVENT, function (e, q) {
              var lq = q.toLowerCase().trim();

              if (lq === "") {
                scope.selList = _.extend({}, scope.selListCopy);
              } else {
                scope.selListCopy = _.extend({}, scope.selList);

                node.each(function(d) {
                  scope.selList["n" + d.node] = d.name.toLowerCase().indexOf(lq) !== -1;
                });
              }

              label.attr("display", labelDisplay).attr("opacity", labelOpacity);
            });

            scope.panelMeta.loading = false;
          }
        }
      };
    });
  });
