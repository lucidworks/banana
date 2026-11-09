'use strict';

// The built page, served with `Content-Security-Policy: script-src 'self'; object-src 'none'; frame-ancestors 'self'`,
// has to start, render every panel and report no policy violation that is not a known harmless one
// (docs/adr/0029-content-security-policy-without-unsafe-eval.md). This runs `node tools/smoke.js --csp`
// on all three base paths in headless Chromium. It is skipped when there is no dist/ (run `npm run build`
// first) or no Chromium for Playwright (`npx playwright install chromium`).
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');

function chromiumInstalled() {
  try {
    return fs.existsSync(require('playwright').chromium.executablePath());
  } catch (e) {
    return false;
  }
}

const skip = !fs.existsSync(path.join(root, 'dist', 'index.html'))
  ? 'dist/ is missing: run npm run build'
  : !chromiumInstalled() && 'Chromium for Playwright is not installed';

test('the built page renders every panel under a policy without unsafe-inline and unsafe-eval', { skip: skip, timeout: 280000 }, function () {
  const run = childProcess.spawnSync(process.execPath, [path.join(root, 'tools', 'smoke.js'), '--csp'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 270000
  });
  assert.strictEqual(run.status, 0, 'tools/smoke.js --csp failed:\n' + run.stdout + run.stderr);
  assert.match(run.stdout, /smoke: all base paths passed/);
});
