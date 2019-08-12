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
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.significantTerms', []);
  app.useModule(module);

  module.controller('significantTerms', function($scope, $timeout, timer, querySrv, dashboard, filterSrv) {
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
      $scope.hits = 0;
      $scope.panel.mindoc_freq = 5;
      $scope.panel.maxdoc_freq = 0.3;
      $scope.panel.minterm_len = 4;

      // Start refresh timer if enabled
      if ($scope.panel.refresh.enable) {
        $scope.set_timer($scope.panel.refresh.interval);
      }

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

      var expression = 'expr=significantTerms(' + dashboard.current.solr.core_name + ','
        + querySrv.getOPQuery() + fq + ',field=' + $scope.panel.field
        + ',limit=' + $scope.panel.size + ',minDocFreq=' + $scope.panel.mindoc_freq
        + ',maxDocFreq=' + $scope.panel.maxdoc_freq  + ',minTermLength='
        + $scope.panel.minterm_len  + ')';

      return expression;
    };

    $scope.set_timer = function(refresh_interval) {
      $scope.panel.refresh.interval = refresh_interval;
      if (_.isNumber($scope.panel.refresh.interval)) {
        timer.cancel($scope.refresh_timer);
        $scope.realtime();
      } else {
        timer.cancel($scope.refresh_timer);
      }
    };

    $scope.realtime = function() {
      if ($scope.panel.refresh.enable) {
        timer.cancel($scope.refresh_timer);

        $scope.refresh_timer = timer.register($timeout(function() {
          $scope.realtime();
          $scope.get_data();
        }, $scope.panel.refresh.interval*1000));
      } else {
        timer.cancel($scope.refresh_timer);
      }
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

      results = request.streamExpression();

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
        var addSliceColor = function(slice,color) {
          if ($scope.panel.useColorFromField && isValidHTMLColor(color)) {
            slice.color = color;
          }
          return slice;
        };

        var sum = 0;
        var k = 0;
        var missing =0;
        $scope.panelMeta.loading = false;
        $scope.hits = results['result-set'].docs.length;
        $scope.data = [];

        if ($scope.panel.mode === 'count') {
          // In count mode, the y-axis min should be zero because count value cannot be negative.
          $scope.yaxis_min = 0;
          _.each(results['result-set'].docs, function(v) {
            if (v.EOF) return;
            
            var term = v.term;
            if (term === null) {
              missing = count;
            } else {
              // if count = 0, do not add it to the chart, just skip it
              if (v.score === 0) { return; }
              var slice = { label : term, data : [[k, v.score, v.foreground, v.background]], actions: true};
              slice = addSliceColor(slice,term);
              $scope.data.push(slice);
            }
          });
        }
        // Sort the results
        $scope.data = _.sortBy($scope.data, function(d) {
          return $scope.panel.sortBy === 'index' ? d.label : d.data[0][1];
        });
        if ($scope.panel.order === 'descending') {
          $scope.data.reverse();
        }

        // Slice it according to panel.size, and then set the x-axis values with k.
        $scope.data = $scope.data.slice(0,$scope.panel.size);
        _.each($scope.data, function(v) {
          v.data[0][0] = k;
          k++;
        });

        if ($scope.panel.field && $scope.fields.typeList[$scope.panel.field] && $scope.fields.typeList[$scope.panel.field].schema.indexOf("T") > -1) {
          $scope.hits = sum;
        }

        $scope.data.push({label:'Missing field',
          // data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});
          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'missing' value.
          data:[[k,missing]],meta:"missing",color:'#aaa',opacity:0});
        $scope.data.push({label:'Other values',
          // data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});
          // TODO: Hard coded to 0 for now. Solr faceting does not provide 'other' value.
          data:[[k+1,$scope.hits-sum]],meta:"other",color:'#444'});

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

});
