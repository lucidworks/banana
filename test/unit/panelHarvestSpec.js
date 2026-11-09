'use strict';

// Features that were written for the panels but never released: the box plot panel, the ticker's "ignore the
// time picker" option, the terms panel's custom queries as filters, the labels of the sunburst, the node
// limit of the force and Sankey diagrams, the Sankey label limit, and the tag cloud's own stop words.
// Each one is off, or does nothing, until its setting is used, so a dashboard saved before them draws as it did.
describe('panel features that were not released before', function () {
  var angular = require('angular');
  var $ = require('jquery');
  var helpers = require('./helpers/injector');

  require('panels/terms/module');
  require('panels/ticker/module');
  require('panels/force/module');
  require('panels/sankey/module');
  require('panels/sunburst/module');
  require('panels/boxplot/module');
  require('panels/tagcloud/module');

  function fixture(moduleName) {
    var dashboard = helpers.fakeDashboard();
    dashboard.indices = ['logstash-2999.12.31'];
    dashboard.current.loader = {};
    dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
    dashboard.refresh = jasmine.createSpy('refresh');
    var injector = helpers.createInjector({ dashboard: dashboard, fields: {} }, [moduleName]);
    injector.get('querySrv').init();
    injector.get('filterSrv').init();
    var dashScope = injector.get('$rootScope').$new();
    injector.get('$controller')('DashCtrl', { $scope: dashScope });
    return { injector: injector, dashboard: dashboard, scope: dashScope.$new(), filterSrv: injector.get('filterSrv'), $httpBackend: injector.get('$httpBackend') };
  }

  function controller(name, moduleName, panel) {
    var f = fixture(moduleName);
    f.scope.panel = panel || {};
    f.scope.row = { height: '300px' };
    f.injector.get('$controller')(name, { $scope: f.scope });
    return f;
  }

  // The filters as the Solr request will carry them, decoded.
  function filterTexts(f) {
    return Object.keys(f.filterSrv.list).map(function (id) {
      var filter = f.filterSrv.list[id];
      return filter.type + ':' + (filter.field ? filter.field + '=' : '') + decodeURIComponent(filter.query || filter.value) + ':' + filter.mandate;
    });
  }

  describe('filterSrv.set', function () {
    it('refuses a query filter that is already there, although the stored one is URL-encoded', function () {
      var f = fixture('kibana.panels.terms');
      expect(f.filterSrv.set({ type: 'querystring', query: 'cat:electronics AND inStock:true' })).not.toBe(false);
      expect(f.filterSrv.list[0].query).toBe('cat%3Aelectronics%20AND%20inStock%3Atrue');
      expect(f.filterSrv.set({ type: 'querystring', query: 'cat:electronics AND inStock:true' })).toBe(false);
      expect(f.filterSrv.ids.length).toBe(1);
    });

    it('refuses a terms filter whose value needs encoding, and a numeric one, when it is already there', function () {
      var f = fixture('kibana.panels.terms');
      expect(f.filterSrv.set({ type: 'terms', field: 'city', value: 'New York' })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'terms', field: 'city', value: 'New York' })).toBe(false);
      expect(f.filterSrv.set({ type: 'terms', field: 'n', value: 5 })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'terms', field: 'n', value: 5 })).toBe(false);
      expect(f.filterSrv.ids.length).toBe(2);
    });

    it('does not take a missing value for the text "undefined" or "null"', function () {
      var f = fixture('kibana.panels.terms');
      f.filterSrv.set({ type: 'querystring', query: 'q', value: 'undefined' });
      expect(f.filterSrv.set({ type: 'querystring', query: 'q' })).not.toBe(false);
      f.filterSrv.set({ type: 'querystring', query: 'r', value: 'null' });
      expect(f.filterSrv.set({ type: 'querystring', query: 'r', value: null })).not.toBe(false);
    });

    it('still adds a different query, and a range with other bounds', function () {
      var f = fixture('kibana.panels.terms');
      f.filterSrv.set({ type: 'querystring', query: 'a:b' });
      expect(f.filterSrv.set({ type: 'querystring', query: 'a:c' })).not.toBe(false);
      f.filterSrv.set({ type: 'range', field: 'x', from: 1, to: 2 });
      expect(f.filterSrv.set({ type: 'range', field: 'x', from: 1, to: 3 })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'x', from: 1, to: 2 })).toBe(false);
    });
  });

  describe('the terms panel, when a custom query is set', function () {
    function terms(custom, off) {
      return controller('terms', 'kibana.panels.terms', { field: 'cat', custom_query_filters: !off, queries: { mode: 'all', ids: [], custom: custom } });
    }

    it('does nothing with the custom query unless the setting is on, as in the last release', function () {
      var f = controller('terms', 'kibana.panels.terms', { field: 'cat', queries: { mode: 'all', ids: [], custom: '&fq=cat:electronics' } });
      expect(f.scope.panel.custom_query_filters).toBe(false);
      f.scope.build_search({ label: 'tv' });
      f.scope.build_search({ meta: 'missing' }, true);
      expect(filterTexts(f)).toEqual(['terms:cat=tv:must', 'exists:cat=undefined:must']);
      f = terms('&fq=cat:electronics', true);
      f.scope.build_search({ label: 'tv' });
      expect(filterTexts(f)).toEqual(['terms:cat=tv:must']);
    });

    it('reads a "+" as a space and a "%2B" as a plus, as the form-encoded request does', function () {
      var scope = terms('').scope;
      expect(scope.parseCustomQueryFilters('&fq=price:[0+TO+100]')).toEqual(['price:[0 TO 100]']);
      expect(scope.parseCustomQueryFilters('&fq=a:1+OR+b:2&fq=c:x%2By')).toEqual(['a:1 OR b:2', 'c:x+y']);
    });

    it('stores a custom filter query that holds "+" the way the panel searched with it', function () {
      var f = terms('&fq=price:[0+TO+100]');
      f.scope.build_search({ label: 'tv' });
      expect(filterTexts(f)[0]).toBe('querystring:price:[0 TO 100]:must');
      expect(f.filterSrv.getSolrFqList()).toContain('price:[0 TO 100]');
    });

    it('reads the filter queries out of it, decoded, and ignores the rest', function () {
      var scope = terms('').scope;
      expect(scope.parseCustomQueryFilters('&fq=cat:electronics&fq=inStock:true')).toEqual(['cat:electronics', 'inStock:true']);
      expect(scope.parseCustomQueryFilters('&q.op=AND&fq=name%3A%22a%20b%22&rows=5&fq=')).toEqual(['name:"a b"']);
      expect(scope.parseCustomQueryFilters('&fq=100%')).toEqual(['100%']);
      expect(scope.parseCustomQueryFilters('')).toEqual([]);
      expect(scope.parseCustomQueryFilters(undefined)).toEqual([]);
    });

    it('adds each filter query to the filters when a term is selected, and the term as well', function () {
      var f = terms('&fq=cat:electronics&fq=inStock:true');
      f.scope.build_search({ label: 'tv' });
      expect(filterTexts(f)).toEqual(['querystring:cat:electronics:must', 'querystring:inStock:true:must', 'terms:cat=tv:must']);
      expect(f.dashboard.refresh).toHaveBeenCalled();
    });

    it('adds them only once when another term is selected', function () {
      var f = terms('&fq=cat:electronics');
      f.scope.build_search({ label: 'tv' });
      f.scope.build_search({ label: 'radio' });
      expect(filterTexts(f)).toEqual(['querystring:cat:electronics:must', 'terms:cat=tv:must', 'terms:cat=radio:must']);
    });

    it('requires the custom query also when the term is excluded', function () {
      var f = terms('&fq=cat:electronics');
      f.scope.build_search({ label: 'tv' }, true);
      expect(filterTexts(f)).toEqual(['querystring:cat:electronics:must', 'terms:cat=tv:mustNot']);
    });

    it('does the same for the missing-values bar, and nothing for "other values"', function () {
      var f = terms('&fq=cat:electronics');
      f.scope.build_search({ meta: 'other' });
      expect(f.filterSrv.ids.length).toBe(0);
      f.scope.build_search({ meta: 'missing' });
      expect(filterTexts(f)).toEqual(['querystring:cat:electronics:must', 'exists:cat=undefined:mustNot']);
    });

    it('adds nothing but the term when there is no custom query, or one without filter queries', function () {
      ['', '&q.op=AND'].forEach(function (custom) {
        var f = terms(custom);
        f.scope.build_search({ label: 'tv' });
        expect(filterTexts(f)).toEqual(['terms:cat=tv:must']);
      });
    });
  });

  describe('the ticker panel', function () {
    var ABSOLUTE = { from: '2024-01-01T00:00:00.000Z', to: '2024-01-02T00:00:00.000Z' };

    function ticker(panel, noTimeFilter) {
      var f = fixture('kibana.panels.ticker');
      f.dashboard.current.services.filter = noTimeFilter ? { list: {}, ids: [] } : {
        list: { 0: { id: 0, type: 'time', field: 'ts', from: ABSOLUTE.from, to: ABSOLUTE.to, active: true, mandate: 'must' } },
        ids: [0]
      };
      f.filterSrv.init();
      f.scope.panel = panel || {};
      f.scope.row = { height: '100px' };
      f.injector.get('$controller')('ticker', { $scope: f.scope });
      f.bodies = [];
      f.$httpBackend.whenPOST(/\/select$/).respond(function (method, url, data) {
        f.bodies.push(decodeURIComponent(data));
        return f.failWith ? [f.failWith, 'boom'] : [200, f.answer ? f.answer(f.bodies.length - 1) : {}];
      });
      return f;
    }

    function counts(older, newer) {
      return { facet_counts: { facet_ranges: { ts: { counts: ['2024-01-01T00:00:00Z', older, '2024-01-02T00:00:00Z', newer] } } } };
    }

    it('does not ignore the time picker, and compares days, unless told to', function () {
      var f = ticker();
      expect(f.scope.panel.ignore_time_picker).toBe(false);
      expect(f.scope.panel.trend_interval).toBe('Day to Day');
    });

    it('still uses the time picker when the option is off', function () {
      var f = ticker();
      f.answer = function () { return { facet_counts: { facet_ranges: { ts: { between: 4 } } } }; };
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.bodies.length).toBe(2);
      expect(f.bodies[0]).toContain('facet.range.start=2024-01-01T00:00:00.000Z');
      expect(f.bodies[0]).toContain('facet.range.other=between');
      expect(f.scope.trends[0].hits).toEqual({ new: 4, old: 4 });
    });

    [
      // the interval, Solr's gap, and the shortest and longest the two ranges can be, in hours
      ['Day to Day', '+1DAY', 48, 48],
      ['Week to Week', '+7DAYS', 336, 336],
      ['Month to Month', '+1MONTH', 2 * 28 * 24, 2 * 31 * 24],
      ['Year to Year', '+1YEAR', 2 * 365 * 24, 2 * 366 * 24]
    ].forEach(function (c) {
      it('asks Solr for two ranges that end now, ' + c[0] + ', and not for the time picker\'s range', function () {
        var f = ticker({ ignore_time_picker: true, trend_interval: c[0] });
        f.answer = function () { return counts(10, 15); };
        var before = Date.now();
        f.scope.get_data();
        f.$httpBackend.flush();

        expect(f.bodies.length).toBe(1);
        var body = f.bodies[0];
        expect(body).toContain('facet.range=ts');
        expect(body).toContain('facet.range.gap=' + c[1]);
        expect(body).not.toContain('2024-01-0');
        var start = Date.parse(/facet\.range\.start=([^&]+)/.exec(body)[1]);
        var end = Date.parse(/facet\.range\.end=([^&]+)/.exec(body)[1]);
        expect(end).toBeGreaterThan(before - 1);
        var hours = (end - start) / 3600000;
        expect(hours).not.toBeLessThan(c[2] - 1); // an hour of slack for a change of clock
        expect(hours).not.toBeGreaterThan(c[3] + 1);
        expect(f.scope.trends[0].hits).toEqual({ old: 10, new: 15 });
        expect(f.scope.trends[0].percent).toBe(50);
      });
    });

    describe('when the response does not match the time field that was requested', function () {
      function other(field, between) {
        var ranges = {};
        ranges[field] = { between: between };
        return { facet_counts: { facet_ranges: ranges } };
      }

      it('shows no counts, and does not throw, for a response keyed by another field', function () {
        var f = ticker();
        f.answer = function () { return other('other_ts', 4); };
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends).toEqual([]);
        expect(f.scope.panelMeta.loading).toBe(false);
      });

      it('does not keep the counts of the previous refresh when the next response lacks the field', function () {
        var f = ticker();
        f.answer = function (i) { return i < 2 ? other('ts', 4) : other('other_ts', 9); };
        f.scope.get_data();
        f.$httpBackend.flush();
        expect(f.scope.trends.length).toBe(1);
        expect(f.scope.trends[0].hits).toEqual({ new: 4, old: 4 });
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends).toEqual([]);
      });

      it('draws only the queries whose responses have counts', function () {
        var f = ticker();
        f.injector.get('querySrv').set({ query: 'second', alias: 'B' });
        // two requests for each query: the first query's answers lack the field, the second query's have it
        f.answer = function (i) { return i < 2 ? other('other_ts', 4) : other('ts', 7); };
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.bodies.length).toBe(4);
        expect(f.scope.trends.length).toBe(1);
        expect(f.scope.trends[0].info.alias).toBe('B');
        expect(f.scope.trends[0].hits).toEqual({ new: 7, old: 7 });
      });

      it('shows no counts when only one of the two ranges has a count', function () {
        var f = ticker();
        f.answer = function (i) { return i === 0 ? other('ts', 4) : other('ts'); };
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends).toEqual([]);
      });

      it('reads the counts from the field it asked for when the time filter changes before the answer', function () {
        var f = ticker();
        f.answer = function () { return other('ts', 4); };
        f.scope.get_data();
        f.filterSrv.list[0].field = 'changed_ts';
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.bodies[0]).toContain('facet.range=ts');
        expect(f.scope.trends[0].hits).toEqual({ new: 4, old: 4 });
      });

      it('reads the counts from the field it asked for when the time filter is removed before the answer', function () {
        var f = ticker();
        f.answer = function () { return other('ts', 4); };
        f.scope.get_data();
        delete f.filterSrv.list[0];
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends[0].hits).toEqual({ new: 4, old: 4 });
      });

      it('does not keep the previous trend when the next response has no ranges', function () {
        var f = ticker({ ignore_time_picker: true });
        f.answer = function (i) { return i === 0 ? counts(10, 15) : {}; };
        f.scope.get_data();
        f.$httpBackend.flush();
        expect(f.scope.trends.length).toBe(1);
        expect(f.scope.trends[0].hits).toEqual({ old: 10, new: 15 });
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends).toEqual([]);
        expect(f.scope.panel.error).toBe('Cannot show the trend: Solr did not return two ranges.');
      });

      it('draws only the trends of queries whose responses have ranges', function () {
        var f = ticker({ ignore_time_picker: true });
        f.injector.get('querySrv').set({ query: 'second', alias: 'B' });
        f.answer = function (i) { return i === 0 ? {} : counts(4, 2); };
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.bodies.length).toBe(2);
        expect(f.scope.trends.length).toBe(1);
        expect(f.scope.trends[0].info.alias).toBe('B');
        expect(f.scope.trends[0].percent).toBe(-50);
      });

      it('does not keep the counts of the previous refresh when Solr answers with an error', function () {
        var f = ticker();
        f.answer = function (i) { return i < 2 ? other('ts', 4) : { error: { msg: 'undefined field ts' } }; };
        f.scope.get_data();
        f.$httpBackend.flush();
        expect(f.scope.trends.length).toBe(1);
        f.scope.get_data();
        expect(function () { f.$httpBackend.flush(); }).not.toThrow();
        expect(f.scope.trends).toEqual([]);
        expect(f.scope.panel.error).toBeTruthy();
      });

      it('reads the trend from the field it asked for when the time filter changes before the answer', function () {
        var f = ticker({ ignore_time_picker: true });
        f.answer = function () { return { facet_counts: { facet_ranges: { ts: { counts: ['a', 10, 'b', 15] } } } }; };
        f.scope.get_data();
        f.filterSrv.list[0].field = 'changed_ts';
        f.$httpBackend.flush();
        expect(f.bodies[0]).toContain('facet.range=ts');
        expect(f.scope.panel.error).toBeFalsy();
        expect(f.scope.trends[0].hits).toEqual({ old: 10, new: 15 });
      });
    });

    it('shows one trend for each query, with a question mark where the earlier range was empty', function () {
      var f = ticker({ ignore_time_picker: true });
      f.injector.get('querySrv').set({ query: 'second', alias: 'B' });
      f.answer = function (i) { return i === 0 ? counts(0, 5) : counts(4, 2); };
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.bodies.length).toBe(2);
      expect(f.scope.trends.length).toBe(2);
      expect(f.scope.trends[0].percent).toBe('?');
      expect(f.scope.trends[1].percent).toBe(-50);
      expect(f.scope.trends[1].info.alias).toBe('B');
    });

    it('keeps the custom query and the filters, but not the time picker\'s range', function () {
      var f = ticker({ ignore_time_picker: true, queries: { mode: 'all', ids: [], custom: '&fq=a:b' } });
      f.filterSrv.set({ type: 'terms', field: 'host', value: 'h1' });
      f.answer = function () { return counts(1, 1); };
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.bodies[0]).toContain('&fq=a:b');
      expect(f.bodies[0]).toContain('fq=host:"h1"');
      expect(f.bodies[0]).not.toContain('2024-01-0');
    });

    it('reports an answer without two ranges, and a failed request, in the panel', function () {
      var f = ticker({ ignore_time_picker: true });
      f.answer = function () { return { facet_counts: { facet_ranges: { ts: { counts: [] } } } }; };
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.scope.panel.error).toMatch(/two ranges/);

      f = ticker({ ignore_time_picker: true });
      f.failWith = 500;
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.scope.panel.error).toBeTruthy();
      expect(f.scope.panelMeta.loading).toBe(false);
    });

    it('needs no time filter when it ignores the time picker, and uses the configured time field', function () {
      var f = ticker({ ignore_time_picker: true }, true);
      f.answer = function () { return { facet_counts: { facet_ranges: {} } }; };
      var field = require('config').timefield;
      f.answer = function () {
        var ranges = {};
        ranges[field] = { counts: ['a', 2, 'b', 3] };
        return { facet_counts: { facet_ranges: ranges } };
      };
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.scope.panel.error).toBeUndefined();
      expect(f.bodies[0]).toContain('facet.range=' + field);
      expect(f.scope.trends[0].hits).toEqual({ old: 2, new: 3 });
    });

    it('still needs a time filter when it uses the time picker', function () {
      var f = ticker({}, true);
      f.scope.get_data();
      expect(f.scope.panel.error).toMatch(/time filter must exist/);
      expect(f.bodies.length).toBe(0);
    });

    it('says what is compared', function () {
      var scope = ticker().scope;
      expect(scope.comparing('Week to Week')).toBe('Last week to this week');
      expect(scope.trendIntervals.length).toBe(4);
    });
  });

  describe('the force panel', function () {
    var DATA = [
      { value: 'a', count: 3, pivot: [{ value: 'a1', count: 2, pivot: [{ value: 'a1x', count: 1 }] }, { value: 'a2', count: 1 }] },
      { value: 'b', count: 2, pivot: [{ value: 'b1', count: 2 }] }
    ];

    function force(panel) {
      return controller('force', 'kibana.panels.force', panel);
    }

    it('has no node limit by default and still mutes the second category', function () {
      var scope = force().scope;
      expect(scope.panel.node_limit).toBe(0);
      expect(scope.panel.mute_remaining_categories).toBe(true);
      expect(scope.panel.mute_category_1).toBe(false);
    });

    it('keeps the choice a dashboard saved with the old "Mute Category 2" setting', function () {
      expect(force({ mute_category_2: false }).scope.panel.mute_remaining_categories).toBe(false);
      expect(force({ mute_category_2: true }).scope.panel.mute_remaining_categories).toBe(true);
      expect(force({ mute_category_2: false }).scope.panel.mute_category_2).toBeUndefined();
    });

    it('takes the spaces out of the colours and keeps the default palette as it was', function () {
      var scope = force().scope;
      expect(scope.palette().length).toBe(10);
      expect(scope.palette()[0]).toBe('#1f77b4');
      expect(force({ colors: ' red , #00 ff 00 ' }).scope.palette()).toEqual(['red', '#00ff00']);
    });

    it('replaces a colour that is too long to be one, so that the colour parser is never given it', function () {
      var palette = force({ colors: 'red,' + new Array(100000).join('1') + ',blue' }).scope.palette();
      expect(palette).toEqual(['red', '#7f7f7f', 'blue']);
    });

    it('turns every pivot level into a category, linked to its parent', function () {
      var data = force().scope.parse_facet_pivot(DATA);
      expect(data.nodes.map(function (n) { return n.category + ':' + n.name; })).toEqual(['1:a', '2:a1', '3:a1x', '2:a2', '1:b', '2:b1']);
      expect(data.links.map(function (l) { return l.source + '>' + l.target + '=' + l.value; })).toEqual(['0>1=2', '1>2=1', '0>3=1', '4>5=2']);
    });

    it('leaves out the nodes past the node limit and says so', function () {
      var f = force({ node_limit: 3 });
      var data = f.scope.parse_facet_pivot(DATA);
      expect(data.nodes.length).toBe(3);
      expect(f.scope.moreNodes).toBe(true);
      expect(f.scope.panel.moreNodes).toBeUndefined(); // not kept in the saved dashboard

      data = force({ node_limit: 6 }).scope.parse_facet_pivot(DATA);
      expect(data.nodes.length).toBe(6);
    });

    it('does not set the warning when everything fits, or when there is no limit', function () {
      [0, 6, 100, undefined].forEach(function (limit) {
        var f = force({ node_limit: limit });
        expect(f.scope.parse_facet_pivot(DATA).nodes.length).toBe(6);
        expect(f.scope.moreNodes).toBe(false);
      });
    });

    function mutedAfterAnswer(panel) {
      var f = force(angular.extend({ facet_pivot_strings: ['a', 'b', 'c'] }, panel));
      f.$httpBackend.expectPOST(/\/select$/).respond(200, { facet_counts: { facet_pivot: { 'a,b,c': DATA } } });
      f.scope.get_data();
      f.$httpBackend.flush();
      var result = {};
      f.scope.data.nodes.forEach(function (n) { result[n.name] = f.scope.selList['n' + n.node]; });
      return result;
    }

    it('mutes the second category and every one after it, not only the second', function () {
      expect(mutedAfterAnswer()).toEqual({ a: true, a1: false, a1x: false, a2: false, b: true, b1: false });
      expect(mutedAfterAnswer({ mute_remaining_categories: false, mute_category_1: true }))
        .toEqual({ a: false, a1: true, a1x: true, a2: true, b: false, b1: true });
    });

    it('asks Solr for a limit of 10 on a level that has none, not NaN', function () {
      var f = force({ facet_pivot_strings: ['a', 'b', 'c'], facet_limit: '5,7' });
      var body;
      f.$httpBackend.expectPOST(/\/select$/).respond(function (method, url, data) {
        body = decodeURIComponent(data);
        return [200, { facet_counts: { facet_pivot: {} } }];
      });
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(body).toContain('f.a.facet.limit=5');
      expect(body).toContain('f.b.facet.limit=7');
      expect(body).toContain('f.c.facet.limit=10');
      expect(body).not.toContain('NaN');
    });
  });

  describe('the Sankey panel', function () {
    var DATA = [
      { value: 'a', count: 3, pivot: [{ value: 'a1', count: 2 }, { value: 'a2', count: 1 }] },
      { value: 'b', count: 2, pivot: [{ value: 'b1', count: 2 }] }
    ];

    function sankey(panel) {
      return controller('sankey', 'kibana.panels.sankey', panel);
    }

    it('has no node limit and no label limit by default', function () {
      var scope = sankey().scope;
      expect(scope.panel.node_limit).toBe(0);
      expect(scope.panel.label_limit).toBe(0);
      expect(scope.parse_facet_pivot(DATA).nodes.length).toBe(5);
      expect(scope.moreNodes).toBe(false);
    });

    it('stops at the node limit and says so', function () {
      var f = sankey({ node_limit: 2 });
      var data = f.scope.parse_facet_pivot(DATA);
      expect(data.nodes.length).toBe(2);
      expect(f.scope.moreNodes).toBe(true);
      expect(f.scope.panel.moreNodes).toBeUndefined();
    });

    describe('the chart', function () {
      function labels(panel) {
        var f = sankey(panel);
        f.scope.data = f.scope.parse_facet_pivot([
          { value: 'a-very-long-source-name', count: 3, pivot: [{ value: 'an-even-longer-target-name', count: 3 }] }
        ]);
        var wrapper = $('<div class="sankey-test" style="width:600px"></div>').appendTo(document.body);
        var elem = f.injector.get('$compile')('<div sankey-chart></div>')(f.scope);
        elem.appendTo(wrapper);
        f.scope.$emit('render');
        return elem.find('svg g text').map(function () { return $(this).text(); }).get().sort();
      }

      afterEach(function () { $('.sankey-test').remove(); });

      it('writes the labels in full unless there is a label limit', function () {
        expect(labels()).toEqual(['a-very-long-source-name', 'an-even-longer-target-name']);
      });

      it('writes labels cut to the label limit', function () {
        expect(labels({ label_limit: 10 })).toEqual(['a-very-...', 'an-even...']);
      });
    });

    it('cuts a long label to the label limit, ending in three dots, and leaves the others', function () {
      var scope = sankey().scope;
      expect(scope.shorten_label('abcdefghij', 6)).toBe('abc...');
      expect(scope.shorten_label('abcdef', 6)).toBe('abcdef');
      expect(scope.shorten_label('abcdefghij', 0)).toBe('abcdefghij');
      expect(scope.shorten_label('abcdefghij')).toBe('abcdefghij');
      expect(scope.shorten_label('abcdefghij', 2)).toBe('ab');
      expect(scope.shorten_label(12345, 4)).toBe('1...');
    });
  });

  describe('the sunburst panel', function () {
    var TREE = {
      name: 'root',
      children: [
        { name: 'java', size: 3, children: [{ name: 'a', size: 2, children: [{ name: 'deep', size: 2 }] }, { name: 'b', size: 1 }] },
        { name: '<img src=x onerror=alert(1)>', size: 2 }
      ]
    };

    function draw(panel) {
      var f = controller('sunburst', 'kibana.panels.sunburst', panel);
      f.scope.data = JSON.parse(JSON.stringify(TREE));
      f.scope.dash = { numberWithCommas: String };
      f.scope.set_filters = jasmine.createSpy('set_filters');
      var wrapper = $('<div style="width:600px"></div>').appendTo(document.body);
      var elem = f.injector.get('$compile')('<sunburst></sunburst>')(f.scope);
      elem.appendTo(wrapper);
      f.scope.$emit('render');
      f.wrapper = wrapper;
      f.elem = elem;
      return f;
    }

    afterEach(function () {
      $('div[style="width:600px"]').remove();
    });

    it('shows no labels by default', function () {
      var f = draw();
      expect(f.scope.panel.labels).toBe(false);
      expect(f.elem.find('path').length).toBeGreaterThan(0);
      expect(f.elem.find('text').length).toBe(0);
    });

    it('writes a label on each slice of the first rings when labels are on', function () {
      var f = draw({ labels: true });
      var labels = f.elem.find('text.sunburst-label').map(function () { return $(this).text(); }).get();
      expect(labels.sort()).toEqual(['<img src=x onerror=alert(1)>', 'a', 'b', 'java'].sort());
      expect(f.elem.find('img').length).toBe(0); // the names are text, never markup
      expect(f.elem.find('text').first().css('font-weight')).toMatch(/bold|700/);
    });

    it('labels more rings, and in normal weight, as the settings say', function () {
      var f = draw({ labels: true, label_rings: 3, bold_labels: false });
      expect(f.elem.find('text.sunburst-label').length).toBe(5);
      expect(f.elem.find('text').first().css('font-weight')).toMatch(/normal|400/);
    });
  });

  describe('the box plot panel', function () {
    function boxplot(panel) {
      return controller('boxplot', 'kibana.panels.boxplot', panel || { facet_pivot_strings: ['host', 'cpu'] });
    }

    var PIVOT = [
      { field: 'host', value: 'h1', count: 6, pivot: [{ value: 1, count: 1 }, { value: 2, count: 3 }, { value: 3, count: 1 }, { value: 4, count: 1 }, { value: 100, count: 1 }] },
      { field: 'host', value: 'h2', count: 2, pivot: [{ value: '7.5', count: 2 }, { value: 'n/a', count: 1 }] },
      { field: 'host', value: 'empty', count: 1, pivot: [{ value: 'x', count: 1 }] },
      { field: 'host', value: 'leaf', count: 1 }
    ];

    it('is a panel the build offers', function () {
      var config = require('config');
      expect(config.panel_names).toContain('boxplot');
    });

    it('works out the quartiles, whiskers and outliers of a list of values', function () {
      // 15 is past 1.5 inter-quartile ranges from the box (3 to 7: the limit is 13), but not past 3 (19)
      var points = [1, 2, 3, 4, 5, 6, 7, 8, 15].map(function (v) { return { value: v, count: 1 }; });
      var s = boxplot().scope.box_stats(points);
      expect([s.n, s.q1, s.median, s.q3]).toEqual([9, 3, 5, 7]);
      expect([s.low, s.high]).toEqual([1, 8]);
      expect(s.outliers).toEqual([15]);
      expect(boxplot().scope.box_stats(points, 3).outliers).toEqual([]);
    });

    it('counts a value as often as it occurs', function () {
      var s = boxplot().scope.box_stats([{ value: 1, count: 3 }, { value: 5, count: 1 }]);
      expect([s.n, s.q1, s.median, s.q3]).toEqual([4, 1, 1, 2]);
    });

    it('builds one box per value of the first field from the numbers of the second', function () {
      var data = boxplot().scope.parse_facet_pivot(PIVOT, ['host', 'cpu']);
      expect(data.nodes.map(function (n) { return n.name; })).toEqual(['h1', 'h2']);
      expect(data.nodes[1].points).toEqual([{ value: 7.5, count: 1 }]);
      expect([data.min, data.max, data.x, data.y]).toEqual([1, 100, 'host', 'cpu']);
    });

    it('lets a value count as often as it occurs when "unique values" is off', function () {
      var data = boxplot({ facet_pivot_strings: ['host', 'cpu'], unique_facet_values: false }).scope.parse_facet_pivot(PIVOT, ['host', 'cpu']);
      expect(data.nodes[0].points[1]).toEqual({ value: 2, count: 3 });
      expect(data.nodes[1].points).toEqual([{ value: 7.5, count: 2 }]);
    });

    it('asks Solr for the pivot of the two fields, and draws what comes back', function () {
      var f = boxplot();
      var body;
      f.$httpBackend.expectPOST(/\/select$/).respond(function (method, url, data) {
        body = decodeURIComponent(data);
        return [200, { facet_counts: { facet_pivot: { 'host,cpu': PIVOT } } }];
      });
      var rendered = jasmine.createSpy('render');
      f.scope.$on('render', rendered);
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(body).toContain('facet.pivot=host,cpu');
      expect(body).toContain('rows=0');
      expect(f.scope.data.nodes.length).toBe(2);
      expect(rendered).toHaveBeenCalled();
    });

    it('asks for two fields, in the panel, when it has fewer', function () {
      var f = boxplot({ facet_pivot_strings: ['host'] });
      f.scope.get_data();
      expect(f.scope.panel.error).toMatch(/two fields/);
      expect(f.scope.panelMeta.loading).toBe(false);
      f = boxplot({});
      f.scope.get_data();
      expect(f.scope.panel.error).toMatch(/two fields/);
    });

    it('reports a failed request in the panel', function () {
      var f = boxplot();
      f.$httpBackend.expectPOST(/\/select$/).respond(500, 'boom');
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(f.scope.panel.error).toBeTruthy();
      expect(f.scope.panelMeta.loading).toBe(false);
    });

    describe('the chart', function () {
      function draw(panel, pivot) {
        var f = boxplot(panel);
        f.scope.data = f.scope.parse_facet_pivot(pivot || PIVOT, ['host', 'cpu']);
        var wrapper = $('<div class="boxplot-test" style="width:700px"></div>').appendTo(document.body);
        f.elem = f.injector.get('$compile')('<div boxplot-chart></div>')(f.scope);
        f.elem.appendTo(wrapper);
        f.scope.$emit('render');
        return f;
      }

      afterEach(function () {
        $('.boxplot-test').remove();
      });

      it('draws a box, a median, two whiskers and the outliers for each group', function () {
        var f = draw();
        expect(f.elem.find('g.boxplot-group').length).toBe(2);
        var first = f.elem.find('g.boxplot-group').first();
        expect(first.find('rect.box').length).toBe(1);
        expect(first.find('line.median').length).toBe(1);
        expect(first.find('line.whisker').length).toBe(2);
        expect(first.find('circle.outlier').length).toBe(1);
        expect(f.scope.panelMeta.loading).toBe(false);
      });

      it('labels the axes and the boxes, and leaves both out when they are off', function () {
        var f = draw();
        var texts = f.elem.find('text').map(function () { return $(this).text(); }).get();
        expect(texts).toContain('host');
        expect(texts).toContain('cpu');
        expect(f.elem.find('text.whisker').length).toBe(4);

        f = draw({ facet_pivot_strings: ['host', 'cpu'], labels: false, axes_labels: false });
        texts = f.elem.find('text').map(function () { return $(this).text(); }).get();
        expect(texts).not.toContain('host');
        expect(f.elem.find('text.whisker').length).toBe(0);
        expect(f.elem.find('text.box').length).toBe(0);
      });

      it('writes group names as text, never as markup', function () {
        var f = draw(null, [{ value: '<img src=x onerror=alert(1)>', count: 1, pivot: [{ value: 1, count: 1 }] }]);
        expect(f.elem.find('img').length).toBe(0);
        expect(f.elem.find('title').first().text()).toContain('<img src=x onerror=alert(1)>');
        expect(f.elem.find('g.boxplot-group').length).toBe(1);
      });

      it('draws nothing, and does not throw, when there is no data or one value', function () {
        var f = draw(null, []);
        expect(f.elem.find('svg').length).toBe(0);
        f = draw(null, [{ value: 'h', count: 1, pivot: [{ value: 5, count: 1 }] }]);
        expect(f.elem.find('g.boxplot-group').length).toBe(1);
      });
    });
  });

  describe('the tag cloud panel', function () {
    var stopwords = require('panels/tagcloud/stopWords');

    function cloud(panel) {
      return controller('tagcloud', 'kibana.panels.tagcloud', panel).scope;
    }

    it('has the list of stop words', function () {
      expect(Array.isArray(stopwords)).toBe(true);
      expect(stopwords).toContain('the');
    });

    it('uses only its own stop words when there are no custom ones', function () {
      var scope = cloud();
      expect(scope.panel.customStopWords).toBe('');
      expect(scope.stop_words()).toEqual(stopwords.filter(function (w, i) { return stopwords.indexOf(w) === i; }));
    });

    it('leaves the stop words out of the cloud when asked, the built-in and the custom ones', function () {
      function words(panel) {
        var f = controller('tagcloud', 'kibana.panels.tagcloud', angular.extend({ field: 't' }, panel));
        f.$httpBackend.expectPOST(/\/select$/).respond(200, {
          response: { numFound: 9 },
          facet_counts: { facet_fields: { t: ['the', 3, 'Zzz', 2, 'java', 4] } }
        });
        f.scope.get_data();
        f.$httpBackend.flush();
        return f.scope.data.map(function (d) { return d.label; });
      }
      expect(words({})).toEqual(['the', 'Zzz', 'java']);
      expect(words({ ignoreStopWords: true })).toEqual(['Zzz', 'java']);
      expect(words({ ignoreStopWords: true, customStopWords: ' ZZZ ' })).toEqual(['java']);
    });

    it('adds the custom stop words, trimmed and in lower case', function () {
      var words = cloud({ customStopWords: ' Foo, bar ,,BAZ ' }).stop_words();
      expect(words).toContain('foo');
      expect(words).toContain('bar');
      expect(words).toContain('baz');
      expect(words).not.toContain('');
    });

    it('keeps the case of custom stop words when asked to', function () {
      var words = cloud({ customStopWords: 'Foo', customStopWordsLowercase: false }).stop_words();
      expect(words).toContain('Foo');
      expect(words).not.toContain('foo');
    });
  });
});
