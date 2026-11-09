'use strict';

// Panels and services that behave as the last release did, or that fail in ways the last release failed too.
// Restored from the last release: the Hits bar, pie and list charts (its series was empty), the heatmap's
// filters when it is transposed, the terms log axis, the relative time ranges' rounding, and the collection
// list on a Solr that has no Collections API. Long-standing faults, shared with the last release: a second
// range on the same field, a months timespan, a reopened absolute or relative range that gives the ticker
// invalid dates, the dashboard list asked for with no query, and a collection list that arrives after the
// dashboard has been replaced.
describe('panel and service regressions', function () {
  var angular = require('angular');
  var $ = require('jquery');
  var config = require('config');
  var helpers = require('./helpers/injector');
  var modes = require('./helpers/modes');

  require('panels/hits/module');
  require('panels/heatmap/module');
  require('panels/terms/module');
  require('panels/timepicker/module');
  require('panels/ticker/module');

  // A dashboard stand-in with the services the panels read, and the real query and filter services.
  function fixture(moduleName, extra) {
    var dashboard = helpers.fakeDashboard();
    dashboard.indices = ['logstash-2999.12.31'];
    dashboard.current.loader = {};
    dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
    dashboard.refresh = jasmine.createSpy('refresh');
    var injector = helpers.createInjector(angular.extend({ dashboard: dashboard, fields: {} }, extra), moduleName ? [moduleName] : []);
    injector.get('querySrv').init();
    injector.get('filterSrv').init();
    var dashScope = injector.get('$rootScope').$new();
    injector.get('$controller')('DashCtrl', { $scope: dashScope });
    return { injector: injector, dashboard: dashboard, scope: dashScope.$new(), filterSrv: injector.get('filterSrv') };
  }

  // Waits until condition() holds: panels that load their chart library do so in a promise.
  function waitFor(condition, done, fail) {
    var tries = 0;
    (function poll() {
      if (condition()) { done(); } else if (++tries > 100) { fail(); } else { setTimeout(poll, 10); }
    }());
  }

  describe('the Hits panel', function () {
    var f, $httpBackend;

    function hitsPanel(chart) {
      f = fixture('kibana.panels.hits');
      $httpBackend = f.injector.get('$httpBackend');
      f.scope.panel = { chart: chart };
      f.scope.row = { height: '150px' };
      f.injector.get('$controller')('hits', { $scope: f.scope });
      return f.scope;
    }

    ['bar', 'pie', 'list'].forEach(function (chart) {
      it('builds one series per query for the ' + chart + ' chart and asks for a render', function () {
        var scope = hitsPanel(chart);
        var rendered = jasmine.createSpy('render');
        scope.$on('render', rendered);
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 42, docs: [] } });

        scope.get_data();
        $httpBackend.flush();

        var info = f.dashboard.current.services.query.list[f.dashboard.current.services.query.ids[0]];
        expect(scope.data.length).toBe(1);
        expect(scope.data[0].hits).toBe(42);
        expect(scope.data[0].data).toEqual([[scope.data[0].id, 42]]);
        expect(scope.data[0].info).toBe(info);
        expect(scope.hits).toBe(42);
        expect(rendered).toHaveBeenCalled();
      });
    });

    describe('with two queries', function () {
      function twoQueries(queries) {
        var scope = hitsPanel('bar');
        scope.panel.queries = queries;
        var querySrv = f.injector.get('querySrv');
        var second = querySrv.set({ query: 'second', alias: 'B' });
        var list = f.dashboard.current.services.query.list;
        return { scope: scope, first: f.dashboard.current.services.query.ids[0], second: second, list: list };
      }

      it('draws the count of each query under its own alias in "all" mode', function () {
        var t = twoQueries({ mode: 'all', ids: [], query: '*:*', custom: '' });
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 3 } });
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 9 } });
        t.scope.get_data();
        $httpBackend.flush();
        expect(t.scope.data.map(function (d) { return [d.id, d.hits]; })).toEqual([[t.first, 3], [t.second, 9]]);
        expect(t.scope.data[1].info).toBe(t.list[t.second]);
      });

      it('draws the one selected query under its own alias and colour, and throws nothing', function () {
        var t = twoQueries({ mode: 'selected', ids: [1], query: '*:*', custom: '' });
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 9 } });
        t.scope.get_data();
        expect(function () { $httpBackend.flush(); }).not.toThrow();
        expect(t.scope.data.length).toBe(1);
        expect(t.scope.data[0].id).toBe(t.second);
        expect(t.scope.data[0].info).toBe(t.list[t.second]);
        expect(t.scope.data[0].hits).toBe(9);
      });

      it('draws the pinned query only, in "pinned" mode', function () {
        var t = twoQueries({ mode: 'pinned', ids: [], query: '*:*', custom: '' });
        t.list[t.second].pin = true;
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 9 } });
        t.scope.get_data();
        $httpBackend.flush();
        expect(t.scope.data.length).toBe(1);
        expect(t.scope.data[0].info.alias).toBe('B');
      });

      it('draws the unpinned query only, in "unpinned" mode', function () {
        var t = twoQueries({ mode: 'unpinned', ids: [], query: '*:*', custom: '' });
        t.list[t.second].pin = true;
        $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 4 } });
        t.scope.get_data();
        $httpBackend.flush();
        expect(t.scope.data.length).toBe(1);
        expect(t.scope.data[0].id).toBe(t.first);
        expect(t.scope.data[0].hits).toBe(4);
      });
    });

    it('still shows the total metrics', function () {
      var scope = hitsPanel('total');
      scope.panel.metrics[0].field = 'size';
      $httpBackend.expectPOST(/\/select$/).respond(200, { response: { numFound: 5 }, stats: { stats_fields: { size: { count: 7 } } } });

      scope.get_data();
      $httpBackend.flush();

      expect(scope.panel.metrics[0].value).toBe('7.00');
    });

    describe('the chart directive', function () {
      var plot;
      beforeEach(function () {
        plot = spyOn($, 'plot').and.returnValue({});
      });

      function draw(chart, options) {
        var scope = hitsPanel(chart);
        angular.extend(scope.panel, options);
        scope.data = [{ info: { alias: 'errors', color: '#e00' }, id: 0, hits: 3, data: [[0, 3]] }];
        var elem = f.injector.get('$compile')('<div hits-chart></div>')(scope);
        scope.$emit('render');
        return { scope: scope, elem: elem };
      }

      it('draws bars', function () {
        draw('bar');
        expect(plot.calls.count()).toBe(1);
        var options = plot.calls.mostRecent().args[2];
        expect(options.series.bars.show).toBe(true);
        expect(options.series.pie).toBeUndefined();
        expect(plot.calls.mostRecent().args[1][0].label).toBe('errors');
        expect(plot.calls.mostRecent().args[1][0].color).toBe('#e00');
      });

      it('draws a pie, with the donut and tilt settings, and puts nothing but escaped text in its labels', function () {
        draw('pie', { donut: true, tilt: true });
        var pie = plot.calls.mostRecent().args[2].series.pie;
        expect(pie.show).toBe(true);
        expect(pie.innerRadius).toBe(0.4);
        expect(pie.tilt).toBe(0.45);
        var label = pie.label.formatter('<img src=x onerror=alert(1)>', { percent: 12.4 });
        expect(label).not.toContain('<img');
        expect(label).toContain('&lt;img');
        expect(label).toContain('12%');
      });

      it('draws nothing for the total and list modes', function () {
        draw('total');
        draw('list');
        expect(plot.calls.count()).toBe(0);
      });
    });

    describe('the template', function () {
      var template = require('../../src/app/panels/hits/module.html');

      function render(chart) {
        var scope = hitsPanel(chart);
        f.dashboard.indices = []; // the controller waits for indices: it leaves the data alone
        scope.data = [{ info: { alias: 'errors', color: '#e00' }, id: 0, hits: 3, data: [[0, 3]] }];
        var el = f.injector.get('$compile')('<div>' + template + '</div>')(scope);
        scope.$digest();
        return el;
      }

      function visible(el, selector) {
        // AngularJS 1.0.8 hides with an inline style
        return el.find(selector).filter(function () { return this.style.display !== 'none'; });
      }

      it('shows the legend of the queries for the bar and pie charts', function () {
        ['bar', 'pie'].forEach(function (chart) {
          var el = render(chart);
          expect(visible(el, '[hits-chart]').length).toBe(1);
          expect(el.text()).toContain('errors');
          expect(el.text()).toContain('(3)');
        });
      });

      it('shows the list of the queries for the list mode and no chart', function () {
        var el = render('list');
        expect(visible(el, 'span[ng-show]').text()).toContain('errors (3)');
        expect(visible(el, '[hits-chart]').length).toBe(0);
      });
    });
  });

  describe('the heatmap panel', function () {
    var FACETS = [
      { value: 'us', pivot: [{ value: 'ERROR', count: 3 }, { value: 'WARN', count: 1 }] },
      { value: 'de', pivot: [{ value: 'ERROR', count: 2 }, { value: 'WARN', count: 4 }] },
      { value: 'fr', pivot: [{ value: 'ERROR', count: 5 }, { value: 'WARN', count: 6 }] }
    ];

    function heatmap(settings) {
      var f = fixture('kibana.panels.heatmap');
      f.scope.panel = angular.extend({ row_field: 'region', col_field: 'level' }, settings);
      f.injector.get('$controller')('heatmap', { $scope: f.scope });
      return f;
    }

    function termsFilters(f) {
      return Object.keys(f.filterSrv.list).map(function (id) {
        var filter = f.filterSrv.list[id];
        return filter.field + '=' + decodeURIComponent(filter.value);
      }).sort();
    }

    it('keeps the default number of rows of the last release', function () {
      expect(heatmap().scope.panel.row_size).toBe(300);
    });

    [FACETS, FACETS.slice(0, 2), FACETS.slice(0, 1)].forEach(function (facets) {
      it('labels the axes by field name, swapped once when transposed (' + facets.length + ' rows)', function () {
        var f = heatmap();
        f.scope.formatData(facets, false);
        expect(f.scope.axis_labels).toEqual(['level', 'region']);
        f.scope.formatData(facets, true);
        // axis_labels[1] names the vertical axis, which then lists the values of the column field
        expect(f.scope.axis_labels).toEqual(['region', 'level']);
        expect(f.scope.row_labels).toEqual(['ERROR', 'WARN']);
        expect(f.scope.col_labels).toEqual(facets.map(function (d) { return d.value; }));
      });
    });

    it('filters a cell by the row field and the column field when it is not transposed', function () {
      var f = heatmap();
      f.scope.formatData(FACETS, false);
      f.scope.build_search('de', 'WARN');
      expect(termsFilters(f)).toEqual(['level=WARN', 'region=de']);
      expect(f.dashboard.refresh).toHaveBeenCalled();
    });

    it('filters a cell on the field whose values it shows when it is transposed', function () {
      var f = heatmap({ transposed: true });
      f.scope.formatData(FACETS, true);
      // the row of a transposed heatmap shows a level, its column a region
      f.scope.build_search('WARN', 'de');
      expect(termsFilters(f)).toEqual(['level=WARN', 'region=de']);
    });

    it('filters by the layout on screen when the setting changes without a new layout', function () {
      var f = heatmap();
      f.scope.formatData(FACETS, false);
      // the editor's checkbox changes the setting; the data is laid out again only when it closes
      f.scope.panel.transposed = true;
      f.scope.build_search('de', 'WARN');
      expect(termsFilters(f)).toEqual(['level=WARN', 'region=de']);
    });

    it('goes on showing the spinner until the answer arrives', function () {
      var f = heatmap();
      var $httpBackend = f.injector.get('$httpBackend');
      $httpBackend.expectPOST(/\/select$/).respond(200, { facet_counts: { facet_pivot: { 'region,level': FACETS } } });

      f.scope.get_data();
      expect(f.scope.panelMeta.loading).toBe(true);
      $httpBackend.flush();

      expect(f.scope.panelMeta.loading).toBe(false);
      expect(f.scope.facets.length).toBe(3);
    });
  });

  describe('the terms panel log axis', function () {
    beforeEach(function () {
      spyOn($, 'plot').and.returnValue({});
    });

    function drawLogAxis(arrangement, done) {
      var f = fixture('kibana.panels.terms');
      f.scope.panel = { chart: 'bar', logAxis: true, field: 'status', chartColors: ['#1f77b4'],
        bar_chart_arrangement: arrangement };
      f.scope.row = { height: '150px' };
      f.scope.data = [{ label: 'a', data: [['a', 100]], meta: undefined }];
      f.injector.get('$compile')('<div terms-chart></div>')(f.scope);
      f.scope.$emit('render');
      waitFor(function () { return $.plot.calls.count() > 0; }, function () {
        done($.plot.calls.mostRecent().args[2]);
      }, function () {
        done(null);
      });
    }

    [['vertical', 'yaxis'], ['horizontal', 'xaxis']].forEach(function (pair) {
      it('scales the values to the ticks on the ' + pair[1] + ' of a ' + pair[0] + ' chart', function (done) {
        drawLogAxis(pair[0], function (options) {
          expect(options).not.toBeNull();
          var axis = options[pair[1]];
          expect(axis.transform(Math.E)).toBeCloseTo(1, 10);
          expect(axis.inverseTransform(1)).toBeCloseTo(Math.E, 10);
          expect(axis.transform(1000)).toBeCloseTo(Math.log(1000), 10);
          expect(axis.transform(0)).toBe(0);
          expect(axis.inverseTransform(0)).toBe(0);
          expect(typeof axis.ticks).toBe('function');
          done();
        });
      });
    });
  });

  describe('the list of collections', function () {
    var CORES = { status: { 'banana-it-logs': { name: 'banana-it-logs' }, 'banana-int': { name: 'banana-int' } } };

    describe('on a Solr without the Collections API', function () {
      modes.useMode('solr');
      var $httpBackend, kbnIndex, alertSrv;
      beforeEach(function () {
        var injector = helpers.createInjector();
        $httpBackend = injector.get('$httpBackend');
        kbnIndex = injector.get('kbnIndex');
        alertSrv = injector.get('alertSrv');
      });

      it('falls back to the cores that CoreAdmin lists and shows no error', function () {
        var names;
        $httpBackend.expectGET('/solr/admin/collections?action=LIST&wt=json&omitHeader=true').respond(400, { error: { msg: 'Solr instance is not running in SolrCloud mode.' } });
        $httpBackend.expectGET('/solr/admin/cores?action=STATUS&wt=json&omitHeader=true').respond(200, CORES);
        kbnIndex.collections('/solr/').then(function (list) { names = list; });
        $httpBackend.flush();
        expect(names).toEqual(['banana-it-logs', 'banana-int']);
        expect(alertSrv.list.length).toBe(0);
      });

      it('shows the error, and rejects, only when CoreAdmin fails too', function () {
        var rejected = false;
        spyOn(console, 'debug');
        $httpBackend.expectGET(/admin\/collections/).respond(404, '');
        $httpBackend.expectGET(/admin\/cores/).respond(500, '');
        kbnIndex.collections('/solr/').then(null, function () { rejected = true; });
        $httpBackend.flush();
        expect(rejected).toBe(true);
        expect(alertSrv.list.length).toBe(1);
        expect(alertSrv.list[0].text).toContain('error status = 500');
      });

      it('does not ask CoreAdmin when the Collections API answers', function () {
        var names;
        $httpBackend.expectGET(/admin\/collections/).respond(200, { collections: ['one'] });
        kbnIndex.collections('/solr/').then(function (list) { names = list; });
        $httpBackend.flush();
        expect(names).toEqual(['one']);
        $httpBackend.verifyNoOutstandingRequest();
      });
    });
  });

  describe('filters', function () {
    it('accepts a second range on a field when its bounds differ, and refuses an exact repeat', function () {
      var f = fixture();
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 10, to: 20, mandate: 'must' })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 30, to: 40, mandate: 'must' })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 10, to: 20, mandate: 'must' })).toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 10, to: 25, mandate: 'must' })).not.toBe(false);
      expect(f.filterSrv.idsByType('range').length).toBe(3);
      expect(f.filterSrv.getSolrFq()).toBe('fq=cpu:[10 TO 20]&fq=cpu:[30 TO 40]&fq=cpu:[10 TO 25]');
    });

    it('accepts a range that differs from an existing one only in its lower bound, or only in its upper bound', function () {
      var f = fixture();
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 10, to: 20 })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 11, to: 20 })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'range', field: 'cpu', from: 10, to: 21 })).not.toBe(false);
      expect(f.filterSrv.idsByType('range').length).toBe(3);
    });

    it('still refuses a repeated terms filter', function () {
      var f = fixture();
      expect(f.filterSrv.set({ type: 'terms', field: 'host', value: 'a' })).not.toBe(false);
      expect(f.filterSrv.set({ type: 'terms', field: 'host', value: 'a' })).toBe(false);
    });
  });

  describe('the time picker', function () {
    function timeFilterFor(timespan) {
      var f = fixture('kibana.panels.timepicker');
      f.scope.panel = { mode: 'relative', timespan: timespan, timefield: 'ts' };
      f.injector.get('$controller')('timepicker', { $scope: f.scope });
      f.scope.init();
      var id = f.filterSrv.idsByType('time')[0];
      return f.filterSrv.list[id];
    }

    [['15m', 'MINUTE', '15'], ['6h', 'HOUR', '6'], ['2d', 'DAY', '2'], ['2w', 'DAY', '14'],
      ['1M', 'MONTH', '1'], ['1y', 'YEAR', '1']].forEach(function (c) {
      it('rounds a relative range of ' + c[0] + ' to the ' + c[1].toLowerCase(), function () {
        var filter = timeFilterFor(c[0]);
        expect(filter.from).toBe('NOW/' + c[1] + '-' + c[2] + c[1]);
        expect(filter.to).toBe('NOW/' + c[1] + '%2B1' + c[1]);
      });
    });

    describe('the start of a relative range, as a date object', function () {
      var moment = require('moment');
      var handler;

      beforeEach(function () {
        handler = moment.deprecationHandler;
        // moment calls this for every use of an outdated call form, so one use fails the test
        moment.deprecationHandler = function (name, message) { throw new Error('moment: ' + message); };
      });

      afterEach(function () {
        moment.deprecationHandler = handler;
      });

      [['30m', 30 * 60e3], ['6h', 6 * 3600e3], ['2d', 2 * 86400e3]].forEach(function (c) {
        it('is ' + c[0] + ' before now, and uses the current moment call form', function () {
          var filter = timeFilterFor(c[0]);
          expect(Math.abs((filter.toDateObj - filter.fromDateObj) - c[1])).toBeLessThan(2 * 3600e3);
        });
      });
    });
  });

  describe('a dashboard saved with an absolute time range', function () {
    // what the dashboard holds after it is saved as JSON and read back: the dates are strings and the
    // date objects of the relative modes are missing
    function reopened(moduleName) {
      var f = fixture(moduleName);
      var from = '2024-01-01T00:00:00.000Z', to = '2024-01-02T00:00:00.000Z';
      f.dashboard.current.services.filter = {
        list: { 0: { id: 0, type: 'time', field: 'ts', from: from, to: to, active: true, mandate: 'must' } },
        ids: [0]
      };
      f.filterSrv.init();
      return f;
    }

    it('gives the panels a valid time range', function () {
      var range = reopened().filterSrv.timeRange('min');
      expect(range.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    });

    it('does not make the ticker throw when it asks for its two ranges', function () {
      var f = reopened('kibana.panels.ticker');
      f.dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
      var $httpBackend = f.injector.get('$httpBackend');
      $httpBackend.whenPOST(/\/select$/).respond(200, { facet_counts: { facet_ranges: { ts: { between: 1 } } } });
      f.scope.panel = {};
      f.scope.row = { height: '100px' };
      f.injector.get('$controller')('ticker', { $scope: f.scope });
      expect(function () { f.scope.get_data(); }).not.toThrow();
    });

    describe('a relative range written in a dashboard file, with no date objects', function () {
      function loaded(from, to, moduleName) {
        var f = fixture(moduleName);
        f.dashboard.current.services.filter = {
          list: { 0: { id: 0, type: 'time', field: 'ts', from: from, to: to, active: true, mandate: 'must' } },
          ids: [0]
        };
        f.filterSrv.init();
        return f;
      }

      it('gives the panels the dates that the Solr date math names', function () {
        var before = Date.now();
        var range = loaded('NOW/HOUR-1HOUR', 'NOW/HOUR%2B1HOUR').filterSrv.timeRange('min');
        var hourStart = Math.floor(before / 3600000) * 3600000;
        expect(range.from.getTime()).toBe(hourStart - 3600000);
        expect(range.to.getTime()).toBe(hourStart + 3600000);
      });

      it('reads the other units, a plain NOW, a month and the "since" form', function () {
        var f = loaded('NOW-15MINUTE', 'NOW');
        var range = f.filterSrv.timeRange('min');
        expect(Math.abs(range.to.getTime() - Date.now())).toBeLessThan(5000);
        expect(Math.abs(range.to.getTime() - range.from.getTime() - 15 * 60000)).toBeLessThan(5000);
        range = loaded('NOW/MONTH-1MONTH', 'NOW/MONTH%2B1MONTH').filterSrv.timeRange('min');
        expect(range.from.getUTCDate()).toBe(1);
        expect(range.from.getTime()).toBeLessThan(range.to.getTime());
        range = loaded('2024-01-01T00:00:00.000Z/SECOND', '*').filterSrv.timeRange('min');
        expect(range.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
        expect(isNaN(range.to.getTime())).toBe(false);
      });

      it('sends the same filter to Solr as before', function () {
        var f = loaded('NOW/HOUR-1HOUR', 'NOW/HOUR%2B1HOUR');
        expect(f.filterSrv.getSolrFq()).toBe('fq=ts:[NOW/HOUR-1HOUR%20TO%20NOW/HOUR%2B1HOUR]');
      });

      it('does not make the ticker throw when it reads the range before a time picker replaces it', function () {
        var f = loaded('NOW/HOUR-1HOUR', 'NOW/HOUR%2B1HOUR', 'kibana.panels.ticker');
        f.dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
        f.injector.get('$httpBackend').whenPOST(/\/select$/).respond(200, {});
        f.scope.panel = {};
        f.scope.row = { height: '100px' };
        f.injector.get('$controller')('ticker', { $scope: f.scope });
        expect(function () { f.scope.get_data(); }).not.toThrow();
      });
    });

    it('keeps the date objects that a relative range saved', function () {
      var f = fixture();
      f.dashboard.current.services.filter = {
        list: { 0: { id: 0, type: 'time', field: 'ts', from: 'NOW/HOUR-1HOUR', to: 'NOW/HOUR%2B1HOUR', active: true,
          fromDateObj: '2024-03-01T10:00:00.000Z', toDateObj: '2024-03-01T11:00:00.000Z' } },
        ids: [0]
      };
      f.filterSrv.init();
      var range = f.filterSrv.timeRange('min');
      expect(range.from.toISOString()).toBe('2024-03-01T10:00:00.000Z');
      expect(range.to.toISOString()).toBe('2024-03-01T11:00:00.000Z');
    });
  });

  describe('the dashboard list', function () {
    it('lists every dashboard when no query is given, instead of searching for "undefined"', function () {
      var injector = helpers.createInjector({}, []);
      var savedFusion = config.USE_FUSION;
      config.USE_FUSION = true;
      try {
        var lucidworksSrv = injector.get('lucidworksSrv');
        var $httpBackend = injector.get('$httpBackend');
        var url;
        $httpBackend.whenGET(/.*/).respond(function (method, requestUrl) { url = requestUrl; return [200, []]; });
        lucidworksSrv.getDashboardList();
        $httpBackend.flush();
        expect(url).toContain('?q=id:*&');
        expect(url).not.toContain('undefined');
      } finally {
        config.USE_FUSION = savedFusion;
      }
    });
  });
});
