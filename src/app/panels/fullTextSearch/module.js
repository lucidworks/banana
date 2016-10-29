/*

  ## Full Text Search

  ### Parameters
  * size :: Number of events per page to show
  * pages :: Number of pages to show. size * pages = number of cached events.
             Bigger = more memory usage byh the browser
  * offset :: Position from which to start in the array of hits
  * sort :: An array with 2 elements. sort[0]: field, sort[1]: direction ('asc' or 'desc')
  * style :: hash of css properties
  * fields :: fields to be faceted on
  * trimFactor :: If line is > this many characters, divided by the number of columns, trim it.
  * sortable :: Allow sorting?
  * title field :: control the title field that will be show for every document
  * body field :: the field that will be shown as description for each document
  * URL field :: url that will be linked to title field
  * facet limit :: number of values that will be show per field

*/
define([
    'angular',
    'app',
    'underscore',
    'kbn',
    'moment',
    'bootstrap'
  ],
  function(angular, app, _, kbn, moment) {
    'use strict';

    var module = angular.module('kibana.panels.fullTextSearch', []);
    app.useModule(module);
    //app.useModule('ui.bootstrap')
    module.controller('fullTextSearch', function($rootScope, $scope, fields, querySrv, dashboard, filterSrv) {
      $scope.panelMeta = {
        modals: [{
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }],
        editorTabs: [{
          title: 'Paging',
          src: 'app/panels/table/pagination.html'
        }, {
          title: 'Queries',
          src: 'app/partials/querySelect.html'
        }],
        exportfile: true,
        status: "Experimental",
        description: "This panel provide full text search functionality for data"
      };

      // Set and populate defaults
      var _d = {
        status: "Stable",
        queries: {
          mode: 'all',
          ids: [],
          query: '*:*',
          basic_query: '',
          custom: ''
        },
        size: 100, // Per page
        pages: 5, // Pages available
        offset: 0,
        group: "default",
        sort: [],
        style: {
          'font-size': '9pt'
        },
        overflow: 'min-height',
        fields: [],
        highlight: [],
        sortable: false,
        header: true,
        paging: true,
        field_list: true,
        trimFactor: 300,
        normTimes: true,
        spyable: true,
        saveOption: 'json',
        exportSize: 100,
        exportAll: true,
        facet_limit: 10,
        foundResults: true,
        show_queries:true,
      };
      _.defaults($scope.panel, _d);

      $scope.init = function() {
        $scope.Math = Math;
        // Solr
        $scope.sjs = $scope.sjs || sjsResource(dashboard.current.solr.server + dashboard.current.solr.core_name); // jshint ignore:line

        $scope.$on('refresh', function() {
          $scope.get_data();
        });

        $scope.panel.exportSize = $scope.panel.size * $scope.panel.pages;

        $scope.fields = fields;
        $scope.get_data();
      };

      $scope.percent = kbn.to_percent;

      $scope.toggle_micropanel = function(field, groups) {
        var docs = _.map($scope.data, function(_d) {
          return _d.kibana._source;
        });
        var topFieldValues = kbn.top_field_values(docs, field, 10, groups);
        $scope.micropanel = {
          field: field,
          grouped: groups,
          values: topFieldValues.counts,
          hasArrays: topFieldValues.hasArrays,
          related: kbn.get_related_fields(docs, field),
          count: _.countBy(docs, function(doc) {
            return _.contains(_.keys(doc), field);
          })['true']
        };
      };

      $scope.micropanelColor = function(index) {
        var _c = ['bar-success', 'bar-warning', 'bar-danger', 'bar-info', 'bar-primary'];
        return index > _c.length ? '' : _c[index];
      };

      $scope.set_sort = function(field) {
        if ($scope.panel.sort[0] === field) {
          $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
        } else {
          $scope.panel.sort[0] = field;
        }
        $scope.get_data();
      };

      $scope.add_facet_field = function(field) {
        if (_.contains(fields.list, field) && _.indexOf($scope.panel.fields, field) === -1) {
          $scope.panel.fields.push(field);
          $scope.get_data();
        }
      };

      $scope.remove_facet_field = function(field) {
        if (_.contains(fields.list, field) && _.indexOf($scope.panel.fields, field) > -1) {
          $scope.panel.fields = _.without($scope.panel.fields, field);
        }
      };

      $scope.toggle_highlight = function(field) {
        if (_.indexOf($scope.panel.highlight, field) > -1) {
          $scope.panel.highlight = _.without($scope.panel.highlight, field);
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
        $scope.panel.offset = page * $scope.panel.size;
        $scope.get_data();
      };

      $scope.build_search = function(field, value, negate) {
        var query;
        // This needs to be abstracted somewhere
        if (_.isArray(value)) {
          // TODO: I don't think Solr has "AND" operator in query.
          query = "(" + _.map(value, function(v) {
            return angular.toJson(v);
          }).join(" AND ") + ")";
        } else if (_.isUndefined(value)) {
          query = '*:*';
          negate = !negate;
        } else {
          query = angular.toJson(value);
        }
        // TODO: Need to take a look here, not sure if need change.
        filterSrv.set({
          type: 'field',
          field: field,
          query: query,
          mandate: (negate ? 'mustNot' : 'must')
        });

        $scope.panel.offset = 0;
        dashboard.refresh();
      };

      $scope.facet_label = function(key) {

        return filterSrv.translateLanguageKey("facet", key, dashboard.current);
      };

      $scope.fieldExists = function(field, mandate) {
        // TODO: Need to take a look here.
        filterSrv.set({
          type: 'exists',
          field: field,
          mandate: mandate
        });
        dashboard.refresh();
      };

      $scope.get_data = function(segment, query_id) {
        $scope.panel.error = false;
        delete $scope.panel.error;

        // Make sure we have everything for the request to complete
        if (dashboard.indices.length === 0) {
          return;
        }
        $scope.panelMeta.loading = true;
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

        // What this segment is for? => to select which indices to query.
        var _segment = _.isUndefined(segment) ? 0 : segment;
        $scope.segment = _segment;

        $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

        var request = $scope.sjs.Request().indices(dashboard.indices[_segment]);
        var boolQuery = $scope.sjs.BoolQuery();
        _.each($scope.panel.queries.ids, function(id) {
          boolQuery = boolQuery.should(querySrv.getEjsObj(id));
        });

        request = request.query(
          $scope.sjs.FilteredQuery(
            boolQuery,
            filterSrv.getBoolFilter(filterSrv.ids) // search time range is provided here.
          ))
          .highlight(
            $scope.sjs.Highlight($scope.panel.highlight)
            .fragmentSize(2147483647) // Max size of a 32bit unsigned int
            .preTags('@start-highlight@')
            .postTags('@end-highlight@')
        ).size($scope.panel.size * $scope.panel.pages); // Set the size of query result

        $scope.panel_request = request;

        var fq = '';
        if (filterSrv.getSolrFq()) {
          fq = '&' + filterSrv.getSolrFq();
        }
        var query_size = $scope.panel.size * $scope.panel.pages;
        var wt_json = '&wt=json';
        var facet = '&facet=true';
        var facet_fields = '';
        for (var i = 0; i < $scope.panel.fields.length; i++) {
          facet_fields += '&facet.field=' + $scope.panel.fields[i];
        }
        var rows_limit;
        var sorting = '';

        if ($scope.panel.sortable && $scope.panel.sort && $scope.panel.sort[0] !== undefined && $scope.panel.sort[1] !== undefined) {
          sorting = '&sort=' + $scope.panel.sort[0] + ' ' + $scope.panel.sort[1];
        }

        // set the size of query result
        if (query_size !== undefined && query_size !== 0) {
          rows_limit = '&rows=' + query_size;
        } else { // default
          rows_limit = '&rows=25';
        }

        //set highlight part in sole query
        var highlight;
        if ($scope.panel.body_field) {
          highlight = '&hl=true&hl.fl=' + $scope.panel.body_field;
        } else {
          highlight = "";
        }


        // Set the panel's query

        //var query = $scope.panel.searchQuery == null ? querySrv.getQuery(0) : 'q=' + $scope.panel.searchQuery
        $scope.panel.queries.basic_query = querySrv.getORquery() + fq + facet + facet_fields + sorting;
        $scope.panel.queries.query = $scope.panel.queries.basic_query + wt_json + rows_limit + highlight;

        // Set the additional custom query
        if ($scope.panel.queries.custom != null) {
          request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
        } else {
          request = request.setQuery($scope.panel.queries.query);
        }

        var results = request.doSearch();

        // Populate scope when we have results
        results.then(function(results) {
          $scope.panelMeta.loading = false;
          $scope.panel.offset = 0;

          if (_segment === 0) {
            $scope.hits = 0;
            $scope.data = [];
            query_id = $scope.query_id = new Date().getTime();
          } else {
            // Fix BUG with wrong total event count.
            $scope.data = [];
          }

          // Check for error and abort if found
          if (!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error.msg); // There's also results.error.code
            return;
          }

          // Check that we're still on the same query, if not stop
          if ($scope.query_id === query_id) {
            $scope.data = $scope.data.concat(_.map(results.response.docs, function(hit) {
              var _h = _.clone(hit);
              _h.kibana = {
                _source: kbn.flatten_json(hit),
                highlight: kbn.flatten_json(hit.highlighting || {})
              };

              return _h;
            }));

            // Solr does not need to accumulate hits count because it can get total count
            // from a single faceted query.
            $scope.hits = results.response.numFound;
            $scope.panel.foundResults = $scope.hits === 0 ? false : true;
            if (results.highlighting) {
              $scope.highlighting = results.highlighting;
              $scope.highlightingKeys = Object.keys(results.highlighting);

              if ($.isEmptyObject($scope.highlighting[$scope.highlightingKeys[0]])) { // jshint ignore:line
                $scope.highlight_flag = false;
              } else {
                $scope.highlight_flag = true;
              }
            }
            var facet_results = results.facet_counts.facet_fields;
            var facet_data = {};
            _.each($scope.panel.fields, function(field) {
              facet_data[field] = [];
              for (var i = 0; i < facet_results[field].length; i += 2) {
                facet_data[field].push({
                  value: facet_results[field][i],
                  count: facet_results[field][i + 1]
                });
              }
            });
            $scope.facet_data = facet_data;

            // Keep only what we need for the set
            $scope.data = $scope.data.slice(0, $scope.panel.size * $scope.panel.pages);
          } else {
            return;
          }

          // If we're not sorting in reverse chrono order, query every index for
          // size*pages results
          // Otherwise, only get size*pages results then stop querying
          if ($scope.panel.sortable && ($scope.data.length < $scope.panel.size * $scope.panel.pages || !((_.contains(filterSrv.timeField(), $scope.panel.sort[0])) && $scope.panel.sort[1] === 'desc')) &&
            _segment + 1 < dashboard.indices.length) {
            $scope.get_data(_segment + 1, $scope.query_id);
          }

        });
      };

      $scope.exportfile = function(filetype) {
        var omitHeader = '&omitHeader=true';
        var rows_limit = '&rows=' + ($scope.panel.exportSize || ($scope.panel.size * $scope.panel.pages));
        var fl = '';
        if (!$scope.panel.exportAll) {
          fl = '&fl=';
          for (var i = 0; i < $scope.panel.fields.length; i++) {
            fl += $scope.panel.fields[i] + (i !== $scope.panel.fields.length - 1 ? ',' : '');
          }
        }
        var exportQuery = $scope.panel.queries.basic_query + '&wt=' + filetype + omitHeader + rows_limit + fl;
        var request = $scope.panel_request;
        request = request.setQuery(exportQuery);
        var response = request.doSearch();

        response.then(function(response) {
          kbn.download_response(response, filetype, 'fulltextsearch');
        });
      };

      $scope.populate_modal = function(request) {
        $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
      };

      $scope.without_kibana = function(row) {
        var _c = _.clone(row);
        delete _c.kibana;
        return _c;
      };

      $scope.set_refresh = function(state) {
        $scope.refresh = state;
      };

      $scope.close_edit = function() {
        if ($scope.refresh) {
          $scope.get_data();
        }
        $scope.refresh = false;
      };

      $scope.locate = function(obj, path) {
        path = path.split('.');
        var arrayPattern = /(.+)\[(\d+)\]/;
        for (var i = 0; i < path.length; i++) {
          var match = arrayPattern.exec(path[i]);
          if (match) {
            obj = obj[match[1]][parseInt(match[2], 10)];
          } else {
            obj = obj[path[i]];
          }
        }
        return obj;
      };

      // Set term filter when click on the one of facet values
      $scope.set_facet_filter = function(field, value) {
        filterSrv.set({
          type: 'terms',
          field: field,
          value: value
        });
        dashboard.refresh();
      };

      // return the length of the filters with specific field
      // that will be used to detect if the filter is present or not to show close icon beside the facet
      $scope.filter_close = function(field) {
        return filterSrv.idsByTypeAndField('terms', field).length > 0;
      };

      // call close filter when click in close icon
      $scope.delete_filter = function(type, field) {
        filterSrv.removeByTypeAndField(type, field);
        dashboard.refresh();
      };

      // TODO Refactor this jquery code
      // jquery code used to toggle the arrow from up to down when facet is opened
      // also it is used to highlight the header field in faceting

      // jshint ignore:start
      $('.accordion').on('show hide', function(n) {
        $(n.target).siblings('.accordion-heading').find('.accordion-toggle i').toggleClass('icon-chevron-up icon-chevron-down');
        $(n.target).siblings('.accordion-heading').toggleClass('bold');
      });
      // jshint ignore:end

    });



    // This also escapes some xml sequences
    module.filter('tableHighlight', function() {
      return function(text) {
        if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
          var ret = text.toString().
          replace(/^\s*\n/gm, '<br>').
          replace(/<em>/g, '<span class="highlight-code"><b>').
          replace(/<\/em>/g, '</b></span>');

          if (ret.lastIndexOf('<br>', 0) === 0) {
            return ret.replace(/<br>/, "");
          } else {
            return ret;
          }
        }
        return '';
      };
    });

    module.filter('tablebody', function() {
      return function(text) {
        if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
          return text.toString().replace(/^\s*\n/gm, '<br>');
        }
        return '';
      };
    });

    module.filter('tableTruncate', function() {
      return function(text, length, factor) {
        if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0 && length !== 0 && factor !== 0) {
          return text.length > length / factor ? text.substr(0, length / factor) + '...' : text;
        }
        return '';
      };
    });

    module.filter('tableJson', function() {
      var json;
      return function(text, prettyLevel) {
        if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
          json = angular.toJson(text, prettyLevel > 0 ? true : false);
          json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          if (prettyLevel > 1) {
            /* jshint maxlen: false */
            json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(match) {
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
    module.filter('tableFieldFormat', function(fields) {
      return function(text, field, event, scope) {
        var type;
        if (!_.isUndefined(fields.mapping[event._index]) && !_.isUndefined(fields.mapping[event._index][event._type])) {
          type = fields.mapping[event._index][event._type][field]['type'];
          if (type === 'date' && scope.panel.normTimes) {
            return moment(text).format('YYYY-MM-DD HH:mm:ss');
          }
        }
        return text;
      };
    });

  });
