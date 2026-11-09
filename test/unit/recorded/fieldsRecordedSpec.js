'use strict';

// The fields service reads the field list of the dashboard's collection: from the Fusion schema API, from
// Solr's Luke handler, or from Solr's schema API, depending on the settings.
describe('fields on recorded responses', function () {
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  var injector, $httpBackend, $rootScope, fields, alertSrv, dashboard;

  function setup(server) {
    dashboard = { current: { solr: { server: server, core_name: 'banana-it-logs' }, services: {} }, indices: [] };
    injector = helpers.createInjector({ dashboard: dashboard });
    $httpBackend = injector.get('$httpBackend');
    $rootScope = injector.get('$rootScope');
    fields = injector.get('fields');
    alertSrv = injector.get('alertSrv');
  }

  function result(promise) {
    var out = {};
    promise.then(function (v) { out.value = v; out.resolved = true; }, function (e) { out.error = e; out.rejected = true; });
    return out;
  }

  afterEach(function () {
    $httpBackend.verifyNoOutstandingExpectation();
    $httpBackend.verifyNoOutstandingRequest();
  });

  var LEAF = 'logstash-2999.12.31';

  describe('Fusion mode (recorded from Fusion 5.9.16)', function () {
    modes.useMode('fusion');
    beforeEach(function () { setup('/api/query-pipelines/_system/collections/'); });

    function expectSchema() {
      fixtures.respond($httpBackend.expectGET('/api/collections/banana-it-logs/schema/fields'), fixtures.load('fusion-5.9.16/schema-fields'));
      fixtures.respond($httpBackend.expectGET('/api/collections/banana-it-logs/schema/dynamicfields'), fixtures.load('fusion-5.9.16/schema-dynamicfields'));
    }

    it('maps every field of the collection to its type', function () {
      expectSchema();
      var out = result(fields.map());
      $httpBackend.flush();
      var mapped = out.value[LEAF].logs;
      expect(mapped.id).toEqual({ type: 'string', schema: '' });
      expect(mapped.status_i.type).toBe('pint');
      expect(mapped.level_s).toBeDefined();
      expect(mapped['*_i']).toBeUndefined();
    });

    it('fills its field list when the dashboard names an index, and asks only once', function () {
      expectSchema();
      dashboard.indices = [LEAF];
      $rootScope.$digest();
      $httpBackend.flush();
      expect(fields.list).toContain('id');
      expect(fields.list).toContain('level_s');

      // the same indices again use the cache: no request
      dashboard.indices = [LEAF, LEAF];
      $rootScope.$digest();
      $httpBackend.verifyNoOutstandingRequest();
      expect(fields.list).toContain('level_s');
    });

    it('resolves to an empty mapping for a collection that does not exist', function () {
      dashboard.current.solr.core_name = 'banana-it-no-such-collection';
      fixtures.respond($httpBackend.expectGET('/api/collections/banana-it-no-such-collection/schema/fields'), fixtures.load('fusion-5.9.16/schema-fields-missing'));
      fixtures.respond($httpBackend.expectGET('/api/collections/banana-it-no-such-collection/schema/dynamicfields'), fixtures.load('fusion-5.9.16/schema-dynamicfields-missing'));
      spyOn(console, 'log');
      var out = result(fields.map());
      $httpBackend.flush();
      expect(out.value[LEAF].logs).toEqual({});
    });
  });

  describe('Solr mode', function () {
    describe('with the Luke handler (derived shape, not observed on a server)', function () {
      modes.useMode('solr');
      beforeEach(function () { setup('/solr/'); });

      it('maps the fields with their type and schema string', function () {
        var luke = fixtures.load('solr-shapes/luke');
        fixtures.respond($httpBackend.expectGET('/solr/banana-it-logs/admin/luke?numTerms=0&wt=json'), luke);
        var out = result(fields.map());
        $httpBackend.flush();
        var name = Object.keys(luke.response.body.fields)[0];
        expect(out.value[LEAF].logs[name]).toEqual({ type: luke.response.body.fields[name].type, schema: 'I-S-----------' });
        expect(Object.keys(out.value[LEAF].logs).length).toBe(Object.keys(luke.response.body.fields).length);
      });

      it('reads another collection when it is named', function () {
        fixtures.respond($httpBackend.expectGET('/solr/other/admin/luke?numTerms=0&wt=json'), fixtures.load('solr-shapes/luke'));
        fields.map('other');
        $httpBackend.flush();
      });

      it('shows that the collection was not found, and rejects, on a 404', function () {
        fixtures.respond($httpBackend.expectGET(/admin\/luke/), fixtures.load('solr-shapes/select-error'));
        spyOn(console, 'log');
        var out = result(fields.map());
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
        expect(alertSrv.list.length).toBe(1);
        expect(alertSrv.list[0].text).toContain('Collection not found at /solr/banana-it-logs');
      });

      it('says that Solr cannot be contacted when there is no answer', function () {
        $httpBackend.expectGET(/admin\/luke/).respond(0, '');
        spyOn(console, 'log');
        fields.map();
        $httpBackend.flush();
        expect(alertSrv.list[0].text).toContain('Could not contact Solr at /solr/');
      });
    });

    describe('with the schema API (recorded through the Fusion Solr proxy: not a standalone Solr)', function () {
      modes.useMode('solr', { USE_ADMIN_LUKE: false });
      beforeEach(function () { setup('/solr/'); });

      it('maps the fields of the schema response with their type and no schema string', function () {
        var recorded = fixtures.load('solr-shapes/schema-fields');
        expect(recorded.source).toBe('recorded-solr');
        fixtures.respond($httpBackend.expectGET('/solr/banana-it-logs/schema/fields'), recorded);
        var out = result(fields.map());
        $httpBackend.flush();
        var first = recorded.response.body.fields[0];
        expect(out.value[LEAF].logs[first.name]).toEqual({ type: first.type, schema: '' });
        expect(Object.keys(out.value[LEAF].logs).length).toBe(recorded.response.body.fields.length);
      });
    });
  });
});
