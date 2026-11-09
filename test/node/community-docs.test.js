'use strict';

// Checks that the community-facing files carry no email addresses and that
// the security policy exists and names the private reporting channel.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;

['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'package.json'].forEach(function (file) {
  test(file + ' contains no email address', function () {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const m = text.match(EMAIL);
    assert.strictEqual(m, null, 'found email address: ' + (m && m[0]));
  });
});

test('SECURITY.md exists and mentions private vulnerability reporting', function () {
  const file = path.join(root, 'SECURITY.md');
  assert.ok(fs.existsSync(file), 'SECURITY.md is missing');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /private vulnerability reporting/i);
});

test('CONTRIBUTING.md and README.md point to GitHub Issues', function () {
  ['README.md', 'CONTRIBUTING.md'].forEach(function (file) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(text, /github\.com\/lucidworks\/banana\/issues/i, file);
  });
});

test('package.json author follows the project copyright line', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.author, 'Lucidworks, Inc. and Banana contributors');
  assert.strictEqual(pkg.license, 'Apache-2.0');
});

test('README and CONTRIBUTING agree that release is the development branch', function () {
  var readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  var contributing = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
  assert.ok(!/`develop` branch is used for active development/.test(readme),
    'README must not name develop as the development branch');
  assert.ok(/branch from it when you contribute/.test(readme), 'README must point contributors at release');
  assert.ok(/Create a branch from `release`/.test(contributing), 'CONTRIBUTING must branch from release');
  assert.ok(/against the `release` branch/.test(contributing), 'CONTRIBUTING must target release');
});
