'use strict';

// Banana has to load and run under `script-src 'self'; object-src 'none'; frame-ancestors 'self'`, a policy
// with neither 'unsafe-inline' nor 'unsafe-eval'. This test fails when something the policy forbids is
// added to the sources:
//   - an inline <script> or an inline event handler attribute (onclick="...") in index.html or a template,
//   - a javascript: URL in a template,
//   - code that compiles a string (new Function, eval, setTimeout or setInterval called with a string)
//     in Banana's own scripts (the vendored libraries are checked by `node tools/smoke.js --csp`, which
//     runs the built page under the policy), and
//   - removal of ng-csp from the page, which switches AngularJS 1.0.8 from compiling expressions with
//     `new Function` to interpreting them.
// The scan root can be changed with BANANA_CSP_ROOT, which lets the test be pointed at a scratch copy.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.BANANA_CSP_ROOT
  ? path.resolve(process.env.BANANA_CSP_ROOT)
  : path.resolve(__dirname, '..', '..');
const src = path.join(root, 'src');

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); } else { out.push(full); }
  });
  return out;
}

const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const pages = [path.join(src, 'index.html')].concat(walk(path.join(src, 'app'), []).filter((f) => /\.html$/.test(f)));

// Banana's own scripts: not the vendored copies (src/vendor, the libraries under a panel's lib folder,
// Leaflet and its plugins), which are minified or third party.
const ownScripts = walk(path.join(src, 'app'), []).filter((f) =>
  /\.js$/.test(f) && !/\.min\.js$/.test(f) && !/\/panels\/[^/]+\/(lib|leaflet)\//.test(rel(f)));

// A template as the browser parses it, without HTML comments (a commented-out block is not active).
const markup = (file) => fs.readFileSync(file, 'utf8').replace(/<!--(?!\[if|<!\[endif)[\s\S]*?-->/g, '');

test('index.html and the templates have no inline script', () => {
  const found = [];
  pages.forEach((file) => {
    const re = /<script\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(markup(file)))) {
      if (!/\bsrc\s*=/.test(m[1])) { found.push(rel(file)); }
    }
  });
  assert.deepStrictEqual(found, [], 'inline <script> in: ' + found.join(', '));
});

// The names of the inline event handler attributes (onclick, onfocus, ...) in some markup. Attribute values are
// read as quoted strings, so a `>` or an `onclick=` inside a value is neither the end of a tag nor a handler; a
// hyphenated name such as on-select is not a handler.
function inlineHandlers(html) {
  const value = '(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'=<>`]+))?';
  const tag = new RegExp('<[a-z][^\\s/>]*((?:\\s+[^\\s"\'<>/=]+' + value + ')*)\\s*/?>', 'gi');
  const attribute = new RegExp('\\s([^\\s"\'<>/=]+)' + value, 'g');
  const found = [];
  let t;
  while ((t = tag.exec(html))) {
    let a;
    attribute.lastIndex = 0;
    while ((a = attribute.exec(t[1]))) {
      if (/^on[a-z]+$/i.test(a[1])) { found.push(a[1]); }
    }
  }
  return found;
}

test('the handler finder sees a handler after an attribute value that holds a ">"', () => {
  assert.deepStrictEqual(inlineHandlers('<input ng-show="a > b" onclick="x()" onfocus=\'y()\'>'), ['onclick', 'onfocus']);
  assert.deepStrictEqual(inlineHandlers('<input on-select="f()" title="onclick=" data-x=1>'), []);
  assert.deepStrictEqual(inlineHandlers('<button\n  ng-click="a()"\n  onmouseover=go()>'), ['onmouseover']);
});

test('index.html and the templates have no inline event handler or javascript: URL', () => {
  const found = [];
  pages.forEach((file) => {
    const text = markup(file);
    inlineHandlers(text).forEach((name) => found.push(rel(file) + ': ' + name));
    if (/\b(href|src|action)\s*=\s*["']?\s*javascript:/i.test(text)) { found.push(rel(file) + ': javascript: URL'); }
  });
  assert.deepStrictEqual(found, [], 'inline handlers: ' + found.join(', '));
});

test('Banana scripts do not compile a string', () => {
  const found = [];
  const patterns = [
    [/\bnew\s+Function\s*\(/, 'new Function'],
    [/(^|[^.\w$])Function\s*\(\s*['"]/, 'Function(string)'],
    [/(^|[^.\w$])eval\s*\(/, 'eval'],
    [/\b(setTimeout|setInterval)\s*\(\s*['"`]/, 'timer with a string']
  ];
  ownScripts.forEach((file) => {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) { return; }
      patterns.forEach(([re, name]) => { if (re.test(line)) { found.push(rel(file) + ':' + (i + 1) + ' ' + name); } });
    });
  });
  assert.deepStrictEqual(found, [], 'string compilation in: ' + found.join(', '));
});

test('the page switches AngularJS to its policy-safe expression parser (ng-csp)', () => {
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const tags = html.match(/<html\b[^>]*>/gi) || [];
  assert.ok(tags.length > 0, 'index.html has no <html> tag');
  tags.forEach((tag) => assert.match(tag, /\sng-csp\b/, 'ng-csp missing from ' + tag));
});
