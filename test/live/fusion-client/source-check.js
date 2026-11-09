'use strict';

// The source check that backs the claim "only the guarded path". It scans every
// file under test/live (and the test:live entries of package.json) except this
// client module, and refuses the idioms that would reach the network or the
// browser without the rule set. It is a tripwire for honest mistakes, not a
// sandbox: a call hidden from the text (built from strings, or by a
// dependency) is not seen.

const fs = require('node:fs');
const path = require('node:path');

const PINNED_PLAYWRIGHT = '1.65.0';

// Tokens that match as substrings of identifiers.
const SUBSTRING_TOKENS = [
  'newContext', 'newPage', 'launchPersistentContext', 'launchServer', 'connectOverCDP',
  'newCDPSession', 'newBrowserCDPSession', '_innerFetch', '_android', '_electron',
  '_playwright', '_channel', '_combinedContextOptions', 'mergeTests',
  'XMLHttpRequest', 'sendBeacon', 'axios', 'undici', 'APIRequestContext',
  'routeFromHAR', 'routeWebSocket',
  // the fixtures and members that belong to the client module alone
  '_session', '_guard', '_guardedBrowser', '_once', '_fetch'
];

const ID = '(?![A-Za-z0-9_$])';
const NOT_ID = '(?<![A-Za-z0-9_$])';

// [pattern, label]
const PATTERNS = [
  [new RegExp('\\.\\s*connect' + ID), '.connect'],
  [new RegExp('\\.\\s*launch' + ID), '.launch'],
  [new RegExp('\\.\\s*extend' + ID), '.extend'],
  [new RegExp(NOT_ID + 'fetch' + ID), 'the identifier fetch'],
  [/node-fetch/, 'node-fetch'],
  [new RegExp(NOT_ID + 'got\\s*\\('), 'got('],
  [/(?:from\s*|require\s*\(\s*|import\s*\(\s*|import\s+)['"]got['"]/, 'the got module'],
  [/\.\s*request(?!\s*\()/, 'a .request property access'],
  [/\[\s*['"`]request['"`]\s*\]/, "a ['request'] property access"],
  [new RegExp('\\{[^{}]*(?<![A-Za-z0-9_$.\'"`])request(?![A-Za-z0-9_$(\'"`])[^{}]*\\}'), 'a destructuring pattern that names request'],
  [/request\s*\.\s*newContext/, 'request.newContext'],
  [/\.\s*route\s*\(/, '.route('],
  [/\.\s*unroute/, '.unroute'],
  [/\.\s*ledger/, '.ledger'],
  [/route\s*\.\s*continue\s*\(\s*[^)\s]/, 'route.continue( with an override'],
  [/(?:require\s*\(\s*|from\s*|import\s*\(\s*|import\s+)['"](?:node:)?(?:http|https|http2|net|tls|dgram|child_process)['"]/, 'a network or process module'],
  [/\bhttps?\s*\.\s*request/, 'http.request']
];

const SCRIPT_EXTENSIONS = /\.(?:sh|bash|envsh)$/;
const SOURCE_EXTENSIONS = /\.(?:js|mjs|cjs|ts|mts|cts|jsx|tsx|sh|bash|envsh)$/;
const PLAYWRIGHT_MODULE = /^(?:playwright|playwright-core)(?:\/|$)/;
const TEST_MODULE = '@playwright/test';

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function quoted(name) {
  return '[\'"]' + name.replace(/[/@]/g, '\\$&') + '[\'"]';
}

// Check the import and require forms of one source text.
function checkImports(text, file, isSpec, out) {
  // import ... from '@playwright/test'
  const importRe = /import\s+(type\s+)?([^;'"]*?)\s*from\s*(['"])([^'"]+)\3/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[4];
    if (PLAYWRIGHT_MODULE.test(spec)) {
      out.push({ file: file, line: lineOf(text, m.index), rule: 'import of ' + spec });
    } else if (spec === TEST_MODULE && !m[1]) {
      const clause = m[2].trim();
      const named = /^\{([^}]*)\}$/.exec(clause);
      const ok = named && named[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean).every(function (n) {
        return /^type\s/.test(n) || n === 'expect' || /^expect\s+as\s+[A-Za-z_$][\w$]*$/.test(n);
      });
      if (!ok) {
        out.push({ file: file, line: lineOf(text, m.index), rule: 'an import from @playwright/test other than expect and types' });
      }
    }
  }
  // import '@playwright/test' with no names, and dynamic import() of either
  const bareRe = /import\s*(?:\(\s*)?(['"])([^'"]+)\1/g;
  while ((m = bareRe.exec(text)) !== null) {
    if (PLAYWRIGHT_MODULE.test(m[2]) || m[2] === TEST_MODULE) {
      out.push({ file: file, line: lineOf(text, m.index), rule: 'a bare or dynamic import of ' + m[2] });
    }
  }
  const requireRe = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = requireRe.exec(text)) !== null) {
    if (PLAYWRIGHT_MODULE.test(m[2]) || m[2] === TEST_MODULE) {
      out.push({ file: file, line: lineOf(text, m.index), rule: 'require of ' + m[2] });
    }
  }
  if (/\bdefineConfig\b/.test(text)) {
    out.push({ file: file, line: lineOf(text, text.search(/\bdefineConfig\b/)), rule: 'defineConfig outside the client module' });
  }
  if (isSpec) {
    const fromFixture = /(?:\{[^}]*\btest\b[^}]*\}\s*=\s*require\s*\(\s*['"][^'"]*fusion-client(?:\/index(?:\.js)?)?['"]\s*\)|import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"][^'"]*fusion-client(?:\/index(?:\.js)?)?['"])/;
    if (!fromFixture.test(text)) {
      out.push({ file: file, line: 1, rule: 'a spec that does not import test from the fixture module' });
    }
  }
}

// Scan one text. `file` is a label for messages; `isSpec` applies the import
// rule for specs; `script` also applies the curl and wget rule.
function checkText(text, file, options) {
  const out = [];
  const opts = options || {};
  SUBSTRING_TOKENS.forEach(function (token) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) {
        break;
      }
      out.push({ file: file, line: lineOf(text, at), rule: 'the token ' + token });
      from = at + token.length;
    }
  });
  PATTERNS.forEach(function (entry) {
    const re = new RegExp(entry[0].source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ file: file, line: lineOf(text, m.index), rule: entry[1] });
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
  });
  if (opts.script && /\b(?:curl|wget)\b/.test(text)) {
    out.push({ file: file, line: lineOf(text, text.search(/\b(?:curl|wget)\b/)), rule: 'curl or wget in a script' });
  }
  checkImports(text, file, !!opts.spec, out);
  return out;
}

function walk(dir, skip, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip(full)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, skip, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

// Scan the tree under `liveDir` (test/live), except the client module, and the
// test:live entries of the package.json at `packageJson`.
function checkTree(liveDir, packageJson) {
  const clientDir = path.join(liveDir, 'fusion-client');
  const out = [];
  const files = walk(liveDir, function (full) {
    return full === clientDir || path.basename(full) === 'node_modules';
  }, []);
  for (const file of files) {
    const rel = path.relative(liveDir, file);
    if (/(?:^|\/)playwright\.config\.[cm]?[jt]s$/.test(rel)) {
      out.push({ file: rel, line: 1, rule: 'a Playwright configuration file outside the client module' });
    }
    if (!SOURCE_EXTENSIONS.test(file)) {
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    out.push.apply(out, checkText(text, rel, { spec: /\.spec\.[^.]+$/.test(file), script: SCRIPT_EXTENSIONS.test(file) }));
  }
  if (packageJson && fs.existsSync(packageJson)) {
    const scripts = JSON.parse(fs.readFileSync(packageJson, 'utf8')).scripts || {};
    Object.keys(scripts).filter(function (k) { return /^test:live/.test(k); }).forEach(function (key) {
      if (/\b(?:curl|wget)\b/.test(scripts[key])) {
        out.push({ file: 'package.json', line: 1, rule: 'curl or wget in the ' + key + ' entry' });
      }
    });
  }
  return out;
}

// The markers the fixture's own file must keep. Deleting any of them is a
// failure, so the guard installation cannot be removed unnoticed.
const FIXTURE_MARKERS = [
  ['the route installation', 'context.route(/.*/'],
  ['the WebSocket route', 'context.routeWebSocket('],
  ['the wrapper of playwright', 'await use(wrapPlaywright(playwright));'],
  ['the override of playwright', 'playwright: ['],
  ['the override of request', 'request: ['],
  ['the override of browser', 'browser: ['],
  ['the override of _combinedContextOptions', '_combinedContextOptions: ['],
  ['the explicit context keys', 'options.contextOptions('],
  ['the explicit launch keys', 'options.launchOptions()'],
  ['the no-op logger', 'NOOP_LOGGER'],
  ['the dependency on _browserOptions', '_browserOptions, _session'],
  ['the replacement of the request-class methods', 'patchRequestClass(context);']
];

function checkFixtureSource(text) {
  return FIXTURE_MARKERS.filter(function (m) { return text.indexOf(m[1]) === -1; }).map(function (m) {
    return { file: 'fixture.js', line: 1, rule: 'the fixture no longer contains ' + m[0] };
  });
}

// The installed Playwright must be the pinned version, an exact one, in
// package.json and in the lockfile when there is one.
function checkPlaywrightVersion(root) {
  const out = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = (pkg.devDependencies || {})['@playwright/test'];
  if (declared !== PINNED_PLAYWRIGHT) {
    out.push({ file: 'package.json', line: 1, rule: '@playwright/test is declared as ' + declared + ', not exactly ' + PINNED_PLAYWRIGHT });
  }
  ['@playwright/test', 'playwright', 'playwright-core'].forEach(function (name) {
    let installed = null;
    try {
      installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch (e) {
      installed = null;
    }
    if (installed !== PINNED_PLAYWRIGHT) {
      out.push({ file: 'node_modules/' + name, line: 1, rule: 'the installed version is ' + installed + ', not ' + PINNED_PLAYWRIGHT });
    }
  });
  const lock = path.join(root, 'package-lock.json');
  if (fs.existsSync(lock)) {
    const packages = JSON.parse(fs.readFileSync(lock, 'utf8')).packages || {};
    const entry = packages['node_modules/@playwright/test'];
    if (!entry || entry.version !== PINNED_PLAYWRIGHT) {
      out.push({ file: 'package-lock.json', line: 1, rule: 'the lockfile does not pin @playwright/test to ' + PINNED_PLAYWRIGHT });
    }
  }
  return out;
}

// Run every check for a repository root. Returns a list of findings.
function checkAll(root) {
  const liveDir = path.join(root, 'test', 'live');
  const fixture = fs.readFileSync(path.join(liveDir, 'fusion-client', 'fixture.js'), 'utf8');
  return [].concat(
    checkTree(liveDir, path.join(root, 'package.json')),
    checkFixtureSource(fixture),
    checkPlaywrightVersion(root)
  );
}

module.exports = {
  PINNED_PLAYWRIGHT: PINNED_PLAYWRIGHT,
  FIXTURE_MARKERS: FIXTURE_MARKERS,
  checkText: checkText,
  checkTree: checkTree,
  checkFixtureSource: checkFixtureSource,
  checkPlaywrightVersion: checkPlaywrightVersion,
  checkAll: checkAll
};

if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..', '..');
  const findings = checkAll(root);
  findings.forEach(function (f) {
    process.stderr.write(f.file + ':' + f.line + ': ' + f.rule + '\n');
  });
  if (findings.length) {
    process.stderr.write('the live-test source check found ' + findings.length + ' problem(s)\n');
    process.exit(1);
  }
  process.stdout.write('the live-test source check passed\n');
}
