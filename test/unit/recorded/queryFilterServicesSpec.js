'use strict';

// querySrv and filterSrv hold the state of a dashboard (its queries and filters) and turn it into the parameters
// of a Solr request. They do not call the server themselves, so the recorded part of these specs is the
// dashboard they start from (the one saved in the recorded blob) and the request they build, compared with the
// request that was recorded. They run in both modes: the settings differ, the services must not.
['fusion', 'solr'].forEach(function (mode) {
  describe('querySrv and filterSrv on the recorded dashboard (' + mode + ' mode)', function () {
    var angular = require('angular');
    var helpers = require('../helpers/injector');
    var fixtures = require('../helpers/fixtures');
    var modes = require('../helpers/modes');

    modes.useMode(mode);

    var injector, $httpBackend, dashboard, querySrv, filterSrv;

    beforeEach(function () {
      injector = helpers.createInjector();
      $httpBackend = injector.get('$httpBackend');
      if (mode === 'fusion') {
        fixtures.respond($httpBackend.expectGET(/\/api\/session$/), fixtures.load('fusion-5.9.16/session'));
      }
      dashboard = injector.get('dashboard');
      if (mode === 'fusion') { $httpBackend.flush(); }
      var blob = fixtures.load('fusion-5.9.16/blob-read').response.body[0];
      var dash = JSON.parse(blob.banana_dashboard_s);
      dash.solr.server = mode === 'fusion' ? '/api/query-pipelines/_system/collections/' : '/solr/';
      dashboard.dash_load(dash);
      querySrv = injector.get('querySrv');
      filterSrv = injector.get('filterSrv');
    });

    it('starts the dashboard with one match-all query and no filter', function () {
      expect(querySrv.ids).toEqual([0]);
      expect(querySrv.list[0].query).toBe('*:*');
      expect(filterSrv.ids).toEqual([]);
      expect(filterSrv.getSolrFq()).toBe('');
    });

    it('builds the query and filter parameters of the recorded request', function () {
      var recorded = fixtures.load('fusion-5.9.16/select-top-values-with-fq');
      filterSrv.set({ type: 'querystring', query: 'level_s:ERROR', mandate: 'must' });
      var built = fixtures.params(querySrv.getOPQuery() + '&' + filterSrv.getSolrFq());
      var sent = fixtures.recordedParams(recorded);
      expect(built.q).toEqual(sent.q);
      expect(built.fq).toEqual(sent.fq);
    });

    it('turns a time range into the range filter that the range facet request carries', function () {
      filterSrv.set({ type: 'time', field: 'timestamp_tdt', from: 'NOW-10YEARS/DAY', to: 'NOW' });
      expect(filterSrv.getSolrFq()).toBe('fq=timestamp_tdt:[NOW-10YEARS/DAY%20TO%20NOW]');
      var recorded = fixtures.recordedParams(fixtures.load('fusion-5.9.16/select-range-facet'));
      expect(recorded['facet.range.start']).toEqual([filterSrv.getStartTime()]);
      expect(recorded['facet.range.end']).toEqual([filterSrv.getEndTime()]);
    });

    describe('querySrv', function () {
      it('keeps a changed query and its alias when the dashboard is saved and loaded again', function () {
        querySrv.set({ query: 'level_s:ERROR', alias: 'errors', pin: true });
        var saved = JSON.parse(angular.toJson(dashboard.current));
        expect(saved.services.query.list[1]).toEqual(jasmine.objectContaining({ query: 'level_s:ERROR', alias: 'errors', pin: true }));
        dashboard.dash_load(saved);
        expect(querySrv.findQuery('level_s:ERROR').alias).toBe('errors');
      });

      it('updates a query in place and gives a colour to a new one', function () {
        var id = querySrv.set({ query: 'a' });
        expect(querySrv.list[id].color).toBeTruthy();
        expect(querySrv.set({ query: 'b' }, id)).toBe(id);
        expect(querySrv.list[id].query).toBe('b');
      });

      it('gives the text of the queries without encoding, for stream expressions', function () {
        querySrv.set({ query: 'level_s:"ERROR" AND x' });
        querySrv.operator = 'AND';
        expect(querySrv.getOPQueryText()).toBe('*:* AND level_s:"ERROR" AND x');
        querySrv.list = {};
        expect(querySrv.getOPQueryText()).toBe('*:*');
      });

      it('turns a query into a query-string object, and refuses one without text', function () {
        expect(querySrv.toEjsObj({ type: 'lucene', query: 'a' })).not.toBe(false);
        expect(querySrv.toEjsObj({ type: 'lucene' })).not.toBe(false);
        expect(querySrv.toEjsObj({ type: 'other' })).toBe(false);
        expect(querySrv.getEjsObj(0)).not.toBe(false);
      });
    });

    describe('filterSrv', function () {
      it('builds each kind of filter into its Solr form', function () {
        filterSrv.set({ type: 'terms', field: 'level_s', value: 'ERROR', mandate: 'must' });
        filterSrv.set({ type: 'terms', field: 'service_s', value: 'query', mandate: 'mustNot' });
        filterSrv.set({ type: 'field', field: 'path_s', query: '"/dashboard"', mandate: 'must' });
        filterSrv.set({ type: 'range', field: 'cpu_d', from: 10, to: 90, mandate: 'must' });
        filterSrv.set({ type: 'range', field: 'heap_mb_i', from: 1, to: 2, mandate: 'mustNot' });
        // a field filter's query is stored URL-encoded, so the fq parameter is too; the plain-text list decodes it
        expect(filterSrv.getSolrFq()).toBe('fq=level_s:"ERROR"&fq=-service_s:"query"&fq=path_s:%22%2Fdashboard%22&fq=cpu_d:[10 TO 90]&fq=-heap_mb_i:[1 TO 2]');
        expect(filterSrv.getSolrFqList()).toEqual(['level_s:"ERROR"', '-service_s:"query"', 'path_s:"/dashboard"', 'cpu_d:[10 TO 90]', '-heap_mb_i:[1 TO 2]']);
      });

      it('lists the time filter first, with plain text, for stream expressions', function () {
        filterSrv.set({ type: 'terms', field: 'level_s', value: 'a b', mandate: 'must' });
        filterSrv.set({ type: 'time', field: 'timestamp_tdt', from: 'NOW-1DAY', to: 'NOW' });
        expect(filterSrv.getSolrFqList()).toEqual(['timestamp_tdt:[NOW-1DAY TO NOW]', 'level_s:"a b"']);
        expect(filterSrv.getSolrFqList(true)).toEqual(['level_s:"a b"']);
        expect(filterSrv.getSolrFq(true)).toBe('&fq=level_s:"a%20b"');
      });

      it('leaves out a filter that is not active and one of a type it does not know', function () {
        var id = filterSrv.set({ type: 'terms', field: 'level_s', value: 'ERROR', mandate: 'must' });
        filterSrv.list[id].active = false;
        filterSrv.set({ type: 'unknown', field: 'x', value: 'y' });
        expect(filterSrv.getSolrFq()).toBe('');
        expect(filterSrv.toEjsObj(filterSrv.list[id])).toBe(false);
      });

      it('turns the filters into request objects', function () {
        [
          { type: 'time', field: 't', from: new Date(1), to: new Date(2) },
          { type: 'range', field: 'r', from: 1, to: 2 },
          { type: 'querystring', query: 'a' },
          { type: 'field', field: 'f', query: 'a' },
          { type: 'terms', field: 'f', value: 'a' },
          { type: 'exists', field: 'f' },
          { type: 'missing', field: 'f' }
        ].forEach(function (filter) {
          var id = filterSrv.set(filter);
          expect(filterSrv.getEjsObj(id)).not.toBe(false);
        });
        var bool = filterSrv.getBoolFilter(filterSrv.ids);
        expect(bool).toBeDefined();
        filterSrv.list[0].mandate = 'mustNot';
        filterSrv.list[1].mandate = 'either';
        expect(filterSrv.getBoolFilter(filterSrv.ids)).toBeDefined();
        expect(filterSrv.toEjsObj({ type: 'nothing', active: true })).toBe(false);
      });

      it('reports the range of the time and the range filters', function () {
        var from = new Date(Date.UTC(2024, 0, 1));
        var to = new Date(Date.UTC(2024, 0, 3));
        filterSrv.set({ type: 'time', field: 'timestamp_tdt', from: from, to: to });
        filterSrv.set({ type: 'time', field: 'timestamp_tdt', from: new Date(Date.UTC(2024, 0, 2)), to: new Date(Date.UTC(2024, 0, 4)) });
        expect(filterSrv.timeRange('min')).toEqual({ from: new Date(Date.UTC(2024, 0, 2)), to: to });
        expect(filterSrv.timeRange('max')).toEqual({ from: from, to: new Date(Date.UTC(2024, 0, 4)) });
        expect(filterSrv.timeRange('other')).toBe(false);
        expect(filterSrv.timeField()).toEqual(['timestamp_tdt', 'timestamp_tdt']);
        expect(filterSrv.getStartTime()).toBe(new Date(Date.UTC(2024, 0, 2)).toISOString());
        expect(filterSrv.getEndTime()).toBe(new Date(Date.UTC(2024, 0, 4)).toISOString());
        expect(filterSrv.getStartTimeAndEndTime()).toEqual([new Date(Date.UTC(2024, 0, 2)).toISOString(), new Date(Date.UTC(2024, 0, 4)).toISOString()]);

        filterSrv.set({ type: 'range', field: 'cpu_d', from: 10, to: 90 });
        filterSrv.set({ type: 'range', field: 'heap_mb_i', from: 20, to: 80 });
        expect(filterSrv.getRangeField()).toBe('heap_mb_i');
        expect(filterSrv.facetRange('cpu_d')).toEqual({ from: 10, to: 90 });
        expect(filterSrv.facetRange('other')).toBe(false);
        expect(Object.keys(filterSrv.getRangeFieldFilter('range', 'cpu_d')).length).toBe(1);
      });

      it('reports no time range when there is no time filter', function () {
        expect(filterSrv.timeRange('min')).toBe(false);
        expect(filterSrv.getTimeField()).toBeUndefined();
      });

      it('removes filters by id, type and field, and reuses a freed id', function () {
        filterSrv.set({ type: 'terms', field: 'a', value: '1' });
        filterSrv.set({ type: 'terms', field: 'b', value: '2' });
        filterSrv.set({ type: 'range', field: 'c', from: 1, to: 2 });
        expect(filterSrv.remove(1)).toBe(true);
        expect(filterSrv.remove(1)).toBe(false);
        expect(filterSrv.set({ type: 'terms', field: 'd', value: '3' })).toBe(1);
        expect(filterSrv.removeByTypeAndField('terms', 'd')).toEqual([1]);
        expect(filterSrv.removeByType('range')).toEqual([2]);
        expect(filterSrv.ids).toEqual([0]);
      });

      it('translates a key with the language table of the dashboard, or returns the key', function () {
        var current = { lang: { 'facet.id': 'Model ID', plain: 'Plain' } };
        expect(filterSrv.translateLanguageKey('facet', 'id', current)).toBe('Model ID');
        expect(filterSrv.translateLanguageKey(null, 'plain', current)).toBe('Plain');
        expect(filterSrv.translateLanguageKey('facet', 'other', current)).toBe('other');
        expect(filterSrv.translateLanguageKey('facet', 'id', {})).toBe('id');
      });

      it('updates a filter in place and refuses an id that does not exist', function () {
        var id = filterSrv.set({ type: 'terms', field: 'a', value: '1' });
        expect(filterSrv.set({ type: 'terms', field: 'a', value: '2' }, id)).toBe(id);
        expect(filterSrv.list[id].value).toBe('2');
        expect(filterSrv.set({ type: 'terms', field: 'a', value: '3' }, 9)).toBe(false);
      });
    });
  });
});
