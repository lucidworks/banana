'use strict';

// The dashboard service loads, saves, lists and deletes saved dashboards. With Fusion they live in the blob store
// (/api/blobs), with a plain Solr in the banana-int collection. These specs drive the real service against the mock
// $httpBackend and answer with the recorded fixtures: in Fusion mode, responses recorded from Fusion 5.9.16; in
// Solr mode, Solr response shapes that were derived (no standalone Solr was recorded), which each group says.
describe('dashboard saved-dashboard calls on recorded responses', function () {
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  var ID = 'banana-it-000000000000-1';
  // The session request is the relative path the service reads from its setting.
  var sessionUrl = require('config').FUSION_SESSION_API;

  var injector, $httpBackend, dashboard, alertSrv;

  // Builds the service. In Fusion mode the service asks for the session when it is created.
  function setup(routeParams, session) {
    injector = helpers.createInjector({ $routeParams: routeParams || {} });
    $httpBackend = injector.get('$httpBackend');
    if (session) {
      fixtures.respond($httpBackend.expectGET(sessionUrl), session);
    }
    dashboard = injector.get('dashboard');
    alertSrv = injector.get('alertSrv');
    if (session) { $httpBackend.flush(); }
  }

  // The dashboard of the recorded blob; `server` replaces the server it was saved with (a Solr mode dashboard names /solr/).
  function savedDashboard(server) {
    var blob = fixtures.load('fusion-5.9.16/blob-read').response.body[0];
    var dash = JSON.parse(blob.banana_dashboard_s);
    if (server) { dash.solr.server = server; }
    return dash;
  }

  // What a save asks first: is the title taken? Fusion reads the blob (recorded: the blob store answers 404 with its own
  // error), Solr selects on the id (derived: a result with no document).
  function expectFree(id) {
    if (require('config').USE_FUSION) {
      fixtures.respond($httpBackend.expectGET('/api/blobs/' + encodeURIComponent(id)), fixtures.load('fusion-5.9.16/blob-read-absent'));
    } else {
      fixtures.respond($httpBackend.expectGET(/\/solr\/banana-int\/select\?wt=json&rows=1&fl=id,user,dashboard,_version_&q=id%3A%22/), fixtures.load('solr-shapes/dashboard-load-none'));
    }
  }

  // A save starts with promise steps (the session user, the look-up), which run in a digest: the mock backend of
  // AngularJS 1.0.8 does not digest before it flushes.
  function flushSave() {
    injector.get('$rootScope').$digest();
    $httpBackend.flush();
  }

  function settled(promise) {
    var out = {};
    promise.then(function (v) { out.value = v; out.resolved = true; }, function (e) { out.error = e; out.rejected = true; });
    return out;
  }

  afterEach(function () {
    $httpBackend.verifyNoOutstandingExpectation();
    $httpBackend.verifyNoOutstandingRequest();
  });

  describe('Fusion mode (recorded from Fusion 5.9.16)', function () {
    modes.useMode('fusion');

    describe('the session', function () {
      it('uses the user name of the session as the owner of the dashboards it loads', function () {
        setup({}, fixtures.load('fusion-5.9.16/session'));
        dashboard.dash_load({ title: 't', rows: [] });
        expect(dashboard.current.username).toBe('fixture-user');
      });

      it('uses guest when there is no session', function () {
        spyOn(console, 'log');
        setup({}, fixtures.load('fusion-5.9.16/session-unauthenticated'));
        dashboard.dash_load({ title: 't', rows: [] });
        expect(dashboard.current.username).toBe('guest');
      });

      it('uses the Fusion field names for saved dashboards', function () {
        setup({}, fixtures.load('fusion-5.9.16/session'));
        expect([dashboard.TITLE_FIELD, dashboard.DASHBOARD_FIELD, dashboard.USER_FIELD, dashboard.GROUP_FIELD])
          .toEqual(['banana_title_s', 'banana_dashboard_s', 'banana_user_s', 'banana_group_s']);
      });
    });

    describe('load', function () {
      beforeEach(function () { setup({}, fixtures.load('fusion-5.9.16/session')); });

      it('reads the blob and makes its dashboard the current one', function () {
        fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-read'));
        var out = settled(dashboard.elasticsearch_load('dashboard', ID));
        $httpBackend.flush();
        expect(out.resolved).toBe(true);
        expect(dashboard.current.title).toBe(ID);
        expect(dashboard.current.solr.core_name).toBe('banana-it-logs');
        expect(dashboard.current.solr.server).toBe('/api/query-pipelines/_system/collections/');
        expect(alertSrv.list).toEqual([]);
      });

      it('fills in what the saved dashboard leaves out', function () {
        fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-read'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(dashboard.current.index.interval).toBe('none');
        expect(dashboard.current.loader.save_default).toBe(true);
        expect(dashboard.current.username).toBe('fixture-user');
      });

      it('shows that the dashboard was not found when the blob store answers 404', function () {
        fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-read-absent'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list.length).toBe(1);
        expect(alertSrv.list[0].text).toBe('Could not find dashboard named "' + ID + '". Please ensure that the dashboard name is correct or exists in the system.');
        expect(dashboard.current.title).not.toBe(ID);
      });

      it('shows that Solr cannot be contacted when there is no answer', function () {
        $httpBackend.expectGET('/api/blobs/' + ID).respond(0, '');
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not contact Solr at');
      });

      it('replaces {{ARGS.name}} in the stored dashboard with the URL parameter, and nothing else', function () {
        setup({ q: 'hello' }, fixtures.load('fusion-5.9.16/session'));
        var blob = fixtures.load('fusion-5.9.16/blob-read');
        var stored = JSON.parse(blob.response.body[0].banana_dashboard_s);
        stored.title = 'for {{ARGS.q}} {{notargs}}';
        blob.response.body[0].banana_dashboard_s = JSON.stringify(stored);
        fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), blob);
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(dashboard.current.title).toBe('for hello {{notargs}}');
      });

      // the 404 that the blob store answered after the recorded delete
      it('shows that the dashboard is gone after a delete', function () {
        fixtures.respond($httpBackend.expectGET('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-read-after-delete'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not find dashboard named');
      });
    });

    describe('save', function () {
      beforeEach(function () {
        setup({}, fixtures.load('fusion-5.9.16/session'));
        dashboard.dash_load(savedDashboard());
      });

      // The recorded save sent a document with these fields, as the blob store stored it.
      var recordedKeys = function () {
        var sent = JSON.parse(fixtures.load('fusion-5.9.16/blob-save').recordedRequest.body);
        return Object.keys(sent[0]).sort();
      };

      it('puts a one-element array to the blob of the title, with the resource type, and the fields of the recording', function () {
        var sent = {};
        expectFree(ID);
        fixtures.respond($httpBackend.expectPUT('/api/blobs/' + ID + '?resourceType=banana'), fixtures.load('fusion-5.9.16/blob-save'), function (request) {
          sent.body = JSON.parse(request.data);
          sent.contentType = request.headers['Content-Type'];
        });
        var out = settled(dashboard.elasticsearch_save('dashboard', ID));
        flushSave();

        expect(out.resolved).toBe(true);
        expect(sent.contentType).toContain('application/json');
        expect(sent.body.length).toBe(1);
        expect(Object.keys(sent.body[0]).sort()).toEqual(recordedKeys());
        expect(sent.body[0]).toEqual(jasmine.objectContaining({
          id: ID, banana_user_s: 'fixture-user', banana_group_s: 'none', banana_title_s: ID, is_public_b: false
        }));
        expect(JSON.parse(sent.body[0].banana_dashboard_s).title).toBe(ID);
      });

      it('saves under a new title and marks a public dashboard', function () {
        dashboard.current.loader.save_as_public = true;
        var sent = {};
        expectFree('new title');
        fixtures.respond($httpBackend.expectPUT('/api/blobs/new%20title?resourceType=banana'), fixtures.load('fusion-5.9.16/blob-save'), function (request) {
          sent.body = JSON.parse(request.data);
        });
        dashboard.elasticsearch_save('dashboard', 'new title');
        flushSave();
        expect(sent.body[0].id).toBe('new title');
        expect(sent.body[0].is_public_b).toBe(true);
        expect(JSON.parse(sent.body[0].banana_dashboard_s).title).toBe('new title');
      });

      it('encodes the id of a title that has reserved characters in the save URL', function () {
        expectFree('q?#x/y');
        fixtures.respond($httpBackend.expectPUT('/api/blobs/q%3F%23x%2Fy?resourceType=banana'), fixtures.load('fusion-5.9.16/blob-save'));
        dashboard.elasticsearch_save('dashboard', 'q?#x/y');
        flushSave();
      });

      it('opens the saved dashboard two seconds later', function () {
        expectFree(ID);
        fixtures.respond($httpBackend.expectPUT(/\/api\/blobs\//), fixtures.load('fusion-5.9.16/blob-save'));
        dashboard.elasticsearch_save('dashboard', ID);
        flushSave();
        var $location = injector.get('$location');
        expect($location.url()).not.toBe('/dashboard/solr/' + ID);
        injector.get('$timeout').flush();
        expect($location.url()).toBe('/dashboard/solr/' + ID);
      });

      it('rejects the promise and does not open the dashboard when the blob store refuses the save (a 403 whose body is not recorded)', function () {
        expectFree(ID);
        $httpBackend.expectPUT(/\/api\/blobs\//).respond(403, '');
        spyOn(console, 'log');
        var out = settled(dashboard.elasticsearch_save('dashboard', ID));
        flushSave();
        expect(out.rejected).toBe(true);
        expect(out.error.status).toBe(403);
        // nothing was scheduled: flushing the timeout service finds no task (AngularJS 1.0.8 throws then)
        expect(function () { injector.get('$timeout').flush(); }).toThrow();
      });
    });

    describe('list', function () {
      beforeEach(function () { setup({}, fixtures.load('fusion-5.9.16/session')); });

      it('lists the blobs of the Banana resource type, in the shape of a Solr response', function () {
        var list = fixtures.load('fusion-5.9.16/blob-list');
        fixtures.respond($httpBackend.expectGET('/api/blobs?q=id:ban*&resourceType=banana'), list);
        var out = settled(dashboard.elasticsearch_list('ban', 10));
        $httpBackend.flush();
        expect(out.value.response.numFound).toBe(list.response.body.length);
        expect(out.value.response.docs.length).toBe(list.response.body.length);
      });

      it('rejects the promise when the blob store refuses the listing', function () {
        $httpBackend.expectGET(/\/api\/blobs\?/).respond(500, '');
        var out = settled(dashboard.elasticsearch_list('', 10));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
      });
    });

    describe('delete', function () {
      beforeEach(function () { setup({}, fixtures.load('fusion-5.9.16/session')); });

      it('deletes the blob of the id, and resolves with the empty answer of the 204', function () {
        fixtures.respond($httpBackend.expectDELETE('/api/blobs/' + ID), fixtures.load('fusion-5.9.16/blob-delete'));
        var out = settled(dashboard.elasticsearch_delete(ID));
        $httpBackend.flush();
        expect(out.resolved).toBe(true);
        expect(out.value).toBe('');
      });

      it('rejects the promise when the blob store refuses the delete (a 404 whose body is not recorded)', function () {
        // not recorded: the guarded client never sends a delete for an id it does not own
        $httpBackend.expectDELETE('/api/blobs/' + ID).respond(404, '');
        var out = settled(dashboard.elasticsearch_delete(ID));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
        expect(out.error.status).toBe(404);
      });
    });
  });

  describe('Solr mode (Solr response shapes, derived: no standalone Solr was recorded)', function () {
    modes.useMode('solr');

    describe('the service', function () {
      it('does not ask for a session and uses the default field names', function () {
        setup();
        expect([dashboard.TITLE_FIELD, dashboard.DASHBOARD_FIELD, dashboard.USER_FIELD, dashboard.GROUP_FIELD])
          .toEqual(['title', 'dashboard', 'user', 'group']);
        dashboard.dash_load({ title: 't', rows: [] });
        expect(dashboard.current.username).toBe('guest');
      });
    });

    describe('load', function () {
      var URL = '/solr/banana-int/select?wt=json&q=title%3A%22' + ID + '%22';
      beforeEach(function () { setup(); });

      it('reads the dashboard field of the first document', function () {
        fixtures.respond($httpBackend.expectGET(URL), fixtures.load('solr-shapes/dashboard-load'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(dashboard.current.title).toBe(ID);
        expect(dashboard.current.solr.core_name).toBe('banana-it-logs');
      });

      it('reads a dashboard field that Solr returns as an array', function () {
        fixtures.respond($httpBackend.expectGET(URL), fixtures.load('solr-shapes/dashboard-load-multivalued'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(dashboard.current.title).toBe(ID);
      });

      it('shows that the dashboard was not found when Solr answers with an error', function () {
        fixtures.respond($httpBackend.expectGET(URL), fixtures.load('solr-shapes/select-error'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not find dashboard named');
      });

      it('shows that Solr cannot be contacted when there is no answer', function () {
        $httpBackend.expectGET(URL).respond(0, '');
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not contact Solr at /solr/');
      });

      // Solr answers 200 with no document when no dashboard has the title.
      it('shows that the dashboard was not found when Solr finds no document', function () {
        fixtures.respond($httpBackend.expectGET(URL), fixtures.load('solr-shapes/dashboard-load-none'));
        dashboard.elasticsearch_load('dashboard', ID);
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not find dashboard named');
      });
    });

    describe('save', function () {
      beforeEach(function () {
        setup();
        dashboard.dash_load(savedDashboard('/solr/'));
      });

      it('posts a one-element array to the update handler of banana-int, with the Solr field names', function () {
        var sent = {};
        expectFree(ID);
        fixtures.respond($httpBackend.expectPOST('/solr/banana-int/update?commit=true'), fixtures.load('solr-shapes/update-ack'), function (request) {
          sent.body = JSON.parse(request.data);
          sent.contentType = request.headers['Content-type'] || request.headers['Content-Type'];
        });
        var out = settled(dashboard.elasticsearch_save('dashboard', ID));
        flushSave();
        expect(out.resolved).toBe(true);
        expect(sent.contentType).toBe('application/json');
        expect(sent.body.length).toBe(1);
        expect(sent.body[0]).toEqual({
          id: ID, user: 'guest', group: 'none', title: ID, dashboard: sent.body[0].dashboard
        });
        expect(JSON.parse(sent.body[0].dashboard).title).toBe(ID);
      });

      it('opens the saved dashboard on the same server two seconds later', function () {
        expectFree(ID);
        fixtures.respond($httpBackend.expectPOST(/update/), fixtures.load('solr-shapes/update-ack'));
        dashboard.elasticsearch_save('dashboard', ID);
        flushSave();
        injector.get('$timeout').flush();
        expect(injector.get('$location').url()).toBe('/dashboard/solr/' + ID + '?server=%2Fsolr%2F');
      });

      it('saves to the server that the loaded dashboard names, when no banana server is configured', function () {
        dashboard.dash_load(savedDashboard('/other-solr/'));
        $httpBackend.expectGET(/^\/other-solr\/banana-int\/select\?/).respond(200, fixtures.text(fixtures.load('solr-shapes/dashboard-load-none')));
        fixtures.respond($httpBackend.expectPOST('/other-solr/banana-int/update?commit=true'), fixtures.load('solr-shapes/update-ack'));
        dashboard.elasticsearch_save('dashboard', ID);
        flushSave();
      });

      it('saves to the configured banana server when there is one', function () {
        require('config').banana_server = '/solr-store/';
        $httpBackend.expectGET(/^\/solr-store\/banana-int\/select\?/).respond(200, fixtures.text(fixtures.load('solr-shapes/dashboard-load-none')));
        fixtures.respond($httpBackend.expectPOST('/solr-store/banana-int/update?commit=true'), fixtures.load('solr-shapes/update-ack'));
        dashboard.elasticsearch_save('dashboard', ID);
        flushSave();
      });

      it('rejects the promise when Solr refuses the save', function () {
        expectFree(ID);
        $httpBackend.expectPOST(/update/).respond(500, '');
        spyOn(console, 'log');
        var out = settled(dashboard.elasticsearch_save('dashboard', ID));
        flushSave();
        expect(out.rejected).toBe(true);
      });
    });

    describe('list', function () {
      beforeEach(function () { setup(); });

      it('searches the dashboards of banana-int with the text and the size, and returns the Solr response', function () {
        var sent = {};
        var list = fixtures.load('solr-shapes/dashboard-list');
        fixtures.respond($httpBackend.expectPOST(/^\/solr\/banana-int\/select/), list, function (request) {
          sent.body = fixtures.params(request.data);
        });
        var out = settled(dashboard.elasticsearch_list('title:x', 25));
        $httpBackend.flush();
        expect(sent.body.q).toEqual(['title:x']);
        expect(sent.body.rows).toEqual(['25']);
        expect(out.value.response.numFound).toBe(1);
        expect(out.value.response.docs[0].title).toBe(ID);
      });

      it('lists everything when there is no search text', function () {
        var sent = {};
        fixtures.respond($httpBackend.expectPOST(/banana-int\/select/), fixtures.load('solr-shapes/dashboard-list'), function (request) {
          sent.body = fixtures.params(request.data);
        });
        dashboard.elasticsearch_list('', 10);
        $httpBackend.flush();
        expect(sent.body.q).toEqual(['*:*']);
      });

      it('rejects the promise when Solr answers with an error', function () {
        $httpBackend.expectPOST(/banana-int\/select/).respond(500, '');
        spyOn(console, 'log');
        var out = settled(dashboard.elasticsearch_list('', 10));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
      });
    });

    describe('delete', function () {
      beforeEach(function () { setup(); });

      it('posts a JSON delete-by-id of the id to the update handler, and commits', function () {
        var sent = {};
        fixtures.respond($httpBackend.expectPOST(/^\/solr\/banana-int\/update\?/), fixtures.load('solr-shapes/update-ack'), function (request) {
          sent.url = request.url;
          sent.body = request.data;
          sent.contentType = request.headers['Content-type'] || request.headers['Content-Type'];
        });
        var out = settled(dashboard.elasticsearch_delete(ID));
        $httpBackend.flush();
        expect(out.resolved).toBe(true);
        expect(sent.body).toBe('{"delete":{"id":"' + ID + '"}}');
        expect(sent.contentType).toBe('application/json');
        expect(fixtures.params(sent.url.slice(sent.url.indexOf('?') + 1))).toEqual({ commit: ['true'], wt: ['json'] });
      });

      it('rejects the promise when Solr refuses the delete', function () {
        $httpBackend.expectPOST(/update/).respond(500, '');
        var out = settled(dashboard.elasticsearch_delete(ID));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
      });
    });
  });
});
