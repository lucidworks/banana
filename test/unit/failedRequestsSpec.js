'use strict';

// A request that fails must be reported to the person using Banana: a failed save says so, a failed
// delete keeps the dashboard in the list, and a panel whose query fails shows the error and stops
// its spinner. These specs drive the real services, controllers and a panel against the mock
// $httpBackend, so they cover the whole path from the HTTP status to what is shown.
describe('failed requests', function () {
  var angular = require('angular');
  var config = require('config');
  var helpers = require('./helpers/injector');
  var httpErrors = require('components/http-errors');
  // Panels whose query starts from get_data() with the settings below. (bar and force wait on one
  // request; hits waits on several with $q.all.)
  var PANELS = ['bar', 'facet', 'force', 'graph', 'heatmap', 'hits', 'map', 'multiseries', 'rangeFacet',
    'sankey', 'scatterplot', 'significantTerms', 'sunburst', 'tagcloud', 'terms', 'timeseries'];
  // Settings the stream-expression panels need before they send a request.
  var PANEL_SETTINGS = {
    graph: { graph_collection: 'edges', join_field: 'src', from_field: 'dst', to_field: 'dst', label_field: 'name' },
    significantTerms: { mindoc_freq: 5, maxdoc_freq: 0.3, minterm_len: 4 },
    timeseries: { metric: 'count', field: '*', interval: '1h', auto_int: false }
  };
  require('panels/terms/module');
  PANELS.forEach(function (name) {
    require('panels/' + name + '/module');
  });

  var FAILURES = [
    { status: 403, body: { message: 'forbidden' } },
    { status: 404, body: { message: 'not found' } },
    { status: 500, body: { message: 'server error' } },
    { status: 0, body: '' }
  ];

  var savedConfig;
  var fakeWindow;

  // The interceptor as app.js installs it, with a window that records where the browser is sent.
  function interceptorModule() {
    return ['$httpProvider', function ($httpProvider) {
      $httpProvider.responseInterceptors.push(['$q', function ($q) {
        return httpErrors($q, fakeWindow);
      }]);
    }];
  }

  beforeEach(function () {
    savedConfig = { USE_FUSION: config.USE_FUSION, banana_index: config.banana_index };
    fakeWindow = { location: { search: '', hash: '', pathname: '/admin/banana/' } };
  });

  afterEach(function () {
    config.USE_FUSION = savedConfig.USE_FUSION;
    config.banana_index = savedConfig.banana_index;
  });

  function alertTitles(alertSrv) {
    return alertSrv.list.map(function (a) { return a.title; });
  }

  // Builds the real dashboard service and the dashLoader controller on top of it.
  function loaderFixture(useFusion) {
    config.USE_FUSION = useFusion;
    var injector = helpers.createInjector({}, [interceptorModule()]);
    var $httpBackend = injector.get('$httpBackend');
    // the dashboard service asks Fusion for the user name when it starts
    $httpBackend.whenGET(/\/api\/session$/).respond(200, { user: { username: 'tester' } });
    var dashboard = injector.get('dashboard');
    dashboard.current = {
      title: 'My dashboard',
      username: 'tester',
      loader: { save_temp_ttl_enable: false },
      services: {},
      solr: { server: '/api/query-pipelines/_system/collections/', core_name: 'logs' }
    };
    var scope = injector.get('$rootScope').$new();
    scope.config = config;
    injector.get('$controller')('dashLoader', { $scope: scope });
    scope.init();
    if (useFusion) {
      $httpBackend.flush();
    }
    return {
      $httpBackend: $httpBackend,
      alertSrv: injector.get('alertSrv'),
      scope: scope,
      // a save starts with promise steps that run in a digest (the mock backend does not digest before it flushes)
      flushSave: function () {
        injector.get('$rootScope').$digest();
        $httpBackend.flush();
      }
    };
  }

  [true, false].forEach(function (useFusion) {
    var target = useFusion ? 'Fusion blob store' : 'Solr';
    var saveUrl = useFusion ? /\/api\/blobs\/My%20dashboard\?resourceType=banana$/ : /\/update\?commit=true$/;
    // a save first asks whether the title is taken: it is not
    var save = function (f) {
      if (useFusion) {
        f.$httpBackend.expectGET(/\/api\/blobs\/My%20dashboard$/).respond(404, { error: 'BLOB-0001' });
        return f.$httpBackend.expectPUT(saveUrl);
      }
      f.$httpBackend.expectGET(/\/select\?wt=json&rows=1&/).respond(200, { response: { numFound: 0, docs: [] } });
      return f.$httpBackend.expectPOST(saveUrl);
    };

    describe('saving a dashboard to the ' + target, function () {
      FAILURES.forEach(function (failure) {
        it('says "Save failed" when the server answers ' + failure.status, function () {
          var f = loaderFixture(useFusion);
          save(f).respond(failure.status, failure.body);

          f.scope.elasticsearch_save('dashboard');
          f.flushSave();

          expect(alertTitles(f.alertSrv)).toEqual(['Save failed']);
        });
      });

      it('says "Dashboard Saved" when the server accepts it', function () {
        var f = loaderFixture(useFusion);
        save(f).respond(200, {});

        f.scope.elasticsearch_save('dashboard');
        f.flushSave();

        expect(alertTitles(f.alertSrv)).toEqual(['Dashboard Saved']);
      });
    });
  });

  describe('deleting a dashboard from the Fusion blob store', function () {
    var deleteUrl = /\/api\/blobs\/two$/;

    function fixtureWithList() {
      var f = loaderFixture(true);
      f.scope.elasticsearch.dashboards = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
      return f;
    }

    [403, 404, 500, 0].forEach(function (status) {
      it('reports an error and keeps the dashboard in the list when the server answers ' + status, function () {
        var f = fixtureWithList();
        f.$httpBackend.expectDELETE(deleteUrl).respond(status, '');

        f.scope.elasticsearch_delete('two');
        f.$httpBackend.flush();

        expect(alertTitles(f.alertSrv)).toEqual(['Dashboard Not Deleted']);
        expect(f.alertSrv.list[0].severity).toBe('error');
        expect(f.scope.elasticsearch.dashboards.map(function (d) { return d.id; })).toEqual(['one', 'two', 'three']);
      });
    });

    it('removes the dashboard from the list when the server deletes it', function () {
      var f = fixtureWithList();
      f.$httpBackend.expectDELETE(deleteUrl).respond(204, '');

      f.scope.elasticsearch_delete('two');
      f.$httpBackend.flush();

      expect(alertTitles(f.alertSrv)).toEqual(['Dashboard Deleted']);
      expect(f.scope.elasticsearch.dashboards.map(function (d) { return d.id; })).toEqual(['one', 'three']);
    });
  });

  describe('a panel whose query fails', function () {
    function panelFixture() {
      config.USE_FUSION = true;
      var dashboard = helpers.fakeDashboard();
      dashboard.indices = ['logstash-2999.12.31'];
      dashboard.current.loader = {};
      var injector = helpers.createInjector({ dashboard: dashboard, fields: {} }, [interceptorModule(), 'kibana.panels.terms']);
      var $controller = injector.get('$controller');
      var dashScope = injector.get('$rootScope').$new();
      $controller('DashCtrl', { $scope: dashScope });
      var scope = dashScope.$new();
      scope.panel = { field: 'status', title: 'Status' };
      $controller('terms', { $scope: scope });
      return { $httpBackend: injector.get('$httpBackend'), scope: scope };
    }

    it('shows the error and stops the spinner when the server answers 500', function () {
      var f = panelFixture();
      f.$httpBackend.expectPOST(/\/select$/).respond(500, 'Internal Server Error');

      f.scope.get_data();
      expect(f.scope.panelMeta.loading).toBe(true);
      f.$httpBackend.flush();

      expect(f.scope.panelMeta.loading).toBe(false);
      expect(f.scope.panel.error).toBe('The request failed (HTTP status 500)');
    });

    it('shows the message that Solr sends with its error', function () {
      var f = panelFixture();
      f.$httpBackend.expectPOST(/\/select$/).respond(400, { error: { msg: 'undefined field: nope', code: 400 } });

      f.scope.get_data();
      f.$httpBackend.flush();

      expect(f.scope.panelMeta.loading).toBe(false);
      expect(f.scope.panel.error).toBe('undefined field: nope');
    });

    it('says the server could not be contacted when there is no answer', function () {
      var f = panelFixture();
      f.$httpBackend.expectPOST(/\/select$/).respond(0, '');

      f.scope.get_data();
      f.$httpBackend.flush();

      expect(f.scope.panelMeta.loading).toBe(false);
      expect(f.scope.panel.error).toMatch(/Could not contact the server/);
    });
  });

  // Every panel that waits on a query must give a failure handler, or its spinner never stops.
  describe('every panel that runs a query', function () {
    PANELS.forEach(function (name) {
      it('the ' + name + ' panel shows the error and stops the spinner when the server answers 500', function () {
        config.USE_FUSION = true;
        var dashboard = helpers.fakeDashboard();
        dashboard.indices = ['logstash-2999.12.31'];
        dashboard.current.loader = {};
        var injector = helpers.createInjector({ dashboard: dashboard, fields: {} }, [interceptorModule(), 'kibana.panels.' + name]);
        var $controller = injector.get('$controller');
        var dashScope = injector.get('$rootScope').$new();
        $controller('DashCtrl', { $scope: dashScope });
        var scope = dashScope.$new();
        scope.panel = angular.extend({ field: 'status', title: 'Status', facet_pivot_strings: ['a', 'b'] },
          PANEL_SETTINGS[name]);
        if (PANEL_SETTINGS[name]) {
          // the stream-expression panels need a query and a time filter before they send anything
          dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
          injector.get('querySrv').init();
          var filterSrv = injector.get('filterSrv');
          filterSrv.init();
          filterSrv.set({ type: 'time', field: 'ts', from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-02T00:00:00Z') });
        }
        $controller(name, { $scope: scope });
        var $httpBackend = injector.get('$httpBackend');
        $httpBackend.whenGET(/.*/).respond(500, 'Internal Server Error');
        $httpBackend.whenPOST(/.*/).respond(500, 'Internal Server Error');

        scope.get_data();
        $httpBackend.flush();

        expect(scope.panelMeta.loading).toBe(false);
        expect(scope.panel.error).toBe('The request failed (HTTP status 500)');
      });
    });
  });

  // Alerts are shown as HTML, so text taken from the address bar, a request or a dashboard file must be
  // escaped before it goes into an alert.
  describe('alerts that quote a request or address value', function () {
    var PAYLOAD = '<img src=x onerror=window.xssRan=1>';

    function expectEscaped(alertSrv, quoted) {
      expect(alertSrv.list.length).toBeGreaterThan(0);
      alertSrv.list.forEach(function (a) {
        expect(a.text).not.toMatch(/<img/);
        expect(a.text).not.toMatch(/onerror=window\.xssRan=1>/);
      });
      expect(alertSrv.list[alertSrv.list.length - 1].text).toContain(quoted);
    }

    it('escapes the file name when a dashboard file cannot be loaded', function () {
      config.USE_FUSION = false;
      var injector = helpers.createInjector({}, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/dashboards\//).respond(404, '');
      injector.get('dashboard').file_load(PAYLOAD);
      $httpBackend.flush();
      expectEscaped(injector.get('alertSrv'), '&lt;img src=x onerror=window.xssRan=1&gt;');
    });

    it('escapes the dashboard name when a saved dashboard cannot be found', function () {
      config.USE_FUSION = true;
      var injector = helpers.createInjector({}, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/\/api\/session$/).respond(200, { user: { username: 'tester' } });
      $httpBackend.whenGET(/\/api\/blobs\//).respond(404, '[{"banana_dashboard_s":"{}"}]');
      injector.get('dashboard').elasticsearch_load('solr', PAYLOAD);
      $httpBackend.flush();
      expectEscaped(injector.get('alertSrv'), 'named "&lt;img src=x onerror=window.xssRan=1&gt;"');
    });

    it('escapes the Solr address that comes from the dashboard when the collection is not found', function () {
      config.USE_FUSION = false;
      var dashboard = helpers.fakeDashboard();
      dashboard.current.solr.server = 'http://' + PAYLOAD + '/solr/';
      var injector = helpers.createInjector({ dashboard: dashboard }, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/.*/).respond(404, '');
      injector.get('fields').map();
      $httpBackend.flush();
      expectEscaped(injector.get('alertSrv'), 'Collection not found at http://&lt;img');
    });

    it('escapes the Solr address in the facet data alert', function () {
      config.USE_FUSION = false;
      var dashboard = helpers.fakeDashboard();
      dashboard.current.solr.server = 'http://' + PAYLOAD + '/solr/';
      var injector = helpers.createInjector({ dashboard: dashboard }, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/.*/).respond(0, '');
      injector.get('solrSrv').calcTopFieldValues(['status']);
      $httpBackend.flush();
      expectEscaped(injector.get('alertSrv'), 'Could not contact Solr at http://&lt;img');
    });
  });

  describe('the field list when the request fails', function () {
    function fixture(useFusion, status) {
      config.USE_FUSION = useFusion;
      var injector = helpers.createInjector({ dashboard: helpers.fakeDashboard() }, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/.*/).respond(status, '');
      var outcome = { resolved: false, rejected: false };
      injector.get('fields').map().then(function (mapping) {
        outcome.resolved = true;
        outcome.mapping = mapping;
      }, function () {
        outcome.rejected = true;
      });
      $httpBackend.flush();
      return { alertSrv: injector.get('alertSrv'), outcome: outcome };
    }

    it('raises only the alert that says why in Solr mode, not a second one that hides it', function () {
      var f = fixture(false, 404);
      expect(f.alertSrv.list.length).toBe(1);
      expect(f.alertSrv.list[0].text).toMatch(/^Collection not found at /);
      expect(f.outcome.rejected).toBe(true);
    });

    it('resolves with an empty list and no alert in Fusion mode when both field requests fail', function () {
      var f = fixture(true, 403);
      expect(f.alertSrv.list).toEqual([]);
      expect(f.outcome.rejected).toBe(false);
      expect(f.outcome.resolved).toBe(true);
      expect(f.outcome.mapping['logstash-2999.12.31'].logs).toEqual({});
    });
  });

  describe('the response interceptor', function () {
    function get(status) {
      var injector = helpers.createInjector({}, [interceptorModule()]);
      var $httpBackend = injector.get('$httpBackend');
      var outcome = { resolved: false, rejected: false };
      $httpBackend.expectGET('/api/thing').respond(status, '');
      injector.get('$http').get('/api/thing').then(function (response) {
        outcome.resolved = true;
        outcome.value = response;
      }, function (response) {
        outcome.rejected = true;
        outcome.status = response.status;
      });
      $httpBackend.flush();
      return outcome;
    }

    [403, 404, 500, 0].forEach(function (status) {
      it('rejects a ' + status + ' and leaves the page alone', function () {
        var outcome = get(status);
        expect(outcome.rejected).toBe(true);
        expect(outcome.resolved).toBe(false);
        expect(outcome.status).toBe(status);
        expect(fakeWindow.location).toEqual({ search: '', hash: '', pathname: '/admin/banana/' });
      });
    });

    it('sends the browser to the login page on a 401, as before', function () {
      fakeWindow.location = { search: '?q=a', hash: '#/dashboard/solr/x', pathname: '/admin/banana/' };

      var outcome = get(401);

      expect(fakeWindow.location).toBe('../login?return=/admin/banana/%23/dashboard/solr/x?' + encodeURIComponent('?q=a'));
      // the page is leaving, so the request neither resolves with data nor reports a failure
      expect(outcome.rejected).toBe(false);
      expect(angular.isUndefined(outcome.value)).toBe(true);
    });

    it('sends the browser to the login page named by FUSION_LOGIN_URL, with the same return value', function () {
      var saved = config.FUSION_LOGIN_URL;
      config.FUSION_LOGIN_URL = '/auth/login';
      try {
        fakeWindow.location = { search: '?q=a', hash: '#/dashboard/solr/x', pathname: '/' };

        get(401);

        expect(fakeWindow.location).toBe('/auth/login?return=/%23/dashboard/solr/x?' + encodeURIComponent('?q=a'));
      } finally {
        config.FUSION_LOGIN_URL = saved;
      }
    });
  });
});
