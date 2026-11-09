'use strict';

// Saving and deleting a dashboard must not overwrite or delete the wrong one. A saved dashboard is stored under its
// title, so these specs drive the real dashboard service (and the dashLoader controller on top of it) against a small
// fake of the two stores: the Fusion blob store, whose answers follow the recordings under test/fixtures, and the
// Solr collection of saved dashboards, whose answers are derived shapes (no standalone Solr was recorded).
// Every request that leaves the page is logged, so a spec can say what was sent, in what order and to where.
describe('saving and deleting a saved dashboard', function () {
  var angular = require('angular');
  var config = require('config');
  var _ = require('underscore');
  var kbn = require('kbn');
  var ids = require('components/dashboard-ids');
  var httpErrors = require('components/http-errors');
  var helpers = require('./helpers/injector');
  var fixtures = require('./helpers/fixtures');
  var modes = require('./helpers/modes');

  var ID = 'banana-it-000000000000-7';
  var SESSION_URL = config.FUSION_SESSION_API;
  var BLOB = '/api/blobs/';
  var SOLR_SELECT = /^\/solr\/banana-int\/select\?/;

  // ---------------------------------------------------------------------------------------------------------------
  // The harness

  // Builds the services on a mock backend that logs every request. Options:
  //   fusion       true for the blob store, false for Solr (the mode is applied before the service is created)
  //   session      the session fixture to answer with (Fusion); default the recorded login of "fixture-user"
  //   interceptor  install the response interceptor of the application (a 401 sends the window to login)
  //   modules      more injector modules
  function build(options) {
    options = options || {};
    var h = { fusion: options.fusion !== false, requests: [], store: {}, gets: 0, hooks: {} };
    h.settle = function () { settle(h); };
    h.fakeWindow = { location: { search: '', hash: '', pathname: '/admin/banana/' } };
    var modules = [
      ['$provide', function ($provide) {
        // a decorator that logs the arguments of every request the backend receives
        $provide.decorator('$httpBackend', ['$delegate', function ($delegate) {
          var logged = function (method, url, data, callback, headers, timeout) {
            h.requests.push({ method: method, url: url, data: data, headers: headers, timeout: timeout });
            return $delegate.apply(this, arguments);
          };
          return angular.extend(logged, $delegate);
        }]);
      }],
      // errors that a promise callback throws are logged, as in production, instead of rethrown
      ['$exceptionHandlerProvider', function (provider) { provider.mode('log'); }]
    ];
    if (options.interceptor) {
      modules.push(['$httpProvider', function ($httpProvider) {
        $httpProvider.responseInterceptors.push(['$q', function ($q) { return httpErrors($q, h.fakeWindow); }]);
      }]);
    }
    h.injector = helpers.createInjector({ $routeParams: options.routeParams || {} }, modules.concat(options.modules || []));
    h.$httpBackend = h.injector.get('$httpBackend');
    h.$rootScope = h.injector.get('$rootScope');
    h.$timeout = h.injector.get('$timeout');
    h.$location = h.injector.get('$location');
    h.alertSrv = h.injector.get('alertSrv');

    var session = options.session || fixtures.load('fusion-5.9.16/session');
    h.$httpBackend.whenGET(SESSION_URL).respond(function () {
      return [session.response.status, JSON.stringify(session.response.body), { 'Content-Type': 'application/json' }];
    });
    if (h.fusion) {
      installFusionStore(h);
    } else {
      installSolrStore(h);
    }
    h.dashboard = h.injector.get('dashboard');
    if (options.settleSession !== false) { h.settle(); }
    return h;
  }

  // Runs digests and flushes answers until nothing is pending (a save is a chain of promise steps and requests).
  function settle(h) {
    for (var i = 0; i < 30; i++) {
      h.$rootScope.$digest();
      try {
        h.$httpBackend.flush();
      } catch (e) {
        if (/No (more )?pending request/.test(e.message)) { return; }
        throw e;
      }
    }
    throw new Error('requests keep coming: the save or the fake is looping');
  }

  function answer(status, body) {
    return [status, typeof body === 'string' ? body : JSON.stringify(body), { 'Content-Type': 'application/json' }];
  }

  // ---- the blob store: GET and PUT and DELETE of /api/blobs/<encoded id>
  function installFusionStore(h) {
    var idOf = function (url) { return decodeURIComponent(url.slice(BLOB.length).replace(/\?.*$/, '')); };
    h.$httpBackend.whenGET(/^\/api\/blobs\/[^?]*$/).respond(function (method, url) {
      var n = ++h.gets;
      var id = idOf(url);
      var hooked = h.hooks.onGet && h.hooks.onGet(n, id, url);
      if (hooked) { return hooked; }
      var record = h.store[id];
      return record ? answer(200, [record]) : answer(404, fixtures.load('fusion-5.9.16/blob-read-absent').response.body);
    });
    h.$httpBackend.whenPUT(/^\/api\/blobs\/[^?]*\?resourceType=banana$/).respond(function (method, url, data) {
      var doc = JSON.parse(data)[0];
      h.store[doc.id] = doc;
      return answer(200, {});
    });
    h.$httpBackend.whenDELETE(/^\/api\/blobs\/[^?]*$/).respond(function (method, url) {
      var hooked = h.hooks.onDelete && h.hooks.onDelete(url);
      if (hooked) { return hooked; }
      delete h.store[idOf(url)];
      return [204, '', {}];
    });
  }

  // ---- the Solr collection: select (the look-ups and the load) and update (save and delete)
  function installSolrStore(h) {
    var unphrase = function (q) {
      var m = /^(?:id|title):"((?:[^"\\]|\\.)*)"$/.exec(q);
      return m ? m[1].replace(/\\(.)/g, '$1') : null;
    };
    h.$httpBackend.whenGET(SOLR_SELECT).respond(function (method, url) {
      var n = ++h.gets;
      var params = fixtures.params(url.slice(url.indexOf('?') + 1));
      var id = unphrase(params.q[0]);
      var hooked = h.hooks.onGet && h.hooks.onGet(n, id, url);
      if (hooked) { return hooked; }
      var doc = h.store[id];
      return answer(200, { responseHeader: { status: 0 }, response: { numFound: doc ? 1 : 0, start: 0, docs: doc ? [doc] : [] } });
    });
    h.$httpBackend.whenPOST(/\/update\?/).respond(function (method, url, data) {
      var body = JSON.parse(data);
      if (_.isArray(body)) {
        h.store[body[0].id] = _.extend({ _version_: 1800000000000000000 }, body[0]);
      } else {
        delete h.store[body['delete'].id];
      }
      return answer(200, { responseHeader: { status: 0, QTime: 1 } });
    });
  }

  function dashboardToSave(solrServer) {
    var dash = JSON.parse(fixtures.load('fusion-5.9.16/blob-read').response.body[0].banana_dashboard_s);
    dash.title = 'My dashboard';
    dash.username = 'guest';
    if (solrServer) { dash.solr.server = solrServer; }
    return dash;
  }

  function settled(promise) {
    var out = {};
    promise.then(function (v) { out.value = v; out.resolved = true; }, function (e) { out.error = e; out.rejected = true; });
    return out;
  }

  function sent(h, method) {
    return h.requests.filter(function (r) { return r.method === method; });
  }

  // The look-ups are GETs of the saved-dashboard store; the session request is not one of them.
  function lookups(h) {
    return sent(h, 'GET').filter(function (r) { return r.url !== SESSION_URL; });
  }

  function writes(h) {
    return h.requests.filter(function (r) { return r.method === 'PUT' || r.method === 'POST' || r.method === 'DELETE'; });
  }

  function fusionRecord(id, owner, text) {
    return {
      id: id, banana_user_s: owner, banana_group_s: 'none', banana_title_s: id,
      banana_dashboard_s: text || JSON.stringify({ title: id, rows: [], username: owner }), is_public_b: false
    };
  }

  function solrRecord(id, owner, text, version) {
    return {
      id: id, user: owner, group: 'none', title: id,
      dashboard: text || JSON.stringify({ title: id, rows: [], username: owner }), _version_: version || 1800000000000000001
    };
  }

  // A function for the fourth argument of the save: answers `decision`, and records what it was asked.
  function confirmWith(decision, before) {
    var fn = function (existing) {
      fn.asked.push(existing);
      if (before) { before(existing); }
      return decision;
    };
    fn.asked = [];
    return fn;
  }

  // Something else uses the shared Solr client between two steps of a save: it points the client at a data
  // collection, replaces the client the way sjsResource() does, and flips its mode.
  function repoint(h) {
    h.injector.get('sjsResource')('/data/collection/');
    window.sjs.client.server('/data/collection/');
    window.sjs.client.useFusion(!h.fusion);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The codec and the predicate (shared table of ids)

  describe('the id table that the unit suite and the live-client suite both read', function () {
    var table = require('../shared/blob-ids.json');

    it('holds the titles that matter and the encoding of each', function () {
      expect(table.ids.length).toBeGreaterThanOrEqual(12);
      table.ids.forEach(function (row) { expect(encodeURIComponent(row.id)).toBe(row.encoded); });
    });

    describe('Fusion mode: one codec for the look-up, the load, the save and the delete', function () {
      modes.useMode('fusion');

      table.ids.forEach(function (row) {
        it('names ' + row.label + ' by the same path segment in all four requests', function () {
          var h = build();
          h.dashboard.dash_load(dashboardToSave());
          var path = BLOB + row.encoded;

          // load
          h.dashboard.elasticsearch_load('dashboard', row.id);
          settle(h);
          // save (the look-up, then the write)
          h.dashboard.elasticsearch_save('dashboard', row.id);
          settle(h);
          // delete
          h.dashboard.elasticsearch_delete(row.id);
          settle(h);

          var get = lookups(h).map(function (r) { return r.url; });
          // load, look-up of the save: the same address
          expect(get).toEqual([path, path]);
          expect(sent(h, 'PUT').map(function (r) { return r.url; })).toEqual([path + '?resourceType=banana']);
          expect(sent(h, 'DELETE').map(function (r) { return r.url; })).toEqual([path]);
          // and the saved blob holds the id as the title said it
          expect(Object.keys(h.store)).toEqual([]);
        });
      });
    });

    it('is the delete address the live-test client would allow for each id', function () {
      // the node tests of the live client (test/node/live/dashboard-ids.test.js) compare the same table with its
      // own function; here the unit suite holds the other side of it
      table.ids.forEach(function (row) {
        expect(BLOB + ids.blobSegment(row.id)).toBe(BLOB + row.encoded);
      });
    });
  });

  describe('the refusal predicate for Fusion titles', function () {
    var table = require('../shared/blob-ids.json');

    it('accepts every title of the table of plain and reserved characters', function () {
      table.ids.forEach(function (row) {
        expect(ids.isStorableBlobId(row.id)).toBe(true, row.label);
        expect(ids.blobIdProblem(row.id)).toBe(null);
      });
    });

    it('refuses every title that the blob path cannot carry, with a reason', function () {
      table.refused.forEach(function (row) {
        expect(ids.isStorableBlobId(row.id)).toBe(false, row.label);
        expect(typeof ids.blobIdProblem(row.id)).toBe('string', row.label);
      });
      expect(ids.isStorableBlobId(undefined)).toBe(false);
      expect(ids.isStorableBlobId(5)).toBe(false);
      expect(ids.isStorableBlobId(null)).toBe(false);
    });

    it('accepts a pair of surrogates (one character outside the basic plane)', function () {
      expect(ids.isStorableBlobId('board 😀')).toBe(true);
    });

    describe('in the service', function () {
      modes.useMode('fusion');

      table.refused.forEach(function (row) {
        it('sends no request for a save, a delete or a load of ' + row.label, function () {
          var h = build();
          h.dashboard.dash_load(dashboardToSave());
          var before = h.requests.length;
          var save = settled(h.dashboard.elasticsearch_save('dashboard', row.id, undefined, confirmWith(true)));
          var del = settled(h.dashboard.elasticsearch_delete(row.id));
          var load = settled(h.dashboard.elasticsearch_load('dashboard', row.id));
          settle(h);
          expect(h.requests.length).toBe(before);
          expect(save.rejected).toBe(true);
          expect(save.error.reason).toBe('invalid-title');
          expect(typeof save.error.message).toBe('string');
          expect(del.rejected).toBe(true);
          expect(load.rejected).toBe(true);
          expect(h.alertSrv.list[h.alertSrv.list.length - 1].text).toContain('Could not open a dashboard named');
        });
      });
    });

    describe('in Solr mode', function () {
      modes.useMode('solr');

      it('sends a save of a title with a percent sign, a semicolon or a backslash, and refuses only an empty one', function () {
        var h = build({ fusion: false });
        h.dashboard.dash_load(dashboardToSave('/solr/'));
        var ok = settled(h.dashboard.elasticsearch_save('dashboard', '100% a;b\\c'));
        settle(h);
        expect(ok.resolved).toBe(true);
        expect(h.store['100% a;b\\c']).toBeDefined();
        var empty = settled(h.dashboard.elasticsearch_save('dashboard', ''));
        settle(h);
        expect(empty.rejected).toBe(true);
        expect(empty.error.reason).toBe('invalid-title');
      });
    });

    it('shows in the real browser that a request for ".." is rewritten before it is sent', function () {
      expect(new URL('/api/blobs/..', 'http://example.test/admin/banana/').pathname).toBe('/api/');
      expect(new URL('/api/blobs/a/../b', 'http://example.test/').pathname).toBe('/api/blobs/b');
      expect(new URL('/api/blobs/%2e%2e', 'http://example.test/').pathname).toBe('/api/');
    });
  });

  describe('a Fusion blob URL is never built without the codec', function () {
    // The source-level check is in test/node/dashboard-ids-source.test.js (it reads the files).
    it('builds the path segment with encodeURIComponent through one function', function () {
      expect(ids.blobSegment('a/b?c#d e')).toBe('a%2Fb%3Fc%23d%20e');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Save, Fusion mode

  describe('saving in Fusion mode', function () {
    modes.useMode('fusion');
    var h;
    beforeEach(function () {
      h = build();
      h.dashboard.dash_load(dashboardToSave());
    });

    it('writes a new title without a question after a look-up that the blob store answers with its own 404', function () {
      var confirm = confirmWith(true);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
      settle(h);
      expect(out.resolved).toBe(true);
      expect(confirm.asked).toEqual([]);
      expect(h.requests.filter(function (r) { return r.url !== SESSION_URL; }).map(function (r) { return r.method + ' ' + r.url; }))
        .toEqual(['GET ' + BLOB + ID, 'PUT ' + BLOB + ID + '?resourceType=banana']);
    });

    it('shows the stored owner and writes nothing when the user declines', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      var before = JSON.stringify(h.store[ID]);
      var confirm = confirmWith(false);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
      settle(h);
      expect(confirm.asked).toEqual([{ title: ID, owner: 'alice', byYou: false }]);
      expect(out.rejected).toBe(true);
      expect(out.error.reason).toBe('declined');
      expect(writes(h)).toEqual([]);
      expect(JSON.stringify(h.store[ID])).toBe(before);
    });

    it('replaces the stored dashboard once when the user accepts, and records the session user as the owner', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
      settle(h);
      expect(out.resolved).toBe(true);
      expect(sent(h, 'PUT').length).toBe(1);
      expect(lookups(h).length).toBe(2);
      var doc = h.store[ID];
      expect(doc.banana_user_s).toBe('fixture-user');
      expect(JSON.parse(doc.banana_dashboard_s).username).toBe('fixture-user');
      expect(JSON.parse(doc.banana_dashboard_s).title).toBe(ID);
    });

    it('refuses an overwrite when no function to ask was given', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID));
      settle(h);
      expect(out.rejected).toBe(true);
      expect(out.error.reason).toBe('declined');
      expect(writes(h)).toEqual([]);
    });

    it('treats a function that throws, or one that answers anything but true, as a decline', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      var throwing = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, function () { throw new Error('no dialog'); }));
      var truthy = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, function () { return 'yes'; }));
      settle(h);
      expect(throwing.error.reason).toBe('declined');
      expect(truthy.error.reason).toBe('declined');
      expect(writes(h)).toEqual([]);
    });

    describe('every answer to the look-up that is not "free" or "a dashboard"', function () {
      [
        { name: 'a 404 whose body is not the blob store error', answer: [404, '{"message":"no route"}'] },
        { name: 'a 404 with no body', answer: [404, ''] },
        { name: 'a 403', answer: [403, '{}'] },
        { name: 'a 500', answer: [500, 'oops'] },
        { name: 'no answer (status 0)', answer: [0, ''] },
        { name: 'a request that timed out (status -1)', answer: [-1, ''] },
        { name: 'a 200 whose body does not parse', answer: [200, '<html>proxy page</html>'] }
      ].forEach(function (c) {
        it('is "could not check" and writes nothing: ' + c.name, function () {
          h.hooks.onGet = function () { return c.answer; };
          var confirm = confirmWith(true);
          var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
          settle(h);
          expect(out.rejected).toBe(true);
          expect(out.error.reason).toBe('cannot-check');
          expect(confirm.asked).toEqual([]);
          expect(writes(h)).toEqual([]);
        });
      });

      [
        { name: 'a 200 with an object that is not a dashboard record', answer: [200, '{"something":"else"}'] },
        { name: 'a 200 with an array whose element has no dashboard text', answer: [200, '[{"id":"x"}]'] },
        { name: 'a 200 with an array of two records', answer: [200, '[{"banana_dashboard_s":"{}"},{"banana_dashboard_s":"{}"}]'] },
        { name: 'a 204 (the name of a folder)', answer: [204, ''] }
      ].forEach(function (c) {
        it('is "not a dashboard" and writes nothing: ' + c.name, function () {
          h.hooks.onGet = function () { return c.answer; };
          var confirm = confirmWith(true);
          var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
          settle(h);
          expect(out.rejected).toBe(true);
          expect(out.error.reason).toBe('not-a-dashboard');
          expect(confirm.asked).toEqual([]);
          expect(writes(h)).toEqual([]);
        });
      });
    });

    it('sends both look-ups with the no-cache header and a timeout, and the save itself without a timeout', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
      settle(h);
      var gets = lookups(h);
      expect(gets.length).toBe(2);
      gets.forEach(function (r) {
        expect(r.headers['Cache-Control']).toBe('no-cache');
        expect(r.timeout).toBeGreaterThan(0);
      });
    });

    it('defeats a cache that would answer the second look-up with the first answer', function () {
      // a stub cache that answers every look-up with the first answer, unless the request says no-cache
      h.store[ID] = fusionRecord(ID, 'alice');
      var first;
      h.hooks.onGet = function (n, id, url) {
        var request = lookups(h)[n - 1];
        if (request.headers['Cache-Control'] === 'no-cache') { return undefined; }
        first = first || answer(200, [h.store[ID]]);
        return first;
      };
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
        h.store[ID] = fusionRecord(ID, 'alice', JSON.stringify({ title: ID, rows: [], username: 'alice', changed: true }));
      })));
      settle(h);
      expect(out.rejected).toBe(true);
      expect(out.error.reason).toBe('changed');
      expect(writes(h)).toEqual([]);
    });

    describe('the recheck after the user said yes', function () {
      it('writes nothing when the dashboard text changed and the owner did not', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
          h.store[ID] = fusionRecord(ID, 'alice', JSON.stringify({ title: ID, rows: [{ title: 'new' }], username: 'alice' }));
        })));
        settle(h);
        expect(out.rejected).toBe(true);
        expect(out.error.reason).toBe('changed');
        expect(writes(h)).toEqual([]);
        expect(JSON.parse(h.store[ID].banana_dashboard_s).rows.length).toBe(1);
      });

      it('writes nothing when the owner changed', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
          h.store[ID] = fusionRecord(ID, 'bob');
        })));
        settle(h);
        expect(out.error.reason).toBe('changed');
        expect(writes(h)).toEqual([]);
      });

      it('writes nothing when what is stored is no longer a dashboard', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        h.hooks.onGet = function (n) { return n === 2 ? [200, '{"now":"a plugin"}'] : undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.error.reason).toBe('changed');
        expect(writes(h)).toEqual([]);
      });

      it('writes when the dashboard was deleted meanwhile', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
          delete h.store[ID];
        })));
        settle(h);
        expect(out.resolved).toBe(true);
        expect(sent(h, 'PUT').length).toBe(1);
      });

      it('writes nothing when the recheck cannot be made (a 503)', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        h.hooks.onGet = function (n) { return n === 2 ? [503, ''] : undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.error.reason).toBe('cannot-check');
        expect(writes(h)).toEqual([]);
      });
    });

    describe('while it waits, the shared Solr client is used by other code', function () {
      var BLOB_PUT = BLOB + ID + '?resourceType=banana';

      function expectWriteToTheBlob() {
        expect(sent(h, 'PUT').map(function (r) { return r.url; })).toEqual([BLOB_PUT]);
        expect(h.requests.filter(function (r) { return r.url.indexOf('/data/collection/') === 0; })).toEqual([]);
        expect(sent(h, 'POST')).toEqual([]);
      }

      it('re-pointed during the look-up: the write still goes to the blob', function () {
        h.hooks.onGet = function (n) { if (n === 1) { repoint(h); } return undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.resolved).toBe(true);
        expectWriteToTheBlob();
      });

      it('re-pointed during the recheck: the write still goes to the blob', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        h.hooks.onGet = function (n) { if (n === 2) { repoint(h); } return undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.resolved).toBe(true);
        expectWriteToTheBlob();
      });

      it('re-pointed while the dialog is open: the write still goes to the blob', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () { repoint(h); })));
        settle(h);
        expect(out.resolved).toBe(true);
        expectWriteToTheBlob();
      });

      it('the look-ups never go through the shared client', function () {
        window.sjs.client.server('/data/collection/');
        settled(h.dashboard.elasticsearch_save('dashboard', ID));
        settle(h);
        expect(lookups(h).map(function (r) { return r.url; })).toEqual([BLOB + ID]);
      });

      it('the mode changed in the settings during the dialog: the recheck and the write use the mode of the click', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
          config.USE_FUSION = false;
        })));
        settle(h);
        expect(out.resolved).toBe(true);
        expect(lookups(h).map(function (r) { return r.url; })).toEqual([BLOB + ID, BLOB + ID]);
        expectWriteToTheBlob();
      });
    });

    describe('what is saved is what was on the screen at the click', function () {
      it('keeps a copy of the dashboard: later changes and a route change do not reach the write', function () {
        var rowsAtClick = h.dashboard.current.rows.length;
        var title = h.dashboard.current.title;
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID));
        // the user keeps editing, and the route replaces the current dashboard, before the look-up answers
        h.dashboard.current.rows.push({ title: 'added after the click', panels: [] });
        h.dashboard.current.style = 'light';
        h.dashboard.current = {};
        settle(h);
        expect(out.resolved).toBe(true);
        var saved = JSON.parse(h.store[ID].banana_dashboard_s);
        expect(saved.rows.length).toBe(rowsAtClick);
        expect(saved.style).not.toBe('light');
        expect(title).toBe('My dashboard');
        expect(saved.title).toBe(ID);
      });
    });

    describe('the address after a save', function () {
      it('opens the saved dashboard two seconds later', function () {
        settled(h.dashboard.elasticsearch_save('dashboard', ID));
        settle(h);
        expect(h.$location.url()).not.toBe('/dashboard/solr/' + ID);
        h.$timeout.flush();
        expect(h.$location.url()).toBe('/dashboard/solr/' + ID);
      });

      it('does not move the user who went to another dashboard meanwhile', function () {
        settled(h.dashboard.elasticsearch_save('dashboard', ID));
        settle(h);
        h.$location.url('/dashboard/solr/another');
        h.$timeout.flush();
        expect(h.$location.url()).toBe('/dashboard/solr/another');
      });

      it('writes a link with the title encoded twice', function () {
        settled(h.dashboard.elasticsearch_save('dashboard', 'a/b c'));
        settle(h);
        h.$timeout.flush();
        // $location writes the path as it holds it: it was decoded once from what the save set
        expect(h.$location.url()).toBe('/dashboard/solr/' + encodeURIComponent('a%2Fb%20c'));
      });
    });

    describe('the owner', function () {
      it('is the session user in the stored field and in the saved JSON, not the user of the loaded JSON', function () {
        // the loaded dashboard carries the previous saver
        h.dashboard.current.username = 'previous-saver';
        settled(h.dashboard.elasticsearch_save('dashboard', ID));
        settle(h);
        expect(h.store[ID].banana_user_s).toBe('fixture-user');
        expect(JSON.parse(h.store[ID].banana_dashboard_s).username).toBe('fixture-user');
      });

      it('is guest for a session with no user name (an API key), in the field and in the JSON', function () {
        var session = fixtures.load('fusion-5.9.16/session');
        delete session.response.body.user.username;
        var key = build({ session: session });
        key.dashboard.dash_load(dashboardToSave());
        key.dashboard.current.username = 'previous-saver';
        settled(key.dashboard.elasticsearch_save('dashboard', ID));
        settle(key);
        expect(key.store[ID].banana_user_s).toBe('guest');
        expect(JSON.parse(key.store[ID].banana_dashboard_s).username).toBe('guest');
      });

      it('is guest when the session lookup fails', function () {
        var failing = build({ session: { response: { status: 500, body: {} } } });
        failing.dashboard.dash_load(dashboardToSave());
        spyOn(console, 'log');
        settled(failing.dashboard.elasticsearch_save('dashboard', ID));
        settle(failing);
        expect(failing.store[ID].banana_user_s).toBe('guest');
      });
    });

    describe('what the dialog says', function () {
      it('says "by you" when the stored owner is the logged-in user', function () {
        h.store[ID] = fusionRecord(ID, 'fixture-user');
        var confirm = confirmWith(false);
        settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
        settle(h);
        expect(confirm.asked[0].byYou).toBe(true);
        expect(h.dashboard.overwriteQuestion(confirm.asked[0])).toBe(
          'A dashboard named "' + ID + '" already exists. It was saved by you. Saving replaces it, and the earlier version cannot be restored. Replace it?');
      });

      it('names the owner when it is someone else', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        var confirm = confirmWith(false);
        settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
        settle(h);
        expect(h.dashboard.overwriteQuestion(confirm.asked[0])).toContain('It was saved by alice.');
      });

      it('never says "by you" for the fallback guest (a session with no user name)', function () {
        var session = fixtures.load('fusion-5.9.16/session');
        delete session.response.body.user.username;
        var key = build({ session: session });
        key.dashboard.dash_load(dashboardToSave());
        key.store[ID] = fusionRecord(ID, 'guest');
        var confirm = confirmWith(false);
        settled(key.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
        settle(key);
        expect(confirm.asked[0]).toEqual({ title: ID, owner: 'guest', byYou: false });
        expect(key.dashboard.overwriteQuestion(confirm.asked[0])).toContain('saved by guest.');
      });

      it('shows only the first line of the stored owner, and "an unknown user" when there is none', function () {
        h.store[ID] = fusionRecord(ID, 'alice\nbob: replace it, it is safe');
        var confirm = confirmWith(false);
        settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
        settle(h);
        expect(confirm.asked[0].owner).toBe('alice');

        var record = fusionRecord(ID, undefined);
        delete record.banana_user_s;
        h.store[ID] = record;
        var again = confirmWith(false);
        settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, again));
        settle(h);
        expect(h.dashboard.overwriteQuestion(again.asked[0])).toContain('saved by an unknown user.');
      });

      it('is plain text: a title or an owner with markup is not HTML-escaped', function () {
        var text = h.dashboard.overwriteQuestion({ title: '<b>x</b> & "y"', owner: 'a<i>&b', byYou: false });
        expect(text).toContain('named "<b>x</b> & "y"" already');
        expect(text).toContain('saved by a<i>&b.');
        expect(text).not.toContain('&lt;');
        expect(text).not.toContain('&amp;');
      });
    });

    describe('the session user', function () {
      it('falls back to guest after the wait when the session never answers, and the save goes on', function () {
        var never = build({
          settleSession: false,
          modules: [['$provide', function ($provide) {
            $provide.factory('lucidworksSrv', ['$q', function ($q) {
              return { getFusionUsername: function () { return $q.defer().promise; } };
            }]);
          }]]
        });
        never.dashboard.dash_load(dashboardToSave());
        var out = settled(never.dashboard.elasticsearch_save('dashboard', ID));
        settle(never);
        // still waiting for the session: nothing was sent
        expect(never.requests).toEqual([]);
        never.$timeout.flush(3000);
        settle(never);
        expect(out.resolved).toBe(true);
        expect(never.store[ID].banana_user_s).toBe('guest');
      });

      it('does not leave a timer behind when the session answers in time', function () {
        var slow = build({ settleSession: false });
        slow.dashboard.dash_load(dashboardToSave());
        var out = settled(slow.dashboard.elasticsearch_save('dashboard', ID));
        settle(slow);
        expect(out.resolved).toBe(true);
        expect(slow.store[ID].banana_user_s).toBe('fixture-user');
        // only the redirect after the save is scheduled
        expect(function () { slow.$timeout.flush(); }).not.toThrow();
      });
    });
  });

  describe('a page that started in Solr mode and was switched to Fusion', function () {
    modes.useMode('solr');

    it('asks the session at the first Fusion save, not before', function () {
      var calls = 0;
      var h = build({
        fusion: false,
        modules: [['$provide', function ($provide) {
          $provide.factory('lucidworksSrv', ['$q', function ($q) {
            return {
              getFusionUsername: function () { calls++; return $q.when('late-user'); },
              getDashboardList: function () { return $q.when({ response: { docs: [] } }); }
            };
          }]);
        }]]
      });
      h.dashboard.dash_load(dashboardToSave('/solr/'));
      expect(calls).toBe(0);
      // the settings box is ticked
      config.USE_FUSION = true;
      installFusionStore(h);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID));
      settle(h);
      expect(calls).toBe(1);
      expect(out.resolved).toBe(true);
      // (the field names of the page are the ones it started with; the owner is in the dashboard text as well)
      expect(JSON.parse(h.store[ID][h.dashboard.DASHBOARD_FIELD]).username).toBe('late-user');
      expect(sent(h, 'PUT').map(function (r) { return r.url; })).toEqual([BLOB + ID + '?resourceType=banana']);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Save and delete, Solr mode

  describe('saving in Solr mode', function () {
    modes.useMode('solr');
    var h;
    beforeEach(function () {
      h = build({ fusion: false });
      h.dashboard.dash_load(dashboardToSave('/solr/'));
    });

    function selectParams(request) {
      return fixtures.params(request.url.slice(request.url.indexOf('?') + 1));
    }

    it('asks for the id, the user field, the dashboard field and the version, with the id as an escaped phrase', function () {
      settled(h.dashboard.elasticsearch_save('dashboard', ID));
      settle(h);
      var params = selectParams(lookups(h)[0]);
      expect(params.wt).toEqual(['json']);
      expect(params.rows).toEqual(['1']);
      expect(params.fl).toEqual(['id,user,dashboard,_version_']);
      expect(params.q).toEqual(['id:"' + ID + '"']);
    });

    it('writes a new title after a look-up that finds no document, with the owner of the dashboard JSON', function () {
      var confirm = confirmWith(true);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
      settle(h);
      expect(out.resolved).toBe(true);
      expect(confirm.asked).toEqual([]);
      expect(sent(h, 'POST').map(function (r) { return r.url; })).toEqual(['/solr/banana-int/update?commit=true']);
      expect(h.store[ID].user).toBe('guest');
    });

    it('shows the stored owner and writes nothing when the user declines', function () {
      h.store[ID] = solrRecord(ID, 'someone');
      var confirm = confirmWith(false);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
      settle(h);
      expect(confirm.asked).toEqual([{ title: ID, owner: 'someone', byYou: false }]);
      expect(out.error.reason).toBe('declined');
      expect(sent(h, 'POST')).toEqual([]);
    });

    it('replaces the document when the user accepts', function () {
      h.store[ID] = solrRecord(ID, 'someone');
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
      settle(h);
      expect(out.resolved).toBe(true);
      expect(sent(h, 'POST').length).toBe(1);
      expect(lookups(h).length).toBe(2);
      expect(JSON.parse(h.store[ID].dashboard).title).toBe(ID);
    });

    [
      { name: 'a 404', answer: [404, '{"error":{"msg":"Collection not found"}}'] },
      { name: 'a 500', answer: [500, ''] },
      { name: 'no answer', answer: [0, ''] },
      { name: 'a 200 that is not a Solr result', answer: [200, '{"hello":"world"}'] },
      { name: 'a 200 that does not parse', answer: [200, 'not json'] }
    ].forEach(function (c) {
      it('is "could not check" and writes nothing: ' + c.name, function () {
        h.hooks.onGet = function () { return c.answer; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.error.reason).toBe('cannot-check');
        expect(sent(h, 'POST')).toEqual([]);
      });
    });

    it('writes nothing when the version and the dashboard text changed and the owner is "guest" in both reads', function () {
      h.store[ID] = solrRecord(ID, 'guest', undefined, 1800000000000000001);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
        h.store[ID] = solrRecord(ID, 'guest', JSON.stringify({ title: ID, rows: [{ title: 'new' }], username: 'guest' }), 1800000000000000999);
      })));
      settle(h);
      expect(out.error.reason).toBe('changed');
      expect(sent(h, 'POST')).toEqual([]);
    });

    it('writes nothing when only the version changed', function () {
      h.store[ID] = solrRecord(ID, 'guest', undefined, 1800000000000000001);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
        h.store[ID]._version_ = 1799999999999999000;
      })));
      settle(h);
      expect(out.error.reason).toBe('changed');
      expect(sent(h, 'POST')).toEqual([]);
    });

    it('writes nothing when only the dashboard text changed', function () {
      h.store[ID] = solrRecord(ID, 'guest');
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
        h.store[ID].dashboard = JSON.stringify({ title: ID, rows: [{ title: 'new' }], username: 'guest' });
      })));
      settle(h);
      expect(out.error.reason).toBe('changed');
      expect(sent(h, 'POST')).toEqual([]);
    });

    it('defeats a cache with a parameter that differs between the two look-ups', function () {
      h.store[ID] = solrRecord(ID, 'someone');
      settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
      settle(h);
      var stamps = lookups(h).map(function (r) { return selectParams(r)._[0]; });
      expect(stamps.length).toBe(2);
      expect(stamps[0]).not.toBe(stamps[1]);
    });

    describe('while it waits, the shared Solr client is used by other code', function () {
      function expectWriteToTheCollection() {
        expect(sent(h, 'POST').map(function (r) { return r.url; })).toEqual(['/solr/banana-int/update?commit=true']);
        expect(h.requests.filter(function (r) { return r.url.indexOf('/data/collection/') === 0; })).toEqual([]);
        expect(sent(h, 'PUT')).toEqual([]);
      }

      it('re-pointed during the look-up: the write still goes to the saved-dashboards collection', function () {
        h.hooks.onGet = function (n) { if (n === 1) { repoint(h); } return undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.resolved).toBe(true);
        expectWriteToTheCollection();
      });

      it('re-pointed during the recheck: the write still goes to the saved-dashboards collection', function () {
        h.store[ID] = solrRecord(ID, 'someone');
        h.hooks.onGet = function (n) { if (n === 2) { repoint(h); } return undefined; };
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
        settle(h);
        expect(out.resolved).toBe(true);
        expectWriteToTheCollection();
      });

      it('the mode changed in the settings during the dialog: the recheck and the write use the mode of the click', function () {
        h.store[ID] = solrRecord(ID, 'someone');
        var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true, function () {
          config.USE_FUSION = true;
        })));
        settle(h);
        expect(out.resolved).toBe(true);
        expect(lookups(h).every(function (r) { return SOLR_SELECT.test(r.url); })).toBe(true);
        expectWriteToTheCollection();
      });
    });

    it('opens the saved dashboard on the same server, with the link encoded twice', function () {
      settled(h.dashboard.elasticsearch_save('dashboard', 'a/b'));
      settle(h);
      h.$timeout.flush();
      expect(h.$location.url()).toBe('/dashboard/solr/' + encodeURIComponent('a%2Fb') + '?server=%2Fsolr%2F');
    });
  });

  describe('Solr queries and the delete, for titles that are crafted', function () {
    modes.useMode('solr');
    var CRAFTED = ['*', 'x" OR title:"*', 'a&b', 'a<b>', 'a\\b', "a'b", 'a"b', 'a b/c?d#e', 'x\\" OR title:\\"*'];

    CRAFTED.forEach(function (title) {
      it('deletes by id, with the id as a JSON string: ' + JSON.stringify(title), function () {
        var h = build({ fusion: false });
        h.store[title] = solrRecord(title, 'x');
        h.store.d1 = solrRecord('d1', 'x');
        h.store.d2 = solrRecord('d2', 'x');
        var out = settled(h.dashboard.elasticsearch_delete(title));
        settle(h);
        expect(out.resolved).toBe(true);
        var post = sent(h, 'POST')[0];
        expect(post.data).toBe(JSON.stringify({ 'delete': { id: title } }));
        expect(JSON.parse(post.data)).toEqual({ 'delete': { id: title } });
        expect(post.data).not.toContain('<delete>');
        expect(post.data).not.toContain('"query"');
        expect(post.headers['Content-type']).toBe('application/json');
        expect(post.url.slice(0, post.url.indexOf('?'))).toBe('/solr/banana-int/update');
        expect(fixtures.params(post.url.slice(post.url.indexOf('?') + 1))).toEqual({ commit: ['true'], wt: ['json'] });
        // only the dashboard with exactly that id is gone
        expect(Object.keys(h.store).sort()).toEqual(['d1', 'd2']);
      });

      it('loads and looks up the title as an escaped, encoded phrase: ' + JSON.stringify(title), function () {
        var h = build({ fusion: false });
        h.dashboard.elasticsearch_load('dashboard', title);
        settle(h);
        var load = lookups(h)[0];
        var phrase = '"' + title.replace(/[\\"]/g, '\\$&') + '"';
        expect(load.url).toBe('/solr/banana-int/select?wt=json&q=' + encodeURIComponent('title:' + phrase));
        // nothing of the title reaches the query string unencoded
        expect(load.url.slice(load.url.indexOf('q=') + 2)).not.toMatch(/[ "&#<>]/);
        expect(fixtures.params(load.url.slice(load.url.indexOf('?') + 1)).q).toEqual(['title:' + phrase]);

        h.dashboard.dash_load(dashboardToSave('/solr/'));
        settled(h.dashboard.elasticsearch_save('dashboard', title));
        settle(h);
        var lookup = lookups(h)[1];
        expect(fixtures.params(lookup.url.slice(lookup.url.indexOf('?') + 1)).q).toEqual(['id:' + phrase]);
        expect(lookup.url.slice(lookup.url.indexOf('q=') + 2)).not.toMatch(/[ "#<>]/);
      });
    });

    it('rejects an empty title in Solr mode, sends nothing, and treats an id that is not text as empty', function () {
      var h = build({ fusion: false });
      var out = settled(h.dashboard.elasticsearch_delete(''));
      var out2 = settled(h.dashboard.elasticsearch_delete(undefined));
      settle(h);
      expect(out.rejected).toBe(true);
      expect(out2.rejected).toBe(true);
      expect(h.requests.filter(function (r) { return r.url !== SESSION_URL; })).toEqual([]);
    });
  });

  describe('deleting in Fusion mode', function () {
    modes.useMode('fusion');
    var h;
    beforeEach(function () {
      h = build();
    });

    it('sends DELETE of the blob API and the encoded id, with no query, no body and no extra header', function () {
      h.store[ID] = fusionRecord(ID, 'alice');
      var out = settled(h.dashboard.elasticsearch_delete(ID));
      settle(h);
      expect(out.resolved).toBe(true);
      var del = sent(h, 'DELETE')[0];
      expect(del.url).toBe(BLOB + ID);
      expect(del.data).toBeUndefined();
      // Banana adds no header of its own: the headers are the ones every $http request carries
      h.$httpBackend.whenDELETE('/probe').respond(204, '');
      h.injector.get('$http').delete('/probe');
      h.$httpBackend.flush();
      var plain = h.requests[h.requests.length - 1];
      expect(Object.keys(del.headers).sort()).toEqual(Object.keys(plain.headers).sort());
    });

    ['/', '?', '#', ' '].forEach(function (c) {
      it('deletes the id with "' + c + '" by its own encoded path', function () {
        var id = 'x' + c + 'y';
        h.store[id] = fusionRecord(id, 'alice');
        h.store.xy = fusionRecord('xy', 'alice');
        settled(h.dashboard.elasticsearch_delete(id));
        settle(h);
        expect(sent(h, 'DELETE')[0].url).toBe(BLOB + encodeURIComponent(id));
        expect(Object.keys(h.store)).toEqual(['xy']);
      });
    });

    [403, 404, 500, 0].forEach(function (status) {
      it('rejects when the server answers ' + status, function () {
        h.hooks.onDelete = function () { return [status, '']; };
        var out = settled(h.dashboard.elasticsearch_delete(ID));
        settle(h);
        expect(out.rejected).toBe(true);
      });
    });

    it('sets the shared client and sends in one turn: a re-pointed client does not redirect it', function () {
      window.sjs.client.server('/data/collection/');
      window.sjs.client.useFusion(false);
      settled(h.dashboard.elasticsearch_delete(ID));
      // no digest or flush yet: the request has already left
      expect(h.requests.filter(function (r) { return r.method === 'DELETE'; }).map(function (r) { return r.url; })).toEqual([BLOB + ID]);
    });

    it('rejects when the promise of the client resolves with no value (a 401 while the browser goes to login)', function () {
      window.sjs.client.del = function () { return h.injector.get('$q').when(undefined); };
      var real = h.injector.get('sjsResource');
      var out = settled(h.dashboard.elasticsearch_delete(ID));
      settle(h);
      expect(real).toBeDefined();
      expect(out.rejected).toBe(true);
      expect(out.error.reason).toBe('no-answer');
    });
  });

  describe('a 401 sends the browser to the login page and resolves with no value', function () {
    modes.useMode('fusion');

    it('is "stop" for the look-up of a save: nothing is written, nothing asked', function () {
      var h = build({ interceptor: true });
      h.dashboard.dash_load(dashboardToSave());
      h.hooks.onGet = function () { return [401, '']; };
      var confirm = confirmWith(true);
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirm));
      settle(h);
      expect(out.rejected).toBe(true);
      expect(out.error.reason).toBe('cannot-check');
      expect(confirm.asked).toEqual([]);
      expect(writes(h)).toEqual([]);
      expect(typeof h.fakeWindow.location).toBe('string');
    });

    it('is "stop" for the recheck', function () {
      var h = build({ interceptor: true });
      h.dashboard.dash_load(dashboardToSave());
      h.store[ID] = fusionRecord(ID, 'alice');
      h.hooks.onGet = function (n) { return n === 2 ? [401, ''] : undefined; };
      var out = settled(h.dashboard.elasticsearch_save('dashboard', ID, undefined, confirmWith(true)));
      settle(h);
      expect(out.error.reason).toBe('cannot-check');
      expect(writes(h)).toEqual([]);
    });

    it('is a failed delete: the promise rejects and nothing is reported as deleted', function () {
      var h = build({ interceptor: true });
      h.hooks.onDelete = function () { return [401, '']; };
      var out = settled(h.dashboard.elasticsearch_delete(ID));
      settle(h);
      expect(out.rejected).toBe(true);
      expect(out.resolved).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The controller: what the user is told

  describe('the dashLoader controller', function () {
    var h, scope;

    function controllerFor(options) {
      h = build(options);
      h.dashboard.dash_load(dashboardToSave(h.fusion ? undefined : '/solr/'));
      scope = h.$rootScope.$new();
      scope.config = config;
      h.injector.get('$controller')('dashLoader', { $scope: scope });
      scope.init();
      return h;
    }

    function titles() {
      return h.alertSrv.list.map(function (a) { return a.title; });
    }

    function save(title) {
      scope.elasticsearch.title = title;
      scope.elasticsearch_save('dashboard', null);
      settle(h);
    }

    describe('Fusion mode', function () {
      modes.useMode('fusion');

      beforeEach(function () {
        controllerFor();
        spyOn(window, 'confirm').and.returnValue(true);
      });

      it('saves a new title: "Dashboard Saved", the title box is cleared', function () {
        save(ID);
        expect(titles()).toEqual(['Dashboard Saved']);
        expect(scope.elasticsearch.title).toBe('');
        expect(window.confirm).not.toHaveBeenCalled();
      });

      it('asks with the question of the service, and replaces on yes', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        save(ID);
        expect(window.confirm).toHaveBeenCalledWith(
          'A dashboard named "' + ID + '" already exists. It was saved by alice. Saving replaces it, and the earlier version cannot be restored. Replace it?');
        expect(titles()).toEqual(['Dashboard Saved']);
        expect(h.store[ID].banana_user_s).toBe('fixture-user');
      });

      // Every refusal rejects, so none of them can end in "Dashboard Saved".
      function expectNothingSaved(expectedText, severity) {
        expect(titles()).toEqual(['Not saved']);
        expect(h.alertSrv.list[0].text).toContain(expectedText);
        expect(h.alertSrv.list[0].severity).toBe(severity);
        // the title box keeps what the user typed
        expect(scope.elasticsearch.title).toBe(ID);
        expect(writes(h)).toEqual([]);
        // and the address is not moved, now or when the delay of a redirect would have passed
        h.$timeout.flush();
        expect(h.$location.url()).toBe('');
      }

      it('declined: says that the existing dashboard was left as it was, as information and not as an error', function () {
        window.confirm.and.returnValue(false);
        h.store[ID] = fusionRecord(ID, 'alice');
        save(ID);
        expectNothingSaved('left as it was', 'info');
      });

      it('changed while deciding', function () {
        h.store[ID] = fusionRecord(ID, 'alice');
        window.confirm.and.callFake(function () {
          h.store[ID] = fusionRecord(ID, 'alice', JSON.stringify({ title: ID, rows: [1], username: 'alice' }));
          return true;
        });
        save(ID);
        expectNothingSaved('changed while you were deciding', 'error');
      });

      it('not a dashboard', function () {
        h.hooks.onGet = function () { return [204, '']; };
        save(ID);
        expectNothingSaved('not a Banana dashboard', 'error');
      });

      it('could not check', function () {
        h.hooks.onGet = function () { return [500, '']; };
        save(ID);
        expectNothingSaved('Could not check whether', 'error');
      });

      it('invalid title', function () {
        scope.elasticsearch.title = 'a%b';
        scope.elasticsearch_save('dashboard', null);
        settle(h);
        expect(titles()).toEqual(['Not saved']);
        expect(h.alertSrv.list[0].text).toContain('cannot contain');
        expect(scope.elasticsearch.title).toBe('a%b');
        expect(h.requests.filter(function (r) { return r.url !== SESSION_URL; })).toEqual([]);
      });

      it('a failed write is still "Save failed", and the title box keeps the title', function () {
        spyOn(console, 'log');
        h.hooks.onPut = true;
        h.$httpBackend.resetExpectations();
        var failing = h;
        failing.$httpBackend.expectGET(BLOB + ID).respond(404, JSON.stringify({ error: 'BLOB-0001' }));
        failing.$httpBackend.expectPUT(BLOB + ID + '?resourceType=banana').respond(500, '');
        save(ID);
        expect(titles()).toEqual(['Save failed']);
        expect(scope.elasticsearch.title).toBe(ID);
      });

      describe('markup in a title is escaped exactly once', function () {
        var MARKUP = '<img src=x onerror=alert(1)>&"\'';
        var ESCAPED = kbn.escapeHtml(MARKUP);

        it('in the "Dashboard Saved" alert', function () {
          save(MARKUP);
          expect(h.alertSrv.list[0].title).toBe('Dashboard Saved');
          expect(h.alertSrv.list[0].text).toBe('This dashboard has been saved to Solr as "' + ESCAPED + '"');
          expect(h.alertSrv.list[0].text).not.toContain('&amp;lt;');
          expect(h.alertSrv.list[0].text).not.toContain('<img');
        });

        it('in the "Dashboard Deleted" alert', function () {
          scope.elasticsearch.dashboards = [{ id: MARKUP }];
          h.store[MARKUP] = fusionRecord(MARKUP, 'x');
          scope.elasticsearch_delete(MARKUP);
          settle(h);
          expect(h.alertSrv.list[0].title).toBe('Dashboard Deleted');
          expect(h.alertSrv.list[0].text).toBe(ESCAPED + ' has been deleted');
          expect(h.alertSrv.list[0].text).not.toContain('&amp;lt;');
        });

        it('in the "not found" alert of a load (the existing escape stays one)', function () {
          h.dashboard.elasticsearch_load('dashboard', MARKUP);
          settle(h);
          expect(h.alertSrv.list[h.alertSrv.list.length - 1].text).toContain('named "' + ESCAPED + '"');
          expect(h.alertSrv.list[h.alertSrv.list.length - 1].text).not.toContain('&amp;lt;');
        });
      });
    });

    describe('Solr mode', function () {
      modes.useMode('solr');

      beforeEach(function () {
        controllerFor({ fusion: false });
        spyOn(window, 'confirm').and.returnValue(true);
      });

      it('"Not Found" alert of a delete that Solr answers without a status of 0 escapes the id once', function () {
        var MARKUP = '<b>x</b>';
        scope.elasticsearch.dashboards = [{ id: MARKUP }];
        h.hooks.onGet = null;
        h.$httpBackend.expectPOST(/\/update\?/).respond(200, JSON.stringify({ responseHeader: { status: 1 } }));
        scope.elasticsearch_delete(MARKUP);
        settle(h);
        expect(h.alertSrv.list[0].title).toBe('Dashboard Not Found');
        expect(h.alertSrv.list[0].text).toBe('Could not find ' + kbn.escapeHtml(MARKUP) + ' in Solr');
      });

      it('asks, and declines leave Solr as it was', function () {
        window.confirm.and.returnValue(false);
        h.store[ID] = solrRecord(ID, 'someone');
        save(ID);
        expect(titles()).toEqual(['Not saved']);
        expect(sent(h, 'POST')).toEqual([]);
      });
    });

    describe('deleting from the list (Fusion)', function () {
      modes.useMode('fusion');

      beforeEach(function () {
        controllerFor({ interceptor: true });
        scope.elasticsearch.dashboards = [{ id: 'one' }, { id: ID }, { id: 'three' }];
        h.store[ID] = fusionRecord(ID, 'alice');
      });

      function rows() { return scope.elasticsearch.dashboards.map(function (d) { return d.id; }); }

      it('removes the row after a real success', function () {
        scope.elasticsearch_delete(ID);
        settle(h);
        expect(titles()).toEqual(['Dashboard Deleted']);
        expect(rows()).toEqual(['one', 'three']);
      });

      it('keeps the row and says "Dashboard Not Deleted" when the answer is a 401 (resolved with no value)', function () {
        h.hooks.onDelete = function () { return [401, '']; };
        scope.elasticsearch_delete(ID);
        settle(h);
        expect(titles()).toEqual(['Dashboard Not Deleted']);
        expect(rows()).toEqual(['one', ID, 'three']);
      });

      it('keeps the row and says "Dashboard Not Deleted" for a 404', function () {
        h.hooks.onDelete = function () { return [404, '']; };
        scope.elasticsearch_delete(ID);
        settle(h);
        expect(titles()).toEqual(['Dashboard Not Deleted']);
        expect(rows()).toEqual(['one', ID, 'three']);
      });

      it('sends no request for an id the blob path cannot carry, keeps the row, and says so', function () {
        scope.elasticsearch.dashboards.push({ id: 'a%2Fb' });
        scope.elasticsearch_delete('a%2Fb');
        settle(h);
        expect(sent(h, 'DELETE')).toEqual([]);
        expect(titles()).toEqual(['Dashboard Not Deleted']);
        expect(rows()).toContain('a%2Fb');
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Load and the list

  describe('the load reports what happened (the response transformer never throws)', function () {
    describe('Fusion mode', function () {
      modes.useMode('fusion');

      var BODIES = [
        { name: 'the 404 of the blob store', answer: function () { var f = fixtures.load('fusion-5.9.16/blob-read-absent'); return [404, f.response.body]; }, text: 'Could not find dashboard named "' + ID + '"' },
        { name: 'a 204', answer: function () { return [204, '']; }, text: 'Could not find dashboard named' },
        { name: 'an empty 200 body', answer: function () { return [200, '']; }, text: 'Could not find dashboard named' },
        { name: 'a 200 with an empty array', answer: function () { return [200, []]; }, text: 'Could not find dashboard named' },
        { name: 'a 200 that is not JSON', answer: function () { return [200, '<html>']; }, text: 'Could not find dashboard named' },
        { name: 'a 200 whose dashboard text is not JSON', answer: function () { return [200, [{ banana_dashboard_s: '{nope' }]]; }, text: 'Could not find dashboard named' },
        { name: 'a 500', answer: function () { return [500, '']; }, text: 'Could not find dashboard named' },
        { name: 'no answer (status 0)', answer: function () { return [0, '']; }, text: 'Could not contact Solr at' }
      ];

      BODIES.forEach(function (c) {
        it('shows an alert, and does not load a dashboard, for ' + c.name, function () {
          var h = build();
          h.hooks.onGet = function () { var a = c.answer(); return answer(a[0], a[1]); };
          var before = h.dashboard.current;
          var out = settled(h.dashboard.elasticsearch_load('dashboard', ID));
          settle(h);
          expect(h.alertSrv.list.length).toBe(1);
          expect(h.alertSrv.list[0].text).toContain(c.text);
          expect(h.dashboard.current).toBe(before);
          expect(out.resolved && out.value === undefined).toBeFalsy();
          // nothing was thrown inside a promise callback
          expect(h.injector.get('$exceptionHandler').errors).toEqual([]);
        });
      });
    });

    describe('Solr mode', function () {
      modes.useMode('solr');

      var BODIES = [
        { name: 'an error answer', answer: [404, fixtures.load('solr-shapes/select-error').response.body], text: 'Could not find dashboard named' },
        { name: 'no document', answer: [200, fixtures.load('solr-shapes/dashboard-load-none').response.body], text: 'Could not find dashboard named' },
        { name: 'a result that has no response', answer: [200, {}], text: 'Could not find dashboard named' },
        { name: 'a document without the dashboard field', answer: [200, { response: { docs: [{ id: 'x' }] } }], text: 'Could not find dashboard named' },
        { name: 'an empty body', answer: [200, ''], text: 'Could not find dashboard named' },
        { name: 'no answer', answer: [0, ''], text: 'Could not contact Solr at /solr/' }
      ];

      BODIES.forEach(function (c) {
        it('shows an alert, and does not load a dashboard, for ' + c.name, function () {
          var h = build({ fusion: false });
          h.hooks.onGet = function () { return answer(c.answer[0], c.answer[1]); };
          h.dashboard.elasticsearch_load('dashboard', ID);
          settle(h);
          expect(h.alertSrv.list.length).toBe(1);
          expect(h.alertSrv.list[0].text).toContain(c.text);
          expect(h.injector.get('$exceptionHandler').errors).toEqual([]);
        });
      });
    });
  });

  describe('links and the route carry the title intact', function () {
    var TITLES = ['a/b', 'q?x#y', ID, 'new title', 'a/b/c', 'a%2Fb', '100% sure', 'x&y=z', 'ü/ß'];

    // The real AngularJS location and route code, with the routes of the application (no templates).
    function routeOf(path) {
      var injector = helpers.createInjector({}, [['$routeProvider', function ($routeProvider) {
        $routeProvider
          .when('/dashboard/:kbnType/:kbnId', { template: '' })
          .when('/dashboard/:kbnType/:kbnId/:params', { template: '' })
          .otherwise({ redirectTo: '/dashboard' });
      }]]);
      var $location = injector.get('$location');
      var $route = injector.get('$route');
      var $rootScope = injector.get('$rootScope');
      $location.url(path);
      $rootScope.$digest();
      return $route.current && $route.current.params;
    }

    TITLES.forEach(function (title) {
      it('round-trips ' + JSON.stringify(title) + ' from the link to the id the route loads', function () {
        var link = '/dashboard/solr/' + ids.linkId(title);
        var params = routeOf(link);
        expect(params.kbnType).toBe('solr');
        expect(ids.routeId(params.kbnId)).toBe(title);
      });
    });

    it('opens a title with slashes by the second route no more', function () {
      // the same title carried by a link that is encoded only once is split by the route: why the id is encoded twice
      var params = routeOf('/dashboard/solr/' + encodeURIComponent('a/b'));
      expect(params.kbnId).toBe('a');
      expect(params.params).toBe('b');
    });

    it('resolves a link written by 1.6.30 for a plain id and for an id with a space as before', function () {
      expect(ids.routeId(routeOf('/dashboard/solr/' + ID).kbnId)).toBe(ID);
      expect(ids.routeId(routeOf('/dashboard/solr/new title').kbnId)).toBe('new title');
      expect(ids.routeId(routeOf('/dashboard/solr/new%20title').kbnId)).toBe('new title');
    });

    it('falls back to the text when the second decode fails (a malformed percent escape)', function () {
      expect(ids.routeId('100%')).toBe('100%');
      expect(ids.routeId('%E0%A4%A')).toBe('%E0%A4%A');
    });

    it('does not break on an id that cannot be encoded', function () {
      expect(ids.linkId('a\ud800b')).toBe('');
    });

    describe('what the route does with the id', function () {
      var CASES = [
        { type: 'solr', loads: true }, { type: 'elasticsearch', loads: true }, { type: 'temp', loads: true },
        { type: 'file', loads: false }
      ];
      modes.useMode('solr');

      CASES.forEach(function (c) {
        it('decodes a second time for the ' + c.type + ' route: ' + c.loads, function () {
          var h = build({ fusion: false, routeParams: { kbnType: c.type, kbnId: '..%2F..%2Fx' } });
          h.$httpBackend.whenGET(/./).respond(404, '');
          h.$rootScope.$broadcast('$routeChangeSuccess');
          settle(h);
          var urls = h.requests.map(function (r) { return r.url; });
          if (c.loads) {
            // the saved-dashboard route: the id is "../../x" (a phrase in a query, not a path)
            expect(urls.some(function (u) { return u.indexOf('/solr/banana-int/select?wt=json&q=' + encodeURIComponent('title:"../../x"')) === 0; })).toBe(true);
          } else {
            // the file route is never decoded a second time: the id stays "..%2F..%2Fx"
            expect(urls.some(function (u) { return u.indexOf('app/dashboards/..%2F..%2Fx?') === 0; })).toBe(true);
            expect(urls.some(function (u) { return u.indexOf('app/dashboards/../../x') === 0; })).toBe(false);
          }
        });
      });

      it('loads the id with a slash from a Fusion link', function () {
        config.USE_FUSION = true;
        var h = build({ routeParams: { kbnType: 'solr', kbnId: 'a%2Fb' } });
        h.$rootScope.$broadcast('$routeChangeSuccess');
        settle(h);
        expect(lookups(h).map(function (r) { return r.url; })).toEqual([BLOB + 'a%2Fb']);
      });
    });
  });

  describe('the list of saved dashboards', function () {
    modes.useMode('fusion');

    function listFixture(entries) {
      var h = build({
        modules: [['$provide', function () {}]]
      });
      h.dashboard.dash_load(dashboardToSave());
      var scope = h.$rootScope.$new();
      scope.config = config;
      h.injector.get('$controller')('dashLoader', { $scope: scope });
      scope.init();
      h.$httpBackend.whenGET(/^\/api\/blobs\?/).respond(function () { return answer(200, entries); });
      return { h: h, scope: scope };
    }

    it('keeps the first character of an id that contains a slash', function () {
      var f = listFixture([{ id: 'ab/c' }, { id: 'banana-it-a0-s1/x' }]);
      f.scope.elasticsearch_dblist('');
      settle(f.h);
      expect(f.scope.elasticsearch.dashboards.map(function (d) { return d.id; })).toEqual(['ab/c', 'banana-it-a0-s1/x']);
    });

    it('strips a leading slash only', function () {
      var f = listFixture([{ id: '/path-style' }, { id: 'plain' }]);
      f.scope.elasticsearch_dblist('');
      settle(f.h);
      expect(f.scope.elasticsearch.dashboards.map(function (d) { return d.id; })).toEqual(['path-style', 'plain']);
    });

    it('gives each row a link that carries the id encoded twice', function () {
      var f = listFixture([{ id: 'a/b' }, { id: 'q?x#y' }, { id: ID }]);
      f.scope.elasticsearch_dblist('');
      settle(f.h);
      f.scope.elasticsearch.dashboards.forEach(function (d) {
        expect(d.link).toBe(encodeURIComponent(encodeURIComponent(d.id)));
      });
    });

    it('orders the entries by id in the browser, and asks the store for nothing but q and resourceType', function () {
      var f = listFixture([{ id: 'c' }, { id: 'a' }, { id: 'B' }, { id: 'b' }]);
      f.scope.elasticsearch_dblist('x y');
      settle(f.h);
      expect(f.scope.elasticsearch.dashboards.map(function (d) { return d.id; })).toEqual(['B', 'a', 'b', 'c']);
      var request = lookups(f.h)[0];
      var query = fixtures.params(request.url.slice(request.url.indexOf('?') + 1));
      expect(Object.keys(query).sort()).toEqual(['q', 'resourceType']);
      expect(query.q).toEqual(['id:x y*']);
      expect(query.resourceType).toEqual(['banana']);
    });

    it('is what the list shows to the row buttons: the row holds the id that Delete sends', function () {
      var f = listFixture([{ id: 'ab/c' }]);
      f.h.store['ab/c'] = fusionRecord('ab/c', 'x');
      f.h.store['b/c'] = fusionRecord('b/c', 'x');
      f.scope.elasticsearch_dblist('');
      settle(f.h);
      f.scope.elasticsearch_delete(f.scope.elasticsearch.dashboards[0].id);
      settle(f.h);
      expect(sent(f.h, 'DELETE').map(function (r) { return r.url; })).toEqual([BLOB + 'ab%2Fc']);
      expect(Object.keys(f.h.store)).toEqual(['b/c']);
    });
  });
});
