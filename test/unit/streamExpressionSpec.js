'use strict';

// The graph, significantTerms and timeseries panels send a streaming expression in the `expr`
// parameter of a GET request. These specs read that parameter back from the request the panel makes
// and check that it applies the dashboard's filters and time range, that nothing a user typed can
// end a quoted value or add a function, and that only read-only functions can appear.
describe('stream expression panels', function () {
  var angular = require('angular');
  var config = require('config');
  var helpers = require('./helpers/injector');
  var streamExpression = require('components/streamExpression');
  require('panels/graph/module');
  require('panels/significantTerms/module');
  require('panels/timeseries/module');

  var HOSTILE = 'a", b) ,update(x,y) , q="z';
  var PIPELINE = '/api/query-pipelines/_system/collections/';
  var DIRECT = '/api/solr/';

  describe('the expression helpers', function () {
    it('quotes a value and escapes only the double quote', function () {
      expect(streamExpression.quote('plain, (text) = 1')).toBe('"plain, (text) = 1"');
      expect(streamExpression.quote('say "hi"')).toBe('"say \\"hi\\""');
    });

    it('sends other backslashes unchanged, as Solr does not undo a doubled one', function () {
      expect(streamExpression.quote('foo\\:bar')).toBe('"foo\\:bar"');
      expect(streamExpression.quote('path:C\\\\temp')).toBe('"path:C\\\\temp"');
      // an even run of backslashes before a quote is fine: the quote is the escaped one
      expect(streamExpression.quote('a\\\\"b')).toBe('"a\\\\\\"b"');
      expect(streamExpression.quote('ends\\\\')).toBe('"ends\\\\"');
    });

    it('gives Solr back the value that was quoted (the parser removes the quotes and turns \\" into ")', function () {
      ['normal value', 'say "hi" twice "now"', 'foo\\:bar', 'a\\\\"b', 'x\\\\', 'a, b) , c(d', ''].forEach(function (v) {
        expect(streamExpression.unquote(streamExpression.quote(v))).toBe(v);
      });
    });

    it('trims the whitespace Solr trims, then checks the value, and keeps inner whitespace', function () {
      expect(streamExpression.quote('  lead')).toBe('"lead"');
      expect(streamExpression.quote('trail \t\n')).toBe('"trail"');
      expect(streamExpression.quote('in  ner\tspace')).toBe('"in  ner\tspace"');
      expect(streamExpression.quote('a\nb')).toBe('"a b"');
      expect(function () { streamExpression.quote('foo\\ '); }).toThrow();
      expect(streamExpression.unquote(streamExpression.quote('  lead and trail  '))).toBe('lead and trail');
    });

    it('refuses a value that cannot be sent exactly', function () {
      ['a\\"b', 'trailing\\', 'a\\\\\\"b', 'back`tick', '`'].forEach(function (v) {
        expect(function () { streamExpression.quote(v); }).toThrow();
      });
    });

    it('treats an empty query as match-all and folds line breaks into spaces', function () {
      expect(streamExpression.combine('', ['a:1'])).toBe('(*:*) AND (a:1)');
      expect(streamExpression.combine('  ', [])).toBe('*:*');
      expect(streamExpression.combine('a\n#b\r\nc', ['x:\n1'])).toBe('(a #b c) AND (x: 1)');
    });

    it('accepts ordinary collection and field names and refuses anything else', function () {
      expect(streamExpression.name('my-collection_1', 'collection')).toBe('my-collection_1');
      expect(streamExpression.name('a.b_s', 'field')).toBe('a.b_s');
      ['', 'a b', 'a,b', 'a)', 'a"b', 'a(b', undefined, null, 5].forEach(function (bad) {
        expect(function () { streamExpression.name(bad, 'field'); }).toThrow();
      });
    });

    it('accepts whole numbers only where a whole number is needed', function () {
      expect(streamExpression.integer('10', 'size')).toBe('10');
      expect(function () { streamExpression.integer('1.5', 'size'); }).toThrow();
      expect(function () { streamExpression.integer('1)', 'size'); }).toThrow();
      expect(function () { streamExpression.integer('', 'size'); }).toThrow();
      expect(streamExpression.number('0.3', 'frequency')).toBe('0.3');
      expect(function () { streamExpression.number('abc', 'frequency'); }).toThrow();
    });

    it('pairs a filter that only excludes with *:*', function () {
      expect(streamExpression.combine('a:1', [])).toBe('a:1');
      expect(streamExpression.combine('a:1', ['b:2', '-c:3'])).toBe('(a:1) AND (b:2) AND (*:* -c:3)');
    });

    it('accepts the read-only functions the panels use', function () {
      streamExpression.assertReadOnly('fetch(c, select(nodes(c, search(c, q="*:*", fl="id"), walk="a->b", gather="b"), node as id), fl="t", on="id")');
      streamExpression.assertReadOnly('significantTerms(c, q="*:*", field="f", limit="10")');
      streamExpression.assertReadOnly('timeseries(c, q="*:*", field="t", start="a", end="b", gap="+1DAY", count(*))');
    });

    it('refuses functions that write or run in the background, and anything but one expression', function () {
      ['update', 'commit', 'delete', 'daemon', 'executor', 'topic', 'random', 'jdbc', 'let'].forEach(function (fn) {
        expect(function () { streamExpression.assertReadOnly(fn + '(c, search(c, q="*:*"))'); }).toThrow();
        expect(function () { streamExpression.assertReadOnly('search(c, q="*:*", x=' + fn + '(c))'); }).toThrow();
      });
      expect(function () { streamExpression.assertReadOnly('search(c) update(c)'); }).toThrow();
      expect(function () { streamExpression.assertReadOnly('search(c)) , update(c'); }).toThrow();
      expect(function () { streamExpression.assertReadOnly('search(c, q="open)'); }).toThrow();
      // a function name inside a quoted value is only text
      streamExpression.assertReadOnly('search(c, q="update(x)")');
      // an unterminated quote, text after the closing parenthesis, and an escaped parenthesis
      expect(function () { streamExpression.assertReadOnly('search(c, q="x)'); }).toThrow();
      expect(function () { streamExpression.assertReadOnly('search(c)"'); }).toThrow();
      expect(function () { streamExpression.assertReadOnly('search(c) x'); }).toThrow();
      expect(function () { streamExpression.assertReadOnly('search(c, q=a\\)) , update(c'); }).toThrow();
      streamExpression.assertReadOnly('search(c, q="a \\" update(x) \\" b")');
    });

    it('says a pipeline refusal needs direct Solr access, and leaves other failures alone', function () {
      var refused = streamExpression.failureMessage(PIPELINE, { status: 500 }, 'The request failed (HTTP status 500)');
      expect(refused).toMatch(/^This panel requires direct Solr access\./);
      expect(refused).toContain('The request failed (HTTP status 500)');
      expect(streamExpression.failureMessage(DIRECT, { status: 500 }, 'The request failed (HTTP status 500)'))
        .toBe('The request failed (HTTP status 500)');
      expect(streamExpression.failureMessage(PIPELINE, { status: 403 }, 'The request failed (HTTP status 403)'))
        .toBe('The request failed (HTTP status 403)');
      expect(streamExpression.failureMessage(PIPELINE, { status: 0 }, 'Could not contact the server'))
        .toBe('Could not contact the server');
    });
  });

  describe('the services that feed them', function () {
    var injector, filterSrv, querySrv;

    beforeEach(function () {
      injector = helpers.createInjector({ dashboard: helpers.fakeDashboard() });
      filterSrv = injector.get('filterSrv');
      querySrv = injector.get('querySrv');
      filterSrv.init();
    });

    it('lists the filters as decoded text, the time range first, and leaves getSolrFq as it was', function () {
      filterSrv.set({ type: 'time', field: 'ts', from: 'NOW-1HOUR', to: 'NOW' });
      filterSrv.set({ type: 'terms', field: 'host', value: 'a, b)', mandate: 'must' });
      filterSrv.set({ type: 'terms', field: 'level', value: 'debug', mandate: 'mustNot' });
      filterSrv.set({ type: 'querystring', query: 'x:1 OR y:2', mandate: 'must' });
      expect(filterSrv.getSolrFqList()).toEqual([
        'ts:[NOW-1HOUR TO NOW]', 'host:"a, b)"', '-level:"debug"', 'x:1 OR y:2']);
      expect(filterSrv.getSolrFqList(true)).toEqual(['host:"a, b)"', '-level:"debug"', 'x:1 OR y:2']);
      expect(filterSrv.getSolrFq()).toBe(
        'fq=ts:[NOW-1HOUR%20TO%20NOW]&fq=host:"a%2C%20b)"&fq=-level:"debug"&fq=x%3A1%20OR%20y%3A2');
    });

    it('gives the query text without encoding or global parameters', function () {
      injector.get('dashboard').current.solr.global_params = '&wt=json&fq=secret:1';
      querySrv.set({ query: 'title:a b&c' }, 0);
      querySrv.set({ query: 'x:1' });
      expect(querySrv.getOPQueryText()).toBe('title:a b&c OR x:1');
    });
  });

  // Builds a panel controller on the real services, with a $httpBackend that records the requests.
  function fixture(name, server, settings) {
    config.USE_FUSION = true;
    var dashboard = helpers.fakeDashboard();
    dashboard.indices = ['logstash-2999.12.31'];
    dashboard.current.loader = {};
    dashboard.current.solr.server = server;
    dashboard.current.solr.core_name = 'logs';
    dashboard.current.solr.global_params = '&wt=json&fq=secret:1';
    dashboard.current.services.query = { list: {}, ids: [], idQueue: [] };
    var injector = helpers.createInjector({ dashboard: dashboard, fields: {} }, ['kibana.panels.' + name]);
    var $controller = injector.get('$controller');
    var dashScope = injector.get('$rootScope').$new();
    $controller('DashCtrl', { $scope: dashScope });
    var scope = dashScope.$new();
    scope.panel = angular.extend({ queries: { mode: 'all', ids: [], custom: '&expr=update(logs)' } }, settings);
    $controller(name, { $scope: scope });
    var filterSrv = injector.get('filterSrv');
    filterSrv.init();
    var querySrv = injector.get('querySrv');
    querySrv.init();
    querySrv.set({ query: HOSTILE }, 0);
    filterSrv.set({ type: 'time', field: 'ts', from: new Date('2024-01-01T00:00:00Z'), to: new Date('2024-01-02T00:00:00Z') });
    filterSrv.set({ type: 'terms', field: 'host', value: 'a", b)', mandate: 'must' });
    var f = {
      $httpBackend: injector.get('$httpBackend'),
      scope: scope,
      requests: [],
      injector: injector
    };
    return f;
  }

  var SETTINGS = {
    graph: { graph_collection: 'edges', join_field: 'src', from_field: 'dst', to_field: 'dst', label_field: 'name' },
    significantTerms: { field: 'term_s', size: 10, mindoc_freq: 5, maxdoc_freq: 0.3, minterm_len: 4 },
    timeseries: { metric: 'count', field: '*', interval: '1h', auto_int: false }
  };
  // An answer that ends each panel's processing early, so that only the request matters
  var STOP = {
    graph: { error: { msg: 'stop' } },
    significantTerms: { error: { msg: 'stop' } },
    timeseries: { 'result-set': { docs: [{ EXCEPTION: 'stop' }] } }
  };
  var HANDLERS = { graph: 'graph', significantTerms: 'stream', timeseries: 'stream' };

  // Runs get_data() against a server that answers with `answer`; returns the decoded expression of the
  // first request and the raw request URLs.
  function run(name, server, answer, settings) {
    var f = fixture(name, server, angular.extend({}, SETTINGS[name], settings));
    f.$httpBackend.whenGET(/.*/).respond(function (method, url) {
      f.requests.push(url);
      return answer;
    });
    f.scope.get_data();
    f.$httpBackend.flush();
    return f;
  }

  function exprOf(url) {
    var query = url.substring(url.indexOf('?') + 1);
    var params = query.split('&');
    expect(params.length).toBe(1);
    expect(params[0].indexOf('expr=')).toBe(0);
    return decodeURIComponent(params[0].substring(5));
  }

  Object.keys(SETTINGS).forEach(function (name) {
    describe('the ' + name + ' panel', function () {
      it('sends one quoted, read-only expression to the ' + HANDLERS[name] + ' handler', function () {
        var f = run(name, DIRECT, [200, STOP[name]]);
        var url = f.requests[0];
        expect(url).toMatch(new RegExp('^/api/solr/logs/' + HANDLERS[name] + '\\?'));
        var expr = exprOf(url);
        streamExpression.assertReadOnly(expr);

        // the query text stays inside one quoted value (a quote in it is escaped)
        expect(expr).toContain(streamExpression.quote(HOSTILE).replace(/^"|"$/g, ''));
        expect(expr.replace(/"(\\.|[^"\\])*"/g, '""')).not.toMatch(/update|wt=json|secret/);
      });

      it('applies the dashboard filters and the time range', function () {
        var f = run(name, DIRECT, [200, STOP[name]]);
        var expr = exprOf(f.requests[0]);
        expect(expr).toContain('host:\\"a\\", b)\\"');
        if (name === 'timeseries') {
          // the time range is in start and end, not in the query
          expect(expr).toContain('start="2024-01-01T00:00:00.000Z"');
          expect(expr).toContain('end="2024-01-02T00:00:00.000Z"');
          expect(expr).toContain('field="ts"');
          expect(expr).toContain('gap="+1HOUR"');
        } else {
          expect(expr).toContain('ts:[2024-01-01T00:00:00.000Z TO 2024-01-02T00:00:00.000Z]');
        }
      });

      it('keeps the global parameters and the custom parameters out of the request', function () {
        var f = run(name, DIRECT, [200, STOP[name]]);
        expect(f.requests[0]).not.toMatch(/secret|wt%3Djson|wt=json|%26expr|&expr/);
        expect(f.scope.panel.queries.query).not.toMatch(/secret/);
      });

      it('refuses a setting that is not a plain name, without sending a request', function () {
        var bad = { graph: { join_field: 'a", update(x' }, significantTerms: { field: 'f), update(x' },
          timeseries: { field: 'f), update(x' } }[name];
        var f = fixture(name, DIRECT, angular.extend({}, SETTINGS[name], bad));
        f.scope.get_data();
        f.$httpBackend.verifyNoOutstandingRequest();
        expect(f.scope.panelMeta.loading).toBe(false);
        expect(f.scope.panel.error).toMatch(/^Invalid /);
      });

      it('refuses a query that cannot be sent exactly, without sending a request', function () {
        ['a\\"b', 'back`tick'].forEach(function (bad) {
          var f = fixture(name, DIRECT, SETTINGS[name]);
          f.injector.get('querySrv').set({ query: bad }, 0);
          f.scope.get_data();
          f.$httpBackend.verifyNoOutstandingRequest();
          expect(f.scope.panelMeta.loading).toBe(false);
          expect(f.scope.panel.error).toMatch(/cannot be sent in a streaming expression/);
        });
      });

      it('clears the data and renders when an expression is refused, so no stale result stays', function () {
        if (name === 'graph') { return; }
        var f = fixture(name, DIRECT, angular.extend({}, SETTINGS[name], { field: 'f), update(x' }));
        var rendered = 0;
        f.scope.$on('render', function () { rendered++; });
        f.scope.data = [{ stale: true }];
        f.scope.get_data();
        expect(f.scope.panel.error).toMatch(/^Invalid /);
        expect(f.scope.data).toEqual([]);
        expect(rendered).toBe(1);
      });

      it('sends a backslash in a query as it is', function () {
        var f = fixture(name, DIRECT, SETTINGS[name]);
        f.injector.get('querySrv').set({ query: 'path:foo\\:bar' }, 0);
        f.$httpBackend.whenGET(/.*/).respond(function (method, url) {
          f.requests.push(url);
          return [200, STOP[name]];
        });
        f.scope.get_data();
        f.$httpBackend.flush();
        expect(exprOf(f.requests[0])).toContain('path:foo\\:bar');
        expect(exprOf(f.requests[0])).not.toContain('\\\\');
      });

      it('says it requires direct Solr access when a query pipeline refuses the request (HTTP 500)', function () {
        var f = run(name, PIPELINE, [500, { message: 'Request handler not allowed' }]);
        expect(f.requests[0]).toMatch(new RegExp('^/api/query-pipelines/_system/collections/logs/' + HANDLERS[name] + '\\?'));
        expect(f.scope.panelMeta.loading).toBe(false);
        expect(f.scope.panel.error).toMatch(/^This panel requires direct Solr access\./);
        expect(f.scope.panel.error).toContain('(The request failed (HTTP status 500))');
      });

      it('shows only the usual message when a direct request fails', function () {
        var f = run(name, DIRECT, [500, 'Internal Server Error']);
        expect(f.scope.panelMeta.loading).toBe(false);
        expect(f.scope.panel.error).toBe('The request failed (HTTP status 500)');
      });
    });
  });

  describe('the graph panel', function () {
    var GRAPHML = '<graphml><graph><node id="1"/><node id="2"/><edge source="1" target="2"/></graph></graphml>';

    function mount(f) {
      var $compile = f.injector.get('$compile');
      f.scope.row = { height: '200px' };
      var element = $compile('<graph></graph>')(f.scope);
      document.body.appendChild(element[0]);
      return element;
    }

    it('draws nothing and throws nothing when the request fails', function () {
      var f = fixture('graph', PIPELINE, SETTINGS.graph);
      var element = mount(f);
      f.$httpBackend.whenGET(/.*/).respond(500, 'Internal Server Error');
      f.scope.get_data();
      expect(function () { f.$httpBackend.flush(); }).not.toThrow();
      expect(f.scope.panel.error).toMatch(/^This panel requires direct Solr access\./);
      expect(f.scope.graphML).toBeUndefined();
      expect(element.find('canvas').length).toBe(0);
      element.remove();
    });

    it('draws nothing after a failure that follows a drawn graph', function () {
      var f = fixture('graph', DIRECT, SETTINGS.graph);
      var element = mount(f);
      var fail = false;
      f.$httpBackend.whenGET(/.*/).respond(function (method, url) {
        if (fail) {
          return [500, 'Internal Server Error'];
        }
        return /\/graph\?/.test(url) ? [200, GRAPHML] : [200, { 'result-set': { docs: [{ EOF: true }] } }];
      });
      f.scope.get_data();
      f.$httpBackend.flush();
      expect(element.find('canvas').length).toBeGreaterThan(0);

      fail = true;
      f.scope.get_data();
      expect(function () { f.$httpBackend.flush(); }).not.toThrow();
      expect(f.scope.panel.error).toBe('The request failed (HTTP status 500)');
      expect(element.find('canvas').length).toBe(0);
      element.remove();
    });
  });
});
