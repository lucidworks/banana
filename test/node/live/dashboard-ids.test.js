'use strict';

// The table of dashboard titles and their encodings (test/shared/blob-ids.json) is read by the unit
// tests of the dashboard service (run in the browser, npm test) and here, by the tests of the live-test client, so the
// address Banana sends to name a stored dashboard and the address the client's rules allow cannot drift apart.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, ctx, ORIGIN } = require('./helpers');

const rules = load('rules.js');
const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'shared', 'blob-ids.json'), 'utf8'));

test('the table lists the titles that matter, each with the encoding encodeURIComponent gives it', function () {
  assert.ok(table.ids.length >= 12);
  table.ids.forEach(function (row) {
    assert.strictEqual(encodeURIComponent(row.id), row.encoded, row.label);
  });
});

test('the delete address of the client for each title is the blob API and the encoded title, with no query', function () {
  table.ids.forEach(function (row) {
    const url = rules.deleteUrl(ORIGIN, row.id);
    assert.strictEqual(url, ORIGIN + '/api/blobs/' + row.encoded, row.label);
    assert.ok(url.indexOf('?') === -1 && url.indexOf('#') === -1, row.label);
  });
});

test('the rule table turns a delete of any of these titles away unless it is a run id the process owns', function () {
  const ids = load('ids.js');
  table.ids.filter(function (row) { return !ids.isValidId(row.id); }).forEach(function (row) {
    const verdict = rules.classify({ method: 'DELETE', url: rules.deleteUrl(ORIGIN, row.id), body: null }, ctx({ [row.id]: 'created' }));
    assert.strictEqual(verdict.allow, false, row.label);
  });
  // and allows the plain run id that the live tests use
  const run = 'banana-it-0123456789ab-1';
  const verdict = rules.classify({ method: 'DELETE', url: rules.deleteUrl(ORIGIN, run), body: null }, ctx({ [run]: 'created' }));
  assert.strictEqual(verdict.allow, true);
  assert.strictEqual(verdict.id, run);
});
