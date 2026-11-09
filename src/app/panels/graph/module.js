/*
  ## Graph

*/
define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'vis',
  'x2js',
  'kbn',
  'components/streamExpression'
],
function (angular, app, _, $, vis, X2JS, kbn, streamExpression) {
  'use strict';

  var module = angular.module('kibana.panels.graph', []);
  app.useModule(module);

  module.controller('graph', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
    $scope.TRUNC_LENGTH = 25;

    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      exportfile: false,
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : "Displays the results of significant terms as a table."
    };

    // Set and populate defaults
    var _d = {
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      mode    : 'count', // mode to tell which number will be used to plot the chart.
      field   : '',
      stats_field : '',
      decimal_points : 0, // The number of digits after the decimal point
      exclude : [],
      missing : false,
      other   : false,
      size    : 10,
      sortBy  : 'count',
      order   : 'descending',
      style   : { "font-size": '10pt'},
      donut   : false,
      tilt    : false,
      labels  : true,
      logAxis : false,
      arrangement : 'horizontal',
      chart       : 'bar',
      counter_pos : 'above',
      exportSize : 10000,
      lastColor : '',
      spyable     : true,
      show_queries:true,
      error : '',
      chartColors : querySrv.colors,
      refresh: {
        enable: false,
        interval: 2
      },
      root_nodes_sort_order: 'desc'
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

      var fields_request = $scope.fields.map($scope.panel.graph_collection);

      fields_request.then(p => {
        // TODO: ?
        $scope.fields.aux_list = _.keys(p['logstash-2999.12.31'].logs);
      });

      String.prototype.trunc = String.prototype.trunc ||
            function(n){
                return (this.length > n) ? this.substr(0, n-1) + '...' : this;
            };
    };

    $scope.testMultivalued = function() {
      if($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("M") > -1) {
        $scope.panel.error = "Can't proceed with Multivalued field";
        return;
      }

      if($scope.panel.stats_field && $scope.fields.typeList[$scope.panel.stats_field].schema.indexOf("M") > -1) {
        $scope.panel.error = "Can't proceed with Multivalued field";
        return;
      }
    };

    // The nodes expression for the current queries and filters (the dashboard's time range
    // included), for the /graph handler. The filters apply to the root documents found by the
    // search; later hops of the traversal are not filtered. Every value is quoted, and the
    // dashboard's global parameters are not part of the expression. Throws an Error when a
    // setting is not usable in an expression.
    $scope.build_graph_expression = function() {
      var q = streamExpression.quote;
      var name = streamExpression.name;
      var panel = $scope.panel;
      var graph_collection = name(panel.graph_collection, 'graph collection name');
      var join_field = name(panel.join_field, 'join field name');
      var from_field = name(panel.from_field, 'from field name');
      var to_field = name(panel.to_field, 'to field name');

      var fl = join_field;
      var sort = '';
      if (panel.root_nodes_sort) {
        var sort_field = name(panel.root_nodes_sort, 'root nodes sort field name');
        fl += ',' + sort_field;
        sort = ', sort=' + q(sort_field + ' ' +
          (panel.root_nodes_sort_order === 'asc' ? 'asc' : 'desc'));
      }
      var rows = panel.root_nodes ? ', rows=' + q(streamExpression.integer(panel.root_nodes, 'number of root nodes')) : '';

      var query = streamExpression.combine(querySrv.getOPQueryText(), filterSrv.getSolrFqList());

      var graph_expression = 'nodes(' + graph_collection + ', ' +
        'nodes(' + graph_collection + ', ' +
        'search(' + name(dashboard.current.solr.core_name, 'collection name') + ', q=' + q(query) +
        ', fl=' + q(fl) + sort + rows + '), ' +
        'walk=' + q(join_field + '->' + from_field) + ', ' +
        'trackTraversal="true", ' +
        'gather=' + q(to_field) + '), ' +
        'walk=' + q('node->' + from_field) + ', ' +
        'scatter="leaves,branches", ' +
        'trackTraversal="true", ' +
        'gather=' + q(to_field) + ')';

      return streamExpression.assertReadOnly(graph_expression);
    };

    // The fetch expression that looks up the label of every node of the graph.
    $scope.build_base_expression = function() {
      var q = streamExpression.quote;
      var name = streamExpression.name;
      var join_field = name($scope.panel.join_field, 'join field name');
      var collection = name(dashboard.current.solr.core_name, 'collection name');

      var base_expression = 'fetch(' + collection + ', select(' +
        this.build_graph_expression() +
        ', node as ' + join_field + '), fl=' + q(name($scope.panel.label_field, 'label field name')) +
        ', on=' + q(join_field) + ')';

      return streamExpression.assertReadOnly(base_expression);
    };

    $scope.get_data = function() {
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      delete $scope.panel.error;
      $scope.panelMeta.loading = true;
      var request, response;

      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      request = $scope.sjs.Request().indices(dashboard.indices);
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var expression;
      try {
        expression = this.build_graph_expression();
      } catch (e) {
        $scope.graph_failed(e.message);
        return;
      }

      // Set the panel's query
      $scope.panel.queries.query = 'expr=' + expression;

      request.setQuery('expr=' + encodeURIComponent(expression));

      response = request.streamExpression('graph');

      // Populate scope when we have results
      response.then(function(graph_response) {
        // Check for error and abort if found
        if(!(_.isUndefined(graph_response.error))) {
          $scope.graph_failed($scope.parse_error(graph_response.error.msg));
          return;
        }
        var base_expression;
        try {
          base_expression = $scope.build_base_expression();
        } catch (e) {
          $scope.graph_failed(e.message);
          return;
        }
        request = $scope.sjs.Request().indices(dashboard.indices);
        request.setQuery('expr=' + encodeURIComponent(base_expression));
        response = request.streamExpression('stream');

        response.then(function(base_reponse) {
          // Check for error and abort if found
          if(!(_.isUndefined(base_reponse.error))) {
            $scope.graph_failed($scope.parse_error(base_reponse.error.msg));
            return;
          }

          var x2js = new X2JS();
          $scope.graphML = x2js.xml2js(graph_response);

          var graph = $scope.graphML && $scope.graphML.graphml && $scope.graphML.graphml.graph;
          var graph_nodes = graph && graph.node ? [].concat(graph.node) : [];
          base_reponse['result-set'].docs.filter(d => d[$scope.panel.label_field] != undefined).map(d => {
            graph_nodes.filter(n => n._id === d[$scope.panel.join_field])
              .map(n => n.title = d[$scope.panel.label_field])
          });

          $scope.panelMeta.loading = false;

          $scope.$emit('render');
        }, function (response) {
          $scope.graph_failed(streamExpression.failureMessage(dashboard.current.solr.server,
            response, $scope.request_error(response)));
        });
      }, function (response) {
        $scope.graph_failed(streamExpression.failureMessage(dashboard.current.solr.server,
          response, $scope.request_error(response)));
      });
    };

    // A request or an expression failed: show the message, stop the spinner and forget the last
    // graph. The panel then draws nothing.
    $scope.graph_failed = function(message) {
      $scope.panel.error = message;
      $scope.panelMeta.loading = false;
      $scope.data = [];
      $scope.graphML = undefined;
      $scope.$emit('render');
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
      // if 'count' mode is selected, set decimal_points to zero automatically.
      if ($scope.panel.mode === 'count') {
        $scope.panel.decimal_points = 0;
      }

      var fields_request = $scope.fields.map($scope.panel.graph_collection);

      fields_request.then(p => {
        // TODO: ?
        $scope.fields.aux_list = _.keys(p['logstash-2999.12.31'].logs);
      });
    };

    $scope.close_edit = function() {
      // Start refresh timer if enabled
      if ($scope.panel.refresh.enable) {
        $scope.set_timer($scope.panel.refresh.interval);
      }

      if ($scope.refresh) {
        // $scope.testMultivalued();
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

  });

  module.directive('graph', function() {
    return {
      restrict: 'E',
      link: function(scope, element) {
        scope.$on('render',function(){
          render_panel();
        });

        // Render the panel when resizing browser window
        angular.element(window).bind('resize', function() {
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          // Clear the panel
          element.html('');

          // Nothing to draw after a failed request, or when the answer holds no graph
          var graph = scope.graphML && scope.graphML.graphml && scope.graphML.graphml.graph;
          if (scope.panel.error || !graph) {
            return;
          }

          var parent_width = element.parent().width(),
            height = scope.row.height,
            width = parent_width - 20;

          var nodes = new vis.DataSet();

          // create an array with edges
          var edges = new vis.DataSet();

          // provide the data in the vis format
          var data = {
            nodes: nodes,
            edges: edges
          };
          var options = {height: height, edges: {arrows: {to: {enabled: true, scaleFactor: 0.5}}},
            nodes: {widthConstraint: {maximum: 75}}};

          // initialize your network!
          var network = new vis.Network(element[0], data, options);

          if (graph.node) {
            [].concat(graph.node).forEach(function(n) {
              nodes.add({id: n._id, label: n.title? n.title.trunc(scope.TRUNC_LENGTH) : n._id, title: n.title ? kbn.escapeHtml(n.title) : n.title});
            });
          }

          if (graph.edge) {
            [].concat(graph.edge).forEach(function(e) {
              edges.add({from: e._source, to: e._target});
            });
          }
        }
      }
    };
  });
});
