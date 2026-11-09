'use strict';

describe('querySrv', function () {
  require('panels/query/module');
  var helpers = require('./helpers/injector');
  var dashboard, querySrv;

  beforeEach(function () {
    dashboard = helpers.fakeDashboard();
    querySrv = helpers.createInjector({ dashboard: dashboard }).get('querySrv');
  });

  it('starts with one match-all query', function () {
    expect(querySrv.ids).toEqual([0]);
    expect(querySrv.list[0].query).toBe('*:*');
  });

  it('adds a query with the next id and fills in the defaults', function () {
    var id = querySrv.set({ query: 'status:ok' });
    expect(id).toBe(1);
    expect(querySrv.list[1]).toEqual(jasmine.objectContaining({ query: 'status:ok', alias: '', pin: false }));
    expect(querySrv.ids).toEqual([0, 1]);
  });

  it('refuses to update an id that does not exist', function () {
    expect(querySrv.set({ query: 'x' }, 7)).toBe(false);
  });

  it('removes a query and reuses its id', function () {
    querySrv.set({ query: 'a' });
    expect(querySrv.remove(1)).toBe(true);
    expect(querySrv.ids).toEqual([0]);
    expect(querySrv.remove(1)).toBe(false);
    expect(querySrv.set({ query: 'b' })).toBe(1);
  });

  it('url-encodes the query it sends to Solr', function () {
    querySrv.set({ query: 'title:a b&c' }, 0);
    expect(querySrv.getQuery(0)).toBe('q=title%3Aa%20b%26c');
  });

  it('adds the global parameters of the dashboard', function () {
    dashboard.current.solr.global_params = '&df=text';
    expect(querySrv.getQuery(0)).toBe('q=*%3A*&df=text');
  });

  it('selects ids by mode', function () {
    querySrv.set({ query: 'a', pin: true });
    querySrv.set({ query: 'b' });
    expect(querySrv.idsByMode({ mode: 'all' })).toEqual([0, 1, 2]);
    expect(querySrv.idsByMode({ mode: 'pinned' })).toEqual([1]);
    expect(querySrv.idsByMode({ mode: 'unpinned' })).toEqual([0, 2]);
    expect(querySrv.idsByMode({ mode: 'selected', ids: [2] })).toEqual([2]);
  });

  describe('getOPQuery', function () {
    // Builds querySrv on the dashboard that ships as the blank starting point: it has no query panel,
    // so nothing ever sets the operator.
    var blankDashboard;
    function blankQuerySrv() {
      var blank = JSON.parse(JSON.stringify(require('../../src/app/dashboards/blank.json')));
      blank.solr = { server: 'http://solr.example/solr/', core_name: 'logs' };
      blankDashboard = { current: blank };
      var srv = helpers.createInjector({ dashboard: blankDashboard }).get('querySrv');
      srv.init();
      return srv;
    }

    it('joins the queries with OR when no query panel set an operator', function () {
      var srv = blankQuerySrv();
      expect(srv.operator).toBeUndefined();
      srv.set({ query: 'status:ok' });
      expect(srv.getOPQuery()).toBe('q=* OR status%3Aok');
    });

    it('does not append the operator to a single query', function () {
      var srv = blankQuerySrv();
      expect(srv.getOPQuery()).toBe('q=*');
      expect(srv.getOPQuery()).not.toContain('undefi');
    });

    it('uses the operator of the query panel', function () {
      var srv = blankQuerySrv();
      srv.set({ query: 'a' });
      srv.set({ query: 'b' });
      srv.operator = 'AND';
      expect(srv.getOPQuery()).toBe('q=* AND a AND b');
    });

    it('returns only the global parameters when there are no queries', function () {
      var srv = blankQuerySrv();
      srv.list = {};
      expect(srv.getOPQuery()).toBe('');
      srv.operator = 'AND';
      expect(srv.getOPQuery()).toBe('');
      blankDashboard.current.solr.global_params = '&df=text';
      expect(srv.getOPQuery()).toBe('&df=text');
    });

    describe('across dashboards', function () {
      function twoDashboards() {
        var current = JSON.parse(JSON.stringify(require('../../src/app/dashboards/blank.json')));
        current.solr = { server: 'http://solr.example/solr/', core_name: 'logs' };
        current.services.query.list = {
          0: { query: 'x', id: 0 },
          1: { query: 'y', id: 1 }
        };
        current.services.query.ids = [0, 1];
        var dashboard = { current: current };
        var injector = helpers.createInjector({ dashboard: dashboard }, ['kibana.panels.query']);
        return { dashboard: dashboard, injector: injector, querySrv: injector.get('querySrv') };
      }

      function nextDashboard(dashboard) {
        var next = JSON.parse(JSON.stringify(dashboard.current));
        next.services.query = { idQueue: [], list: { 0: { query: 'p', id: 0 }, 1: { query: 'q', id: 1 } }, ids: [0, 1] };
        dashboard.current = next;
      }

      it('forgets the operator of the previous dashboard when a dashboard without a query panel loads', function () {
        var f = twoDashboards();
        f.querySrv.init();
        f.querySrv.operator = 'AND';
        expect(f.querySrv.getOPQuery()).toBe('q=x AND y');

        nextDashboard(f.dashboard);
        f.querySrv.init();
        expect(f.querySrv.getOPQuery()).toBe('q=p OR q');
      });

      it('uses the operator of a query panel that starts after the dashboard loaded', function () {
        var f = twoDashboards();
        f.querySrv.init();
        f.querySrv.operator = 'OR';

        nextDashboard(f.dashboard);
        f.querySrv.init();
        var scope = f.injector.get('$rootScope').$new();
        scope.panel = { operator: 'AND' };
        f.injector.get('$controller')('query', { $scope: scope });
        scope.init();
        expect(f.querySrv.getOPQuery()).toBe('q=p AND q');
      });
    });
  });
});
