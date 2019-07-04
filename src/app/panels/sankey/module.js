/*
  ## Sankey Diagram Integrated with Banana.
*/
define([
    'angular',
    'app',
    'underscore',
    'jquery',
    'kbn',
    'd3',
    'd3-sankey'
  ],
  function (angular, app, _, $, kbn, d3, d3sankey) {
    'use strict';

    var module = angular.module('kibana.panels.sankey', []);
    app.useModule(module);

    module.controller('sankey', function ($scope, querySrv, dashboard, filterSrv) {
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
        description: "Display a Sankey diagram."
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

      $scope.parse_facet_pivot = function (data) {
        var nodes = {};
        var links = [];
        var count = 0;

        var addNode = function(key, fcount, category) {
          var k = category + "-" + key;
          var existing = nodes[k];
          if (!!existing) {
            return existing.node;
          }

          var id = count++;
          nodes[k] = {
            node: id,
            name: key,
            category: category
          };

          return id;
        };

        var processNodes = function(parent, parentCount, data, category) {
          for (var ob in data) {
            var id1 = addNode(data[ob].value, data[ob].count, category + 1);

            if (parent !== null) {
              links.push({
                source: parent,
                target: id1,
                value: data[ob].count,
                key: parent + "-" + id1
              });
            }

            processNodes(id1, data[ob].count, data[ob].pivot, category + 1);
          }
        };

        processNodes(null, 0, data, 0);

        return {
          nodes: _.map(_.keys(nodes), function(key) {
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
          $scope.data = $scope.parse_facet_pivot(results.facet_counts.facet_pivot[$scope.panel.facet_pivot_strings.join().replace(/ /g, '')]);
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

    module.directive('sankeyChart', function () {
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


            var svg = d3.select(element[0]).append("svg")
              .attr("width", width + margin.left + margin.right)
              .attr("height", height + margin.top + margin.bottom);

            var sankey = d3sankey.sankey().nodeWidth(15).nodePadding(10).extent([[1, 1], [width - 1, height - 5]])(scope.data);
            var nodes = sankey.nodes;
            var links = sankey.links;

            var format = function (d) {
              var f = d3.format(",.0f");
              return f(d) + "";
            };
            var color = d3.scale.category10();

            var node = svg.append("g").attr("stroke-width", 0).selectAll("rect").data(nodes).enter().append("rect").attr("x", function (d) {
              return d.x0;
            }).attr("y", function (d) {
              return d.y0;
            }).attr("height", function (d) {
              return d.y1 - d.y0;
            }).attr("width", function (d) {
              return d.x1 - d.x0;
            }).attr("fill", function (d) {
              return color(d.category);
            });

            node.append("title").text(function (d) {
              return d.name + "\n" + format(d.value);
            });

            var labels = svg.append("g").style("font", "10px sans-serif").selectAll("text").data(nodes).enter().append("text").attr("x", function (d) {
              return d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6;
            }).attr("y", function (d) {
              return (d.y1 + d.y0) / 2;
            }).attr("dy", "0.35em").attr("text-anchor", function (d) {
              return d.x0 < width / 2 ? "start" : "end";
            }).text(function (d) {
              return d.name;
            });

            var link = svg.append("g")
              .attr("fill", "none")
              .attr("stroke-opacity", 0.5)
              .selectAll("g")
              .data(links)
              .enter()
              .append("g")
              .style("mix-blend-mode", "multiply");

            link.append("path").attr("d", d3sankey.sankeyLinkHorizontal())
              .attr("fill", "none")
              .attr("stroke", "#777777")
              .attr("stroke-opacity", "0.2")
              .attr("stroke-width", function (d) {
              return Math.max(1, d.width);
            });

            link.append("title").text(function (d) {
              return d.source.name + " \u2192 " + d.target.name + ", " + d.value;
            });

            var hoverLinksNodes = function(ns, ls, on) {
              node.each(function(n) {
                if (!_.contains(ns, n.node)) {
                  d3.select(this).attr("opacity", on ? 0.3 : 1);
                }
              });
              labels.each(function(n) {
                if (!_.contains(ns, n.node)) {
                  d3.select(this).attr("opacity", on ? 0.3 : 1);
                }
              });
              link.each(function(ll) {
                if (!_.contains(ls, ll.key)) {
                  d3.select(this).attr("opacity", on ? 0.3 : 1);
                }
              });
            };

            var hoverLink = function(l, on) {
              hoverLinksNodes([l.source.node, l.target.node], [l.key], on);
            };

            link.on("mouseover", function(d) {
              hoverLink(d, true);
            }).on("mouseout", function(d) {
              hoverLink(d, false);
            });

            var hoverNode = function(n, on) {
              var nlist = [n.node];
              var llist = [];
              var parseOut = function(ns) {
                _.each(ns, function(nn) {
                  nlist.push(nn.source.node);
                  llist.push(nn.key);
                });
              };
              var parseIn = function(ns) {
                _.each(ns, function(nn) {
                  nlist.push(nn.target.node);
                  llist.push(nn.key);
                  parseIn(nn.target.sourceLinks);
                });
              };
              _.each(nodes, function(nn) {
                if (n.node === nn.node) {
                  parseOut(n.targetLinks);
                  parseIn(n.sourceLinks);
                }
              });
              hoverLinksNodes(nlist, llist, on);
            };

            node.on("mouseover", function(d) {
              hoverNode(d, true);
            }).on("mouseout", function(d) {
              hoverNode(d, false);
            });

            scope.panelMeta.loading = false;
          }
        }
      };
    });
  });
