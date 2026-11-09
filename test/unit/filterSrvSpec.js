'use strict';

describe('filterSrv', function () {
  var angular = require('angular');
  var helpers = require('./helpers/injector');
  var filterSrv;

  beforeEach(function () {
    filterSrv = helpers.createInjector({ dashboard: helpers.fakeDashboard() }).get('filterSrv');
    filterSrv.init();
  });

  it('starts with no filters', function () {
    expect(filterSrv.ids).toEqual([]);
  });

  it('adds a filter, makes it active and encodes its value', function () {
    var id = filterSrv.set({ type: 'terms', field: 'host', value: 'a b', mandate: 'must' });
    expect(id).toBe(0);
    expect(filterSrv.list[0]).toEqual(jasmine.objectContaining({ active: true, value: 'a%20b' }));
  });

  it('does not add the same filter twice, but allows a second time filter', function () {
    var terms = { type: 'terms', field: 'host', value: 'a', mandate: 'must' };
    expect(filterSrv.set(angular.copy(terms))).toBe(0);
    expect(filterSrv.set(angular.copy(terms))).toBe(false);

    var time = { type: 'time', field: 'ts', from: 'now-1h', to: 'now' };
    expect(filterSrv.set(angular.copy(time))).toBe(1);
    expect(filterSrv.set(angular.copy(time))).toBe(2);
  });

  it('refuses a filter without a type', function () {
    expect(filterSrv.set({ field: 'host' })).toBe(false);
  });

  it('builds the fq parameters for Solr', function () {
    filterSrv.set({ type: 'time', field: 'ts', from: 'NOW-1HOUR', to: 'NOW' });
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'must' });
    filterSrv.set({ type: 'terms', field: 'level', value: 'debug', mandate: 'mustNot' });
    expect(filterSrv.getSolrFq()).toBe('fq=ts:[NOW-1HOUR%20TO%20NOW]&fq=host:"a"&fq=-level:"debug"');
  });

  it('combines "either" filters with OR', function () {
    filterSrv.set({ type: 'time', field: 'ts', from: 'NOW-1HOUR', to: 'NOW' });
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'either' });
    filterSrv.set({ type: 'terms', field: 'host', value: 'b', mandate: 'either' });
    expect(filterSrv.getSolrFq(true)).toBe('&fq=(host:"a" OR host:"b")');
  });

  it('keeps "either" filters when there is no time filter', function () {
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'either' });
    filterSrv.set({ type: 'field', field: 'level', query: '"warn"', mandate: 'either' });
    expect(filterSrv.getSolrFq()).toBe('fq=(host:"a" OR level:%22warn%22)');
  });

  it('puts "either" filters after the other filters when there is no time filter', function () {
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'must' });
    filterSrv.set({ type: 'terms', field: 'host', value: 'b', mandate: 'either' });
    filterSrv.set({ type: 'terms', field: 'host', value: 'c', mandate: 'either' });
    expect(filterSrv.getSolrFq()).toBe('fq=host:"a"&fq=(host:"b" OR host:"c")');
  });

  it('strips only the leading separator of the result when there is no time filter', function () {
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'must' });
    filterSrv.set({ type: 'terms', field: 'level', value: 'debug', mandate: 'mustNot' });
    expect(filterSrv.getSolrFq()).toBe('fq=host:"a"&fq=-level:"debug"');
    expect(filterSrv.getSolrFq(false, ',')).toBe('fq=host:"a",fq=-level:"debug"');
  });

  it('uses the given separator for "either" filters without a time filter', function () {
    filterSrv.set({ type: 'terms', field: 'host', value: 'a', mandate: 'either' });
    expect(filterSrv.getSolrFq(false, ',')).toBe('fq=(host:"a")');
  });

  it('returns an empty string when there are no filters at all', function () {
    expect(filterSrv.getSolrFq()).toBe('');
  });

  it('reports the time field and range', function () {
    filterSrv.set({ type: 'time', field: 'ts', from: 'NOW-1HOUR', to: 'NOW' });
    expect(filterSrv.getTimeField()).toBe('ts');
    expect(filterSrv.getStartTime()).toBe('NOW-1HOUR');
    expect(filterSrv.getEndTime()).toBe('NOW');
  });
});
