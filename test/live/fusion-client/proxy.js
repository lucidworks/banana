'use strict';

// Starts and stops the test proxy container. Code that starts a container, and
// so uses child_process, lives only in this client module. The upstream and the
// digest key are passed to the container by variable name, never as values on
// the command line.

const path = require('node:path');
const net = require('node:net');
const childProcess = require('node:child_process');
const settings = require('./settings');

const PROXY_DIR = path.resolve(__dirname, '..', 'proxy');
const IMAGE = 'nginx:alpine';
// The hosting image reads its upstream from the variable of the same name without the prefix of the
// live-test settings. It is the one upstream variable of the run under another name, not a second setting.
const IMAGE_UPSTREAM_VAR = settings.VAR.fusionUrl.replace(/^BANANA_LIVE_/, '');

function docker(args, env) {
  return childProcess.execFileSync('docker', args, {
    env: env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// A free port on the loopback address. The hosting image has to be told its public address before it
// starts, so the port is chosen here and not by Docker.
function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

function hostArgs(options) {
  const args = [];
  (options.extraHosts || []).forEach(function (host) {
    args.push('--add-host', host);
  });
  return args;
}

// The `docker run` arguments that start the hosting image in front of the instance: the Fusion origin and
// the digest key are given by variable name only, the values come from the environment of the process.
// The image serves Banana at / and, with the mount on, at /admin/banana/ as Fusion does (the live tests
// open the mount). The public address is the loopback address and port the browser uses; the development
// switch is on because that address is plain http.
function imageArgs(options, port) {
  const args = [
    'run', '-d', '--rm', '--name', options.name,
    '-p', '127.0.0.1:' + port + ':8080',
    '-e', IMAGE_UPSTREAM_VAR,
    '-e', 'BANANA_PUBLIC_ORIGIN=http://127.0.0.1:' + port,
    '-e', 'BANANA_INSECURE_COOKIES=on',
    '-e', 'BANANA_ADMIN_MOUNT=on'
  ];
  if (options.digestKey) {
    args.push('-e', settings.VAR.digestKey);
  }
  return args.concat(hostArgs(options), [options.image]);
}

// The `docker run` arguments of the test proxy.
function proxyArgs(options) {
  const args = ['run', '-d', '--rm', '--name', options.name, '-p', '127.0.0.1::8080', '-e', settings.VAR.fusionUrl];
  if (options.digestKey) {
    args.push('-e', settings.VAR.digestKey);
  }
  return args.concat(hostArgs(options), [
    '-v', path.join(PROXY_DIR, 'default.conf.template') + ':/etc/nginx/templates/default.conf.template:ro',
    '-v', path.join(PROXY_DIR, '10-banana-live.envsh') + ':/docker-entrypoint.d/10-banana-live.envsh:ro',
    '-v', options.bananaDir + ':/usr/share/banana:ro',
    IMAGE
  ]);
}

// Start the proxy. options: fusionOrigin, bananaDir (a directory with Banana's
// files), name, digestKey (omit to start without the digest header), extraHosts
// (for tests that point the upstream at the host machine), image (start this hosting image
// instead of the test proxy; bananaDir is then not used, the image carries its own build).
async function startProxy(options) {
  const env = Object.assign({}, process.env);
  env[settings.VAR.fusionUrl] = options.fusionOrigin;
  env[IMAGE_UPSTREAM_VAR] = options.fusionOrigin;
  delete env[settings.VAR.digestKey];
  if (options.digestKey) {
    env[settings.VAR.digestKey] = options.digestKey;
  }
  let port;
  if (options.image) {
    port = await freePort();
    docker(imageArgs(options, port), env);
  } else {
    docker(proxyArgs(options), env);
    try {
      const mapping = docker(['port', options.name, '8080/tcp']);
      port = /:(\d+)\s*$/m.exec(mapping)[1];
    } catch (e) {
      stopProxy(options.name);
      throw new Error('the proxy container did not publish a port');
    }
  }
  const origin = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(origin + settings.BANANA_PATH, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (res.status === 200) {
        break;
      }
    } catch (e) {
      // not ready yet
    }
    if (Date.now() > deadline) {
      stopProxy(options.name);
      throw new Error('the proxy container did not become ready');
    }
    await sleep(250);
  }
  return { origin: origin, name: options.name, stop: function () { stopProxy(options.name); } };
}

function stopProxy(name) {
  try {
    docker(['stop', '-t', '2', name]);
  } catch (e) {
    // already stopped
  }
}

module.exports = { startProxy: startProxy, stopProxy: stopProxy, imageArgs: imageArgs, PROXY_DIR: PROXY_DIR };
