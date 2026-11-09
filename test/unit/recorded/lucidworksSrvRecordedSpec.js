'use strict';

// lucidworksSrv talks to the Fusion gateway: the session, the schema of a collection and the list of saved
// dashboards. The responses below were recorded from a Fusion 5.9.16 gateway (see test/fixtures), so these specs
// show how the service reads what that version answers, not only what the code was written to expect.
describe('lucidworksSrv on recorded Fusion 5.9.16 responses', function () {
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  modes.useMode('fusion');

  var injector, $httpBackend, lucidworksSrv;
  // The session request is the relative path the service reads from its setting.
  var sessionUrl = require('config').FUSION_SESSION_API;

  beforeEach(function () {
    injector = helpers.createInjector();
    $httpBackend = injector.get('$httpBackend');
    lucidworksSrv = injector.get('lucidworksSrv');
  });

  afterEach(function () {
    $httpBackend.verifyNoOutstandingExpectation();
    $httpBackend.verifyNoOutstandingRequest();
  });

  function result(promise) {
    var out = {};
    promise.then(function (v) { out.value = v; out.resolved = true; }, function (e) { out.error = e; out.rejected = true; });
    return out;
  }

  describe('getFusionUsername', function () {
    it('reads the user name from the session of a logged-in user', function () {
      fixtures.respond($httpBackend.expectGET(sessionUrl), fixtures.load('fusion-5.9.16/session'));
      var out = result(lucidworksSrv.getFusionUsername());
      $httpBackend.flush();
      expect(out.value).toBe('fixture-user');
    });

    it('falls back to guest when the session answers 401', function () {
      fixtures.respond($httpBackend.expectGET(sessionUrl), fixtures.load('fusion-5.9.16/session-unauthenticated'));
      var out = result(lucidworksSrv.getFusionUsername());
      spyOn(console, 'log');
      $httpBackend.flush();
      expect(out.value).toBe('guest');
      expect(console.log).toHaveBeenCalled();
    });

    it('falls back to guest when the gateway cannot be reached', function () {
      $httpBackend.expectGET(sessionUrl).respond(0, '');
      var out = result(lucidworksSrv.getFusionUsername());
      spyOn(console, 'log');
      $httpBackend.flush();
      expect(out.value).toBe('guest');
    });

    // The session of an API key has no user name (observed on the same gateway, recorded in a run that is not
    // kept as a fixture): the service resolves to the default, 'guest'.
    it('gives guest for a session that has no user name (an API key)', function () {
      var session = fixtures.load('fusion-5.9.16/session');
      delete session.response.body.user.username;
      fixtures.respond($httpBackend.expectGET(sessionUrl), session);
      var out = result(lucidworksSrv.getFusionUsername());
      $httpBackend.flush();
      expect(out.value).toBe('guest');
    });
  });

  describe('getFields', function () {
    var STATIC = '/api/collections/banana-it-logs/schema/fields';
    var DYNAMIC = '/api/collections/banana-it-logs/schema/dynamicfields';

    it('merges the static and the dynamic fields of the collection, sorted by name', function () {
      var staticFields = fixtures.load('fusion-5.9.16/schema-fields');
      var dynamicFields = fixtures.load('fusion-5.9.16/schema-dynamicfields');
      fixtures.respond($httpBackend.expectGET(STATIC), staticFields);
      fixtures.respond($httpBackend.expectGET(DYNAMIC), dynamicFields);
      var out = result(lucidworksSrv.getFields('banana-it-logs'));
      $httpBackend.flush();

      var names = out.value.map(function (f) { return f.name; });
      var expected = staticFields.response.body.map(function (f) { return f.name; });
      dynamicFields.response.body.forEach(function (d) {
        d.indexFields.forEach(function (f) { expected.push(f.name); });
      });
      expect(names).toEqual(expected.slice().sort());
      // a field that exists only because a dynamic field rule matched it, with the rule's type
      var status = out.value.filter(function (f) { return f.name === 'status_i'; })[0];
      expect(status.type).toBe('pint');
      // a dynamic field rule that matched nothing adds nothing
      expect(names).not.toContain('*_i');
    });

    it('returns an empty list when the collection does not exist (404 for both calls)', function () {
      var missing = '/api/collections/banana-it-no-such-collection/schema/';
      fixtures.respond($httpBackend.expectGET(missing + 'fields'), fixtures.load('fusion-5.9.16/schema-fields-missing'));
      fixtures.respond($httpBackend.expectGET(missing + 'dynamicfields'), fixtures.load('fusion-5.9.16/schema-dynamicfields-missing'));
      spyOn(console, 'log');
      var out = result(lucidworksSrv.getFields('banana-it-no-such-collection'));
      $httpBackend.flush();
      expect(out.value).toEqual([]);
    });

    it('keeps the static fields when only the dynamic call fails', function () {
      var staticFields = fixtures.load('fusion-5.9.16/schema-fields');
      fixtures.respond($httpBackend.expectGET(STATIC), staticFields);
      fixtures.respond($httpBackend.expectGET(DYNAMIC), fixtures.load('fusion-5.9.16/schema-dynamicfields-missing'));
      spyOn(console, 'log');
      var out = result(lucidworksSrv.getFields('banana-it-logs'));
      $httpBackend.flush();
      expect(out.value.length).toBe(staticFields.response.body.length);
    });
  });

  describe('getDashboardList', function () {
    it('lists the saved dashboards in the shape of a Solr response, from the blob store', function () {
      var list = fixtures.load('fusion-5.9.16/blob-list');
      fixtures.respond($httpBackend.expectGET('/api/blobs?q=id:*&resourceType=banana'), list);
      var out = result(lucidworksSrv.getDashboardList(''));
      $httpBackend.flush();
      expect(out.value.response.numFound).toBe(list.response.body.length);
      expect(out.value.response.docs.map(function (d) { return d.id; }).sort())
        .toEqual(list.response.body.map(function (d) { return d.id; }).sort());
      // the blob store lists metadata only: the dashboard itself is not in the list
      expect(out.value.response.docs[0].banana_dashboard_s).toBeUndefined();
    });

    it('puts the search text into the id query, encoded', function () {
      fixtures.respond($httpBackend.expectGET('/api/blobs?q=id:my%20board%3F*&resourceType=banana'), fixtures.load('fusion-5.9.16/blob-list'));
      lucidworksSrv.getDashboardList('my board?');
      $httpBackend.flush();
    });

    it('lists ids that the blob store stores with a slash, a question mark, a hash or a space', function () {
      fixtures.respond($httpBackend.expectGET(/\/api\/blobs\?q=/), fixtures.load('fusion-5.9.16/blob-list'));
      var out = result(lucidworksSrv.getDashboardList(''));
      $httpBackend.flush();
      var ids = out.value.response.docs.map(function (d) { return d.id; });
      expect(ids).toContain('banana-it-a0-s1/x');
      expect(ids).toContain('banana-it-a0-q1?x');
      expect(ids).toContain('banana-it-a0-h1#x');
      expect(ids).toContain('banana-it-a0-sp 1');
    });

    it('rejects the promise when the blob store answers with an error (a 500 whose body is not recorded)', function () {
      $httpBackend.expectGET(/\/api\/blobs\?q=/).respond(500, '');
      var out = result(lucidworksSrv.getDashboardList(''));
      $httpBackend.flush();
      expect(out.rejected).toBe(true);
      expect(out.error.status).toBe(500);
    });
  });
});
