/*
  ## Significant Terms

  ### Parameters
  * size :: top N
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
      }
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

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

    $scope.build_expression = function() {
      var fq = '';
      if (filterSrv.getSolrFq()) {
        fq = ',' + filterSrv.getSolrFq(false, ',');
      }

      var expression = $scope.panel.expression + /* fq ? */ + ')';

      return expression;
    };

    $scope.get_data = function() {
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      delete $scope.panel.error;
      $scope.panelMeta.loading = true;
      var request, results;

      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      request = $scope.sjs.Request().indices(dashboard.indices);
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var query = this.build_expression('json', false);

      // Set the panel's query
      $scope.panel.queries.query = query;

      request.setQuery(query);

      results = request.streamExpression('graph');

      // Populate scope when we have results
      results.then(function(results) {
        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error.msg);
          $scope.data = [];
          $scope.panelMeta.loading = false;
          $scope.$emit('render');
          return;
        }

        var x2js = new X2JS();
        $scope.graphML = x2js.xml_str2json(results);

        $scope.panelMeta.loading = false;

        $scope.$emit('render');
      });
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
      // if 'count' mode is selected, set decimal_points to zero automatically.
      if ($scope.panel.mode === 'count') {
        $scope.panel.decimal_points = 0;
      }
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
            height = parseInt(scope.row.height),
            width = parent_width - 20;

          var nodes = new vis.DataSet();

          // create an array with edges
          var edges = new vis.DataSet();

          // provide the data in the vis format
          var data = {
            nodes: nodes,
            edges: edges
          };
          var options = {height: height, edges: {arrows: {to: {enabled: true, scaleFactor: 0.5}}}};

          // initialize your network!
          var network = new vis.Network(element[0], data, options);

          if (!(scope.graphML.graphml.graph.node instanceof Array))
            nodes.add({id: scope.graphML.graphml.graph.node._id, label: scope.graphML.graphml.graph.node._id});
          else
            scope.graphML.graphml.graph.node.forEach(function(n) {
              nodes.add({id: n._id, label: n._id});
          });

          if (!(scope.graphML.graphml.graph.edge instanceof Array))
            edges.add({from: scope.graphML.graphml.graph.edge._source, to: scope.graphML.graphml.graph.edge._target});
          else
            scope.graphML.graphml.graph.edge.forEach(function(e) {
              edges.add({from: e._source, to: e._target});
          });
        }
      }
    };
  });
});