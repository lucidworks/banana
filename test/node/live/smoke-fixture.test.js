'use strict';

// Checks on the fixture dashboard and on the render rules of the live smoke
// test. They need no browser and no Fusion.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const panels = require(path.resolve(__dirname, '..', '..', 'live', 'panels.js'));
const helpers = require('./helpers');

const rules = helpers.load('rules.js');

const TYPES = Array.from(new Set(panels.dashboardPanelTypes(panels.readFixture())));

function emptyPanel() {
  return { text: '', svg: 0, svgText: 0, canvas: 0, rows: 0, paths: 0, leaflet: 0, fills: {}, ticks: [], graphNodes: 0 };
}

// A summary in which every panel shows what its rule asks for.
function goodSummary() {
  const good = {
    column: { text: 'TIMEPICKER' },
    timepicker: { text: 'Relative | Absolute | Since' },
    query: { text: 'q' },
    filtering: { text: 'field : timestamp_tdt' },
    text: { text: 'Fixture dashboard' },
    hits: { text: '232.70 mean response' },
    ticker: { text: 'TICKER 0%' },
    histogram: { canvas: 2, text: '(240) count' },
    rangeFacet: { canvas: 2, text: '(240) count' },
    timeseries: { canvas: 2, ticks: [0, 100, 200, 450] },
    bar: { svg: 1, text: 'INFO' },
    terms: { canvas: 2, text: 'gateway (60)' },
    tagcloud: { svgText: 4 },
    map: { paths: 176, fills: { '#8c8c8c': 168, '#265656': 8 } },
    bettermap: { leaflet: 1, text: '30 30' },
    heatmap: { svg: 2, text: 'gateway' },
    scatterplot: { svg: 1, text: 'DEBUG' },
    table: { rows: 31 },
    fullTextSearch: { rows: 20 },
    facet: { text: 'INFO (120)' },
    docviewer: { text: '1 of 20 available Content' },
    multiseries: { paths: 4 },
    sunburst: { paths: 25 },
    sankey: { paths: 10, text: 'INFO' },
    force: { svg: 1, text: 'INFO' },
    boxplot: { svg: 1, svgText: 6 },
    significantTerms: { rows: 13 },
    graph: { canvas: 1, graphNodes: 5 }
  };
  const summary = { panels: {}, banners: [] };
  Object.keys(good).forEach(function (type) {
    summary.panels[type] = Object.assign(emptyPanel(), good[type]);
  });
  return summary;
}

test('the fixture uses every panel type the build offers, and nothing else', function () {
  assert.deepStrictEqual(TYPES.slice().sort(), panels.configuredPanelTypes().sort());
  assert.strictEqual(panels.configuredPanelTypes().length, 28);
});

test('every panel type has a render rule', function () {
  assert.deepStrictEqual(Object.keys(panels.RULES).sort(), TYPES.slice().sort());
});

test('a summary in which every panel rendered has no problems', function () {
  assert.deepStrictEqual(panels.problems(goodSummary(), TYPES), []);
});

test('a missing panel, an empty panel and an error banner are each a problem', function () {
  const summary = goodSummary();
  delete summary.panels.map;
  summary.panels.bar = Object.assign({}, summary.panels.bar, { text: '' });
  summary.banners.push('Oops! undefined field');
  const found = panels.problems(summary, TYPES);
  assert.deepStrictEqual(found.slice().sort(), ['bar: no bars for level_s', 'error banner: Oops! undefined field', 'map: not on the page']);
  assert.strictEqual(found.length, 3);
});

test('a panel type that the summary asks for but no rule covers is a problem', function () {
  assert.deepStrictEqual(panels.problems(goodSummary(), ['dashcontrol']), ['dashcontrol: not on the page']);
});

test('the fixture keeps the settings the guard needs', function () {
  const d = panels.readFixture();
  assert.strictEqual(d.solr.core_name, 'banana-it-logs');
  assert.strictEqual(d.solr.server, '/api/solr/');
  assert.strictEqual(d.solr.global_params, '');
  assert.strictEqual(d.index.interval, 'none');
  const all = [];
  d.rows.forEach(function (row) { row.panels.forEach(function (p) { all.push(p); }); });
  all.filter(function (p) { return p.type === 'table'; }).forEach(function (p) {
    assert.ok(!p.calcTopFieldValuesFromAllData);
  });
  const graph = all.filter(function (p) { return p.type === 'graph'; })[0];
  assert.strictEqual(graph.graph_collection, 'banana-it-logs');
});

test('the stream requests of the fixture panels pass the rule table', function () {
  const exprs = [
    'timeseries(banana-it-logs,q=*:*,field=timestamp_tdt,start=2023-12-30T00:00:00.000Z,end=2024-01-05T00:00:00.000Z,gap=+1HOUR,avg(response_time_d))',
    'significantTerms(banana-it-logs,q=*:*,fq=timestamp_tdt:[2023-12-30T00:00:00.000Z TO 2024-01-05T00:00:00.000Z],field=message_t,limit=10,minDocFreq=5,maxDocFreq=0.3,minTermLength=4)',
    'nodes(banana-it-logs,nodes(banana-it-logs, search(banana-it-logs, q="*:*", fl="host_s"  , rows=10),walk="host_s->host_s",trackTraversal="true",gather="level_s"),walk="node->host_s",scatter="leaves,branches",trackTraversal="true",gather="level_s")',
    'fetch(banana-it-logs, select(nodes(banana-it-logs,nodes(banana-it-logs, search(banana-it-logs, q="*:*", fl="host_s"  , rows=10),walk="host_s->host_s",trackTraversal="true",gather="level_s"),walk="node->host_s",scatter="leaves,branches",trackTraversal="true",gather="level_s"), node as host_s), fl="host_s", on="host_s")'
  ];
  const context = helpers.ctx({});
  exprs.forEach(function (expr) {
    ['stream', 'graph'].forEach(function (leaf) {
      const url = context.origin + '/api/solr/banana-it-logs/' + leaf + '?expr=' + encodeURIComponent(expr);
      const verdict = rules.classify({ method: 'GET', url: url, body: null }, context);
      assert.strictEqual(verdict.allow, true, JSON.stringify(verdict));
    });
  });
});

test('every rule rejects a panel that rendered but holds nothing', function () {
  TYPES.forEach(function (type) {
    const summary = { panels: {}, banners: [] };
    TYPES.forEach(function (t) { summary.panels[t] = emptyPanel(); });
    const found = panels.problems(summary, [type]);
    assert.strictEqual(found.length, 1, type + ' accepted an empty panel');
  });
});

function withPanel(type, change) {
  const summary = goodSummary();
  summary.panels[type] = Object.assign({}, summary.panels[type], change);
  return panels.problems(summary, [type]);
}

test('the map needs regions coloured by data, not only regions', function () {
  assert.deepStrictEqual(withPanel('map', { fills: { '#8c8c8c': 176 } }), ['map: fewer than 8 regions coloured by data']);
  assert.deepStrictEqual(withPanel('map', { fills: { '#8c8c8c': 170, '#265656': 6 } }), ['map: fewer than 8 regions coloured by data']);
});

test('the time series needs values on its axis, not only a canvas', function () {
  assert.deepStrictEqual(withPanel('timeseries', { ticks: [0, 0.2, 0.4, 1] }), ['timeseries: no series values on the axis']);
  assert.deepStrictEqual(withPanel('timeseries', { ticks: [] }), ['timeseries: no series values on the axis']);
});

test('the graph needs nodes, not only a canvas', function () {
  assert.deepStrictEqual(withPanel('graph', { graphNodes: 0 }), ['graph: no nodes']);
});

test('the ticker needs a number before the percent sign', function () {
  assert.deepStrictEqual(withPanel('ticker', { text: 'TICKER TICKER ?%' }), ['ticker: no numeric percentage']);
  assert.deepStrictEqual(withPanel('ticker', { text: 'TICKER TICKER 12.5%' }), []);
  assert.deepStrictEqual(withPanel('ticker', { text: 'TICKER TICKER -3%' }), []);
});
