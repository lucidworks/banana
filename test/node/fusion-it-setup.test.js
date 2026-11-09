'use strict';

// Unit tests for scripts/fusion-it-setup. They need no Fusion: requests are
// answered by a small in-memory stand-in, and the assertions are made on the
// requests the script actually sends.
//
// Run with: node --test test/node/*.test.js

var test = require('node:test');
var assert = require('node:assert');
var path = require('node:path');

var setup = require(path.join(__dirname, '..', '..', 'scripts', 'fusion-it-setup'));
var PREFIX = 'banana-it';

// Independent of the script's own guard: a request is acceptable only if it is
// a read, a login, or a POST aimed at an object carrying the prefix.
function violation(method, urlPath, body) {
  var bare = urlPath.split('?')[0];
  var m;
  if (method === 'GET' || method === 'HEAD') { return null; }
  if (method !== 'POST') { return method + ' ' + bare + ' is not allowed'; }
  if (bare === '/api/session') { return null; }
  if (bare === '/api/apps') {
    return body && String(body.id).indexOf(PREFIX) === 0 ? null : 'app created without prefix';
  }
  m = /^\/api\/apps\/([^/]+)\/collections$/.exec(bare);
  if (m) {
    return m[1].indexOf(PREFIX) === 0 && body && String(body.id).indexOf(PREFIX) === 0 ?
      null : 'collection created without prefix';
  }
  m = /^\/api\/index-pipelines\/[^/]+\/collections\/([^/]+)\/index$/.exec(bare);
  if (m) {
    return m[1].indexOf(PREFIX) === 0 ? null : 'indexed into unprefixed collection';
  }
  return 'unexpected write ' + method + ' ' + bare;
}

function relatedObjectsOff(urlPath) {
  return urlPath.split('?')[1] === 'relatedObjects=false';
}

// In-memory stand-in for the parts of the Fusion API the script touches.
function fakeFusion() {
  var state = { apps: ['test'], collections: ['test'], blobs: [], countOffset: 0, docs: {}, requests: [] };

  function json(status, data) {
    return {
      status: status,
      headers: { getSetCookie: function () { return ['id=cookie-value-1234; Secure; HttpOnly']; } },
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    };
  }

  function fetchImpl(url, init) {
    var u = new URL(url);
    var method = init.method;
    var p = u.pathname;
    var body = init.body ? JSON.parse(init.body) : undefined;
    state.requests.push({ method: method, path: p + u.search, body: body, headers: init.headers });

    if (method === 'GET') {
      if (p === '/api/apps') { return Promise.resolve(json(200, state.apps.map(function (id) { return { id: id }; }))); }
      if (p === '/api/collections') { return Promise.resolve(json(200, state.collections.map(function (id) { return { id: id }; }))); }
      if (p === '/api/jobs') { return Promise.resolve(json(200, [{ resource: 'task:example' }])); }
      if (p === '/api/index-pipelines' || p === '/api/query-pipelines' ||
          p === '/api/index-profiles' || p === '/api/query-profiles') {
        return Promise.resolve(json(200, [{ id: '_system' }]));
      }
      if (p === '/api/solrAdmin/default/admin/configs') { return Promise.resolve(json(200, { configSets: ['_default'] })); }
      if (p === '/api/blobs') { return Promise.resolve(json(200, state.blobs.map(function (id) { return { id: id }; }))); }
      var a = /^\/api\/apps\/([^/]+)$/.exec(p);
      if (a) { return Promise.resolve(json(state.apps.indexOf(a[1]) >= 0 ? 200 : 404, {})); }
      var c = /^\/api\/collections\/([^/]+)$/.exec(p);
      if (c) { return Promise.resolve(json(state.collections.indexOf(c[1]) >= 0 ? 200 : 404, {})); }
      if (/^\/api\/solr\/[^/]+\/select$/.exec(p)) {
        return Promise.resolve(json(200, { response: { numFound: Object.keys(state.docs).length + state.countOffset } }));
      }
    }
    if (method === 'POST') {
      if (p === '/api/session') { return Promise.resolve(json(201, {})); }
      if (p === '/api/apps') { state.apps.push(body.id); return Promise.resolve(json(201, body)); }
      var cc = /^\/api\/apps\/([^/]+)\/collections$/.exec(p);
      if (cc) { state.collections.push(body.id); return Promise.resolve(json(201, body)); }
      if (/\/index$/.test(p)) {
        body.forEach(function (d) { state.docs[d.id] = d; });
        return Promise.resolve(json(200, {}));
      }
    }
    return Promise.resolve(json(404, {}));
  }

  return { state: state, fetch: fetchImpl };
}

function runAgainst(fake) {
  var lines = [];
  return setup.run({
    env: { FUSION_URL: 'https://fusion.example.test', FUSION_API_KEY: 'k' },
    fetch: fake.fetch,
    log: function (l) { lines.push(l); },
    retryDelayMs: 0
  }).then(function (result) { return { result: result, lines: lines }; });
}

test('dataset is deterministic, prefixed and unique', function () {
  var a = setup.generateDocs();
  var b = setup.generateDocs();
  assert.deepStrictEqual(a, b);
  var ids = {};
  a.forEach(function (d) {
    assert.strictEqual(d.id.indexOf(PREFIX), 0);
    ids[d.id] = true;
  });
  assert.strictEqual(Object.keys(ids).length, a.length);
});

test('dataset covers the field types the panels need and carries markup-like strings', function () {
  var docs = setup.generateDocs();
  var first = docs[0];
  ['timestamp_tdt', 'level_s', 'message_t', 'host_s', 'user_agent_s', 'url_s', 'geo_p',
    'lat_d', 'lon_d', 'status_i', 'bytes_l', 'response_time_d', 'tags_ss'].forEach(function (f) {
    assert.ok(first[f] !== undefined, 'missing field ' + f);
  });
  var text = docs.map(function (d) { return d.message_t + '\n' + d.url_s; }).join('\n');
  assert.ok(text.indexOf('<img src=x onerror=alert(1)>') >= 0);
  assert.ok(text.indexOf('" onmouseover="x') >= 0);
  assert.ok(text.indexOf('javascript:alert(1)') >= 0);
});

test('the planned requests never delete and only write to prefixed objects', function () {
  var steps = setup.plan();
  assert.ok(steps.some(function (s) { return s.method === 'POST'; }));
  steps.forEach(function (s) {
    assert.notStrictEqual(s.method, 'DELETE');
    assert.strictEqual(violation(s.method, s.path, s.body), null, s.method + ' ' + s.path);
    if (s.path.indexOf('/api/apps') === 0 && s.method === 'POST') {
      assert.ok(relatedObjectsOff(s.path), 'create must send relatedObjects=false: ' + s.path);
    }
  });
});

test('a run sends no DELETE and no write to an unprefixed object', function () {
  var fake = fakeFusion();
  return runAgainst(fake).then(function () {
    assert.ok(fake.state.requests.length > 0);
    fake.state.requests.forEach(function (r) {
      assert.notStrictEqual(r.method, 'DELETE');
      assert.strictEqual(violation(r.method, r.path, r.body), null, r.method + ' ' + r.path);
    });
    var creates = fake.state.requests.filter(function (r) {
      return r.method === 'POST' && /^\/api\/apps(\/[^/]+\/collections)?$/.test(r.path.split('?')[0]);
    });
    assert.strictEqual(creates.length, 2);
    creates.forEach(function (r) { assert.ok(relatedObjectsOff(r.path), r.path); });
  });
});

test('a second run creates nothing and leaves the same document count', function () {
  var fake = fakeFusion();
  return runAgainst(fake).then(function () {
    var docsAfterFirst = Object.keys(fake.state.docs).length;
    var apps = fake.state.apps.slice();
    var collections = fake.state.collections.slice();
    fake.state.requests.length = 0;
    return runAgainst(fake).then(function (second) {
      assert.deepStrictEqual(fake.state.apps, apps);
      assert.deepStrictEqual(fake.state.collections, collections);
      assert.strictEqual(Object.keys(fake.state.docs).length, docsAfterFirst);
      assert.strictEqual(second.result.count, docsAfterFirst);
      assert.ok(second.lines.indexOf('inventory change: none') >= 0);
      var creates = fake.state.requests.filter(function (r) {
        return r.method === 'POST' && r.path.indexOf('/index') < 0;
      });
      assert.strictEqual(creates.length, 0);
    });
  });
});

test('a run fails when a non-prefixed object appears during setup', function () {
  var fake = fakeFusion();
  var original = fake.fetch;
  var seenIndex = false;
  fake.fetch = function (url, init) {
    if (/\/index(\?|$)/.test(url)) { seenIndex = true; }
    if (seenIndex && init.method === 'GET' && /\/api\/collections$/.test(url)) {
      fake.state.collections.push('someone-elses-collection');
    }
    return original(url, init);
  };
  return assert.rejects(runAgainst(fake), /inventory changed outside banana-it/);
});

test('the signals objects Fusion derives from the collection are expected', function () {
  [
    'apps: banana-it',
    'collections: banana-it-logs',
    'collections: banana-it-logs_signals',
    'collections: banana-it-logs_signals_aggr',
    'jobs: spark:banana-it-logs_click_signals_aggregation',
    'jobs: spark:banana-it-logs_head_tail',
    'jobs: spark:banana-it-logs_session_rollup',
    'solrConfigsets: banana-it-logs',
    'solrConfigsets: banana-it-logs_signals',
    'solrConfigsets: banana-it-logs_signals_aggr'
  ].forEach(function (e) { assert.ok(setup.isExpectedAddition(e), e); });
});

test('other additions are not expected, even when they look similar', function () {
  [
    'jobs: spark:other',
    'jobs: spark:banana-it-other_head_tail',
    'jobs: banana-it-logs_head_tail',
    'collections: banana-it-other',
    'collections: other',
    'apps: banana-it-extra',
    'indexPipelines: banana-it-logs',
    'solrConfigsets: other'
  ].forEach(function (e) { assert.ok(!setup.isExpectedAddition(e), e); });
});

test('a run fails when an unexpected spark job appears', function () {
  var fake = fakeFusion();
  var original = fake.fetch;
  fake.fetch = function (url, init) {
    if (init.method === 'GET' && /\/api\/jobs$/.test(url) && fake.state.collections.indexOf('banana-it-logs') >= 0) {
      var real = original(url, init);
      return real.then(function (res) {
        return {
          status: 200,
          headers: res.headers,
          text: function () {
            return Promise.resolve(JSON.stringify([{ resource: 'task:example' }, { resource: 'spark:other' }]));
          }
        };
      });
    }
    return original(url, init);
  };
  return assert.rejects(runAgainst(fake), /spark:other/);
});

test('the dataset has a single-valued 2-letter country code for the map panel', function () {
  setup.generateDocs().forEach(function (d) {
    assert.ok(typeof d.country_s === 'string' && /^[A-Z]{2}$/.test(d.country_s), d.id + ' ' + d.country_s);
  });
});

test('a run fails when the document count differs from the expected count', function () {
  var fake = fakeFusion();
  fake.state.countOffset = -1;
  return assert.rejects(runAgainst(fake), /expected 240 documents, found 239/);
});

test('a run fails when an existing object disappears', function () {
  var fake = fakeFusion();
  var original = fake.fetch;
  var seenIndex = false;
  fake.fetch = function (url, init) {
    if (/\/index(\?|$)/.test(url)) { seenIndex = true; }
    if (seenIndex && init.method === 'GET' && /\/api\/collections$/.test(url)) {
      fake.state.collections = fake.state.collections.filter(function (c) { return c !== 'test'; });
    }
    return original(url, init);
  };
  return assert.rejects(runAgainst(fake), /inventory changed outside banana-it objects.*collections: test/);
});

test('a run fails when a blob without the prefix appears, and accepts one with it', function () {
  var addBlob = function (id) {
    var fake = fakeFusion();
    var original = fake.fetch;
    var seenIndex = false;
    fake.fetch = function (url, init) {
      if (/\/index(\?|$)/.test(url)) { seenIndex = true; }
      if (seenIndex && init.method === 'GET' && /\/api\/blobs$/.test(url) && fake.state.blobs.indexOf(id) < 0) {
        fake.state.blobs.push(id);
      }
      return original(url, init);
    };
    return fake;
  };
  return assert.rejects(runAgainst(addBlob('other-blob')), /blobs: other-blob/).then(function () {
    return runAgainst(addBlob('banana-it-other-run-1'));
  });
});

test('the inventory covers exactly the nine kinds of object', function () {
  var fake = fakeFusion();
  return runAgainst(fake).then(function () {
    var gets = {};
    fake.state.requests.forEach(function (r) {
      if (r.method === 'GET' && r.path.split('/').length === 3) { gets[r.path.split('?')[0]] = true; }
    });
    ['/api/apps', '/api/collections', '/api/jobs', '/api/index-pipelines', '/api/query-pipelines',
      '/api/index-profiles', '/api/query-profiles', '/api/blobs'].forEach(function (g) {
      assert.ok(gets[g], 'not inventoried: ' + g);
    });
    assert.ok(fake.state.requests.some(function (r) {
      return r.path.indexOf('/api/solrAdmin/default/admin/configs') === 0;
    }), 'configsets not inventoried');
    // A removed index pipeline must be noticed, so the kind must be read.
    var original = fake.fetch;
    var seenIndex = false;
    fake.fetch = function (url, init) {
      if (/\/index(\?|$)/.test(url)) { seenIndex = true; }
      if (seenIndex && /\/api\/index-pipelines$/.test(url)) {
        return Promise.resolve({
          status: 200,
          headers: { getSetCookie: function () { return []; } },
          text: function () { return Promise.resolve('[]'); }
        });
      }
      return original(url, init);
    };
    return assert.rejects(runAgainst(fake), /indexPipelines: _system/);
  });
});

test('log output holds neither the URL, the host, the API key nor a cookie', function () {
  var fake = fakeFusion();
  var lines = [];
  var env = {
    FUSION_URL: 'https://fusion.example.test:6764',
    FUSION_API_KEY: 'secret-key-value-9876'
  };
  return setup.run({ env: env, fetch: fake.fetch, log: function (l) { lines.push(l); }, retryDelayMs: 0 })
    .then(function () {
      var passwordEnv = { FUSION_URL: env.FUSION_URL, FUSION_USER: 'someone', FUSION_PASSWORD: 'secret-password-1' };
      return setup.run({ env: passwordEnv, fetch: fake.fetch, log: function (l) { lines.push(l); }, retryDelayMs: 0 });
    })
    .then(function () {
      var all = lines.join('\n');
      ['fusion.example.test', 'https://', 'secret-key-value-9876', 'cookie-value-1234',
        'secret-password-1', 'someone'].forEach(function (needle) {
        assert.strictEqual(all.indexOf(needle), -1, 'log contains ' + needle);
      });
      assert.ok(all.indexOf('<FUSION>') >= 0);
    });
});

test('the request guard refuses a collection segment that decodes to a slash or ..', function () {
  ['banana-it%2F..%2Fother', 'banana-it%2Fx', 'banana-it..x', 'banana-it%5Cx'].forEach(function (seg) {
    assert.throws(function () {
      setup.assertAllowed({
        method: 'POST', path: '/api/index-pipelines/_system/collections/' + seg + '/index', body: []
      });
    }, /refused/, seg);
    assert.throws(function () {
      setup.assertAllowed({
        method: 'POST', path: '/api/apps/' + seg + '/collections?relatedObjects=false', body: { id: 'banana-it-x' }
      });
    }, /refused/, seg);
  });
});

test('the request guard refuses DELETE, PUT and PATCH', function () {
  ['DELETE', 'PUT', 'PATCH'].forEach(function (method) {
    assert.throws(function () {
      setup.assertAllowed({ method: method, path: '/api/collections/banana-it-logs' });
    }, /refused/);
    assert.throws(function () {
      setup.assertAllowed({ method: method, path: '/api/apps/test' });
    }, /refused/);
  });
});

test('the request guard refuses writes to objects without the prefix', function () {
  assert.throws(function () {
    setup.assertAllowed({ method: 'POST', path: '/api/apps?relatedObjects=false', body: { id: 'test' } });
  }, /prefix/);
  assert.throws(function () {
    setup.assertAllowed({
      method: 'POST', path: '/api/apps/test/collections?relatedObjects=false', body: { id: 'banana-it-logs' }
    });
  }, /prefix/);
  assert.throws(function () {
    setup.assertAllowed({
      method: 'POST', path: '/api/apps/banana-it/collections?relatedObjects=false', body: { id: 'other' }
    });
  }, /prefix/);
  assert.throws(function () {
    setup.assertAllowed({
      method: 'POST', path: '/api/index-pipelines/_system/collections/test/index?commit=true', body: []
    });
  }, /prefix/);
  assert.throws(function () {
    setup.assertAllowed({ method: 'POST', path: '/api/jobs/anything', body: {} });
  }, /refused/);
});

test('the request guard insists on relatedObjects=false for creates', function () {
  assert.throws(function () {
    setup.assertAllowed({ method: 'POST', path: '/api/apps', body: { id: 'banana-it' } });
  }, /relatedObjects=false/);
  assert.throws(function () {
    setup.assertAllowed({
      method: 'POST', path: '/api/apps/banana-it/collections', body: { id: 'banana-it-logs' }
    });
  }, /relatedObjects=false/);
});

test('the request guard allows reads of the shared pipeline and writes to the prefixed collection', function () {
  setup.assertAllowed({ method: 'GET', path: '/api/index-pipelines/_system' });
  setup.assertAllowed({
    method: 'POST', path: '/api/index-pipelines/_system/collections/banana-it-logs/index?commit=true', body: []
  });
});
