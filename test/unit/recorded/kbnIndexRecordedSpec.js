'use strict';

// kbnIndex lists the collections (from Fusion or from Solr) and the time-based indices of a collection.
describe('kbnIndex on recorded responses', function () {
  var config = require('config');
  var helpers = require('../helpers/injector');
  var fixtures = require('../helpers/fixtures');
  var modes = require('../helpers/modes');

  var injector, $httpBackend, kbnIndex, alertSrv;

  function setup() {
    injector = helpers.createInjector();
    $httpBackend = injector.get('$httpBackend');
    kbnIndex = injector.get('kbnIndex');
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

  describe('Fusion mode (responses recorded from Fusion 5.9.16)', function () {
    modes.useMode('fusion');
    beforeEach(setup);

    it('lists the collections from the Fusion collections API', function () {
      var recorded = fixtures.load('fusion-5.9.16/collections');
      fixtures.respond($httpBackend.expectGET('/api/collections'), recorded);
      var out = result(kbnIndex.collections('/api/query-pipelines/_system/collections/'));
      $httpBackend.flush();
      expect(out.value).toEqual(recorded.response.body.map(function (c) { return c.id; }));
      expect(out.value).toContain('banana-it-logs');
    });

    it('shows an alert and rejects when the collections cannot be read (a 403 whose body is not recorded)', function () {
      $httpBackend.expectGET('/api/collections').respond(403, '');
      spyOn(console, 'debug');
      var out = result(kbnIndex.collections('/api/query-pipelines/_system/collections/'));
      $httpBackend.flush();
      expect(out.rejected).toBe(true);
      expect(alertSrv.list[0].text).toContain('error status = 403');
    });
  });

  describe('Solr mode (Solr response shapes, derived: no standalone Solr was recorded)', function () {
    describe('with the collections API enabled', function () {
      modes.useMode('solr');
      beforeEach(setup);

      it('lists the collections from the Solr collections API, without the double slash', function () {
        var shape = fixtures.load('solr-shapes/collections-list');
        fixtures.respond($httpBackend.expectGET('/solr/admin/collections?action=LIST&wt=json&omitHeader=true'), shape);
        var out = result(kbnIndex.collections('/solr/'));
        $httpBackend.flush();
        expect(out.value).toEqual(shape.response.body.collections);
      });

      it('shows an alert and rejects when neither the collections API nor the cores API answers', function () {
        $httpBackend.expectGET(/admin\/collections/).respond(500, '');
        $httpBackend.expectGET(/admin\/cores\?action=STATUS/).respond(500, '');
        spyOn(console, 'debug');
        var out = result(kbnIndex.collections('/solr/'));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
        expect(alertSrv.list[0].text).toContain('error status = 500');
      });
    });

    describe('with the collections API disabled', function () {
      modes.useMode('solr', { USE_ADMIN_CORES: false });
      beforeEach(setup);

      it('returns an empty list and sends no request', function (done) {
        kbnIndex.collections('/solr/').then(function (list) {
          expect(list).toEqual([]);
          $httpBackend.verifyNoOutstandingRequest();
          done();
        });
      });
    });
  });

  // The time-based indices use the same request in both modes: it names the field event_timestamp and is sent
  // to config.solr + config.solr_core.
  ['fusion', 'solr'].forEach(function (mode) {
    describe('indices in ' + mode + ' mode', function () {
      modes.useMode(mode);
      beforeEach(setup);

      var URL = function () {
        return config.solr + 'banana-it-logs' + '/select?q=*:*&wt=json&rows=0&omitHeader=true&facet=true&facet.range=event_timestamp' +
          '&facet.range.start=NOW-10YEARS/DAY&facet.range.end=NOW&facet.range.gap=%2B1DAY&facet.mincount=1';
      };

      it('turns the days that have documents into index names and keeps those inside the range, newest first', function () {
        // a range facet recorded from Fusion 5.9.16, renamed and without the empty days (see the fixture's note)
        var range = fixtures.load('fusion-5.9.16/select-range-facet');
        fixtures.respond($httpBackend.expectGET(URL()), range);
        var out = result(kbnIndex.indices(new Date(2023, 11, 31), new Date(2024, 0, 3), '[logstash-]YYYY.MM.DD', 'day'));
        $httpBackend.flush();
        expect(out.value).toEqual(['logstash-2024.01.02', 'logstash-2024.01.01']);
      });

      it('returns nothing for a range without documents', function () {
        fixtures.respond($httpBackend.expectGET(URL()), fixtures.load('fusion-5.9.16/select-range-facet'));
        var out = result(kbnIndex.indices(new Date(2020, 0, 1), new Date(2020, 0, 3), '[logstash-]YYYY.MM.DD', 'day'));
        $httpBackend.flush();
        expect(out.value).toEqual([]);
      });

      it('shows an alert and rejects when the field is not in the collection (the 400 that Fusion 5.9.16 answered)', function () {
        fixtures.respond($httpBackend.expectGET(URL()), fixtures.load('fusion-5.9.16/select-undefined-field'));
        var out = result(kbnIndex.indices(new Date(2024, 0, 1), new Date(2024, 0, 3), '[logstash-]YYYY.MM.DD', 'day'));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
        expect(alertSrv.list[0].text).toContain('Could not reach ' + config.solr);
      });

      it('says that the server cannot be contacted when there is no answer at all', function () {
        $httpBackend.expectGET(URL()).respond(0, '');
        var out = result(kbnIndex.indices(new Date(2024, 0, 1), new Date(2024, 0, 3), '[logstash-]YYYY.MM.DD', 'day'));
        $httpBackend.flush();
        expect(out.rejected).toBe(true);
        expect(alertSrv.list[0].text).toContain('Could not contact Solr at ' + config.solr);
      });

      ['hour', 'day', 'week', 'month', 'year'].forEach(function (interval) {
        it('steps through a range by the ' + interval + ' with the current moment call form', function () {
          var moment = require('moment');
          var handler = moment.deprecationHandler;
          // moment calls this for every use of an outdated call form, so one use fails the test
          moment.deprecationHandler = function (name, message) { throw new Error('moment: ' + message); };
          try {
            fixtures.respond($httpBackend.expectGET(URL()), fixtures.load('fusion-5.9.16/select-range-facet'));
            var out = result(kbnIndex.indices(new Date(2023, 11, 31), new Date(2025, 0, 3), '[logstash-]YYYY.MM.DD', interval));
            $httpBackend.flush();
            expect(out.rejected).toBeFalsy();
          } finally {
            moment.deprecationHandler = handler;
          }
        });
      });

      it('sends only the list request for an interval it does not know', function () {
        // expand_range returns false for an interval other than hour, day, week, month or year: _.each over
        // false adds nothing, so only the list request goes out and nothing matches
        fixtures.respond($httpBackend.expectGET(URL()), fixtures.load('fusion-5.9.16/select-range-facet'));
        var out = result(kbnIndex.indices(new Date(2024, 0, 1), new Date(2024, 0, 3), '[logstash-]YYYY.MM.DD', 'fortnight'));
        $httpBackend.flush();
        expect(out.value).toEqual([]);
      });
    });
  });
});
