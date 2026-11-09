#!/usr/bin/env node
'use strict';

/*
 * Checks package-lock.json so that an install from it is reproducible and does not depend on a private mirror.
 *   - every package that is fetched (not a link or the root project) has a `resolved` URL on the public npm
 *     registry, https://registry.npmjs.org/, and an `integrity` hash
 *   - the lockfile uses lockfileVersion 2 or 3, which `npm ci` on the supported Node.js versions reads
 *   - the lockfile and package.json agree on the root dependencies (a stale lockfile makes `npm ci` fail)
 * Usage: node tools/check-lockfile.js [path/to/package-lock.json]
 * Without an argument it checks package-lock.json and tools/maps/package-lock.json against their package.json files.
 */

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = 'https://registry.npmjs.org/';

// Entries of a dependency map in key order, so that the order of keys in the two files does not matter.
function sortedEntries(map) {
  return Object.keys(map || {}).sort().map(function (name) { return [name, map[name]]; });
}

function checkLockfile(lock, pkg) {
  const problems = [];
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object') {
    return ['the lockfile has no "packages" section (lockfileVersion 2 or 3 is required)'];
  }
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) {
    problems.push('lockfileVersion is ' + lock.lockfileVersion + ', expected 2 or 3');
  }
  Object.keys(lock.packages).forEach(function (key) {
    if (key === '') { return; }
    const entry = lock.packages[key];
    if (entry.link) { return; }
    if (typeof entry.resolved !== 'string' || entry.resolved.indexOf(REGISTRY) !== 0) {
      problems.push(key + ': resolved is not on ' + REGISTRY + ' (' + entry.resolved + ')');
    }
    if (typeof entry.integrity !== 'string' || entry.integrity === '') {
      problems.push(key + ': integrity is missing');
    }
  });
  if (pkg) {
    const root = lock.packages[''] || {};
    ['dependencies', 'devDependencies', 'optionalDependencies'].forEach(function (field) {
      const want = JSON.stringify(sortedEntries(pkg[field]));
      const have = JSON.stringify(sortedEntries(root[field]));
      if (want !== have) {
        problems.push('package.json ' + field + ' differs from the lockfile root: run npm install to refresh it');
      }
    });
  }
  return problems;
}

// Checks one lockfile (and its package.json when given); returns true when it is clean.
function checkFile(lockFile, pkgFile) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (e) {
    console.error('check-lockfile: cannot read ' + lockFile + ': ' + e.message);
    return false;
  }
  const pkg = pkgFile ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : null;
  const problems = checkLockfile(lock, pkg);
  if (problems.length) {
    console.error('check-lockfile: ' + problems.length + ' problem(s) in ' + lockFile);
    problems.slice(0, 20).forEach(function (p) { console.error('  ' + p); });
    return false;
  }
  console.log('check-lockfile: ' + lockFile + ': ' + (Object.keys(lock.packages).length - 1) + ' packages, all on ' + REGISTRY + ' with integrity');
  return true;
}

function main() {
  const root = path.resolve(__dirname, '..');
  let ok;
  if (process.argv[2]) {
    ok = checkFile(path.resolve(process.argv[2]), null);
  } else {
    // the application's lockfile, and the one of the map tools (tools/maps), which is installed separately
    ok = checkFile(path.join(root, 'package-lock.json'), path.join(root, 'package.json'));
    const maps = path.join(root, 'tools', 'maps');
    ok = checkFile(path.join(maps, 'package-lock.json'), path.join(maps, 'package.json')) && ok;
  }
  if (!ok) { process.exit(1); }
}

if (require.main === module) { main(); }

module.exports = { checkLockfile, REGISTRY };
