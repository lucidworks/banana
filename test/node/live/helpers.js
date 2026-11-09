'use strict';

// Shared helpers for the live-test client's unit tests: a temporary directory,
// a stand-in for the Fusion blob API, and builders for rule contexts.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const client = path.resolve(__dirname, '..', '..', 'live', 'fusion-client');

function load(name) {
  return require(path.join(client, name));
}

const made = [];

// A temporary directory that is removed when the test process exits.
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'live-'));
  made.push(dir);
  return dir;
}

process.on('exit', function () {
  made.forEach(function (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

const ORIGIN = 'http://127.0.0.1:9';

// A rule context where `states` maps ids to their registry state.
function ctx(states, extra) {
  const map = states || {};
  return Object.assign({
    origin: ORIGIN,
    stateOf: function (id) { return map[id]; }
  }, extra || {});
}

const ID1 = 'banana-it-0123456789ab-1';
const ID2 = 'banana-it-0123456789ab-2';

function get(pathAndQuery, origin) {
  return { method: 'GET', url: (origin || ORIGIN) + pathAndQuery, body: null };
}

// A stand-in for the Fusion API: a login, a session, and the blob store. Hooks
// in `behave` change what it answers. `log` records every request it saw.
function startStubFusion(behave) {
  const state = {
    blobs: new Map(),
    log: [],
    sessions: new Set(),
    behave: behave || {},
    counter: 0
  };
  const server = http.createServer(function (req, res) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://stub');
      const entry = { method: req.method, path: url.pathname, query: url.search.slice(1), headers: req.headers, body: body.toString('utf8') };
      state.log.push(entry);
      const send = function (status, payload, headers) {
        res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, headers || {}));
        res.end(payload === undefined ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload)));
      };
      const hook = state.behave.before && state.behave.before(entry, send, state);
      if (hook) {
        return;
      }
      const cookie = /(?:^|;\s*)id=([^;]+)/.exec(req.headers.cookie || '');
      const loggedIn = cookie && state.sessions.has(cookie[1]);
      if (url.pathname === '/api/session' && req.method === 'POST') {
        const token = 'tok' + (++state.counter);
        state.sessions.add(token);
        return send(201, { user: {} }, { 'set-cookie': 'id=' + token + '; Path=/; HttpOnly' });
      }
      if (!loggedIn) {
        return send(401, { error: 'unauthorised' });
      }
      if (url.pathname === '/api/session' && req.method === 'DELETE') {
        state.sessions.delete(cookie[1]);
        return send(204);
      }
      const m = /^\/api\/blobs\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          if (state.blobs.has(id)) {
            return send(200, state.blobs.get(id));
          }
          return send(404, { error: 'no blob' });
        }
        if (req.method === 'PUT') {
          try {
            state.blobs.set(id, JSON.parse(body.toString('utf8')));
          } catch (e) {
            return send(400, { error: 'bad body' });
          }
          return send(200, { id: id });
        }
        if (req.method === 'DELETE') {
          state.blobs.delete(id);
          return send(204);
        }
      }
      return send(404, { error: 'not found' });
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      state.origin = 'http://127.0.0.1:' + server.address().port;
      state.close = function () {
        return new Promise(function (r) { server.closeAllConnections(); server.close(r); });
      };
      resolve(state);
    });
  });
}

module.exports = {
  load: load,
  tempDir: tempDir,
  ctx: ctx,
  get: get,
  ORIGIN: ORIGIN,
  ID1: ID1,
  ID2: ID2,
  startStubFusion: startStubFusion
};
