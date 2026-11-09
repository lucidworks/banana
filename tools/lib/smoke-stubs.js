'use strict';

// Stubbed Solr and Fusion responses, and the dashboard, for tools/smoke.js. The responses are synthetic:
// they only have to be well formed enough for every panel to draw without errors.

const DOCS = [1, 2, 3].map((n) => ({
  id: 'smoke-doc-' + n,
  title_s: 'smoke-doc-' + n,
  type_s: 'java',
  message_txt: 'smoke message ' + n,
  timestamp_tdt: '2018-06-18T06:2' + n + ':00Z',
  loc_p: '40.' + n + ',-86.' + n,
  count_i: n
}));

const FIELDS = [
  { name: 'id', type: 'string' },
  { name: 'title_s', type: 'string' },
  { name: 'type_s', type: 'string' },
  { name: 'message_txt', type: 'text_general' },
  { name: 'timestamp_tdt', type: 'tdate' },
  { name: 'loc_p', type: 'location' },
  { name: 'count_i', type: 'int' }
];

const GRAPHML = '<?xml version="1.0" encoding="UTF-8"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns">' +
  '<graph id="G" edgedefault="directed"><node id="n1"/><node id="n2"/><node id="n3"/>' +
  '<edge source="n1" target="n2"/><edge source="n2" target="n3"/></graph></graphml>';

// term, count pairs in the flat form Solr uses for facet_fields
const TERMS = ['java', 3, 'python', 2, 'US', 2, 'FR', 1];

// Solr searches arrive as a form-encoded body (or a query string). The stub answers every facet that the
// request asks for, so that each panel finds the shape it expects.
function requestParams(route) {
  const params = new URLSearchParams(new URL(route.request().url()).search);
  const body = route.request().postData();
  if (body) { new URLSearchParams(body).forEach((value, key) => params.append(key, value)); }
  return params;
}

function plainField(value) { return value.replace(/^\{![^}]*\}/, '').trim(); }

function solrResponse(params) {
  const facetFields = {};
  const facetRanges = {};
  const facetPivot = {};
  params.getAll('facet.field').forEach((f) => { facetFields[plainField(f)] = TERMS; });
  params.getAll('facet.range').forEach((f) => {
    facetRanges[plainField(f)] = {
      counts: ['2018-06-18T06:20:00Z', 1, '2018-06-18T06:21:00Z', 2, '2018-06-18T06:22:00Z', 3],
      gap: '+1MINUTE', start: '2018-06-18T06:20:00Z', end: '2018-06-18T06:23:00Z', between: 6, before: 0, after: 0
    };
  });
  params.getAll('facet.pivot').forEach((f) => {
    const fields = plainField(f).split(',');
    // the values of a numeric field are numbers, as Solr answers them (the box plot panel needs numbers)
    const numeric = /_i$/.test(fields[1] || '');
    const v = (text, n) => (numeric ? n : text);
    facetPivot[plainField(f)] = [
      { field: fields[0], value: 'java', count: 3, pivot: [{ field: fields[1] || fields[0], value: v('a', 1), count: 2 }, { field: fields[1] || fields[0], value: v('b', 4), count: 1 }] },
      { field: fields[0], value: 'python', count: 2, pivot: [{ field: fields[1] || fields[0], value: v('a', 2), count: 2 }] }
    ];
  });
  return {
    responseHeader: { status: 0, QTime: 1, params: {} },
    response: { numFound: DOCS.length, start: 0, docs: DOCS },
    highlighting: DOCS.reduce((all, d) => { all[d.id] = {}; return all; }, {}),
    facet_counts: {
      facet_queries: {},
      facet_fields: Object.assign({ type_s: TERMS }, facetFields),
      facet_dates: {},
      facet_ranges: facetRanges,
      facet_pivot: facetPivot
    },
    stats: { stats_fields: { count_i: { min: 1, max: 3, count: 3, missing: 0, sum: 6, mean: 2, stddev: 1 } } }
  };
}

function buildDashboard(panels) {
  const options = {
    text: { mode: 'markdown', content: '**smoke-markdown**' },
    terms: { field: 'type_s', chart: 'pie' },
    bar: { field: 'type_s' },
    // the facet panel's accordion is a Bootstrap collapse, which the click-through check opens
    facet: { fields: ['type_s'] },
    map: { field: 'type_s', map: 'world' },
    table: { fields: ['id', 'title_s'] },
    // the three charts that stack: percent stacking is switched on, so the plugin that does it has to be in the bundle
    histogram: { time_field: 'timestamp_tdt', stack: true, percentage: true },
    timeseries: { time_field: 'timestamp_tdt', metric: 'count', field: '*', stack: true, percentage: true },
    bettermap: { field: 'loc_p', tooltip: 'title_s' },
    graph: { label_field: 'title_s', join_field: 'id', from_field: 'id', to_field: 'id', graph_collection: 'system_logs' },
    significantTerms: { field: 'type_s' },
    sunburst: { facet_pivot_strings: ['type_s', 'title_s'] },
    sankey: { facet_pivot_strings: ['type_s', 'title_s'] },
    force: { facet_pivot_strings: ['type_s', 'title_s'] },
    boxplot: { facet_pivot_strings: ['type_s', 'count_i'] },
    rangeFacet: { range_field: 'count_i', stack: true, percentage: true },
    ticker: { time_field: 'timestamp_tdt' },
    scatterplot: { xaxis: 'count_i', yaxis: 'count_i' },
    // the multiseries chart plots the numbers of `fl` against the time field, which gives it axes to draw
    multiseries: { field: 'timestamp_tdt', fl: 'count_i' },
    // the heatmap needs a row and a column field to draw its labels, grid and ticks
    heatmap: { row_field: 'type_s', col_field: 'title_s' }
  };
  const rows = panels.map((type) => ({
    title: type,
    height: '200px',
    editable: true,
    collapse: false,
    collapsable: true,
    panels: [Object.assign({ type: type, span: 12, title: type, editable: true, error: false }, options[type] || {})]
  }));
  return {
    title: 'Smoke',
    services: {
      query: { idQueue: [1], list: { 0: { query: '*', alias: '', color: '#7EB26D', id: 0, pin: false, type: 'lucene' } }, ids: [0] },
      filter: {
        idQueue: [1],
        list: { 0: { from: 'NOW/HOUR-1HOUR', to: 'NOW/HOUR%2B1HOUR', field: 'timestamp_tdt', type: 'time', mandate: 'must', active: true, alias: '', id: 0 } },
        ids: [0]
      }
    },
    editable: true,
    failover: false,
    index: { interval: 'none', pattern: '[logstash-]YYYY.MM.DD', default: 'NO_TIME_FILTER_OR_INDEX_PATTERN_NOT_MATCHED' },
    style: 'light',
    panel_hints: false,
    loader: { save_gist: false, save_elasticsearch: true, save_local: true, save_default: true, save_temp: true, save_temp_ttl_enable: true, save_temp_ttl: '30d', load_gist: true, load_elasticsearch: true, load_elasticsearch_size: 20, load_local: true, hide: false, dropdown_collections: false, save_as_public: false },
    solr: { server: '/api/query-pipelines/_system/collections/', core_name: 'system_logs', core_list: [], global_params: '' },
    rows: rows
  };
}

// What each charting panel must have drawn once its data arrives: [panel type, CSS selector inside the panel].
// These are the panels that load extra scripts on demand (flot pie, jVectorMap data, Leaflet plugins) or draw with d3, vis or flot.
const DRAWN = [
  ['map', '.jvectormap-container'],
  ['bettermap', '.leaflet-container'],
  ['terms', 'canvas'],
  ['histogram', 'canvas'],
  ['timeseries', 'canvas'],
  ['rangeFacet', 'canvas'],
  ['graph', '.vis-network canvas'],
  ['tagcloud', 'svg text'],
  ['heatmap', 'svg'],
  ['sankey', 'svg'],
  ['sunburst', 'svg'],
  ['force', 'svg'],
  ['boxplot', 'svg .boxplot-group'],
  ['bar', 'svg'],
  ['scatterplot', 'svg'],
  ['multiseries', 'svg .x.axis .tick text']
];

// The panels whose Flot chart is percent-stacked in the smoke dashboard (see buildDashboard). Flot keeps its plot
// object on the element that holds the canvas, and the percent-stacking plugin leaves `percents` on every series.
const PERCENT_STACKED = ['histogram', 'timeseries', 'rangeFacet'];

// A timeseries streaming expression answers with one document per time bucket, then an EOF marker.
function timeseriesDocs(field) {
  const base = Math.floor(Date.now() / 60000) * 60000 - 10 * 60000;
  const docs = [1, 2, 3].map((n) => {
    const doc = { 'count(*)': n };
    doc[field] = new Date(base + n * 60000).toISOString();
    return doc;
  });
  return docs.concat([{ EOF: true }]);
}

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function stubRoute(route, dashboard) {
  const url = new URL(route.request().url());
  const p = url.pathname;
  if (/banana-smoke\.json$/.test(p)) { return json(route, dashboard); }
  if (/\/api\/session$/.test(p)) { return json(route, { user: { username: 'smoke' } }); }
  if (/\/schema\/fields$/.test(p)) { return json(route, FIELDS); }
  if (/\/schema\/dynamicfields$/.test(p)) { return json(route, []); }
  if (/\/schema\/uniquekey$/.test(p)) { return json(route, { uniqueKey: 'id' }); }
  if (/\/graph$/.test(p)) { return route.fulfill({ status: 200, contentType: 'application/xml', body: GRAPHML }); }
  if (/\/stream$/.test(p) && /^timeseries\(/.test(requestParams(route).get('expr') || '')) {
    const field = /field="?([^,)"]+)/.exec(requestParams(route).get('expr'));
    return json(route, { 'result-set': { docs: timeseriesDocs(field ? field[1] : 'timestamp_tdt') } });
  }
  if (/\/stream$/.test(p)) { return json(route, { 'result-set': { docs: [{ id: 'n1', title_s: 'Node One' }, { id: 'n2', title_s: 'Node Two' }, { EOF: true }] } }); }
  if (/\/(select|query)$/.test(p) || /\/collections\/[^/]+$/.test(p)) {
    const params = requestParams(route);
    if (params.get('wt') === 'csv') { return route.fulfill({ status: 200, contentType: 'text/csv', body: 'count_i\n1\n2\n3\n' }); }
    return json(route, solrResponse(params));
  }
  if (process.env.SMOKE_DEBUG) { console.log('unstubbed: ' + route.request().method() + ' ' + p); }
  return json(route, {});
}

module.exports = { buildDashboard, stubRoute, DRAWN, PERCENT_STACKED };
