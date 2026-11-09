'use strict';

// A local world for the browser tests: a stand-in for Fusion, a stand-in for the
// test proxy in front of it (static Banana files, the digest header, and the
// same forwarding split as the real proxy), and a second server that stands for
// "an address nobody checked", which counts what reaches it.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const helpers = require('../node/live/helpers');

const root = path.resolve(__dirname, '..', '..');
const settings = helpers.load('settings.js');
const WORLD_CREDENTIAL = 'world-credential';

function listen(server) {
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve(server.address().port); });
  });
}

function html(body) {
  return '<!doctype html><html><body>' + body + '</body></html>';
}

const LOGIN_PAGE = html([
  '<input type="text" id="u"><input type="password" id="p"><button id="go">Login</button>',
  '<script>',
  'document.getElementById("go").onclick = function () {',
  '  var q = new URLSearchParams(location.search);',
  '  fetch("/api/session?realmName=native", { method: "POST", headers: { "content-type": "application/json" },',
  '    body: JSON.stringify({ username: document.getElementById("u").value, password: document.getElementById("p").value }) })',
  '  .then(function (r) { if (r.ok) { location.href = window.__landing === "admin" ? "/admin/" : (q.get("return") || "/admin/banana/index.html"); } });',
  '};',
  '</script>'
].join('\n'));

// The admin UI landing page: reads, a WebSocket and a telemetry POST.
const ADMIN_PAGE = html([
  '<h1>admin</h1>',
  '<script>',
  'fetch("/api"); fetch("/api/apps"); fetch("/api-ws");',
  'try { new WebSocket("ws://" + location.host + "/api-ws"); } catch (e) {}',
  'fetch("/api/ui-logs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });',
  '</script>'
].join('\n'));

// options: landing ('banana' or 'admin'), bananaFiles (a map from path to text).
async function startWorld(options) {
  const opts = options || {};
  const key = crypto.randomBytes(32).toString('hex');
  const target = { hits: [] };
  const targetServer = http.createServer(function (req, res) {
    target.hits.push(req.method + ' ' + req.url);
    res.writeHead(200);
    res.end('target');
  });
  const targetPort = await listen(targetServer);
  target.origin = 'http://127.0.0.1:' + targetPort;

  const world = { key: key, target: target, opts: opts, landing: opts.landing || 'banana', redirectOn: null };
  const stub = await helpers.startStubFusion({
    before: function (entry, send, state) {
      const p = entry.path;
      if (world.redirectOn && world.redirectOn(entry)) {
        send(world.redirectStatus || 307, '', { location: target.origin + '/target' });
        return true;
      }
      if (world.failBrowserLogin && entry.method === 'POST' && p === '/api/session' && entry.headers.origin) {
        send(401, { error: 'bad credentials' });
        return true;
      }
      if (entry.method === 'GET' && p === '/auth/login') {
        send(200, LOGIN_PAGE.replace('<script>', '<script>window.__landing = ' + JSON.stringify(world.landing) + ';'), { 'content-type': 'text/html' });
        return true;
      }
      if (entry.method === 'GET' && p === '/admin/') {
        send(200, ADMIN_PAGE, { 'content-type': 'text/html' });
        return true;
      }
      if (entry.method === 'GET' && (p === '/api' || p === '/api/apps')) {
        send(200, { version: 'x' });
        return true;
      }
      if (entry.method === 'GET' && p === '/api-ws') {
        send(404, { error: 'not found' });
        return true;
      }
      if (entry.method === 'POST' && p === '/api/ui-logs') {
        send(200, {});
        return true;
      }
      if (entry.method === 'POST' && /\/select$/.test(p)) {
        send(200, { response: { numFound: 0, docs: [] } });
        return true;
      }
      return world.behave ? world.behave(entry, send, state) : false;
    }
  });
  world.stub = stub;
  world.fusionOrigin = stub.origin;

  const bananaFiles = Object.assign({
    'config.js': fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8'),
    'index.html': html('<h1>banana</h1>')
  }, opts.bananaFiles || {});
  world.bananaFiles = bananaFiles;
  const digest = settings.digestOf(stub.origin, key);

  world.proxyLog = [];
  const proxyServer = http.createServer(function (req, res) {
    world.proxyLog.push(req.method + ' ' + req.url);
    const url = new URL(req.url, 'http://proxy');
    const send = function (status, body, type) {
      res.writeHead(status, { 'content-type': type || 'text/plain', 'x-banana-upstream-digest': digest });
      res.end(body);
    };
    if (url.pathname.indexOf('/admin/banana/') === 0) {
      const name = url.pathname.slice('/admin/banana/'.length) || 'index.html';
      if (Object.prototype.hasOwnProperty.call(bananaFiles, name)) {
        return send(200, bananaFiles[name], /\.js$/.test(name) ? 'application/javascript' : 'text/html');
      }
      return send(404, 'not found');
    }
    const forwarded = url.pathname === '/api' || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/auth/') === 0 ||
      (url.pathname.indexOf('/admin/') === 0);
    if (!forwarded) {
      return send(404, 'not found');
    }
    const headers = Object.assign({}, req.headers, { origin: stub.origin, host: new URL(stub.origin).host });
    const up = http.request(stub.origin + req.url, { method: req.method, headers: headers }, function (upRes) {
      const h = Object.assign({}, upRes.headers, { 'x-banana-upstream-digest': digest });
      if (h.location && h.location.indexOf(stub.origin) === 0) {
        h.location = h.location.slice(stub.origin.length);
      }
      res.writeHead(upRes.statusCode, h);
      upRes.pipe(res);
    });
    up.on('error', function () { send(502, 'bad gateway'); });
    req.pipe(up);
  });
  world.upgrades = [];
  proxyServer.on('upgrade', function (req, socket) {
    world.upgrades.push(req.url);
    socket.destroy();
  });
  const proxyPort = await listen(proxyServer);
  world.proxyOrigin = 'http://127.0.0.1:' + proxyPort;
  world.registryDir = helpers.tempDir('live-world-registry-');
  world.runTag = crypto.randomBytes(6).toString('hex');

  world.env = function (extra) {
    return Object.assign({}, process.env, {
      BANANA_LIVE_FUSION_URL: stub.origin,
      BANANA_LIVE_PROXY_URL: world.proxyOrigin,
      BANANA_LIVE_REGISTRY_DIR: world.registryDir,
      BANANA_LIVE_RUN_TAG: world.runTag,
      BANANA_LIVE_DIGEST_KEY: key,
      FUSION_USER: 'world-user',
      FUSION_PASSWORD: WORLD_CREDENTIAL
    }, extra || {});
  };
  world.close = async function () {
    await stub.close();
    await new Promise(function (r) { proxyServer.closeAllConnections(); proxyServer.close(r); });
    await new Promise(function (r) { targetServer.closeAllConnections(); targetServer.close(r); });
  };
  return world;
}

module.exports = { startWorld: startWorld, root: root };
