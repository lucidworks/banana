/*

  ## Anomaly Detection

  ### Parameters
  * auto_int :: Auto calculate data point interval?
  * resolution ::  If auto_int is enables, shoot for this many data points, rounding to
                    sane intervals
  * interval :: Datapoint interval in elasticsearch date math format (eg 1d, 1w, 1y, 5y)
  * fill :: Only applies to line charts. Level of area shading from 0-10
  * linewidth ::  Only applies to line charts. How thick the line should be in pixels
                  While the editor only exposes 0-10, this can be any numeric value.
                  Set to 0 and you'll get something like a scatter plot
  * timezone :: This isn't totally functional yet. Currently only supports browser and utc.
                browser will adjust the x-axis labels to match the timezone of the user's
                browser
  * spyable ::  Dislay the 'eye' icon that show the last elasticsearch query
  * zoomlinks :: Show the zoom links?
  * bars :: Show bars in the chart
  * stack :: Stack multiple queries. This generally a crappy way to represent things.
             You probably should just use a line chart without stacking
  * points :: Should circles at the data points on the chart
  * lines :: Line chart? Sweet.
  * legend :: Show the legend?
  * x-axis :: Show x-axis labels and grid lines
  * y-axis :: Show y-axis labels and grid lines
  * interactive :: Allow drag to select time range

*/
define([
  'angular',
  'app',
  'jquery',
  'underscore',
  'kbn',
  'moment',
  './timeSeries'
],
function (angular, app, $, _, kbn, moment, timeSeries) {
  'use strict';
  var module = angular.module('kibana.panels.ad', []);
  app.useModule(module);

  var DEBUG = true;
  console.log('DEBUG : ' + DEBUG);
  module.controller('ad', function($scope, $q, $http, querySrv, dashboard, filterSrv, alertSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {
          title:'Queries',
          src:'app/partials/querySelect.html'
        }
      ],
      status  : "Stable",
      description : "A bucketed time series chart of the current query, including all applied time and non-time filters, when used in <i>count</i> mode. Uses Solr’s facet.range query parameters. In <i>values</i> mode, it plots the value of a specific field over time, and allows the user to group field values by a second field."
    };

    // Set and populate defaults
    var _d = {
      mode        : 'value',
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      max_rows    : 1000,  // maximum number of rows returned from Solr (also use this for group.limit to simplify UI setting)
      reverse     : 0,
      group_field : null,
      auto_int    : true,
	  total_first : '%',
	  fontsize    : 20,
	  field_color : '#209bf8',
      resolution  : 100,
	  value_sort  : 'rs_timestamp',
      interval    : '5m',
      intervals   : ['auto','1s','1m','5m','10m','30m','1h','3h','12h','1d','1w','1M','1y'],
      fill        : 0,
      linewidth   : 3,
	  chart       : 'stacking',
      chartColors : ['#209bf8', '#f4d352','#ccf452','#8cf452','#3cee2b','#f467d8','#2fd7ee'],
      timezone    : 'browser', // browser, utc or a standard timezone
      spyable     : true,
      zoomlinks   : true,
      bars        : true,
      stack       : true,
	  label       : true,
      points      : false,
      lines       : false,
      lines_smooth: false, // Enable 'smooth line' mode by removing zero values from the plot.
      legend      : true,
      'x-axis'    : true,
      'y-axis'    : true,
      percentage  : false,
      interactive : true,
      options     : true,
      show_queries: true,
      tooltip     : {
        value_type: 'cumulative',
        query_as_alias: false
      },
      jobid : '',
      job_status: 'Ready',
      metrics: ['ACTIVE_TRACE_FAST', 'ACTIVE_TRACE_NORMAL', 'ACTIVE_TRACE_SLOW', 'ACTIVE_TRACE_VERY_SLOW', 'CPU_LOAD_JVM', 'JVM_GC_OLD_TIME', 'JVM_GC_OLD_COUNT', 'TPS_TOTAL', 'JVM_MEMORY_NON_HEAP_USED']
    };

    _.defaults($scope.panel,_d);

    $scope.init = function() {
      // Hide view options by default
      if (DEBUG) console.log('init');
      $scope.options = false;
      $scope.$on('refresh',function(){
        $scope.get_data();
      });

      $scope.get_data();

    };

    $scope.set_interval = function(interval) {
      if(interval !== 'auto') {
        $scope.panel.auto_int = false;
        $scope.panel.interval = interval;
      } else {
        $scope.panel.auto_int = true;
      }
    };

    $scope.interval_label = function(interval) {
      return $scope.panel.auto_int && interval === $scope.panel.interval ? interval+" (auto)" : interval;
    };

    $scope.set_refresh = function (state) {
        $scope.refresh = state;
        // if 'count' mode is selected, set decimal_points to zero automatically.
        if ($scope.panel.mode === 'count') {
            $scope.panel.decimal_points = 0;
        }
        $scope.get_data();
    };

    /**
     * The time range effecting the panel
     * @return {[type]} [description]
     */
    $scope.get_time_range = function () {
        var range = $scope.range = filterSrv.timeRange('min');
        return range;
    };

    $scope.get_interval = function () {
        var interval = $scope.panel.interval,
                        range;
        if ($scope.panel.auto_int) {
            range = $scope.get_time_range();
            if (range) {
                interval = kbn.secondsToHms(
                    kbn.calculate_interval(range.from, range.to, $scope.panel.resolution, 0) / 1000
                );
            }
        }
        $scope.panel.interval = interval || '10m';
        return $scope.panel.interval;
    };

    /**
     * Fetch the data for a chunk of a queries results. Multiple segments occur when several indicies
     * need to be consulted (like timestamped logstash indicies)
     *
     * The results of this function are stored on the scope's data property. This property will be an
     * array of objects with the properties info, time_series, and hits. These objects are used in the
     * render_panel function to create the historgram.
     *
     * !!! Solr does not need to fetch the data in chunk because it uses a facet search and retrieve
     * !!! all events from a single query.
     *
     * @param {number} segment   The segment count, (0 based)
     * @param {number} query_id  The id of the query, generated on the first run and passed back when
     *                            this call is made recursively for more segments
     */
    $scope.get_data = function(segment, query_id) {
      if (DEBUG) console.log('get data start.');
      if (_.isUndefined(segment)) {
        segment = 0;
      }
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      var _range = $scope.get_time_range();
      var _interval = $scope.get_interval(_range);

      if ($scope.panel.auto_int) {
        $scope.panel.interval = kbn.secondsToHms(
          kbn.calculate_interval(_range.from,_range.to,$scope.panel.resolution,0)/1000);
      }

      $scope.panelMeta.loading = true;

      // Solr
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      var request = $scope.sjs.Request().indices(dashboard.indices[segment]);
      // $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);


      $scope.panel.queries.query = "";
      // Build the query
      _.each($scope.panel.queries.ids, function(id) {
        var query = $scope.sjs.FilteredQuery(
          querySrv.getEjsObj(id),
          filterSrv.getBoolFilter(filterSrv.ids)
        );

        var facet = $scope.sjs.DateHistogramFacet(id);
        
      });

      if(_.isNull($scope.panel.value_field)) {
        $scope.panel.error = "In " + $scope.panel.mode + " mode a field must be specified";
        return;
      }


      // Build Solr query
      var fq = '';
      if (filterSrv.getSolrFq()) {
        fq = '&' + filterSrv.getSolrFq();
      }

      var time_field = filterSrv.getTimeField();
      var start_time = filterSrv.getStartTime();
      var end_time = filterSrv.getEndTime();

      $scope.panel.start_time = start_time;
      $scope.panel.end_time = end_time;

      // facet.range.end does NOT accept * as a value, need to convert it to NOW
      if (end_time === '*') {
          end_time = 'NOW';
      }


      var wt_json = '&wt=json';
      var metric_field = $scope.panel.metric_field;
      var anomaly_th = $scope.panel.anomaly_th;
      var sort_field = '&sort='+'timestamp_l'+'%20asc';
      var rows_limit = '&rows='+$scope.panel.max_rows;
      var facet = '';
      var fl = '&fl=' + 'timestamp_l%20anomaly_value_d%20value_d';
      fq = fq + '&fq=anomaly_value_d:[' + anomaly_th + '%20TO%20*]'; 

      var mypromises = [];
      var arr_id = [];
      var index = 0;
      // $scope.panel.metrics = ['ACTIVE_TRACE_FAST', 'ACTIVE_TRACE_NORMAL', 'ACTIVE_TRACE_SLOW', 'ACTIVE_TRACE_VERY_SLOW', 'CPU_LOAD_JVM', 'JVM_GC_OLD_TIME', 'JVM_GC_OLD_COUNT', 'TPS_TOTAL'];
      _.each($scope.panel.metrics, function(metric) {
        var temp_q = 'q=' + metric_field + ':' + metric + wt_json + rows_limit + fq + facet + fl + sort_field;
        $scope.panel.queries.query += temp_q + "\n";
        if ($scope.panel.queries.custom !== null) {
          request = request.setQuery(temp_q + $scope.panel.queries.custom);
        } else {
          request = request.setQuery(temp_q);
        }
        mypromises.push(request.doSearch());
        arr_id.push(index);
        index += 1;
      });

      $scope.data = [];
      alert{123214214142}；
      if (dashboard.current.services.query.ids.length >= 1) {
        $q.all(mypromises).then(function(results) {
          $scope.panelMeta.loading = false;
          // Convert facet ids to numbers
          // var facetIds = _.map(_.keys(results.facets),function(k){return parseInt(k, 10);});
          //var facetIds = [0]; // Need to fix this

          // Make sure we're still on the same query/queries
          // TODO: We probably DON'T NEED THIS unless we have to support multiple queries in query module.
          // if ($scope.query_id === query_id && _.difference(facetIds, $scope.panel.queries.ids).length === 0) {
          var i = 0,
            time_series,
            hits;

          _.each(arr_id, function(id,index) {
            // Check for error and abort if found
            if (!(_.isUndefined(results[index].error))) {
              $scope.panel.error = $scope.parse_error(results[index].error.msg);
             return;
            }
            // we need to initialize the data variable on the first run,
            // and when we are working on the first segment of the data.
            if (_.isUndefined($scope.data[i]) || segment === 0) {
              time_series = new timeSeries.ZeroFilled({
                interval: _interval,
                start_date: _range && _range.from,
                end_date: _range && _range.to,
                fill_style: 'minimal'
              });
              hits = 0;
            } else {
              time_series = $scope.data[i].time_series;
              hits = 0;
              $scope.hits = 0;
            }
            var entry_time, entries, entry_value;
            $scope.data[i] = results[index].response.docs;
            i++;
          });

          // Tell the histogram directive to render.
          $scope.$emit('render');
        });
      }
    };
  });

  module.directive('adChart', function(querySrv,dashboard,filterSrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        // Re-render if the window is resized
        angular.element(window).bind('resize', function(){
          render_panel();
        });

        // Function for rendering panel
        function render_panel() {
          var plot, chartData;
          var colors = [];

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
		      
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          // alert(chartData);


//        begin to drow chart

            var graph_id = scope.$id;

            // var metric = scope.panel.metric_field;
            // var labelcolor = false;

            // if (dashboard.current.style === 'dark'){
            //   labelcolor = true;
            // }

            // var graph = echarts.init(dobument.getElementById(graph_id));

              // This variation on ForceDirectedLayout does not move any selected
            // Nodes
            // but does move all other nodes (vertexes).
            function ContinuousForceDirectedLayout() {
              go.ForceDirectedLayout.call(this);
                this._isObserving = false;
            }
            go.Diagram.inherit(ContinuousForceDirectedLayout, go.ForceDirectedLayout);

            /** @override */
            ContinuousForceDirectedLayout.prototype.isFixed = function(v) {
                return v.node.isSelected;
            }

            // optimization: reuse the ForceDirectedNetwork rather than re-create it
            // each time
            /** @override */
            ContinuousForceDirectedLayout.prototype.doLayout = function(coll) {
              if (!this._isObserving) {
                this._isObserving = true;
                // cacheing the network means we need to recreate it if nodes or
              // links have been added or removed or relinked,
                  // so we need to track structural model changes to discard the saved
              // network.
                var lay = this;
                this.diagram.addModelChangedListener(function (e) {
                    // modelChanges include a few cases that we don't actually care
                // about, such as
                    // "nodeCategory" or "linkToPortId", but we'll go ahead and recreate
                // the network anyway.
                    // Also clear the network when replacing the model.
                    if (e.modelChange !== "" || (e.change === go.ChangedEvent.Transaction && e.propertyName === "StartingFirstTransaction")) {
                      lay.network = null;
                    }
                  });
                }
                var net = this.network;
                if (net === null) {                                  // the first time, just create the network as
                                                           // normal
                  this.network = net = this.makeNetwork(coll);
                } else {                                             // but on reuse we need to update the LayoutVertex.bounds
                                                             // for selected nodes
                  this.diagram.nodes.each(function (n) {
                    var v = net.findVertex(n);
                    if (v !== null) v.bounds = n.actualBounds;
                  });
                }
                // now perform the normal layout
                go.ForceDirectedLayout.prototype.doLayout.call(this, coll);
                // doLayout normally discards the LayoutNetwork by setting
              // Layout.network to null;
                // here we remember it for next time
                this.network = net;
            }
            // end ContinuousForceDirectedLayout

            function drawGraph(nodeDataArray, linkDataArray, graph_id) {
              var $ = go.GraphObject.make;  // for conciseness in defining templates
              
              myDiagram =
                $(go.Diagram, graph_id,  // create a Diagram for the DIV HTML
                                // element
                {
                  initialAutoScale: go.Diagram.Uniform,   // an initial automatic
                                      // zoom-to-fit
                      contentAlignment: go.Spot.Center,       // align document to the
                                      // center of the
                                      // viewport
                      layout:
                          $(ContinuousForceDirectedLayout,    // automatically spread
                                          // nodes apart while
                                      // dragging
                          { defaultSpringLength: 30, defaultElectricalCharge: 100 }),
                          // do an extra layout at the end of a move
                          "SelectionMoved": function(e) { e.diagram.layout.invalidateLayout(); }
                });
              
              myDiagram.toolManager.draggingTool.doMouseMove = function() {
                  go.DraggingTool.prototype.doMouseMove.call(this);
                  if (this.isActive) { this.diagram.layout.invalidateLayout(); }
              }
              
                    // These nodes have text surrounded by a rounded rectangle
                    // whose fill color is bound to the node data.
                    // The user can drag a node by dragging its TextBlock label.
                    // Dragging from the Shape will start drawing a new link.
                myDiagram.nodeTemplate =
                  $(go.Node, "Auto",  // the whole node panel define the node's outer shape, which will surround the TextBlock
                  $(go.Shape, "Circle",
                    { fill: "CornflowerBlue", stroke: "black", spot1: new go.Spot(0, 0, 5, 5), spot2: new go.Spot(1, 1, -5, -5) }),
                  $(go.TextBlock,
                    { font: "bold 10pt helvetica, bold arial, sans-serif", textAlign: "center", maxSize: new go.Size(100, NaN) },
                    new go.Binding("text", "key")),
                    {
                        click: function(e, obj) { window.selected_var=obj.part.data.key;showMessage(obj.part.data.key); },
                        selectionChanged: function(part) {
                        var shape = part.elt(0);
                        shape.fill = part.isSelected ? "red" : "CornflowerBlue";
                        }
                    }
                  );
              
                    // The link shape and arrowhead have their stroke brush data
                  // bound to the "color" property
              myDiagram.linkTemplate =
                $(go.Link,  // the whole link panel
                  $(go.Shape,  // the link shape
                    { stroke: "black" }),
                  $(go.Shape,  // the arrowhead
                    { toArrow: "standard", stroke: null })
                  );
              myDiagram.model = new go.GraphLinksModel(nodeDataArray, linkDataArray);
            }
            
            function reload() {
                //myDiagram.layout.network = null;
                var text = myDiagram.model.toJson();
                myDiagram.model = go.Model.fromJson(text);
                //myDiagram.layout =
                //  go.GraphObject.make(ContinuousForceDirectedLayout,  // automatically spread nodes apart while dragging
                //    { defaultSpringLength: 30, defaultElectricalCharge: 100 });
            }
            
            function showMessage(s) {
              alert("klick: "+s+".");
            }

            // drawGraph(nodeDataArray, linkDataArray, graph_id);
          
        }
      }
    };
  });


});
