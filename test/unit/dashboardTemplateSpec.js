'use strict';

// A stored dashboard is shared: whoever can save one decides what every later viewer loads. Loading
// substitutes {{ARGS.name}} with the matching URL parameter and nothing else: no other text between
// double braces is evaluated. These specs drive the real dashboard service through file_load and
// the Fusion blob store load, with the URL parameters given as the route parameters.
describe('dashboard templates', function () {
  var config = require('config');
  var helpers = require('./helpers/injector');

  var savedUseFusion;
  beforeEach(function () {
    savedUseFusion = config.USE_FUSION;
    config.USE_FUSION = false;
    delete window.__pwned;
  });
  afterEach(function () {
    config.USE_FUSION = savedUseFusion;
    delete window.__pwned;
  });

  function fixture(routeParams) {
    var injector = helpers.createInjector({ $routeParams: routeParams || {} });
    var $httpBackend = injector.get('$httpBackend');
    // the dashboard service asks Fusion for the user name when it starts
    $httpBackend.whenGET(/\/api\/session$/).respond(200, { user: { username: 'tester' } });
    return { $httpBackend: $httpBackend, dashboard: injector.get('dashboard') };
  }

  // Loads a dashboard file whose text is given, and returns what the service made current.
  function loadFile(text, routeParams) {
    var f = fixture(routeParams);
    var result;
    f.$httpBackend.expectGET(/^app\/dashboards\/t\.json\?/).respond(200, text);
    f.dashboard.file_load('t.json').then(function (loaded) { result = loaded; });
    f.$httpBackend.flush();
    return { loaded: result, current: f.dashboard.current };
  }

  function dashboardText(title) {
    return '{"title": "' + title + '", "rows": []}';
  }

  describe('code in a stored dashboard', function () {
    it('is not run, and stays literal text', function () {
      var r = loadFile(dashboardText('before {{window.__pwned=1}} after'));
      expect(window.__pwned).toBeUndefined();
      expect(r.loaded).toBe(true);
      expect(r.current.title).toBe('before {{window.__pwned=1}} after');
    });

    it('is not run when it is a call or sits inside a longer expression', function () {
      var r = loadFile(dashboardText('{{ARGS.a}} {{(function(){window.__pwned=2})()}} {{ARGS.a.length}}'),
        { a: 'x' });
      expect(window.__pwned).toBeUndefined();
      expect(r.current.title).toBe('x {{(function(){window.__pwned=2})()}} {{ARGS.a.length}}');
    });

    it('is not run when the dashboard comes from the Fusion blob store', function () {
      config.USE_FUSION = true;
      var f = fixture();
      var stored = JSON.parse(dashboardText('blob {{window.__pwned=3}}'));
      f.$httpBackend.expectGET(/\/api\/blobs\/some-id$/).respond(200, [{ banana_dashboard_s: JSON.stringify(stored) }]);
      var result;
      f.dashboard.elasticsearch_load('dashboard', 'some-id').then(function (r) { result = r; });
      f.$httpBackend.flush();
      expect(window.__pwned).toBeUndefined();
      expect(result.data.title).toBe('blob {{window.__pwned=3}}');
    });

    it('loads when it is not a valid expression', function () {
      var r = loadFile(dashboardText('{{ this is ( not valid }} and {{ unclosed'));
      expect(r.loaded).toBe(true);
      expect(r.current.title).toBe('{{ this is ( not valid }} and {{ unclosed');
    });
  });

  describe('{{ARGS.name}}', function () {
    it('is replaced by the URL parameter', function () {
      var r = loadFile(dashboardText('Index {{ARGS.index}} and {{ ARGS.other }}'), { index: 'logs', other: 'x' });
      expect(r.current.title).toBe('Index logs and x');
    });

    it('passes a number when the placeholder sits outside a string, as before', function () {
      var r = loadFile('{"title": "t", "span": {{ARGS.n}}, "rows": []}', { n: '4' });
      expect(r.current.span).toBe(4);
    });

    it('cannot add keys from outside a string: a value with a quote there is not loaded', function () {
      // The text no longer parses, so the dashboard is not loaded (the load path raises the same
      // error it raises for any file that is not JSON). The point here is that no key is added.
      var f = fixture({ n: '4, "x": 1' });
      var loaded;
      f.$httpBackend.expectGET(/^app\/dashboards\/t\.json\?/)
        .respond(200, '{"title": "t", "span": {{ARGS.n}}, "rows": []}');
      f.dashboard.file_load('t.json').then(function (result) { loaded = result; });
      try { f.$httpBackend.flush(); } catch (e) { /* the parse failure surfaces as an error */ }
      expect(loaded).not.toBe(true);
      expect((f.dashboard.current || {}).x).toBeUndefined();
    });

    it('is replaced by an empty string when the parameter is not set', function () {
      var r = loadFile(dashboardText('[{{ARGS.missing}}]'), {});
      expect(r.current.title).toBe('[]');
    });

    it('keeps a value with a quote and a backslash inside its string', function () {
      var value = 'a"b\\c","rows":[1],"x":"';
      var r = loadFile(dashboardText('{{ARGS.q}}'), { q: value });
      expect(r.loaded).toBe(true);
      expect(r.current.title).toBe(value);
      expect(r.current.rows).toEqual([]);
    });

    it('does not read inherited properties of the parameters', function () {
      var r = loadFile(dashboardText('[{{ARGS.constructor}}]'), {});
      expect(r.current.title).toBe('[]');
    });
  });
});
