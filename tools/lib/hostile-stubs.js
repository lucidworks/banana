'use strict';

// Stubbed Solr and Fusion responses for tools/hostile.js, in which every string that a person could get into
// a document, a schema or a dashboard is replaced by a payload. Each payload calls window.__d3canary with a
// number, and `sources` says where that number was placed, so a failure names the place that leaked.
//
// Two payload styles, chosen per run:
//   markup: an element and an attribute break-out (`<img src=x onerror=...>` and `" onmouseover=...`)
//   url:    a script address (`javascript:...`), for the places that put a value into a link or an image
// The numbers are unique over the whole run.

const sources = [];

function makeHostile(style) {
  return function hostile(where) {
    const n = sources.push(where) - 1;
    const call = 'window.__d3canary(' + n + ')';
    return style === 'url'
      ? 'javascript:' + call + '//' + n
      : '<img src=x onerror=' + call + '>" onmouseover="' + call + '" x="' + n;
  };
}

function requestParams(route) {
  const params = new URLSearchParams(new URL(route.request().url()).search);
  const body = route.request().postData();
  if (body) { new URLSearchParams(body).forEach((value, key) => params.append(key, value)); }
  return params;
}

function plainField(value) { return value.replace(/^\{![^}]*\}/, '').trim(); }

const NORMAL_FIELDS = ['id', 'title_s', 'type_s', 'message_txt', 'timestamp_tdt', 'loc_p', 'count_i'];

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function createStubs(style) {
  const H = makeHostile(style);

  function docs() {
    return [1, 2, 3].map((n) => {
      const doc = {
        id: 'hostile-doc-' + n,
        title_s: H('doc ' + n + ' title_s'),
        type_s: H('doc ' + n + ' type_s'),
        message_txt: H('doc ' + n + ' message_txt'),
        timestamp_tdt: '2018-06-18T06:2' + n + ':00Z',
        loc_p: '40.' + n + ',-86.' + n,
        count_i: n,
        nested_s: [H('doc ' + n + ' nested_s a'), H('doc ' + n + ' nested_s b')],
        link_s: H('doc ' + n + ' link_s')
      };
      doc[H('doc ' + n + ' field name')] = H('doc ' + n + ' value of the odd field');
      return doc;
    });
  }

  function terms(where) {
    // the last term is a colour with a comment in it: a terms panel that uses field values as colours reads it
    return [H(where + ' term 1'), 3, H(where + ' term 2'), 2, H(where + ' term 3'), 1, 'red/*' + H(where + ' colour comment') + '*/', 1, 'var(--a,"' + H(where + ' colour var') + '")', 1, 'env(x,"' + H(where + ' colour env') + '")', 1];
  }

  function solrResponse(params) {
    const list = docs();
    const facetFields = { type_s: terms('facet type_s') };
    const facetRanges = {};
    const facetPivot = {};
    params.getAll('facet.field').forEach((f) => { facetFields[plainField(f)] = terms('facet ' + plainField(f)); });
    params.getAll('facet.range').forEach((f) => {
      facetRanges[plainField(f)] = {
        counts: ['2018-06-18T06:20:00Z', 1, '2018-06-18T06:21:00Z', 2, '2018-06-18T06:22:00Z', 3],
        gap: '+1MINUTE', start: '2018-06-18T06:20:00Z', end: '2018-06-18T06:23:00Z', between: 6, before: 0, after: 0
      };
    });
    params.getAll('facet.pivot').forEach((f) => {
      const fields = plainField(f).split(',');
      const second = fields[1] || fields[0];
      facetPivot[plainField(f)] = [
        { field: fields[0], value: H('pivot ' + f + ' top 1'), count: 3, pivot: [{ field: second, value: H('pivot ' + f + ' leaf 1'), count: 2 }, { field: second, value: H('pivot ' + f + ' leaf 2'), count: 1 }, { field: second, value: '3', count: 1 }, { field: second, value: '7', count: 2 }, { field: second, value: '11', count: 1 }] },
        { field: fields[0], value: H('pivot ' + f + ' top 2'), count: 2, pivot: [{ field: second, value: H('pivot ' + f + ' leaf 3'), count: 2 }] }
      ];
    });
    const highlighting = {};
    list.forEach((d) => {
      highlighting[d.id] = {
        title_s: [H('highlight title_s of ' + d.id) + ' <mark>hit</mark>'],
        message_txt: [H('highlight message_txt of ' + d.id) + ' @start-highlight@hit@end-highlight@ <em>hit</em>']
      };
    });
    return {
      responseHeader: { status: 0, QTime: 1, params: {} },
      response: { numFound: list.length, start: 0, docs: list },
      highlighting: highlighting,
      facet_counts: {
        facet_queries: {},
        facet_fields: facetFields,
        facet_dates: {},
        facet_ranges: facetRanges,
        facet_pivot: facetPivot
      },
      stats: { stats_fields: { count_i: { min: 1, max: 3, count: 3, missing: 0, sum: 6, mean: 2, stddev: 1 } } }
    };
  }

  function fields() {
    const list = NORMAL_FIELDS.map((name) => ({ name: name, type: 'string' }));
    list.push({ name: H('schema field name'), type: 'string' });
    return list;
  }

  function dynamicFields() {
    return [{ name: '*_s', type: 'string', indexFields: [{ name: H('dynamic field name 1') }, { name: H('dynamic field name 2') }] }];
  }

  function graphml() {
    return '<?xml version="1.0" encoding="UTF-8"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns">' +
      '<graph id="G" edgedefault="directed"><node id="n1"><data key="title">' + 'x' + '</data></node><node id="n2"/><node id="n3"/>' +
      '<edge source="n1" target="n2"/><edge source="n2" target="n3"/></graph></graphml>';
  }

  function timeseriesDocs(field) {
    const base = Math.floor(Date.now() / 60000) * 60000 - 10 * 60000;
    const out = [1, 2, 3].map((n) => {
      const doc = { 'count(*)': n };
      doc[field] = new Date(base + n * 60000).toISOString();
      return doc;
    });
    return out.concat([{ EOF: true }]);
  }

  // `dashboard` is the dashboard that the page loads; `unstubbed` collects requests nobody answered.
  function route(r, dashboard, unstubbed) {
    const url = new URL(r.request().url());
    const p = url.pathname;
    const method = r.request().method();
    if (/banana-hostile\.json$/.test(p)) { return json(r, dashboard); }
    if (/\/api\/session$/.test(p)) { return json(r, { user: { username: H('session user name') } }); }
    if (/\/schema\/fields$/.test(p)) { return json(r, fields()); }
    if (/\/schema\/dynamicfields$/.test(p)) { return json(r, dynamicFields()); }
    if (/\/schema\/uniquekey$/.test(p)) { return json(r, { uniqueKey: 'id' }); }
    if (/\/api\/collections$/.test(p)) { return json(r, [{ id: H('collection name 1') }, { id: H('collection name 2') }, { id: 'system_logs' }]); }
    if (/\/api\/blobs/.test(p) && method === 'GET') {
      return json(r, [1, 2].map((n) => ({ id: H('saved dashboard id ' + n), name: H('saved dashboard name ' + n), dashboard: dashboard })));
    }
    if (/\/api\/blobs/.test(p)) { return json(r, { id: H('blob id') }); }
    if (/api\.github\.com\/gists/.test(r.request().url())) { return json(r, { html_url: 'https://gist.example.test/' + H('gist address') }); }
    if (/\/graph$/.test(p)) { return r.fulfill({ status: 200, contentType: 'application/xml', body: graphml() }); }
    if (/\/stream$/.test(p) && /^timeseries\(/.test(requestParams(r).get('expr') || '')) {
      const field = /field="?([^,)"]+)/.exec(requestParams(r).get('expr'));
      return json(r, { 'result-set': { docs: timeseriesDocs(field ? field[1] : 'timestamp_tdt') } });
    }
    if (/\/stream$/.test(p)) {
      return json(r, { 'result-set': { docs: [{ id: 'n1', title_s: H('stream title 1') }, { id: 'n2', title_s: H('stream title 2') }, { EOF: true }] } });
    }
    if (/\/(select|query)$/.test(p) || /\/collections\/[^/]+$/.test(p)) {
      const params = requestParams(r);
      if (params.get('wt') === 'csv') { return r.fulfill({ status: 200, contentType: 'text/csv', body: 'count_i\n1\n2\n3\n' }); }
      return json(r, solrResponse(params));
    }
    unstubbed.push(method + ' ' + p);
    return json(r, {});
  }

  return { H: H, route: route };
}

module.exports = { createStubs, sources };
