'use strict';

/*
 * The recorded responses under test/fixtures (see tools/fixtures/record.js and tools/fixtures/scrub.js).
 *
 * A fixture file holds one response, and says where it comes from in `source`:
 *   recorded       the answer of a Fusion 5.9.16 gateway
 *   recorded-solr  a Solr response shape that Fusion's Solr proxy returned (not a standalone Solr)
 *   derived        built from a documented shape or from a recorded response (see its `note`)
 * Specs name the kind of evidence in their descriptions, so that a derived fixture is never read as a recording.
 */

var context = require.context('../../fixtures', true, /\.json$/);

/** The fixture with the given name, for example 'fusion-5.9.16/session', as a fresh copy. */
function load(name) {
  return JSON.parse(JSON.stringify(context('./' + name + '.json')));
}

/** The response body as the wire carries it: the text that $http then parses. */
function text(fixture) {
  var body = fixture.response.body;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/**
 * Makes a mock $httpBackend definition answer with the fixture (status, content type and body).
 * `onRequest`, when given, is called with the request that matched ({ method, url, data, headers }): the mock
 * of AngularJS 1.0.8 can match a URL by string or pattern only, so a spec reads the rest of the request here.
 */
function respond(definition, fixture, onRequest) {
  var headers = fixture.response.contentType ? { 'Content-Type': fixture.response.contentType } : {};
  return definition.respond(function (method, url, data, requestHeaders) {
    if (onRequest) { onRequest({ method: method, url: url, data: data, headers: requestHeaders }); }
    return [fixture.response.status, text(fixture), headers];
  });
}

/** The parameters of a form or query string as an object of arrays, decoded. */
function params(queryString) {
  var out = {};
  String(queryString || '').split('&').forEach(function (pair) {
    if (pair === '') { return; }
    var i = pair.indexOf('=');
    var key = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, ' '));
    var value = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
    (out[key] = out[key] || []).push(value);
  });
  return out;
}

/** The parameters of the request that was recorded (its form body, or its query string). */
function recordedParams(fixture) {
  var request = fixture.recordedRequest;
  var q = request.body !== undefined ? request.body : request.path.slice(request.path.indexOf('?') + 1);
  return params(q);
}

module.exports = { load: load, text: text, respond: respond, params: params, recordedParams: recordedParams };
