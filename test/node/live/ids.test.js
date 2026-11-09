'use strict';

// Run identity and dashboard ids.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers');

const ids = load('ids.js');

test('the id pattern accepts a run id and refuses near misses', function () {
  assert.ok(ids.isValidId('banana-it-0123456789ab-1'));
  assert.ok(ids.isValidId('banana-it-0123456789ab-123456'));
  [
    'x-banana-it-0123456789ab-1',          // suffix case
    'banana-it-0123456789ab-0',            // counter starts at 1
    'banana-it-0123456789ab-1\n',          // trailing newline
    'banana-it-0123456789ab-1?x',          // a query in the title
    'banana-it-0123456789AB-1',            // upper-case identity
    'banana-it-0123456789ab-1234567',      // seven digits
    'banana-it-0123456789a-1',             // short identity
    'banana-it-0123456789abc-1',           // long identity
    'banana-it-0123456789ab-01',           // leading zero
    'banana-it-0123456789ab-1/x',
    ' banana-it-0123456789ab-1',
    'banana-it-0123456789ab-'
  ].forEach(function (bad) {
    assert.strictEqual(ids.isValidId(bad), false, JSON.stringify(bad));
  });
  assert.strictEqual(ids.isValidId(undefined), false);
  assert.strictEqual(ids.isValidId(5), false);
});

test('identities are 12 lowercase hexadecimal characters and differ between calls', function () {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = ids.newIdentity();
    assert.match(id, /^[0-9a-f]{12}$/);
    seen.add(id);
  }
  assert.strictEqual(seen.size, 200);
});

test('two processes get different identities', function () {
  const childProcess = require('node:child_process');
  const path = require('node:path');
  const script = 'process.stdout.write(require(' + JSON.stringify(path.resolve(__dirname, '..', '..', 'live', 'fusion-client', 'ids.js')) + ').newIdentity())';
  const a = childProcess.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const b = childProcess.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(a, b);
});

test('the allocator counts up from 1 and never repeats an id', function () {
  const alloc = new ids.Allocator('0123456789ab');
  const got = [alloc.next(), alloc.next(), alloc.next()];
  assert.deepStrictEqual(got, ['banana-it-0123456789ab-1', 'banana-it-0123456789ab-2', 'banana-it-0123456789ab-3']);
  got.forEach(function (id) { assert.ok(ids.isValidId(id)); });
  const many = new Set();
  const other = new ids.Allocator('ba9876543210');
  for (let i = 0; i < 500; i++) {
    many.add(other.next());
  }
  assert.strictEqual(many.size, 500);
});

test('the allocator refuses an identity that is not 12 lowercase hexadecimal characters', function () {
  ['', 'abc', '0123456789AB', '0123456789abg', '0123456789abcd'].forEach(function (bad) {
    assert.throws(function () { return new ids.Allocator(bad); });
  });
});

test('the allocator refuses to hand out a seventh digit', function () {
  const alloc = new ids.Allocator('0123456789ab');
  alloc._next = 1000000;
  assert.throws(function () { return alloc.next(); });
});

test('run tags have the same form as identities', function () {
  assert.ok(ids.isValidRunTag('0123456789ab'));
  ['', 'ABCDEF012345', '0123456789a', undefined, null].forEach(function (bad) {
    assert.strictEqual(ids.isValidRunTag(bad), false);
  });
});
