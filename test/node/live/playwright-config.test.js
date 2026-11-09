'use strict';

// The live Playwright configuration must not let Playwright write a page
// snapshot, trace, screenshot or video, which can hold what was typed on the
// login page, and must write nothing inside the repository.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const configPath = path.join(root, 'test', 'live', 'fusion-client', 'playwright.config.js');

function loadConfig(outputEnv) {
  const saved = { out: process.env.BANANA_LIVE_OUTPUT_DIR, prompt: process.env.PLAYWRIGHT_NO_COPY_PROMPT };
  delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
  if (outputEnv === undefined) {
    delete process.env.BANANA_LIVE_OUTPUT_DIR;
  } else {
    process.env.BANANA_LIVE_OUTPUT_DIR = outputEnv;
  }
  delete require.cache[configPath];
  try {
    const config = require(configPath);
    const made = process.env.BANANA_LIVE_OUTPUT_DIR;
    if (outputEnv === undefined && made) {
      // the fallback directory the config created
      fs.rmSync(made, { recursive: true, force: true });
    }
    return { config: config, prompt: process.env.PLAYWRIGHT_NO_COPY_PROMPT };
  } finally {
    delete require.cache[configPath];
    if (saved.out === undefined) { delete process.env.BANANA_LIVE_OUTPUT_DIR; } else { process.env.BANANA_LIVE_OUTPUT_DIR = saved.out; }
    if (saved.prompt === undefined) { delete process.env.PLAYWRIGHT_NO_COPY_PROMPT; } else { process.env.PLAYWRIGHT_NO_COPY_PROMPT = saved.prompt; }
  }
}

function insideRepo(dir) {
  const rel = path.relative(root, path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

test('the live config turns trace, screenshot and video off', function () {
  const use = loadConfig().config.use;
  assert.strictEqual(use.trace, 'off');
  assert.strictEqual(use.screenshot, 'off');
  assert.strictEqual(use.video, 'off');
});

test('the live config switches off the failure page snapshot when it loads', function () {
  assert.strictEqual(loadConfig().prompt, '1');
});

test('the live output directory is outside the repository, with or without the launcher\'s directory', function () {
  const fallback = loadConfig().config.outputDir;
  assert.ok(!insideRepo(fallback));
  assert.match(path.basename(fallback), /^banana-live-out-/);
  assert.ok(!insideRepo(loadConfig(path.join(require('node:os').tmpdir(), 'x')).config.outputDir));
});

test('the launcher gives the run its own temporary output directory and removes it', function () {
  const text = fs.readFileSync(path.join(root, 'test', 'live', 'fusion-client', 'launcher.js'), 'utf8');
  assert.match(text, /mkdtempSync\(path\.join\(os\.tmpdir\(\)/);
  assert.match(text, /BANANA_LIVE_OUTPUT_DIR = outputDir/);
  assert.match(text, /PLAYWRIGHT_NO_COPY_PROMPT = '1'/);
  assert.match(text, /rmSync\(outputDir/);
});

test('the login helper does not pass the password to locator.fill, which logs its value', function () {
  const text = fs.readFileSync(path.join(root, 'test', 'live', 'fusion-client', 'fixture.js'), 'utf8');
  assert.ok(!/\.fill\([^)]*password/.test(text));
  assert.match(text, /setValue\(password, '', 1000\)/);
});
