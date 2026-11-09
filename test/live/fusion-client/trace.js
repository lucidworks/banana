'use strict';

// An optional record of what was sent, for evidence of a live run. A line holds
// who sent it, the method, the path, the names of the query parameters (never
// their values), the content type, the verdict and the status. No host, no
// header, no body, no credential.

const fs = require('node:fs');

function queryNames(query) {
  return String(query || '').split('&').filter(Boolean).map(function (pair) {
    return pair.split('=')[0];
  });
}

function makeTracer(file) {
  if (!file) {
    return null;
  }
  return function trace(entry) {
    fs.appendFileSync(file, JSON.stringify(Object.assign({ time: new Date().toISOString() }, entry)) + '\n');
  };
}

module.exports = { makeTracer: makeTracer, queryNames: queryNames };
