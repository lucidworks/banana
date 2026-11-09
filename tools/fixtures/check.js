#!/usr/bin/env node
'use strict';

/*
 * The scrub check for the recorded fixtures under test/fixtures. A fixture is a response (or a request)
 * recorded from a live system, and those carry identifying data by default, so the check fails when a
 * fixture contains any of the following.
 *
 * Rules that need nothing from the environment (always run):
 *   host     a URL whose host is not localhost or 127.0.0.1 (also after percent-decoding, once or twice, one
 *            %XX at a time, and as a scheme-relative //host); an IPv4 literal other than 127.0.0.1 and 0.0.0.0;
 *            a dotted name with a port, or a hyphenated single-label name with a port (solr-headless:8983),
 *            unless the name is localhost, 127.0.0.1, all digits, or starts with banana-it-; a value under a
 *            key that names a host (host, hostname, origin, referer, *_host, host_s) that is not localhost
 *   header   a cookie, set-cookie, authorization, proxy-authorization, x-api-key, apikey or x-lw-api-key
 *            header: as a key, as a `name` value, as the first element of a name and value pair, or as
 *            `Name:` after any non-word character in text; a Bearer, Basic or Apikey credential
 *   id       a userId, user_id, createdBy, created_by, sessionId or session_id (any case, any non-empty
 *            value that is not the placeholder, strings or not); any id or username in a recorded
 *            /api/session exchange that is not the placeholder; any UUID that is not the placeholder
 *
 * Rules that need the environment of the recording (run only when the variables are set):
 *   FUSION_URL       its host, wherever it appears
 *   FUSION_USER      the user name, as a whole token (it is not matched inside a longer name such as an
 *                    object name that happens to start with it, and the resource type vocabulary is left out)
 *   FUSION_PASSWORD  the password, as text
 *   FUSION_API_KEY   the API key, as text
 *
 * When the environment is not set (CI), the environment-independent rules still run and the result says
 * which rules were skipped. Setting BANANA_REQUIRE_FIXTURE_ENV=1 turns a skip into a failure.
 *
 * Usage: node tools/fixtures/check.js [fixture dir]    (default: test/fixtures)
 */

const fs = require('node:fs');
const path = require('node:path');

const ID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const USER_PLACEHOLDER = 'fixture-user';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\/\s"'?#\\@]*@)?(\[[0-9a-f:]+\]|[^\/\s"'?#\\:]+)/gi;
const HOST_KEY = /^(host|hostname|origin|referer|.*_host|host_s)$/i;
const HEADER_NAMES = 'cookie|set-cookie|authorization|proxy-authorization|x-api-key|apikey|x-lw-api-key';
const HEADER_KEY = new RegExp('^(' + HEADER_NAMES + ')$', 'i');
// a header name followed by a colon, after any character that cannot be part of a name (start of a line or mid-line)
const HEADER_LINE = new RegExp('(^|[^A-Za-z0-9_-])(' + HEADER_NAMES + ')[ \\t]*:', 'i');
// hosts that carry no scheme: an IPv4 literal, a dotted name with a port, and a scheme-relative //host URL
const IPV4 = /(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])/g;
const NAME_PORT = /(?<![A-Za-z0-9.-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+:[0-9]{2,5}(?![0-9])/g;
// a single-label name that has a hyphen and starts with a letter, then a port: the Kubernetes service form
const LABEL_PORT = /(?<![A-Za-z0-9._-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+:[0-9]{2,5}(?![0-9])/g;
const SCHEME_RELATIVE = /(?:^|[\s"'=(,])\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|\[[0-9a-f:]+\])(?=[:\/\s"'?#]|$)/gi;
const BASIC_MIXED = /\bBasic[ \t]+(?=[A-Za-z0-9+\/]*[A-Z][A-Za-z0-9+\/]*[A-Z])[A-Za-z0-9+\/]{12,}={0,2}/;
// a scheme word followed by something that looks like a secret (it has a digit or a symbol), not prose
const CREDENTIAL = /\b(Bearer|Basic|Apikey)[ \t]+(?=[A-Za-z0-9._~+\/=-]*[0-9._~+\/=-])[A-Za-z0-9._~+\/=-]{8,}/;
const ID_KEYS = /^(user_?id|created_?by|session_?id)$/i;

// Fixed application vocabulary that a user name may coincide with: the value of the blob resource type, as a
// query parameter or as a JSON field (also inside a string that holds JSON). It is not the user rule's business.
const VOCABULARY = /resourceType(?:=|\\?"\s*:\s*\\?")[A-Za-z0-9_-]+/g;

// The text with the application vocabulary cut out, so that the user rule does not see it.
function withoutVocabulary(text) {
  return text.replace(VOCABULARY, 'resourceType');
}

function isLocalHost(host) {
  return LOCAL_HOSTS.indexOf(String(host).toLowerCase()) !== -1;
}

// The host of an environment URL, or null when it is not a URL.
function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch (e) {
    return null;
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The user name as a whole token: not part of a longer identifier or object name.
function userPattern(user) {
  return new RegExp('(^|[^A-Za-z0-9_-])' + escapeRegExp(user) + '($|[^A-Za-z0-9_-])');
}

// Every string in a parsed value with the key under which it sits.
function walk(value, key, visit, trail) {
  trail = trail || [];
  if (typeof value === 'string') {
    visit(value, key, trail);
  } else if (Array.isArray(value)) {
    value.forEach(function (v, i) { walk(v, key, visit, trail.concat(String(i))); });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (k) {
      visit(null, k, trail.concat(k), value[k]);
      walk(value[k], k, visit, trail.concat(k));
    });
  }
}

// Strings of a recorded body can themselves hold JSON (a saved dashboard does): look inside as well.
function expand(text) {
  const out = [text];
  const t = text.trim();
  if (t[0] === '{' || t[0] === '[') {
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      // plain text
    }
  }
  return out;
}

function isLocalAddress(ip) {
  return ip === '127.0.0.1' || ip === '0.0.0.0';
}

function hostFindings(text) {
  const out = [];
  let m;
  URL_HOST.lastIndex = 0;
  while ((m = URL_HOST.exec(text)) !== null) {
    if (!isLocalHost(m[1].replace(/^\[|\]$/g, ''))) { out.push('a URL whose host is not localhost'); }
  }
  SCHEME_RELATIVE.lastIndex = 0;
  while ((m = SCHEME_RELATIVE.exec(text)) !== null) {
    if (!isLocalHost(m[1].replace(/^\[|\]$/g, ''))) { out.push('a scheme-relative //host URL whose host is not localhost'); }
  }
  (text.match(IPV4) || []).forEach(function (ip) {
    if (!isLocalAddress(ip)) { out.push('an IPv4 address other than 127.0.0.1'); }
  });
  (text.match(NAME_PORT) || []).concat(text.match(LABEL_PORT) || []).forEach(function (token) {
    const name = token.slice(0, token.lastIndexOf(':')).toLowerCase();
    if (name === 'localhost' || name === '127.0.0.1' || /^[0-9.]+$/.test(name) || name.indexOf('banana-it-') === 0) { return; }
    out.push('a host name with a port');
  });
  return out;
}

function checkText(file, where, text, env, found) {
  // each %XX on its own, so that a stray % does not stop the rest from being decoded; twice, for a double encoding
  const decodeOnce = function (t) {
    return t.replace(/%([0-9A-Fa-f]{2})/g, function (m, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  };
  const once = decodeOnce(text);
  const decoded = decodeOnce(once);
  const seenHost = {};
  hostFindings(text).concat(once !== text ? hostFindings(once) : [], decoded !== once ? hostFindings(decoded) : []).forEach(function (detail) {
    if (!seenHost[detail]) {
      seenHost[detail] = true;
      found.push({ file: file, rule: 'host', where: where, detail: detail });
    }
  });
  if (HEADER_LINE.test(decoded)) {
    found.push({ file: file, rule: 'header', where: where, detail: 'a cookie or authorization header line' });
  }
  if (BASIC_MIXED.test(text)) {
    found.push({ file: file, rule: 'header', where: where, detail: 'a Basic credential' });
  }
  if (CREDENTIAL.test(text)) {
    found.push({ file: file, rule: 'header', where: where, detail: 'a Bearer, Basic or Apikey credential' });
  }
  const uuids = text.match(UUID) || [];
  uuids.forEach(function (u) {
    if (u.toLowerCase() !== ID_PLACEHOLDER) {
      found.push({ file: file, rule: 'id', where: where, detail: 'a UUID that is not the placeholder' });
    }
  });
  // environment-specific rules
  if (env.host && text.toLowerCase().indexOf(env.host.toLowerCase()) !== -1) {
    found.push({ file: file, rule: 'env-host', where: where, detail: 'the host of FUSION_URL' });
  }
  if (env.user && userPattern(env.user).test(withoutVocabulary(text))) {
    found.push({ file: file, rule: 'env-user', where: where, detail: 'the value of FUSION_USER' });
  }
  if (env.password && text.indexOf(env.password) !== -1) {
    found.push({ file: file, rule: 'env-password', where: where, detail: 'the value of FUSION_PASSWORD' });
  }
  if (env.apiKey && text.indexOf(env.apiKey) !== -1) {
    found.push({ file: file, rule: 'env-api-key', where: where, detail: 'the value of FUSION_API_KEY' });
  }
}

// Headers kept as data: {name: 'Set-Cookie', value: ...} (HAR, Playwright) and ['Set-Cookie', ...] pairs.
function headerShapes(file, value, trail, found) {
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === 'string' && HEADER_KEY.test(value[0])) {
      found.push({ file: file, rule: 'header', where: trail.join('.'), detail: 'a ' + value[0] + ' header as a name and value pair' });
    }
    value.forEach(function (v, i) { headerShapes(file, v, trail.concat(String(i)), found); });
  } else if (value && typeof value === 'object') {
    if (typeof value.name === 'string' && HEADER_KEY.test(value.name)) {
      found.push({ file: file, rule: 'header', where: trail.concat('name').join('.'), detail: 'a ' + value.name + ' header as a name field' });
    }
    Object.keys(value).forEach(function (k) { headerShapes(file, value[k], trail.concat(k), found); });
  }
}

function checkValue(file, value, env, found, inSession) {
  headerShapes(file, value, [], found);
  walk(value, '', function (text, key, trail, child) {
    const where = trail.join('.');
    if (text === null) {
      // a key
      if (HEADER_KEY.test(key)) {
        found.push({ file: file, rule: 'header', where: where, detail: 'a ' + key + ' header or field' });
      }
      if (ID_KEYS.test(key) && child !== undefined && child !== null && child !== '' && child !== ID_PLACEHOLDER) {
        found.push({ file: file, rule: 'id', where: where, detail: key + ' is not the placeholder' });
      }
      if (inSession && key === 'id' && typeof child === 'string' && child !== ID_PLACEHOLDER) {
        found.push({ file: file, rule: 'id', where: where, detail: 'an id in a session exchange is not the placeholder' });
      }
      if (inSession && key === 'username' && typeof child === 'string' && child !== USER_PLACEHOLDER) {
        found.push({ file: file, rule: 'id', where: where, detail: 'a username in a session exchange is not the placeholder' });
      }
      if (HOST_KEY.test(key) && typeof child === 'string' && child !== '' && !isLocalHost(child.replace(/:\d+$/, ''))) {
        found.push({ file: file, rule: 'host', where: where, detail: 'the key ' + key + ' holds a host that is not localhost' });
      }
      checkText(file, where + ' (key)', key, env, found);
      return;
    }
    // the value of a resourceType field is application vocabulary (see VOCABULARY)
    const textEnv = key === 'resourceType' ? Object.assign({}, env, { user: null }) : env;
    expand(text).forEach(function (part) {
      if (typeof part === 'string') {
        checkText(file, where, part, textEnv, found);
      } else {
        checkValue(file, part, env, found, inSession);
      }
    });
  });
}

// The environment-specific values, and the rules that cannot run without them.
function readEnv(source) {
  const env = {
    host: source.FUSION_URL ? hostOf(source.FUSION_URL) : null,
    user: source.FUSION_USER || null,
    password: source.FUSION_PASSWORD || null,
    apiKey: source.FUSION_API_KEY || null
  };
  const skipped = [];
  if (!env.host) { skipped.push('env-host (FUSION_URL is not set)'); }
  if (!env.user) { skipped.push('env-user (FUSION_USER is not set)'); }
  if (!env.password) { skipped.push('env-password (FUSION_PASSWORD is not set)'); }
  if (!env.apiKey) { skipped.push('env-api-key (FUSION_API_KEY is not set)'); }
  return { env: env, skipped: skipped };
}

function listFiles(dir) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      listFiles(p).forEach(function (f) { out.push(f); });
    } else {
      out.push(p);
    }
  });
  return out.sort();
}

function isSessionFixture(parsed) {
  const request = parsed && parsed.recordedRequest;
  return !!(request && typeof request.path === 'string' && /^\/api\/session\/?(\?|$)/.test(request.path));
}

/**
 * Checks every file under `dir`. Returns { files, violations, skipped }: a violation names the file (relative
 * to dir), the rule, where in the file and what was found, never the value itself.
 */
function checkDir(dir, source) {
  const read = readEnv(source || {});
  const violations = [];
  const files = listFiles(dir);
  files.forEach(function (file) {
    const rel = path.relative(dir, file);
    const text = fs.readFileSync(file, 'utf8');
    // the raw text is checked as well as the parsed values, so nothing hides in an odd place
    checkText(rel, '(raw text)', text, read.env, violations);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return;
    }
    checkValue(rel, parsed, read.env, violations, isSessionFixture(parsed));
  });
  // one report per file, rule and place
  const seen = new Set();
  const unique = violations.filter(function (v) {
    const k = [v.file, v.rule, v.where, v.detail].join('\u0000');
    if (seen.has(k)) { return false; }
    seen.add(k);
    return true;
  });
  return { files: files.map(function (f) { return path.relative(dir, f); }), violations: unique, skipped: read.skipped };
}

function format(result) {
  const lines = [];
  result.violations.forEach(function (v) {
    lines.push('  ' + v.file + ': rule ' + v.rule + ' at ' + v.where + ': ' + v.detail);
  });
  return lines.join('\n');
}

function skippedNotice(result) {
  if (!result.skipped.length) {
    return null;
  }
  return 'fixture scrub check: the environment-specific rules were SKIPPED (' + result.skipped.join('; ') +
    '). Only the rules that need no environment ran. Set the variables from the recording environment to run all of them.';
}

module.exports = {
  ID_PLACEHOLDER: ID_PLACEHOLDER,
  VOCABULARY: VOCABULARY,
  USER_PLACEHOLDER: USER_PLACEHOLDER,
  checkDir: checkDir,
  format: format,
  skippedNotice: skippedNotice
};

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'test', 'fixtures'));
  const result = checkDir(dir, process.env);
  const notice = skippedNotice(result);
  if (notice) {
    process.stdout.write(notice + '\n');
  }
  if (notice && process.env.BANANA_REQUIRE_FIXTURE_ENV === '1') {
    process.stderr.write('BANANA_REQUIRE_FIXTURE_ENV=1 and the environment-specific rules were skipped\n');
    process.exit(1);
  }
  if (result.violations.length) {
    process.stderr.write('fixture scrub check FAILED, ' + result.violations.length + ' finding(s) in ' + result.files.length + ' file(s):\n' + format(result) + '\n');
    process.exit(1);
  }
  process.stdout.write('fixture scrub check passed: ' + result.files.length + ' file(s)\n');
}
