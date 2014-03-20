/*
  ## Terms

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
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var DEBUG = true; // DEBUG mode

  var module = angular.module('kibana.panels.terms', []);
  app.useModule(module);

  module.controller('terms', function($scope, querySrv, dashboard, filterSrv) {
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
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Beta",
      description : "Displays the results of a Solr facet as a pie chart, bar chart, or a "+
        "table"
    };

    // Set and populate defaults
    var _d = {
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : 'q=*:*',
        custom      : ''
      },
      field   : 'type',
      exclude : [],
      missing : true,
      other   : true,
      size    : 10,
      order   : 'count',
      style   : { "font-size": '10pt'},
      donut   : false,
      tilt    : false,
      labels  : true,
      arrangement : 'horizontal',
      chart       : 'bar',
      counter_pos : 'above',
      spyable     : true,
      time_field  : 'event_timestamp'
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.hits = 0;

      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

    };

    $scope.get_data = function() {
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      $scope.panelMeta.loading = true;
      var request,
        results,
        boolQuery;

      //Solr
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      if (DEBUG) {
        console.log('terms:\n\tdashboard',dashboard,'\n\tquerySrv=',querySrv,'\n\tfilterSrv=',filterSrv);
      }

      request = $scope.sjs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      // This could probably be changed to a BoolFilter
      boolQuery = $scope.sjs.BoolQuery();
      _.each($scope.panel.queries.ids,function(id) {
        boolQuery = boolQuery.should(querySrv.getEjsObj(id));
      });

      // Terms mode
      request = request
        .facet($scope.sjs.TermsFacet('terms')
          .field($scope.panel.field)
          .size($scope.panel.size)
          .order($scope.panel.order)
          .exclude($scope.panel.exclude)
          .facetFilter($scope.sjs.QueryFilter(
            $scope.sjs.FilteredQuery(
              boolQuery,
              filterSrv.getBoolFilter(filterSrv.ids)
              )))).size(0);

      // Use request.size to limit the facet query (is this a good idea?)
      request = request.size($scope.panel.size);

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      // Create a facet to store and pass on time_field value to request.doSearch()
      var facet = $scope.sjs.RangeFacet('time_facet');
      facet = facet.field($scope.panel.time_field);
      request = request.facet(facet);

      // Build Solr query
      // TODO: Validate dashboard.current.services.filter.list[0], what if it is not the timestamp field?
      //       This will cause error.
      var start_time = new Date(dashboard.current.services.filter.list[0].from).toISOString();
      var end_time = new Date(dashboard.current.services.filter.list[0].to).toISOString();
      var fq = '&fq=' + $scope.panel.time_field + ':[' + start_time + '%20TO%20' + end_time + ']';
      // var query_size = $scope.panel.size * $scope.panel.pages;
      var df = '&df=message&df=host&df=path&df=type';
      var wt_json = '&wt=json';
      var rows_limit = '&rows=0' // for terms, we do not need the actual response doc, so set rows=0
      var facet_gap = '%2B1DAY';
      var facet = '&facet=true' +
                  '&facet.field=' + $scope.panel.field +
                  '&facet.range=' + $scope.panel.time_field +
                  '&facet.range.start=' + start_time +
                  '&facet.range.end=' + end_time +
                  '&facet.range.gap=' + facet_gap +
                  '&facet.limit=' + $scope.panel.size;
      var filter_fq = '';
      var filter_either = [];

      // Apply filters to the query
      _.each(dashboard.current.services.filter.list, function(v,k) {
        // Skip the timestamp filter because it's already applied to the query using fq param.
        // timestamp filter should be in k = 0
        if (k > 0 && v.field != $scope.panel.time_field && v.active) {
          if (DEBUG) { console.log('terms: k=',k,' v=',v); }
          if (v.mandate == 'must') {
            filter_fq = filter_fq + '&fq=' + v.field + ':' + v.value;
          } else if (v.mandate == 'mustNot') {
            filter_fq = filter_fq + '&fq=-' + v.field + ':' + v.value;
          } else if (v.mandate == 'either') {
            filter_either.push(v.field + ':' + v.value);
          }
        }
      });
      // parse filter_either array values, if exists
      if (filter_either.length > 0) {
        filter_fq = filter_fq + '&fq=(' + filter_either.join(' OR ') + ')';
      }

      // Set the panel's query
      $scope.panel.queries.query = 'q=' + dashboard.current.services.query.list[0].query + df + wt_json + rows_limit + fq + facet + filter_fq;

      // Set the additional custom query
      if ($scope.panel.queries.custom != null) {
        // request = request.customQuery($scope.panel.queries.custom);
        request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
      } else {
        request = request.setQuery($scope.panel.queries.query);
      }

      results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        if (DEBUG) {
          console.log('terms: results=',results);
        }

        var k = 0;
        $scope.panelMeta.loading = false;
        // $scope.hits = results.hits.total;
        $scope.hits = results.response.numFound;

        $scope.data = [];
        // _.each(results.facets.terms.terms, function(v) {
        //   var slice = { label : v.term, data : [[k,v.count]], actions: true};
        //   $scope.data.push(slice);
        //   k = k + 1;
        // });
        _.each(results.facet_counts.facet_fields, function(v) {
          for (var i = 0; i < v.length; i++) {
            var term = v[i];
            i++;
            var count = v[i];
            // if count = 0, do not add it to the chart, just skip it
            if (count == 0) continue;
            var slice = { label : term, data : [[k,count]], actions: true};
            $scope.data.push(slice);
            k = k + 1;  
          };
        });

        $scope.data.push({label:'Missing field',
          // data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});

          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
          data:[[k,0]],meta:"missing",color:'#aaa',opacity:0});
        $scope.data.push({label:'Other values',
          // data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});

          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'other' value. 
          data:[[k+1,0]],meta:"other",color:'#444'});

        $scope.$emit('render');
      });
    };

    $scope.build_search = function(term,negate) {
      if(_.isUndefined(term.meta)) {
        filterSrv.set({type:'terms',field:$scope.panel.field,value:term.label,
          mandate:(negate ? 'mustNot':'must')});
      } else if(term.meta === 'missing') {
        filterSrv.set({type:'exists',field:$scope.panel.field,
          mandate:(negate ? 'must':'mustNot')});
      } else {
        return;
      }
      dashboard.refresh();
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.showMeta = function(term) {
      if(_.isUndefined(term.meta)) {
        return true;
      }
      if(term.meta === 'other' && !$scope.panel.other) {
        return false;
      }
      if(term.meta === 'missing' && !$scope.panel.missing) {
        return false;
      }
      return true;
    };

  });

  module.directive('termsChart', function(querySrv) {
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

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          // Populate element.
          require(['jquery.flot.pie'], function(){
            // Populate element
            try {
              // Add plot to scope so we can build out own legend
              if(scope.panel.chart === 'bar') {
                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    lines:  { show: false, },
                    bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                    shadowSize: 1
                  },
                  yaxis: { show: true, min: 0, color: "#c8c8c8" },
                  xaxis: { show: false },
                  grid: {
                    borderWidth: 0,
                    borderColor: '#eee',
                    color: "#eee",
                    hoverable: true,
                    clickable: true
                  },
                  colors: querySrv.colors
                });
              }
              if(scope.panel.chart === 'pie') {
                var labelFormat = function(label, series){
                  return '<div ng-click="build_search(panel.field,\''+label+'\')'+
                    ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                    label+'<br/>'+Math.round(series.percent)+'%</div>';
                };

                plot = $.plot(elem, chartData, {
                  legend: { show: false },
                  series: {
                    pie: {
                      innerRadius: scope.panel.donut ? 0.4 : 0,
                      tilt: scope.panel.tilt ? 0.45 : 1,
                      radius: 1,
                      show: true,
                      combine: {
                        color: '#999',
                        label: 'The Rest'
                      },
                      stroke: {
                        width: 0
                      },
                      label: {
                        show: scope.panel.labels,
                        radius: 2/3,
                        formatter: labelFormat,
                        threshold: 0.1
                      }
                    }
                  },
                  //grid: { hoverable: true, clickable: true },
                  grid:   { hoverable: true, clickable: true },
                  colors: querySrv.colors
                });
              }

              // Populate legend
              if(elem.is(":visible")){
                setTimeout(function(){
                  scope.legend = plot.getData();
                  if(!scope.$$phase) {
                    scope.$apply();
                  }
                });
              }

            } catch(e) {
              elem.text(e);
            }
          });
        }

        elem.bind("plotclick", function (event, pos, object) {
          if(object) {
            scope.build_search(scope.data[object.seriesIndex]);
          }
        });

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar' ? item.datapoint[1] : item.datapoint[1][0][1];
            $tooltip
              .html(
                kbn.query_color_dot(item.series.color, 20) + ' ' +
                item.series.label + " (" + value.toFixed(0)+")"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });

      }
    };
  });

});