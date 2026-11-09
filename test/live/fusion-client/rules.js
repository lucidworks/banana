'use strict';

// The rule table. classify() is the one function that decides whether a request
// may leave the test process. It is used by the Node client for direct requests
// and by the browser route for the requests Banana makes itself. Everything
// the table does not name is refused.

const codec = require('./codec');
const stream = require('./stream');
const select = require('./select');
const ids = require('./ids');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COLLECTION = stream.COLLECTION_PATTERN;
const ADMIN_STATIC_ROOTS = new Set(['api', 'auth', 'admin']);
const STATES_FOR_DELETE = new Set(['put-sent', 'created', 'delete-sent']);

function abort(cls, reason) {
  return { allow: false, cls: cls, reason: reason };
}

function allow(kind, extra) {
  return Object.assign({ allow: true, kind: kind }, extra || {});
}

// The one place that builds the delete URL. Both the client and the rule call
// it, so they cannot drift apart.
function deleteUrl(origin, id) {
  return origin + '/api/blobs/' + encodeURIComponent(id);
}

function isWrite(method) {
  return !READ_METHODS.has(method);
}

// Split a URL string into its raw parts without normalising anything.
function splitUrl(url) {
  const m = /^(https?):\/\/([^/?#]*)([^?#]*)(\?([^#]*))?(#.*)?$/i.exec(url);
  if (!m) {
    return null;
  }
  return {
    origin: (m[1] + '://' + m[2]).toLowerCase(),
    path: m[3],
    query: m[4] === undefined ? '' : m[5],
    hasQuery: m[4] !== undefined,
    fragment: m[6] || ''
  };
}

// The path path-decoded once and split on '/'. Returns null when a segment does
// not decode or an interior segment is empty, '.' or '..'. A single trailing
// slash is reported separately.
function pathSegments(rawPath) {
  const decoded = codec.percentDecode(rawPath, false);
  if (decoded === null || decoded[0] !== '/') {
    return null;
  }
  const segs = decoded.split('/').slice(1);
  let trailing = false;
  if (segs.length && segs[segs.length - 1] === '') {
    trailing = true;
    segs.pop();
  }
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') {
      return null;
    }
  }
  return { segs: segs, trailing: trailing };
}

function queryIs(rawQuery, allowed) {
  // allowed: array of [name, value|null]; each at most once, any order. value
  // null means any value. All names must be in `allowed`.
  const pairs = codec.parsePairs(rawQuery);
  if (pairs === null) {
    return false;
  }
  const seen = new Set();
  for (const p of pairs) {
    const rule = allowed.find(function (a) { return a[0] === p.name; });
    if (!rule || seen.has(p.name) || (rule[1] !== null && rule[1] !== p.value)) {
      return false;
    }
    seen.add(p.name);
  }
  return true;
}

function queryHasExactly(rawQuery, required) {
  const pairs = codec.parsePairs(rawQuery);
  if (pairs === null || pairs.length !== required.length) {
    return false;
  }
  return queryIs(rawQuery, required) && required.every(function (r) {
    return pairs.some(function (p) { return p.name === r[0]; });
  });
}

const SCHEMA_LEAVES = new Set(['fields', 'dynamicfields', 'uniquekey']);

// Match a GET, HEAD or OPTIONS request to a row of the read allowlist.
// Returns { row } or { abort }.
function matchRead(p, ctx) {
  const s = p.segs;
  const n = s.length;
  const q = p.query;
  const noQuery = q === '';
  const plain = !p.trailing;

  // Banana's own static files.
  if (n >= 2 && s[0] === 'admin' && s[1] === 'banana' && (n > 2 || p.trailing)) {
    return { row: 'static' };
  }
  if (n >= 1 && ctx.staticRoots && !ADMIN_STATIC_ROOTS.has(s[0]) && ctx.staticRoots.has(s[0])) {
    return { row: 'static' };
  }
  // The login application.
  if (s[0] === 'auth' && plain) {
    if ((n === 2 && s[1] === 'login') || (n >= 3 && s[1] === 'build')) {
      return { row: 'login-app' };
    }
  }
  // The admin UI landing, because the login lands there.
  if (noQuery) {
    if (s[0] === 'admin') {
      if (n === 1) {
        return { row: 'admin-landing' };
      }
      if (plain && n === 2 && (s[1] === 'bundle.js' || /^[A-Za-z0-9_.-]+\.png$/.test(s[1]))) {
        return { row: 'admin-landing' };
      }
      if (plain && n >= 3 && (s[1] === 'ui-common' || s[1] === 'webfonts')) {
        return { row: 'admin-landing' };
      }
      if (plain && n === 3 && s[1] === 'config' && s[2] === 'banner-config.json') {
        return { row: 'admin-landing' };
      }
    }
    if (plain) {
      const exact = ['api/apps', 'api/license', 'api/configurations/quickstart.enabled',
        'api/query-pipelines', 'api/index-pipelines', 'api-ws', 'api', 'api/session', 'api/collections'];
      if (exact.indexOf(s.join('/')) !== -1) {
        return { row: 'discovery' };
      }
    }
  }
  if (!plain) {
    return { abort: 'unlisted-read' };
  }
  // Schema.
  const schemaQuery = queryIs(q, [['wt', 'json'], ['omitHeader', 'true']]);
  if (n === 5 && s[0] === 'api' && s[1] === 'collections' && COLLECTION.test(s[2]) && s[3] === 'schema' && SCHEMA_LEAVES.has(s[4])) {
    return schemaQuery ? { row: 'schema' } : { abort: 'unlisted-read' };
  }
  if (n === 7 && s[0] === 'api' && s[1] === 'query-pipelines' && COLLECTION.test(s[2]) && s[3] === 'collections' &&
      COLLECTION.test(s[4]) && s[5] === 'schema' && SCHEMA_LEAVES.has(s[6])) {
    return schemaQuery ? { row: 'schema' } : { abort: 'unlisted-read' };
  }
  if (n === 5 && s[0] === 'api' && s[1] === 'solr' && COLLECTION.test(s[2]) && s[3] === 'schema' && SCHEMA_LEAVES.has(s[4])) {
    return schemaQuery ? { row: 'schema' } : { abort: 'unlisted-read' };
  }
  // Blobs.
  if (n === 2 && s[0] === 'api' && s[1] === 'blobs') {
    return queryHasExactly(q, [['q', null], ['resourceType', 'banana']]) ? { row: 'blob-list' } : { abort: 'unlisted-read' };
  }
  if (n === 3 && s[0] === 'api' && s[1] === 'blobs') {
    return noQuery ? { row: 'blob-read' } : { abort: 'unlisted-read' };
  }
  // Stream and graph.
  const leaf = s[n - 1];
  if ((leaf === 'stream' || leaf === 'graph') && (
    (n === 6 && s[0] === 'api' && s[1] === 'query-pipelines' && COLLECTION.test(s[2]) && s[3] === 'collections' && COLLECTION.test(s[4])) ||
    (n === 4 && s[0] === 'api' && s[1] === 'solr' && COLLECTION.test(s[2])))) {
    return { row: 'stream' };
  }
  return { abort: 'unlisted-read' };
}

// A path that names a select handler on a permitted pipeline or collection.
function isSelectPath(s) {
  return (s.length === 6 && s[0] === 'api' && s[1] === 'query-pipelines' && COLLECTION.test(s[2]) &&
      s[3] === 'collections' && COLLECTION.test(s[4]) && s[5] === 'select') ||
    (s.length === 4 && s[0] === 'api' && s[1] === 'solr' && COLLECTION.test(s[2]) && s[3] === 'select');
}

// Decide whether a request may be sent.
//   req: { method, url, contentType, body } (body is a Buffer, a string or null)
//   ctx: { origin, staticRoots, stateOf(id) }
// Returns { allow: true, kind, ... } or { allow: false, cls, reason }.
function classify(req, ctx) {
  const method = String(req.method || '').toUpperCase();
  const url = String(req.url || '');
  // Rule 1: the URL must parse, with scheme http or https.
  const parts = splitUrl(url);
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    parsed = null;
  }
  if (!parts || !parsed || !/^https?:$/.test(parsed.protocol)) {
    return abort('bad-url', 'the URL does not parse as http or https');
  }
  // Rule 2: the origin must equal the allowed origin exactly.
  if (parts.origin !== ctx.origin.toLowerCase() || parsed.origin.toLowerCase() !== ctx.origin.toLowerCase()) {
    return abort('off-origin', 'the request leaves the allowed origin');
  }
  // Rule 3: decode once, split, refuse bad segments and write paths.
  const decoded = pathSegments(parts.path);
  if (decoded === null) {
    return abort('bad-path', 'the path does not decode or has an empty, dot or dot-dot segment');
  }
  for (const seg of decoded.segs) {
    if (['update', 'index', '_update'].indexOf(seg.toLowerCase()) !== -1) {
      return abort('write-path', 'the path has an update or index segment');
    }
  }
  const p = { segs: decoded.segs, trailing: decoded.trailing, query: parts.query };
  // Rule 4: client telemetry.
  if (method === 'POST' && p.segs.join('/') === 'api/ui-logs' && !p.trailing) {
    return abort('telemetry', 'client telemetry of the admin UI');
  }
  // Rule 5: by method.
  if (READ_METHODS.has(method)) {
    const m = matchRead(p, ctx);
    if (m.abort) {
      return abort(m.abort, 'no row of the read allowlist matches');
    }
    if (m.row === 'stream') {
      const bad = stream.checkStreamQuery(p.query);
      if (bad) {
        return abort(bad.cls, bad.reason);
      }
    }
    return allow('read', { row: m.row });
  }
  if (method === 'POST') {
    return classifyPost(req, p, ctx);
  }
  if (method === 'PUT') {
    return classifyPut(parts, p, ctx);
  }
  if (method === 'DELETE') {
    return classifyDelete(req, url, p, ctx);
  }
  return abort('unlisted-write', 'method ' + method + ' is not allowed');
}

// The login's content type: exactly application/json, compared
// case-insensitively, with no parameter.
function jsonContentType(contentType) {
  return typeof contentType === 'string' && contentType.trim().toLowerCase() === 'application/json';
}

function classifyPost(req, p, ctx) {
  const path = p.segs.join('/');
  if (path === 'api/session' && !p.trailing) {
    if ((p.query === '' || p.query === 'realmName=native') && jsonContentType(req.contentType)) {
      return allow('login');
    }
    return abort('unlisted-write', 'a login must be JSON with no query or exactly realmName=native');
  }
  if (isSelectPath(p.segs) && !p.trailing) {
    if (p.query !== '' || !select.isSelectContentType(req.contentType)) {
      return abort('unlisted-write', 'a select is a form POST with no query string');
    }
    const bad = select.checkSelectBody(req.body);
    if (bad) {
      return abort(bad.cls, bad.reason);
    }
    return allow('select');
  }
  return abort('unlisted-write', 'POST is allowed only for the login and select');
}

function classifyPut(parts, p, ctx) {
  const s = p.segs;
  if (s.length !== 3 || s[0] !== 'api' || s[1] !== 'blobs' || p.trailing || p.query !== 'resourceType=banana' || parts.fragment !== '') {
    return abort('blob-put', 'PUT is allowed only for /api/blobs/<id> with resourceType=banana');
  }
  const id = s[2];
  if (!ids.isValidId(id)) {
    return abort('blob-put', 'the id is not a run id');
  }
  const state = ctx.stateOf(id);
  if (state === undefined) {
    return abort('blob-put', 'the id is not owned by this process');
  }
  if (state === 'collided') {
    return abort('collided', 'the id collided with an existing blob');
  }
  return allow('put', { id: id, check404: state !== 'created' });
}

function classifyDelete(req, url, p, ctx) {
  const noBody = req.body === null || req.body === undefined || req.body.length === 0;
  if (url === ctx.origin + '/api/session') {
    return noBody ? allow('logout') : abort('delete', 'the logout carries no body');
  }
  const prefix = ctx.origin + '/api/blobs/';
  if (url.slice(0, prefix.length) === prefix) {
    const seg = url.slice(prefix.length);
    const id = /[/?#]/.test(seg) ? null : codec.percentDecode(seg, false);
    if (id !== null && ids.isValidId(id) && url === deleteUrl(ctx.origin, id) && noBody) {
      const state = ctx.stateOf(id);
      if (state !== undefined && STATES_FOR_DELETE.has(state)) {
        return allow('delete', { id: id });
      }
      return abort('delete', 'the id is not at a state that allows a delete');
    }
  }
  return abort('delete', 'a DELETE must be exactly the delete URL of an owned id');
}

module.exports = {
  classify: classify,
  deleteUrl: deleteUrl,
  isWrite: isWrite,
  splitUrl: splitUrl,
  pathSegments: pathSegments,
  matchRead: matchRead,
  jsonContentType: jsonContentType
};
