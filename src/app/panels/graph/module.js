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
  'kbn'
],
function (angular, app, _, $, vis, X2JS, kbn) {
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

    $scope.build_graph_expression = function() {
      var fq = '';
      if (filterSrv.getSolrFq()) {
        fq = ',' + filterSrv.getSolrFq(false, ',');
      }

      var graph_expression_template = 'nodes(%%GRAPH_COLLECTION%%,' +
                                  'nodes(%%GRAPH_COLLECTION%%, ' +
                                  'search(%%COLLECTION%%, q="%%QUERY%%", fl="%%FL%%" %%ROOT_NODES_SORT%% ' +
                                  '%%ROOT_NODES%%),' +
                                  'walk="%%JOIN_FIELD%%->%%FROM_FIELD%%",' +
                                        'trackTraversal="true",' +
                                        'gather="%%TO_FIELD%%"),' +
                                  'walk="node->%%FROM_FIELD%%",' +
                                  'scatter="leaves,branches",' +
                                  'trackTraversal="true",' +
                                  'gather="%%TO_FIELD%%")';

      var graph_expression = graph_expression_template
        .replace(/%%GRAPH_COLLECTION%%/g, $scope.panel.graph_collection)
        .replace(/%%COLLECTION%%/, dashboard.current.solr.core_name)
        .replace(/%%ROOT_NODE%%/, $scope.panel.root_node)
        .replace(/%%TO_FIELD%%/g, $scope.panel.to_field)
        .replace(/%%ROOT_NODES%%/, $scope.panel.root_nodes? ', rows=' + $scope.panel.root_nodes : '')
        .replace(/%%ROOT_NODES_SORT%%/, $scope.panel.root_nodes_sort? ', sort="' +
            $scope.panel.root_nodes_sort + ' %%ROOT_NODES_SORT_ORDER%%"' : '')
        .replace(/%%ROOT_NODES_SORT_ORDER%%/, $scope.panel.root_nodes_sort_order)
        .replace(/%%JOIN_FIELD%%/g, $scope.panel.join_field)
        .replace(/%%FL%%/g, $scope.panel.join_field + ($scope.panel.root_nodes_sort? ',' + 
          $scope.panel.root_nodes_sort : ''))
        .replace(/%%FROM_FIELD%%/g, $scope.panel.from_field)
        .replace(/%%QUERY%%/, querySrv.getOPQuery().substring(2))
        /* + fq ? + ')' */;

      return graph_expression;
    };

    $scope.build_base_expression = function() {
      var base_expression_template = 'fetch(%%COLLECTION%%, select(' +
        this.build_graph_expression() +
        ', node as %%JOIN_FIELD%%), fl="%%LABEL_FIELD%%", on="%%JOIN_FIELD%%")';

      var base_expression = base_expression_template
        .replace(/%%COLLECTION%%/, dashboard.current.solr.core_name)
        .replace(/%%JOIN_FIELD%%/g, $scope.panel.join_field)
        .replace(/%%LABEL_FIELD%%/, $scope.panel.label_field);

      return base_expression;
    }

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

      var query = 'expr=' + this.build_graph_expression();

      // Set the panel's query
      $scope.panel.queries.query = query;

      request.setQuery(query);

      response = request.streamExpression('graph');

      // Populate scope when we have results
      response.then(function(graph_response) {
        // Check for error and abort if found
        if(!(_.isUndefined(graph_response.error))) {
          $scope.panel.error = $scope.parse_error(graph_response.error.msg);
          $scope.data = [];
          $scope.panelMeta.loading = false;
          $scope.$emit('render');
          return;
        }
        var query = 'expr=' + $scope.build_base_expression();
        request = $scope.sjs.Request().indices(dashboard.indices);
        request.setQuery(query);
        response = request.streamExpression('stream');
        
        response.then(function(base_reponse) {
          // Check for error and abort if found
          if(!(_.isUndefined(base_reponse.error))) {
            $scope.panel.error = $scope.parse_error(base_reponse.error.msg);
            $scope.data = [];
            $scope.panelMeta.loading = false;
            $scope.$emit('render');
            return;
          }

          var x2js = new X2JS();
          $scope.graphML = x2js.xml_str2json(graph_response);

          base_reponse['result-set'].docs.filter(d => d.title_s != undefined).map(d => {
            var node = $scope.graphML.graphml.graph.node.filter(n => n._id === d[$scope.panel.join_field])
              .map(n => n.title = d[$scope.panel.label_field])
          });

          $scope.panelMeta.loading = false;

          $scope.$emit('render');
        });
      });
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

          if (scope.graphML.graphml.graph.node) {
            if (!(scope.graphML.graphml.graph.node instanceof Array))
              nodes.add({id: scope.graphML.graphml.graph.node._id, 
                label: scope.graphML.graphml.graph.node.title? scope.graphML.graphml.graph.node.title.trunc(scope.TRUNC_LENGTH) :
                  scope.graphML.graphml.graph.node._id,
                title: scope.graphML.graphml.graph.node.title});
            else
              scope.graphML.graphml.graph.node.forEach(function(n) {
                nodes.add({id: n._id, label: n.title? n.title.trunc(scope.TRUNC_LENGTH) : n._id, title: n.title});
            });
          }

          if (scope.graphML.graphml.graph.edge) {
            if (scope.graphML.graphml.graph.edge && !(scope.graphML.graphml.graph.edge instanceof Array))
              edges.add({from: scope.graphML.graphml.graph.edge._source, to: scope.graphML.graphml.graph.edge._target});
            else
              scope.graphML.graphml.graph.edge.forEach(function(e) {
                edges.add({from: e._source, to: e._target});
            });
          }
        }
      }
    };
  });
});