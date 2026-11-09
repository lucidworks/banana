'use strict';

// The rest of the dashboard service around the saved-dashboard calls: choosing what to load from the URL, the
// refresh that reads the collection list, and the small helpers. They run against the recorded dashboard and the
// recorded collection list (Fusion mode) and the derived Solr collection list (Solr mode).
describe('dashboard service on recorded responses', function () {
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  var ID = 'banana-it-000000000000-1';
  // The session request is the relative path the service reads from its setting.
  var sessionUrl = require('config').FUSION_SESSION_API;

  var injector, $httpBackend, $rootScope, dashboard, alertSrv;

  function setup(routeParams, mode) {
    injector = helpers.createInjector({ $routeParams: routeParams || {} });
    $httpBackend = injector.get('$httpBackend');
    $rootScope = injector.get('$rootScope');
    if (mode === 'fusion') {
      fixtures.respond($httpBackend.expectGET(sessionUrl), fixtures.load('fusion-5.9.16/session'));
    }
    dashboard = injector.get('dashboard');
    alertSrv = injector.get('alertSrv');
    if (mode === 'fusion') { $httpBackend.flush(); }
  }

  function recordedDashboard(server) {
    var dash = JSON.parse(fixtures.load('fusion-5.9.16/blob-read').response.body[0].banana_dashboard_s);
    if (server) { dash.solr.server = server; }
    return dash;
  }

  afterEach(function () {
    $httpBackend.verifyNoOutstandingExpectation();
    $httpBackend.verifyNoOutstandingRequest();
  });

  describe('Fusion mode (recorded from Fusion 5.9.16)', function () {
    modes.useMode('fusion');

    it('loads the saved dashboard that the URL names (a /dashboard/solr/<id> route)', function () {
      setup({ kbnType: 'solr', kbnId: ID }, 'fusion');
      fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-read'));
      $rootScope.$broadcast('$routeChangeSuccess');
      $httpBackend.flush();
      expect(dashboard.current.title).toBe(ID);
    });

    it('reads the collection list from Fusion when it refreshes, and tells the panels to refresh', function () {
      setup({}, 'fusion');
      dashboard.dash_load(recordedDashboard());
      var refreshed = jasmine.createSpy('refresh');
      $rootScope.$on('refresh', refreshed);
      var collections = fixtures.load('fusion-5.9.16/collections');
      fixtures.respond($httpBackend.expectGET('/api/collections'), collections);
      dashboard.refresh();
      $httpBackend.flush();
      expect(dashboard.current.solr.core_list).toEqual(collections.response.body.map(function (c) { return c.id; }));
      expect(dashboard.indices).toEqual(['INDEX_MISSING']);
      expect(refreshed).toHaveBeenCalled();
    });

    it('ignores a collection list that arrives after another dashboard was opened', function () {
      setup({}, 'fusion');
      dashboard.dash_load(recordedDashboard());
      fixtures.respond($httpBackend.expectGET('/api/collections'), fixtures.load('fusion-5.9.16/collections'));
      dashboard.refresh();
      // the route change replaces the current dashboard while the list is still loading
      dashboard.current = {};
      expect(function () { $httpBackend.flush(); }).not.toThrow();
      expect(dashboard.current).toEqual({});
    });
  });

  describe('Solr mode (Solr response shapes, derived: no standalone Solr was recorded)', function () {
    describe('with the collections API', function () {
      modes.useMode('solr');

      it('loads the saved dashboard that the URL names', function () {
        setup({ kbnType: 'solr', kbnId: ID }, 'solr');
        fixtures.respond($httpBackend.expectGET('/solr/banana-int/select?wt=json&q=title%3A%22' + ID + '%22'), fixtures.load('solr-shapes/dashboard-load'));
        $rootScope.$broadcast('$routeChangeSuccess');
        $httpBackend.flush();
        expect(dashboard.current.title).toBe(ID);
      });

      it('reads the collection list from Solr when it refreshes', function () {
        setup({}, 'solr');
        dashboard.dash_load(recordedDashboard('/solr/'));
        var list = fixtures.load('solr-shapes/collections-list');
        fixtures.respond($httpBackend.expectGET('/solr/admin/collections?action=LIST&wt=json&omitHeader=true'), list);
        dashboard.refresh();
        $httpBackend.flush();
        expect(dashboard.current.solr.core_list).toEqual(list.response.body.collections);
      });

      it('tells the user when Solr returns no collections', function () {
        setup({}, 'solr');
        dashboard.dash_load(recordedDashboard('/solr/'));
        $httpBackend.expectGET(/admin\/collections/).respond(200, '{"responseHeader":{"status":0},"collections":[]}');
        dashboard.refresh();
        $httpBackend.flush();
        expect(alertSrv.list[0].title).toBe('No collections');
      });
    });
  });

  describe('what to load when the URL names no saved dashboard', function () {
    modes.useMode('solr');
    var stored;

    beforeEach(function () {
      stored = window.localStorage.getItem('dashboard');
      window.localStorage.removeItem('dashboard');
    });
    afterEach(function () {
      if (stored === null) { window.localStorage.removeItem('dashboard'); } else { window.localStorage.setItem('dashboard', stored); }
    });

    it('loads the default dashboard file', function () {
      setup({}, 'solr');
      $httpBackend.expectGET(/^app\/dashboards\/default\.json\?/).respond(200, JSON.stringify({ title: 'from file', rows: [] }));
      $rootScope.$broadcast('$routeChangeSuccess');
      $httpBackend.flush();
      expect(dashboard.current.title).toBe('from file');
    });

    it('loads the dashboard that the browser stored as its default, and forgets it when asked', function () {
      setup({}, 'solr');
      expect(dashboard.set_default(recordedDashboard('/solr/'))).toBe(true);
      $rootScope.$broadcast('$routeChangeSuccess');
      expect(dashboard.current.title).toBe(ID);
      expect(dashboard.purge_default()).toBe(true);
      expect(window.localStorage.getItem('dashboard')).toBe('');
    });

    it('tells the user when a dashboard file cannot be loaded', function () {
      setup({ kbnType: 'file', kbnId: 'missing.json' }, 'solr');
      $httpBackend.expectGET(/^app\/dashboards\/missing\.json\?/).respond(404, '');
      var out;
      dashboard.file_load('missing.json').then(function (v) { out = v; });
      $httpBackend.flush();
      expect(out).toBe(false);
      expect(alertSrv.list[0].text).toContain('Could not load <i>dashboards/missing.json</i>');
    });

    it('falls back to the default file for a route type it does not know', function () {
      setup({ kbnType: 'nonsense', kbnId: 'x' }, 'solr');
      $httpBackend.expectGET(/^app\/dashboards\/default\.json\?/).respond(200, JSON.stringify({ title: 'fallback', rows: [] }));
      $rootScope.$broadcast('$routeChangeSuccess');
      $httpBackend.flush();
      expect(dashboard.current.title).toBe('fallback');
    });
  });

  describe('helpers', function () {
    modes.useMode('solr');
    beforeEach(function () { setup({}, 'solr'); });

    it('recognises a gist id and extracts it from a gist link', function () {
      expect(dashboard.is_gist('1234567')).toBe(true);
      expect(dashboard.is_gist('abcdef0123456789')).toBe(true);
      expect(dashboard.is_gist('My dashboard')).toBe(false);
      expect(dashboard.is_gist('')).toBe(false);
      expect(dashboard.is_gist(undefined)).toBe(false);
      expect(dashboard.gist_id('https://gist.github.com/someone/abcdef0123456789')).toBe('abcdef0123456789');
      expect(dashboard.gist_id('not a gist')).toBeUndefined();
    });

    it('builds a link to a saved dashboard', function () {
      var link = dashboard.share_link('t', 'solr', ID);
      expect(link.link).toContain('#dashboard/solr/' + ID);
      expect(link).toEqual(jasmine.objectContaining({ type: 'solr', id: ID, title: 't' }));
    });

    it('formats numbers and escapes text', function () {
      expect(dashboard.numberWithCommas(1234567)).toBe('1,234,567');
      expect(dashboard.numberWithCommas(0)).toBe(0);
      expect(dashboard.escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });

    it('saves a dashboard to a gist and returns its URL, or false when GitHub refuses', function () {
      dashboard.dash_load(recordedDashboard('/solr/'));
      var url;
      $httpBackend.expectPOST('https://api.github.com/gists').respond(201, { html_url: 'https://gist.example/1' });
      dashboard.save_gist('t').then(function (v) { url = v; });
      $httpBackend.flush();
      expect(url).toBe('https://gist.example/1');

      var failed;
      $httpBackend.expectPOST('https://api.github.com/gists').respond(500, '');
      dashboard.save_gist('t').then(function (v) { failed = v; });
      $httpBackend.flush();
      expect(failed).toBe(false);
    });
  });
});
