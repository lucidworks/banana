/*

  ## Table

  ### Parameters
  * size :: Number of events per page to show
  * pages :: Number of pages to show. size * pages = number of cached events.
             Bigger = more memory usage byh the browser
  * offset :: Position from which to start in the array of hits
  * sort :: An array with 2 elements. sort[0]: field, sort[1]: direction ('asc' or 'desc')
  * style :: hash of css properties
  * fields :: columns to show in table
  * overflow :: 'height' or 'min-height' controls wether the row will expand (min-height) to
                to fit the table, or if the table will scroll to fit the row (height)
  * trimFactor :: If line is > this many characters, divided by the number of columns, trim it.
  * sortable :: Allow sorting?
  * spyable :: Show the 'eye' icon that reveals the last ES query for this panel

*/
define([
  'angular',
  'app',
  'underscore',
  'kbn',
  'moment'
  // 'text!./pagination.html',
  // 'text!partials/querySelect.html'
],
function (angular, app, _, kbn, moment) {
  'use strict';

  var DEBUG = true; // DEBUG mode

  var module = angular.module('kibana.panels.table', []);
  app.useModule(module);
  module.controller('table', function($rootScope, $scope, fields, querySrv, dashboard, filterSrv) {
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
          title:'Paging',
          src: 'app/panels/table/pagination.html'
        },
        {
          title:'Queries',
          src: 'app/partials/querySelect.html'
        }
      ],
      status: "Stable",
      description: "A paginated table of records matching your query or queries. Click on a row to "+
        "expand it and review all of the fields associated with that document. <p>"
    };

    // Set and populate defaults
    var _d = {
      status  : "Stable",
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : 'q=*:*',
        custom      : ''
      },
      size    : 100, // Per page
      pages   : 5,   // Pages available
      offset  : 0,
      
      // sort    : ['_score','desc'],
      sort    : ['event_timestamp','desc'],

      group   : "default",
      style   : {'font-size': '9pt'},
      overflow: 'min-height',
      fields  : [],
      highlight : [],
      sortable: true,
      header  : true,
      paging  : true,
      field_list: true,
      trimFactor: 300,
      normTimes : true,
      spyable : true,
      time_field : 'event_timestamp'
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.Math = Math;
      // Solr
      // $scope.sjs = $scope.sjs || sjsResource(config.solr + config.solr_collection);
      $scope.sjs = $scope.sjs || sjsResource(dashboard.current.solr.server + dashboard.current.solr.core_name);

      $scope.$on('refresh',function(){$scope.get_data();});

      $scope.fields = fields;
      $scope.get_data();
    };

    $scope.percent = kbn.to_percent;

    $scope.toggle_micropanel = function(field,groups) {
      var docs = _.map($scope.data,function(_d){return _d.kibana._source;});
      var topFieldValues = kbn.top_field_values(docs,field,10,groups);
      $scope.micropanel = {
        field: field,
        grouped: groups,
        values : topFieldValues.counts,
        hasArrays : topFieldValues.hasArrays,
        related : kbn.get_related_fields(docs,field),
        count: _.countBy(docs,function(doc){return _.contains(_.keys(doc),field);})['true']
      };
    };

    $scope.micropanelColor = function(index) {
      var _c = ['bar-success','bar-warning','bar-danger','bar-info','bar-primary'];
      return index > _c.length ? '' : _c[index];
    };

    $scope.set_sort = function(field) {
      if($scope.panel.sort[0] === field) {
        $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
      } else {
        $scope.panel.sort[0] = field;
      }
      $scope.get_data();
    };

    $scope.toggle_field = function(field) {
      if (_.indexOf($scope.panel.fields,field) > -1) {
        $scope.panel.fields = _.without($scope.panel.fields,field);
      } else {
        $scope.panel.fields.push(field);
      }
    };

    $scope.toggle_highlight = function(field) {
      if (_.indexOf($scope.panel.highlight,field) > -1) {
        $scope.panel.highlight = _.without($scope.panel.highlight,field);
      } else {
        $scope.panel.highlight.push(field);
      }
    };

    $scope.toggle_details = function(row) {
      row.kibana.details = row.kibana.details ? false : true;
      row.kibana.view = row.kibana.view || 'table';
      //row.kibana.details = !row.kibana.details ? $scope.without_kibana(row) : false;
    };

    $scope.page = function(page) {
      $scope.panel.offset = page*$scope.panel.size;
      $scope.get_data();
    };

    $scope.build_search = function(field,value,negate) {
      var query;
      // This needs to be abstracted somewhere
      if(_.isArray(value)) {
        // TODO: I don't think Solr has "AND" operator in query.
        query = "(" + _.map(value,function(v){return angular.toJson(v);}).join(" AND ") + ")";
      } else if (_.isUndefined(value)) {
        query = '*:*';
        negate = !negate;
      } else {
        query = angular.toJson(value);
      }
      // TODO: Need to take a look here, not sure if need change.
      filterSrv.set({type:'field',field:field,query:query,mandate:(negate ? 'mustNot':'must')});

      $scope.panel.offset = 0;
      dashboard.refresh();
    };

    $scope.fieldExists = function(field,mandate) {
      // TODO: Need to take a look here.
      filterSrv.set({type:'exists',field:field,mandate:mandate});
      dashboard.refresh();
    };

    $scope.get_data = function(segment,query_id) {
      $scope.panel.error =  false;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      $scope.panelMeta.loading = true;
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      // What this segment is for? => to select which indices to query.
      var _segment = _.isUndefined(segment) ? 0 : segment;
      $scope.segment = _segment;

      if(DEBUG) {
        var dummy = new Date(dashboard.current.services.filter.list[0].from).toISOString();
        console.log('table: Begin of get_data():\n\t$scope=',$scope,'\n\t$scope.panel=',$scope.panel,'\n\t_segment='+_segment,'\n\tdashboard.indices[_segment]=',dashboard.indices[_segment],'\n\tdashboard=',dashboard,'\n\tdashboard.current.services.filter.list[0].from='+ dummy,'\n\tquerySrv=',querySrv,'\n\tfilterSrv=',filterSrv);
      }

      // Solr
      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      var request = $scope.sjs.Request().indices(dashboard.indices[_segment]);
      var boolQuery = $scope.sjs.BoolQuery();
      _.each($scope.panel.queries.ids,function(id) {
        boolQuery = boolQuery.should(querySrv.getEjsObj(id));
      });

      request = request.query(
        $scope.sjs.FilteredQuery(
          boolQuery,
          filterSrv.getBoolFilter(filterSrv.ids)  // search time range is provided here.
        ))
        .highlight(
          $scope.sjs.Highlight($scope.panel.highlight)
          .fragmentSize(2147483647) // Max size of a 32bit unsigned int
          .preTags('@start-highlight@')
          .postTags('@end-highlight@')
        )
        .size($scope.panel.size*$scope.panel.pages) // Set the size of query result
        .sort($scope.panel.sort[0],$scope.panel.sort[1]);

      $scope.populate_modal(request);

      // Create a facet to store and pass on time_field value to request.doSearch()
      // var facet = $scope.sjs.RangeFacet('time_facet');
      // facet = facet.field($scope.panel.time_field);
      // request = request.facet(facet);

      if (DEBUG) {
        console.log('table:\n\trequest=',request,'\n\trequest.toString()=',request.toString());
      }

      // TODO: Parse query here and send to request.doSearch()
      // declare default Solr params here
      // get query
      // get from and to time range
      // get query.size
      // construct the query
      // set queryData
      // request = request.setQuery(q);
      // TODO: Validate dashboard.current.services.filter.list[0], what if it is not the timestamp field?
      //       This will cause error.
      var start_time = new Date(dashboard.current.services.filter.list[0].from).toISOString();
      var end_time = new Date(dashboard.current.services.filter.list[0].to).toISOString();
      var fq = '&fq=' + $scope.panel.time_field + ':[' + start_time + '%20TO%20' + end_time + ']';
      var query_size = $scope.panel.size * $scope.panel.pages;
      var df = '&df=message&df=host&df=path&df=type';
      var wt_json = '&wt=json';
      var rows_limit;
      var sorting = '';

      if ($scope.panel.sort[0] !== undefined && $scope.panel.sort[1] !== undefined) {
        sorting = '&sort=' + $scope.panel.sort[0] + ' ' + $scope.panel.sort[1];
      }

      // set the size of query result
      if (query_size !== undefined && query_size !== 0) {
        rows_limit = '&rows=' + query_size;
        // facet_limit = '&facet.limit=' + query_size;
      } else { // default
        rows_limit = '&rows=25';
        // facet_limit = '&facet.limit=10';
      }

      // Set the panel's query
      $scope.panel.queries.query = 'q=' + dashboard.current.services.query.list[0].query + df + wt_json + rows_limit + fq + sorting;

      // Set the additional custom query
      if ($scope.panel.queries.custom != null) {
        // request = request.customQuery($scope.panel.queries.custom);
        request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
      } else {
        request = request.setQuery($scope.panel.queries.query);
      }

      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;

        if(_segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        } else {
          // Fix BUG with wrong total event count.
          $scope.data = [];
        }

        if(DEBUG) {
          console.log('table: results=',results);
          console.log('\t_segment='+_segment+', $scope.hits='+$scope.hits+', $scope.data=',$scope.data,', query_id='+query_id+'\n\t$scope.panel',$scope.panel);
        }

        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          // $scope.panel.error = $scope.parse_error(results.error);
          $scope.panel.error = $scope.parse_error(results.error.msg); // There's also results.error.code
          return;
        }

        // Check that we're still on the same query, if not stop
        if($scope.query_id === query_id) {
          // $scope.data= $scope.data.concat(_.map(results.hits.hits, function(hit) {
            $scope.data = $scope.data.concat(_.map(results.response.docs, function(hit) {
            var _h = _.clone(hit);
            //_h._source = kbn.flatten_json(hit._source);
            //_h.highlight = kbn.flatten_json(hit.highlight||{});

              _h.kibana = {
                // _source : kbn.flatten_json(hit._source),
                // highlight : kbn.flatten_json(hit.highlight||{})
                
                // _source : kbn.flatten_json(hit_object),
                _source : kbn.flatten_json(hit),
                highlight : kbn.flatten_json(hit.highlight||{})
              };
                return _h;
            }));

          // Solr does not need to accumulate hits count because it can get total count
          // from a single faceted query.
          // $scope.hits += results.hits.total;
          $scope.hits = results.response.numFound;

          if (DEBUG) {
            console.log('\t$scope.hits='+$scope.hits+', $scope.data=',$scope.data);
          }

          // NO NEED for sorting here. Solr result is already sorted.
          // Sort the data
          // $scope.data = _.sortBy($scope.data, function(v){
          //   if(!_.isUndefined(v.sort)) {
          //     return v.sort[0];
          //   } else {
          //     return 0;
          //   }
          // });

          // We DO NOT need to reverse here because Solr's result is already sorted.
          // if($scope.panel.sort[1] === 'desc') {
          //   if (DEBUG) { console.log('\tREVERSE IT!!'); }
          //   $scope.data.reverse();
          // }

          // Keep only what we need for the set
          $scope.data = $scope.data.slice(0,$scope.panel.size * $scope.panel.pages);
        } else {
          return;
        }

        // If we're not sorting in reverse chrono order, query every index for
        // size*pages results
        // Otherwise, only get size*pages results then stop querying
        if (($scope.data.length < $scope.panel.size*$scope.panel.pages ||
          !((_.contains(filterSrv.timeField(),$scope.panel.sort[0])) && $scope.panel.sort[1] === 'desc')) &&
          _segment+1 < dashboard.indices.length) {
          $scope.get_data(_segment+1,$scope.query_id);

          if (DEBUG) {
            console.log('\tnot sorting in reverse chrono order!');
          }
        }

      });
    };

    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.without_kibana = function (row) {
      var _c = _.clone(row);
      delete _c.kibana;
      return _c;
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
    };

    $scope.locate = function(obj, path) {
      path = path.split('.');
      var arrayPattern = /(.+)\[(\d+)\]/;
      for (var i = 0; i < path.length; i++) {
        var match = arrayPattern.exec(path[i]);
        if (match) {
          obj = obj[match[1]][parseInt(match[2],10)];
        } else {
          obj = obj[path[i]];
        }
      }
      return obj;
    };


  });

  // This also escapes some xml sequences
  module.filter('tableHighlight', function() {
    return function(text) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.toString().
          replace(/&/g, '&amp;').
          replace(/</g, '&lt;').
          replace(/>/g, '&gt;').
          replace(/\r?\n/g, '<br/>').
          replace(/@start-highlight@/g, '<code class="highlight">').
          replace(/@end-highlight@/g, '</code>');
      }
      return '';
    };
  });

  module.filter('tableTruncate', function() {
    return function(text,length,factor) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.length > length/factor ? text.substr(0,length/factor)+'...' : text;
      }
      return '';
    };
  });



  module.filter('tableJson', function() {
    var json;
    return function(text,prettyLevel) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        json = angular.toJson(text,prettyLevel > 0 ? true : false);
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if(prettyLevel > 1) {
          /* jshint maxlen: false */
          json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'number';
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = 'key strong';
              } else {
                cls = '';
              }
            } else if (/true|false/.test(match)) {
              cls = 'boolean';
            } else if (/null/.test(match)) {
              cls = 'null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
          });
        }
        return json;
      }
      return '';
    };
  });

  // WIP
  module.filter('tableFieldFormat', function(fields){
    return function(text,field,event,scope) {
      var type;
      if(
        !_.isUndefined(fields.mapping[event._index]) &&
        !_.isUndefined(fields.mapping[event._index][event._type])
      ) {
        type = fields.mapping[event._index][event._type][field]['type'];
        if(type === 'date' && scope.panel.normTimes) {
          return moment(text).format('YYYY-MM-DD HH:mm:ss');
        }
      }
      return text;
    };
  });

});