'use strict';

// A link can carry a "server" URL parameter that names where the dashboard is loaded from. Anyone can
// make such a link, so a server Banana was not told about must not be fetched: the dashboard JSON it
// returns would be shown to the person who clicked. These specs drive the real dashboard service
// (Solr mode) with the parameter given as the route parameter.
describe('dashboard server parameter', function () {
  var config = require('config');
  var helpers = require('./helpers/injector');

  var saved;
  beforeEach(function () {
    saved = {
      USE_FUSION: config.USE_FUSION,
      solr: config.solr,
      banana_server: config.banana_server,
      banana_index: config.banana_index,
      allowed: config.allowed_dashboard_servers
    };
    config.USE_FUSION = false;
    config.solr = '/solr/';
    delete config.banana_server;
    config.banana_index = 'banana-int';
    config.allowed_dashboard_servers = [];
  });
  afterEach(function () {
    config.USE_FUSION = saved.USE_FUSION;
    config.solr = saved.solr;
    if (typeof saved.banana_server === 'undefined') {
      delete config.banana_server;
    } else {
      config.banana_server = saved.banana_server;
    }
    config.banana_index = saved.banana_index;
    config.allowed_dashboard_servers = saved.allowed;
  });

  var DOC = { response: { docs: [{ dashboard: '{"title": "loaded", "rows": []}' }] } };

  // Loads dashboard "d" with the given server parameter and returns the URLs that were requested.
  function load(routeParams) {
    var injector = helpers.createInjector({ $routeParams: routeParams });
    var $httpBackend = injector.get('$httpBackend');
    var requested = [];
    $httpBackend.whenGET(/./).respond(function (method, url) {
      requested.push(url);
      return [200, DOC];
    });
    var dashboard = injector.get('dashboard');
    dashboard.elasticsearch_load('dashboard', 'd');
    $httpBackend.flush();
    return { urls: requested, alerts: injector.get('alertSrv').list, current: dashboard.current };
  }

  var CONFIGURED = '/solr/banana-int/select?wt=json&q=title%3A%22d%22';

  var REJECTED = [
    'https://attacker/',
    'http://attacker.example/solr/',
    'HTTPS://attacker/',
    'HtTp://attacker/',
    '//attacker/',
    '///attacker/',
    '/\\attacker',
    '/\\/attacker',
    '\\\\attacker\\',
    '\\/attacker/',
    'https:attacker',
    'https:/attacker',
    'javascript:alert(1)',
    'data:text/plain,x',
    'attacker/solr/',
    ' /solr/',
    '\t//attacker/',
    '/\t/attacker/',
    '/\n/attacker/',
    '/\r/attacker/',
    '//attacker/solr/',
    '/solr/\\..\\attacker',
    // forms that Angular has already decoded from %2F%2Fattacker, %5Cattacker and the like
    decodeURIComponent('%2F%2Fattacker%2F'),
    decodeURIComponent('%2F%5Cattacker'),
    decodeURIComponent('https%3A%2F%2Fattacker%2F'),
    // a path that carries its own query or fragment would write the rest of the request
    '/solr/c/select?q=x&fl=y#',
    '/solr/c/select?q=*:*&rows=1&fl=dashboard:[value%20v=x]#',
    '/solr/c/x#',
    '/solr/c;x',
    '/solr/c?x',
    '/solr/c&x',
    '/solr/c#x',
    '/solr/c/select?q=x',
    '/solr/c&rows=1',
    '',
    true
  ];

  REJECTED.forEach(function (server) {
    it('does not fetch ' + JSON.stringify(server) + ' and warns', function () {
      var r = load({ server: server });
      expect(r.urls).toEqual([CONFIGURED]);
      expect(r.alerts.length).toBe(1);
      expect(r.alerts[0].severity).toBe('warning');
      expect(r.alerts[0].text).toContain('allowed_dashboard_servers');
    });
  });

  it('escapes the value in the warning', function () {
    var r = load({ server: 'https://x/"><img src=x onerror=alert(1)>' });
    expect(r.alerts[0].text).not.toContain('<img');
    expect(r.alerts[0].text).toContain('&lt;img');
  });

  it('does not match a lookalike of an allowed server', function () {
    config.allowed_dashboard_servers = ['https://good.example/solr/'];
    var r = load({ server: 'https://good.example/solr/@attacker/' });
    expect(r.urls).toEqual([CONFIGURED]);
    expect(r.alerts.length).toBe(1);
  });

  describe('accepts', function () {
    it('a same-origin path', function () {
      var r = load({ server: '/other/solr/' });
      expect(r.urls).toEqual(['/other/solr/banana-int/select?wt=json&q=title%3A%22d%22']);
      expect(r.alerts.length).toBe(0);
    });

    it('a path whose characters are still percent-encoded after decoding', function () {
      var r = load({ server: '/solr%2Fx/' });
      expect(r.urls[0]).toBe('/solr%2Fx/banana-int/select?wt=json&q=title%3A%22d%22');
      expect(r.alerts.length).toBe(0);
    });

    it('a path without a trailing slash, as 1.6.30 did', function () {
      var r = load({ server: '/solr' });
      expect(r.urls[0]).toBe('/solrbanana-int/select?wt=json&q=title%3A%22d%22');
      expect(r.alerts.length).toBe(0);
    });

    it('the server a saved link carries when banana_server is set', function () {
      config.banana_server = 'http://dashboards.example:8983/solr/';
      var r = load({ server: 'http://dashboards.example:8983/solr/' });
      expect(r.urls).toEqual(['http://dashboards.example:8983/solr/banana-int/select?wt=json&q=title%3A%22d%22']);
      expect(r.alerts.length).toBe(0);
    });

    it('the configured data server when it is an absolute URL', function () {
      config.solr = 'http://solr.example:8983/solr/';
      var r = load({ server: 'http://solr.example:8983/solr/' });
      expect(r.urls).toEqual(['http://solr.example:8983/solr/banana-int/select?wt=json&q=title%3A%22d%22']);
      expect(r.alerts.length).toBe(0);
    });

    it('a server listed in allowed_dashboard_servers', function () {
      config.allowed_dashboard_servers = ['https://good.example/solr/'];
      var r = load({ server: 'https://good.example/solr/' });
      expect(r.urls).toEqual(['https://good.example/solr/banana-int/select?wt=json&q=title%3A%22d%22']);
      expect(r.alerts.length).toBe(0);
    });
  });

  describe('without a server parameter', function () {
    it('uses the configured server (and not "undefined")', function () {
      var r = load({});
      expect(r.urls).toEqual([CONFIGURED]);
      expect(r.alerts.length).toBe(0);
    });

    it('uses banana_server when it is set', function () {
      config.banana_server = 'http://dashboards.example:8983/solr/';
      var r = load({});
      expect(r.urls).toEqual(['http://dashboards.example:8983/solr/banana-int/select?wt=json&q=title%3A%22d%22']);
    });
  });

  describe('with Fusion', function () {
    it('ignores the parameter and loads from the blob store without a warning', function () {
      config.USE_FUSION = true;
      var injector = helpers.createInjector({ $routeParams: { server: 'https://attacker/' } });
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.whenGET(/\/api\/session$/).respond(200, { user: { username: 'tester' } });
      $httpBackend.expectGET(/\/api\/blobs\/d$/).respond(200, [{ banana_dashboard_s: '{"title": "t", "rows": []}' }]);
      injector.get('dashboard').elasticsearch_load('dashboard', 'd');
      $httpBackend.flush();
      expect(injector.get('alertSrv').list.length).toBe(0);
    });
  });

  it('keeps allowed_dashboard_servers empty in the shipped config.js', function () {
    expect(saved.allowed).toEqual([]);
  });
});
