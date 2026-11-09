'use strict';

// Helpers for the tests of the hosting image: start a container against a stand-in for
// Fusion that records what it receives, and talk to it with exact control of the request.
// The tests skip when Docker or the image is missing. Build the image first:
//   docker build -t banana-hosting:dev .      (or: npm run test:image)
// BANANA_IMAGE names another image.

const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const IMAGE = process.env.BANANA_IMAGE || 'banana-hosting:dev';

function docker(args, options) {
  return childProcess.spawnSync('docker', args, Object.assign({ encoding: 'utf8', timeout: 120000 }, options || {}));
}

function haveImage() {
  try {
    childProcess.execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 });
    childProcess.execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch (e) {
    return false;
  }
}

const AVAILABLE = haveImage();

// The address under which a container reaches this machine.
let hostIp = null;
function hostAddress() {
  if (!hostIp) {
    const res = docker(['run', '--rm', '--add-host', 'banana-test-host:host-gateway', '--entrypoint', 'sh', IMAGE, '-c', 'grep banana-test-host /etc/hosts']);
    const match = /^(\d+\.\d+\.\d+\.\d+)\s/.exec(res.stdout || '');
    if (!match) {
      throw new Error('cannot find the host address from a container: ' + res.stderr);
    }
    hostIp = match[1];
  }
  return hostIp;
}

// A stand-in for Fusion. It answers GET /api like a gateway (the version and the enabled realms),
// sets a Secure session cookie and an HSTS header on everything, and records every request.
function startUpstream(options) {
  const config = Object.assign({ realms: [{ name: 'native', realmType: 'native' }], version: '5.9.16' }, options || {});
  const seen = [];
  let origin = null;
  const handler = function (req, res) {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    const headers = {
      'content-type': 'application/json',
      'set-cookie': 'id=abc; Path=/; Secure; HttpOnly; SameSite=Lax',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-frame-options': 'DENY'
    };
    if (req.url === '/api/redirect') {
      headers.location = origin + '/landing';
      res.writeHead(302, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    if (req.url === '/api') {
      res.end(JSON.stringify({ enabledRealms: config.realms, version: config.version }));
    } else {
      res.end('{"ok":true}');
    }
   };
  const server = config.tls ? https.createServer({ key: config.tls.key, cert: config.tls.cert }, handler) : http.createServer(handler);
  return new Promise(function (resolve) {
    server.listen(0, '0.0.0.0', function () {
      const port = server.address().port;
      // An https stand-in is reached by the name its certificate carries.
      const name = config.tls ? config.tls.name : hostAddress();
      origin = (config.tls ? 'https://' : 'http://') + name + ':' + port;
      resolve({
        origin: origin,
        host: (config.tls ? config.tls.name : hostAddress()) + ':' + port,
        seen: seen,
        urls: function () { return seen.map(function (s) { return s.url; }); },
        close: function () { return new Promise(function (r) { server.closeAllConnections(); server.close(r); }); }
      });
    });
  });
}

// A self-signed certificate for a DNS name, made with openssl into a temporary directory.
// Returns { key, cert, certFile, name }.
function selfSigned(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-image-tls-'));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const res = childProcess.spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=' + name,
    '-addext', 'subjectAltName=DNS:' + name, '-keyout', keyFile, '-out', certFile], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error('openssl failed: ' + res.stderr);
  }
  process.on('exit', function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), certFile: certFile, name: name };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

const PUBLIC = 'http://banana.test:8080';

// Environment for a container that talks to `upstream`. Plain http on both sides needs the
// development switch, which is on here unless a test turns it off.
function baseEnv(upstream, extra) {
  return Object.assign({
    FUSION_URL: upstream.origin,
    BANANA_PUBLIC_ORIGIN: PUBLIC,
    BANANA_INSECURE_COOKIES: 'on'
  }, extra || {});
}

function envArgs(env) {
  const args = [];
  Object.keys(env).forEach(function (key) {
    args.push('-e', key + '=' + env[key]);
  });
  return args;
}

// Starts a container in the background and waits until /healthz answers.
async function start(env, extraArgs) {
  const name = 'banana-image-test-' + crypto.randomBytes(4).toString('hex');
  const run = docker(['run', '-d', '--name', name, '-p', '127.0.0.1::8080'].concat(extraArgs || [], envArgs(env), [IMAGE]));
  if (run.status !== 0) {
    throw new Error('docker run failed: ' + run.stderr);
  }
  const mapping = docker(['port', name, '8080/tcp']).stdout;
  const port = Number(/:(\d+)\s*$/m.exec(mapping)[1]);
  const container = {
    name: name,
    port: port,
    logs: function () {
      const res = docker(['logs', name]);
      return (res.stdout || '') + (res.stderr || '');
    },
    stop: function () { docker(['rm', '-f', name]); }
  };
  const deadline = Date.now() + 40000;
  for (;;) {
    try {
      const res = await request(container, { path: '/healthz' });
      if (res.status === 200) {
        return container;
      }
    } catch (e) {
      // not ready yet
    }
    const state = docker(['inspect', '-f', '{{.State.Running}}', name]).stdout.trim();
    if (state !== 'true' || Date.now() > deadline) {
      const logs = container.logs();
      container.stop();
      throw new Error('the container did not become ready: ' + logs);
    }
    await sleep(200);
  }
}

// Runs a container to the end (for the cases that must refuse to start) and returns its exit code and output.
// It must not block: the stand-in for Fusion answers the start-up check from this same process.
function runToEnd(env, extraArgs) {
  return new Promise(function (resolve) {
    const child = childProcess.spawn('docker', ['run', '--rm'].concat(extraArgs || [], envArgs(env), [IMAGE]));
    let output = '';
    child.stdout.on('data', function (c) { output += c; });
    child.stderr.on('data', function (c) { output += c; });
    const timer = setTimeout(function () { child.kill('SIGKILL'); }, 60000);
    child.on('close', function (status) {
      clearTimeout(timer);
      resolve({ status: status, output: output });
    });
  });
}

// One request with exact headers (the Host header too). Returns status, headers and body.
function request(container, options) {
  return new Promise(function (resolve, reject) {
    const headers = Object.assign({ host: new URL(PUBLIC).host }, options.headers || {});
    Object.keys(headers).forEach(function (key) {
      if (headers[key] === null) {
        delete headers[key];
      }
    });
    const req = http.request({
      host: '127.0.0.1',
      port: container.port,
      method: options.method || 'GET',
      path: options.path,
      headers: headers,
      setHost: false,
      agent: false
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function () { req.destroy(new Error('timeout')); });
    req.end(options.body);
  });
}

// A request written to the socket as is, for paths Node's client refuses to send.
function rawRequest(container, requestLine, headers) {
  return new Promise(function (resolve, reject) {
    const socket = net.connect(container.port, '127.0.0.1');
    let data = '';
    socket.on('data', function (c) { data += c.toString('latin1'); });
    socket.on('end', function () { resolve(data); });
    socket.on('error', reject);
    socket.setTimeout(10000, function () { socket.destroy(new Error('timeout')); });
    socket.write(requestLine + '\r\nHost: ' + new URL(PUBLIC).host + '\r\n' + (headers || '') + 'Connection: close\r\n\r\n', 'latin1');
  });
}

// Starts a stand-in for Fusion and a container in front of it, runs the body, and cleans up.
// options: env (added to baseEnv), upstream (options of startUpstream), args (extra docker run arguments).
async function scenario(options, body) {
  const upstream = await startUpstream(options.upstream);
  let container = null;
  try {
    container = await start(baseEnv(upstream, options.env), options.args);
    // The start-up check is the one request the stand-in saw so far; keep it for the tests that look.
    upstream.startup = upstream.seen.splice(0);
    await body(container, upstream);
  } finally {
    if (container) {
      container.stop();
    }
    await upstream.close();
  }
}

module.exports = {
  scenario: scenario,
  selfSigned: selfSigned,
  root: root,
  IMAGE: IMAGE,
  AVAILABLE: AVAILABLE,
  PUBLIC: PUBLIC,
  docker: docker,
  startUpstream: startUpstream,
  baseEnv: baseEnv,
  start: start,
  runToEnd: runToEnd,
  request: request,
  rawRequest: rawRequest,
  sleep: sleep
};
