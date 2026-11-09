#!/usr/bin/env node
'use strict';

/*
 * Records the answers that a Fusion 5.9 gateway gives to the requests Banana's services make, as raw
 * exchanges in a directory outside the repository. A second step (tools/fixtures/scrub.js) turns them
 * into the fixtures under test/fixtures.
 *
 *   FUSION_URL=... FUSION_USER=... FUSION_PASSWORD=... \
 *     node tools/fixtures/record.js <raw output dir> <registry dir>
 *
 * Every request goes through the guarded client in test/live/fusion-client, so reads are limited to its
 * allowlist and the only write is one dashboard blob under an id of the form banana-it-<run>-<n>, which
 * this process creates and then deletes. The registry directory must exist and be outside the work tree
 * or ignored (the client checks). The output holds response bodies, so it must never be committed.
 *
 * What is kept of each exchange: the method, the path and query (never the host), the request content
 * type and body (never the login body), the status, the response content type and the response body. Request
 * headers and response headers other than the content type (cookies among them) are dropped here.
 */

const fs = require('node:fs');
const path = require('node:path');
const ids = require('../../test/live/fusion-client/ids');
const registry = require('../../test/live/fusion-client/registry');
const { FusionClient } = require('../../test/live/fusion-client/client');

const COLLECTION = 'banana-it-logs';
const MISSING_COLLECTION = 'banana-it-no-such-collection';
const SOLR_PROXY_SELECT = '/api/solr/' + COLLECTION + '/select';
const PIPELINE_SELECT = '/api/query-pipelines/_system/collections/' + COLLECTION + '/select';

function need(name) {
  if (!process.env[name]) {
    throw new Error(name + ' is not set');
  }
  return process.env[name];
}

function form(pairs) {
  return pairs.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
}

async function main(outDir, registryDir) {
  const base = new URL(need('FUSION_URL')).origin;
  const exchanges = [];
  let label = '';

  // Records what comes back, then hands the response on unchanged.
  async function recordingFetch(url, init) {
    const res = await fetch(url, init);
    const text = await res.clone().text();
    const u = new URL(url);
    const isLogin = init.method === 'POST' && u.pathname === '/api/session';
    if (!isLogin) {
      exchanges.push({
        label: label,
        request: {
          method: init.method,
          path: u.pathname + u.search,
          contentType: (init.headers && init.headers['content-type']) || null,
          body: init.body === undefined ? null : init.body
        },
        response: { status: res.status, contentType: res.headers.get('content-type'), body: text }
      });
    }
    return res;
  }

  const identity = ids.newIdentity();
  const dir = registry.checkRegistryDir(registryDir);
  const reg = new registry.Registry({ dir: dir, runTag: identity, identity: identity });
  const ledger = new registry.Ledger(reg);
  const client = new FusionClient({
    base: base,
    user: need('FUSION_USER'),
    password: need('FUSION_PASSWORD'),
    ledger: ledger,
    allocator: new ids.Allocator(identity),
    fetchImpl: recordingFetch
  });

  async function read(name, p) {
    label = name;
    const res = await client._send({ method: 'GET', url: base + p, body: null });
    return res;
  }

  async function select(name, pairs, selectPath) {
    label = name;
    return client._send({
      method: 'POST',
      url: base + (selectPath || PIPELINE_SELECT),
      contentType: 'application/x-www-form-urlencoded',
      body: form(pairs)
    });
  }

  try {
    // 1. Not logged in yet: the session answers 401. The client then logs in and repeats the read.
    await read('session-unauthenticated', '/api/session');
    await read('session', '/api/session');

    // 2. Collections and schema (lucidworksSrv.getFields, fields.map, kbnIndex.collections).
    await read('collections', '/api/collections');
    await read('schema-fields', '/api/collections/' + COLLECTION + '/schema/fields');
    await read('schema-dynamicfields', '/api/collections/' + COLLECTION + '/schema/dynamicfields');
    await read('schema-fields-missing', '/api/collections/' + MISSING_COLLECTION + '/schema/fields');
    await read('schema-dynamicfields-missing', '/api/collections/' + MISSING_COLLECTION + '/schema/dynamicfields');

    // 3. Queries through the query pipeline (solrSrv.calcTopFieldValues, kbnIndex.indices).
    //    Banana sends these two as GETs; a GET select is outside the guard's allowlist, so they are
    //    recorded as the form POST that the allowlist has, with the same parameters.
    await select('select-top-values', [
      ['q', '*:*'], ['wt', 'json'], ['rows', '0'], ['facet', 'true'], ['facet.limit', '10'],
      ['facet.field', 'level_s'], ['facet.field', 'service_s']
    ]);
    await select('select-top-values-with-fq', [
      ['q', '*:*'], ['fq', 'level_s:ERROR'], ['wt', 'json'], ['rows', '0'], ['facet', 'true'], ['facet.limit', '10'],
      ['facet.field', 'level_s']
    ]);
    await select('select-range-facet', [
      ['q', '*:*'], ['wt', 'json'], ['rows', '0'], ['omitHeader', 'true'], ['facet', 'true'],
      ['facet.range', 'timestamp_tdt'], ['facet.range.start', 'NOW-10YEARS/DAY'], ['facet.range.end', 'NOW'],
      ['facet.range.gap', '+1DAY']
    ]);
    // the same request as kbnIndex sends, whose range field the collection does not have
    await select('select-undefined-field', [
      ['q', '*:*'], ['wt', 'json'], ['rows', '0'], ['omitHeader', 'true'], ['facet', 'true'],
      ['facet.range', 'event_timestamp'], ['facet.range.start', 'NOW-10YEARS/DAY'], ['facet.range.end', 'NOW'],
      ['facet.range.gap', '+1DAY']
    ]);
    await select('select-rows', [['q', '*:*'], ['wt', 'json'], ['rows', '2'], ['sort', 'id asc']]);

    // 3b. The same kinds of request through Fusion's Solr proxy. These are Solr response shapes served
    //     by Fusion, not the answers of a standalone Solr: no standalone Solr was available.
    await read('solr-proxy-schema-fields', '/api/solr/' + COLLECTION + '/schema/fields');
    await select('solr-proxy-select-top-values', [
      ['q', '*:*'], ['wt', 'json'], ['rows', '0'], ['facet', 'true'], ['facet.limit', '10'],
      ['facet.field', 'level_s'], ['facet.field', 'service_s']
    ], SOLR_PROXY_SELECT);
    await select('solr-proxy-select-undefined-field', [
      ['q', 'no_such_field_s:x'], ['wt', 'json'], ['rows', '0']
    ], SOLR_PROXY_SELECT);

    // 4. Dashboards in the blob store, on an id this process allocates and then removes.
    const id = client.allocate();
    label = 'blob-read-absent';
    await client.get(id);
    const dashboard = {
      title: id, style: 'dark', rows: [], solr: { server: '/api/query-pipelines/_system/collections/', core_name: COLLECTION }
    };
    label = 'blob-save';
    await client.create(id, dashboard);
    label = 'blob-read';
    await client.get(id);
    await read('blob-list', '/api/blobs?q=id:banana-it*&resourceType=banana');
    label = 'blob-delete';
    await client.remove(id);

    const report = await client.teardown();
    if (report.orphans.length || report.collided.length) {
      throw new Error('the recording left ids behind: ' + JSON.stringify(report));
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify({ runId: id, exchanges: exchanges }, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write('recorded ' + exchanges.length + ' exchanges\n');
  } finally {
    reg.close();
  }
}

if (require.main === module) {
  if (process.argv.length < 4) {
    process.stderr.write('usage: node tools/fixtures/record.js <raw output dir> <registry dir>\n');
    process.exit(2);
  }
  main(path.resolve(process.argv[2]), path.resolve(process.argv[3])).catch(function (e) {
    process.stderr.write('record failed: ' + e.message + '\n');
    process.exit(1);
  });
}
