#!/usr/bin/env node
'use strict';

/*
 * Turns a raw recording (tools/fixtures/record.js) into the committed fixtures under test/fixtures,
 * and derives the fixtures that no recording could give.
 *
 *   FUSION_URL=... FUSION_USER=... node tools/fixtures/scrub.js <raw.json> <fixtures dir>
 *
 * The scrub keeps the shape of every response and replaces what identifies the system or a person:
 *   - every host with localhost: the host of every URL (also percent-encoded or scheme-relative), every dotted name
 *     with a port, every hyphenated single-label name with a port, every stand-alone IPv4 address (with 127.0.0.1;
 *     a version number such as v11.0.20.1 is left as it is, and the check then flags it for a person to decide), and
 *     the Fusion host (read from FUSION_URL) wherever it appears
 *   - the user name (FUSION_USER) with a placeholder
 *   - every UUID (session, user and role ids among them) with an all-zero placeholder
 *   - the run id of the recording's own dashboard with a fixed one, and trace and request ids with fixed text
 *   - the collection and blob lists with the entries whose names start with banana-it (the instance is shared:
 *     the other names are not ours to publish)
 * Cookies, authorization and every response header but the content type were never kept by the recorder.
 * The result is then run through the scrub check (tools/fixtures/check.js), and the command fails when it finds anything.
 *
 * Each fixture says where it comes from in `source`:
 *   recorded         the response of a Fusion 5.9.16 gateway to the request in `recordedRequest`
 *   recorded-solr    a Solr response shape, recorded through Fusion's Solr proxy; it is not the answer of a
 *                    standalone Solr
 *   derived          built from the shape that Solr documents or from a recorded response, as `note` says;
 *                    nothing here was observed on a server
 */

const fs = require('node:fs');
const path = require('node:path');
const check = require('./check');

const FIXED_RUN = '000000000000';
const COLLECTION = 'banana-it-logs';

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns a function that scrubs one string.
function stringScrubber(env) {
  const rules = [];
  if (env.host) {
    rules.push([new RegExp(escapeRegExp(env.host), 'gi'), 'localhost']);
  }
  if (env.password) {
    rules.push([new RegExp(escapeRegExp(env.password), 'g'), 'fixture-password']);
  }
  if (env.apiKey) {
    rules.push([new RegExp(escapeRegExp(env.apiKey), 'g'), 'fixture-api-key']);
  }
  rules.push(
    [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, check.ID_PLACEHOLDER],
    [/\bbanana-it-[0-9a-f]{12}-([1-9][0-9]*)/g, 'banana-it-' + FIXED_RUN + '-$1'],
    // the sample documents name their hosts under a reserved test domain
    [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.example\.test\b/g, 'localhost'],
    // hosts of every other URL
    [/\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\/\s"'?#\\@]*@)?(?!localhost\b|127\.0\.0\.1\b)[^\/\s"'?#\\:]+(:\d+)?/gi, '$1localhost$2'],
    // the same URL percent-encoded, and a scheme-relative one
    [/\b([a-z][a-z0-9+.-]*%3A%2F%2F)(?!localhost\b)[A-Za-z0-9.-]+/gi, '$1localhost'],
    [/(^|[\s"'=(,])\/\/(?!localhost\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '$1//localhost'],
    // hosts with no scheme: a dotted name with a port, and an IPv4 literal
    [/(?<![A-Za-z0-9.-])(?![0-9.]+:)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+:([0-9]{2,5})(?![0-9])/g, 'localhost:$1'],
    [/(?<![A-Za-z0-9._-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+:([0-9]{2,5})(?![0-9])/g, (m) => (/^banana-it-/.test(m) ? m : 'localhost:' + m.split(':')[1])],
    // an address only when it stands alone (not part of a version such as v11.0.20.1 or 11.0.20.1-x) and every part is 0-255;
    // anything else is left for the check to flag, so that a person decides
    [/(?<![0-9A-Za-z.-])(?:(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})\.){3}(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?![0-9A-Za-z-]|\.[0-9A-Za-z])/g, '127.0.0.1']
  );
  const userRule = env.user
    // as a whole token only: the name is also the start of object names such as the ids of the test dashboards
    ? [new RegExp('(^|[^A-Za-z0-9_-])' + escapeRegExp(env.user) + '(?=$|[^A-Za-z0-9_-])', 'g'), '$1' + check.USER_PLACEHOLDER]
    : null;
  return function (text) {
    let out = rules.reduce(function (t, r) { return t.replace(r[0], r[1]); }, text);
    if (userRule) {
      // the fixed vocabulary of the blob resource type is not a user name, even where the two coincide
      const kept = [];
      out = out.replace(check.VOCABULARY, function (m) { kept.push(m); return '\u0000' + (kept.length - 1) + '\u0000'; });
      out = out.replace(userRule[0], userRule[1]);
      out = out.replace(/\u0000(\d+)\u0000/g, function (m, i) { return kept[Number(i)]; });
    }
    return out;
  };
}

function scrubValue(value, scrub, key) {
  if (typeof value === 'string') {
    if (/^(traceId|requestId)$/.test(key || '')) {
      return 'fixture-' + key;
    }
    if (key === 'resourceType') {
      // the value of the blob resource type is application vocabulary, whatever the user name is
      return value;
    }
    if (/^(userId|createdBy|sessionId)$/.test(key || '') && value !== '') {
      return check.ID_PLACEHOLDER;
    }
    // a string that holds JSON (a saved dashboard) is scrubbed as text, which reaches what is inside it
    return scrub(value);
  }
  if (Array.isArray(value)) {
    return value.map(function (v) { return scrubValue(v, scrub, key); });
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (k) {
      out[scrub(k)] = scrubValue(value[k], scrub, k);
    });
    return out;
  }
  return value;
}

function parseBody(text) {
  if (text === '') {
    return '';
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function pick(exchanges, label, method, nth) {
  const hits = exchanges.filter(function (e) {
    return e.label === label && (!method || e.request.method === method);
  });
  const hit = hits[nth || 0];
  if (!hit) {
    throw new Error('the recording has no ' + (method || '') + ' exchange labelled ' + label);
  }
  return hit;
}

function fixture(source, exchange, scrub, extra) {
  const request = { method: exchange.request.method, path: exchange.request.path };
  if (exchange.request.contentType) { request.contentType = exchange.request.contentType; }
  if (exchange.request.body !== null && exchange.request.body !== undefined) { request.body = exchange.request.body; }
  const out = Object.assign({
    source: source,
    fusionVersion: '5.9.16',
    recordedRequest: request,
    response: {
      status: exchange.response.status,
      contentType: exchange.response.contentType,
      body: parseBody(exchange.response.body)
    }
  }, extra || {});
  return scrubValue(out, scrub);
}

function derived(note, status, body, extra) {
  return Object.assign({ source: 'derived', note: note, response: { status: status, contentType: 'application/json', body: body } }, extra || {});
}

function build(raw, env) {
  const scrub = stringScrubber(env);
  const ex = raw.exchanges;
  const out = {};

  // Fusion
  out['fusion-5.9.16/session.json'] = fixture('recorded', pick(ex, 'session', 'GET'), scrub);
  out['fusion-5.9.16/session-unauthenticated.json'] = fixture('recorded', pick(ex, 'session-unauthenticated', 'GET', 0), scrub);
  const collections = pick(ex, 'collections', 'GET');
  out['fusion-5.9.16/collections.json'] = (function () {
    const f = fixture('recorded', collections, scrub, { note: 'Only the collections whose names start with banana-it are kept; the instance is shared.' });
    f.response.body = f.response.body.filter(function (c) { return /^banana-it-/.test(c.id); });
    return f;
  }());
  out['fusion-5.9.16/schema-fields.json'] = fixture('recorded', pick(ex, 'schema-fields', 'GET'), scrub);
  out['fusion-5.9.16/schema-dynamicfields.json'] = fixture('recorded', pick(ex, 'schema-dynamicfields', 'GET'), scrub);
  out['fusion-5.9.16/schema-fields-missing.json'] = fixture('recorded', pick(ex, 'schema-fields-missing', 'GET'), scrub);
  out['fusion-5.9.16/schema-dynamicfields-missing.json'] = fixture('recorded', pick(ex, 'schema-dynamicfields-missing', 'GET'), scrub);
  out['fusion-5.9.16/select-top-values.json'] = fixture('recorded', pick(ex, 'select-top-values', 'POST'), scrub, {
    note: 'Banana sends this as a GET with the same parameters; the guarded client has no GET select, so it was recorded as the form POST.'
  });
  out['fusion-5.9.16/select-top-values-with-fq.json'] = fixture('recorded', pick(ex, 'select-top-values-with-fq', 'POST'), scrub, {
    note: 'Banana sends this as a GET with the same parameters; the guarded client has no GET select, so it was recorded as the form POST.'
  });
  out['fusion-5.9.16/select-rows.json'] = fixture('recorded', pick(ex, 'select-rows', 'POST'), scrub);
  out['fusion-5.9.16/select-undefined-field.json'] = fixture('recorded', pick(ex, 'select-undefined-field', 'POST'), scrub, {
    note: 'The request is the one kbnIndex sends; the collection has no event_timestamp field.'
  });

  // The range facet that kbnIndex asks for: Banana's request names the field event_timestamp and sends facet.mincount=1,
  // and the recording asked for timestamp_tdt without the mincount (the guarded client does not send it).
  const range = pick(ex, 'select-range-facet', 'POST');
  const rangeBody = JSON.parse(range.response.body);
  const counts = rangeBody.facet_counts.facet_ranges.timestamp_tdt.counts;
  const kept = [];
  for (let i = 0; i < counts.length; i += 2) {
    if (counts[i + 1] >= 1) { kept.push(counts[i], counts[i + 1]); }
  }
  rangeBody.facet_counts.facet_ranges = { event_timestamp: Object.assign({}, rangeBody.facet_counts.facet_ranges.timestamp_tdt, { counts: kept }) };
  out['fusion-5.9.16/select-range-facet.json'] = scrubValue(derived(
    'Derived from a recorded response: the facet is renamed from timestamp_tdt to event_timestamp (the field kbnIndex asks for) and the days with a count of 0 are dropped, which is what facet.mincount=1 does.',
    range.response.status, rangeBody, {
      fusionVersion: '5.9.16',
      derivedFrom: 'the response to recordedRequest',
      recordedRequest: { method: range.request.method, path: range.request.path, contentType: range.request.contentType, body: range.request.body }
    }), scrub);

  out['fusion-5.9.16/blob-read-absent.json'] = fixture('recorded', pick(ex, 'blob-read-absent', 'GET'), scrub);
  out['fusion-5.9.16/blob-save.json'] = fixture('recorded', pick(ex, 'blob-save', 'PUT'), scrub);
  out['fusion-5.9.16/blob-read.json'] = fixture('recorded', pick(ex, 'blob-read', 'GET'), scrub);
  out['fusion-5.9.16/blob-delete.json'] = fixture('recorded', pick(ex, 'blob-delete', 'DELETE'), scrub);
  out['fusion-5.9.16/blob-read-after-delete.json'] = fixture('recorded', pick(ex, 'blob-delete', 'GET'), scrub);
  const list = fixture('recorded', pick(ex, 'blob-list', 'GET'), scrub, { note: 'Only the blobs whose ids start with banana-it are kept; the instance is shared.' });
  list.response.body = list.response.body.filter(function (b) { return /^banana-it-/.test(b.id); });
  out['fusion-5.9.16/blob-list.json'] = list;

  // Solr shapes
  const proxySchema = fixture('recorded-solr', pick(ex, 'solr-proxy-schema-fields', 'GET'), scrub, {
    note: 'The Solr schema API shape, as Fusion\'s Solr proxy returns it. It is not the answer of a standalone Solr.'
  });
  out['solr-shapes/schema-fields.json'] = proxySchema;
  out['solr-shapes/select-top-values.json'] = fixture('recorded-solr', pick(ex, 'solr-proxy-select-top-values', 'POST'), scrub, {
    note: 'The Solr select shape, as Fusion\'s Solr proxy returns it, for a request that Banana sends as a GET. It is not the answer of a standalone Solr.'
  });
  const luke = { responseHeader: { status: 0, QTime: 1 }, index: { numDocs: 240 }, fields: {} };
  proxySchema.response.body.fields.forEach(function (f) {
    luke.fields[f.name] = { type: f.type, schema: 'I-S-----------' };
  });
  out['solr-shapes/luke.json'] = derived(
    'Derived from the recorded schema fields: the Luke handler documents this shape (fields keyed by name, each with a type and a schema string). The schema flags are a stand-in. Not observed on a server.',
    200, luke, { derivedFrom: 'solr-shapes/schema-fields (recorded through the Solr proxy)' });
  out['solr-shapes/collections-list.json'] = derived(
    'The shape that the Solr Collections API documents for action=LIST (wt=json, omitHeader not applied). Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 1 }, collections: [COLLECTION, 'banana-int'] });
  out['solr-shapes/select-error.json'] = derived(
    'The shape of a Solr error response, with the status and message of a request that names a collection that does not exist. Not observed on a server.',
    404, { responseHeader: { status: 404, QTime: 1 }, error: { metadata: ['error-class', 'org.apache.solr.common.SolrException'], msg: 'Collection not found: banana-int', code: 404 } });
  out['solr-shapes/update-ack.json'] = derived(
    'The acknowledgement that Solr gives to an update request. Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 5 } });

  // The saved dashboard of the recording, as the Solr documents hold it (fields title and dashboard in the banana-int collection)
  const saved = JSON.parse(pick(ex, 'blob-read', 'GET').response.body)[0];
  const dashboardJson = scrub(saved.banana_dashboard_s);
  const solrDoc = { id: scrub(saved.id), user: 'guest', group: 'none', title: scrub(saved.banana_title_s), dashboard: dashboardJson };
  out['solr-shapes/dashboard-load.json'] = derived(
    'A select on the banana-int collection that returns the saved dashboard document. The shape follows the documented Solr select response; the document is the dashboard of the recording, stored under the field names Banana uses with a plain Solr. Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 1 }, response: { numFound: 1, start: 0, docs: [solrDoc] } });
  out['solr-shapes/dashboard-load-multivalued.json'] = derived(
    'The same, for a banana-int collection whose dashboard field is multi-valued: Solr then returns the value in an array. Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 1 }, response: { numFound: 1, start: 0, docs: [Object.assign({}, solrDoc, { dashboard: [dashboardJson] })] } });
  out['solr-shapes/dashboard-load-none.json'] = derived(
    'A select on the banana-int collection that finds no dashboard. Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 1 }, response: { numFound: 0, start: 0, docs: [] } });
  out['solr-shapes/dashboard-list.json'] = derived(
    'A select on the banana-int collection for the list of saved dashboards. Not observed on a server.',
    200, { responseHeader: { status: 0, QTime: 1 }, response: { numFound: 1, start: 0, docs: [solrDoc] } });

  Object.keys(out).forEach(function (name) { out[name] = scrubValue(out[name], scrub); });
  return out;
}

function main(rawFile, outDir) {
  const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  const host = process.env.FUSION_URL ? new URL(process.env.FUSION_URL).hostname : null;
  const env = { host: host, user: process.env.FUSION_USER || null, password: process.env.FUSION_PASSWORD || null, apiKey: process.env.FUSION_API_KEY || null };
  const files = build(raw, env);
  fs.rmSync(outDir, { recursive: true, force: true });
  Object.keys(files).sort().forEach(function (name) {
    const target = path.join(outDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(files[name], null, 2) + '\n');
  });
  const result = check.checkDir(outDir, process.env);
  const notice = check.skippedNotice(result);
  if (notice) { process.stdout.write(notice + '\n'); }
  if (result.violations.length) {
    process.stderr.write('the scrubbed fixtures still hold identifying data:\n' + check.format(result) + '\n');
    process.exit(1);
  }
  process.stdout.write('wrote ' + result.files.length + ' fixtures to ' + outDir + '; the scrub check passed\n');
}

if (require.main === module) {
  if (process.argv.length < 4) {
    process.stderr.write('usage: node tools/fixtures/scrub.js <raw.json> <fixtures dir>\n');
    process.exit(2);
  }
  main(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
}

module.exports = { build: build, stringScrubber: stringScrubber };
