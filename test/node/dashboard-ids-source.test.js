'use strict';

// Every address that names a stored dashboard in the Fusion blob store is built with the one codec (encodeURIComponent
// through components/dashboard-ids.js, or the same call in the vendored Solr client). A change that builds one
// without it, or leaves one of the four requests (look-up, load, save, delete) on the old form, fails here.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };

function blobUrlsBuiltWithoutTheCodec(text) {
  // <blob API> + '/' + <anything but the codec>
  const re = /(?:SYSTEM_BANANA_BLOB_API|blobApi)\s*\+\s*'\/'\s*\+\s*([^;\n]*)/g;
  const bad = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!/^(ids\.blobSegment\(|encodeURIComponent\()/.test(m[1].trim())) { bad.push(m[0]); }
  }
  return bad;
}

test('the dashboard service builds the blob address of a stored dashboard with the codec only', function () {
  const text = read('src/app/services/dashboard.js');
  assert.deepStrictEqual(blobUrlsBuiltWithoutTheCodec(text), []);
  // the load and the look-up/save both appear, so the check above has something to check
  assert.ok((text.match(/(?:SYSTEM_BANANA_BLOB_API|blobApi)\s*\+\s*'\/'\s*\+\s*ids\.blobSegment\(/g) || []).length >= 2);
});

test('the delete of the vendored Solr client encodes the id with the same codec', function () {
  const text = read('src/vendor/solrjs/solr.js');
  const from = text.indexOf('doDelete: function (useFusion, successcb, errorcb)');
  assert.ok(from > 0);
  const body = text.slice(from, from + 2500);
  assert.match(body, /var url = '\/' \+ encodeURIComponent\(id\);/);
  assert.doesNotMatch(body, /var url = '\/' \+ id;/);
});

test('the codec function is the one named in the module that both sides use', function () {
  const text = read('src/app/components/dashboard-ids.js');
  assert.match(text, /ids\.blobSegment = function \(id\) \{\s*return encodeURIComponent\(id\);\s*\};/);
});

test('the Solr delete is a JSON delete by id, never a query', function () {
  const text = read('src/vendor/solrjs/solr.js');
  const from = text.indexOf('doDelete: function (useFusion, successcb, errorcb)');
  const body = text.slice(from, from + 2500);
  assert.match(body, /JSON\.stringify\(\{ 'delete': \{ id: id \} \}\)/);
  assert.doesNotMatch(body, /<delete>|<query>/);
});
