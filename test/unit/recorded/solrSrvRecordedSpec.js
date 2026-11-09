'use strict';

// solrSrv asks for the ten most frequent values of fields (the table panel's field list). Its request is
// built by querySrv and filterSrv; the answer it reads is a Solr select response.
describe('solrSrv on recorded responses', function () {
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  var $httpBackend, solrSrv, querySrv, filterSrv, alertSrv, dashboard;

  function setup(server) {
    dashboard = {
      current: { solr: { server: server, core_name: 'banana-it-logs' }, services: {} }
    };
    var injector = helpers.createInjector({ dashboard: dashboard });
    $httpBackend = injector.get('$httpBackend');
    solrSrv = injector.get('solrSrv');
    querySrv = injector.get('querySrv');
    filterSrv = injector.get('filterSrv');
    alertSrv = injector.get('alertSrv');
  }

  afterEach(function () {
    $httpBackend.verifyNoOutstandingExpectation();
    $httpBackend.verifyNoOutstandingRequest();
  });

  // Matches the GET that Banana sends and returns the parameters that it carried.
  function expectSelect(base, fixture) {
    var seen = {};
    var url = new RegExp('^' + (base + 'banana-it-logs/select?').replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));
    fixtures.respond($httpBackend.expectGET(url), fixture, function (request) {
      seen.params = fixtures.params(request.url.slice(request.url.indexOf('?') + 1));
    });
    return seen;
  }

  // Parameters in one order, so that the order Banana sends them in does not matter.
  function sorted(params) {
    var out = {};
    Object.keys(params).sort().forEach(function (k) { out[k] = params[k]; });
    return out;
  }

  describe('Fusion mode (recorded from Fusion 5.9.16)', function () {
    modes.useMode('fusion');
    beforeEach(function () { setup('/api/query-pipelines/_system/collections/'); });

    it('sends the facet request that was recorded, and keeps the counts of every field', function () {
      var recorded = fixtures.load('fusion-5.9.16/select-top-values');
      var seen = expectSelect('/api/query-pipelines/_system/collections/', recorded);
      solrSrv.calcTopFieldValues(['level_s', 'service_s']);
      $httpBackend.flush();

      expect(sorted(seen.params)).toEqual(sorted(fixtures.recordedParams(recorded)));
      expect(solrSrv.getTopFieldValues('level_s')).toEqual({
        totalcount: recorded.response.body.response.numFound,
        counts: [['INFO', 120], ['DEBUG', 40], ['ERROR', 40], ['WARN', 40]]
      });
      expect(solrSrv.getTopFieldValues('service_s').counts.length).toBe(4);
      expect(solrSrv.getTopFieldValues('service_s').totalcount).toBe(240);
    });

    it('adds the active filters to the request, as recorded', function () {
      var recorded = fixtures.load('fusion-5.9.16/select-top-values-with-fq');
      filterSrv.set({ type: 'querystring', query: 'level_s:ERROR', mandate: 'must' });
      var seen = expectSelect('/api/query-pipelines/_system/collections/', recorded);
      solrSrv.calcTopFieldValues(['level_s']);
      $httpBackend.flush();

      expect(sorted(seen.params)).toEqual(sorted(fixtures.recordedParams(recorded)));
      // Solr lists every value of the field, those the filter excludes with a count of 0
      var counts = solrSrv.getTopFieldValues('level_s').counts;
      expect(counts[0]).toEqual(['ERROR', 40]);
      expect(counts.slice(1).map(function (c) { return c[1]; })).toEqual([0, 0, 0]);
    });

    it('joins several queries with the operator and uses the global parameters of the dashboard', function () {
      querySrv.set({ query: 'level_s:ERROR' });
      dashboard.current.solr.global_params = '&df=message_t';
      var seen = expectSelect('/api/query-pipelines/_system/collections/', fixtures.load('fusion-5.9.16/select-top-values'));
      solrSrv.calcTopFieldValues(['level_s']);
      $httpBackend.flush();
      expect(seen.params.q).toEqual(['*:* OR level_s:ERROR']);
      expect(seen.params.df).toEqual(['message_t']);
    });

    it('warns when too many fields are asked for at once', function () {
      var fields = [];
      for (var i = 0; i < 21; i++) { fields.push('f' + i + '_s'); }
      expectSelect('/api/query-pipelines/_system/collections/', fixtures.load('fusion-5.9.16/select-top-values'));
      solrSrv.calcTopFieldValues(fields);
      $httpBackend.flush();
      expect(alertSrv.list[0].text).toContain('too many fields being calculated for top values (21)');
    });

    it('shows an alert, and keeps the values it had, when the query fails', function () {
      expectSelect('/api/query-pipelines/_system/collections/', fixtures.load('fusion-5.9.16/select-top-values'));
      solrSrv.calcTopFieldValues(['level_s']);
      $httpBackend.flush();

      // the 400 that Fusion 5.9.16 answered for a field the collection does not have
      expectSelect('/api/query-pipelines/_system/collections/', fixtures.load('fusion-5.9.16/select-undefined-field'));
      solrSrv.calcTopFieldValues(['event_timestamp']);
      $httpBackend.flush();
      expect(alertSrv.list[alertSrv.list.length - 1].text).toContain('Could not retrieve facet data from Solr (Error status = 400)');
      expect(solrSrv.getTopFieldValues('level_s').totalcount).toBe(240);
    });

    it('says that the server cannot be contacted when there is no answer', function () {
      $httpBackend.expectGET(/select\?/).respond(0, '');
      solrSrv.calcTopFieldValues(['level_s']);
      $httpBackend.flush();
      expect(alertSrv.list[0].text).toContain('Could not contact Solr at /api/query-pipelines/_system/collections/');
    });
  });

  describe('Solr mode (a Solr select shape recorded through the Fusion Solr proxy: not a standalone Solr)', function () {
    modes.useMode('solr');
    beforeEach(function () { setup('/solr/'); });

    it('reads the counts from the Solr response shape', function () {
      var recorded = fixtures.load('solr-shapes/select-top-values');
      expect(recorded.source).toBe('recorded-solr');
      var seen = expectSelect('/solr/', recorded);
      solrSrv.calcTopFieldValues(['level_s', 'service_s']);
      $httpBackend.flush();

      expect(sorted(seen.params)).toEqual(sorted(fixtures.recordedParams(recorded)));
      expect(solrSrv.getTopFieldValues('level_s').counts[0]).toEqual(['INFO', 120]);
      expect(solrSrv.getTopFieldValues('level_s').totalcount).toBe(240);
    });
  });
});
