'use strict';

// The coordinator behind `npm run test:live`. It runs the source check, issues
// the run tag and the digest key, starts the proxy container, and then starts
// Playwright with the configuration of this module. A process started any other
// way finds no run tag and refuses to start before it sends anything.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const settings = require('./settings');
const sourceCheck = require('./source-check');
const registry = require('./registry');
const proxy = require('./proxy');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

async function main(argv) {
  const findings = sourceCheck.checkAll(ROOT);
  if (findings.length) {
    findings.forEach(function (f) {
      process.stderr.write(f.file + ':' + f.line + ': ' + f.rule + '\n');
    });
    fail('the live-test source check found ' + findings.length + ' problem(s); nothing was started');
  }
  const env = Object.assign({}, process.env);
  let fusionOrigin;
  try {
    fusionOrigin = settings.originOf(env[settings.VAR.fusionUrl] || '', settings.VAR.fusionUrl);
    registry.checkRegistryDir(env[settings.VAR.registryDir]);
  } catch (e) {
    fail(e.message);
  }
  if (!env[settings.VAR.user] || !env[settings.VAR.credential]) {
    fail('FUSION_USER and FUSION_PASSWORD must be set');
  }
  env[settings.VAR.fusionUrl] = fusionOrigin;
  env[settings.VAR.runTag] = crypto.randomBytes(6).toString('hex');
  env[settings.VAR.digestKey] = crypto.randomBytes(32).toString('hex');
  // Playwright's output goes to a temporary directory outside the repository,
  // removed after the run.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-live-out-'));
  env.BANANA_LIVE_OUTPUT_DIR = outputDir;
  env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
  const bananaDir = path.resolve(env[settings.VAR.bananaDir] || path.join(ROOT, 'dist'));

  const running = await proxy.startProxy({
    fusionOrigin: fusionOrigin,
    digestKey: env[settings.VAR.digestKey],
    bananaDir: bananaDir,
    // BANANA_LIVE_IMAGE names a hosting image to run in place of the test proxy.
    image: env[settings.VAR.image] || undefined,
    name: 'banana-live-proxy-' + env[settings.VAR.runTag]
  });
  env[settings.VAR.proxyUrl] = running.origin;

  const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const child = childProcess.spawn(process.execPath, [cli, 'test', '--config', path.join(__dirname, 'playwright.config.js')].concat(argv), {
    env: env,
    stdio: 'inherit'
  });
  const forward = function (signal) {
    child.kill(signal);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const code = await new Promise(function (resolve) {
    child.on('exit', function (c, signal) { resolve(c === null ? 1 : c); });
  });
  running.stop();
  fs.rmSync(outputDir, { recursive: true, force: true });
  process.stdout.write('run tag ' + env[settings.VAR.runTag] + '\n');
  process.exit(code);
}

main(process.argv.slice(2)).catch(function (e) {
  fail(e.message);
});
