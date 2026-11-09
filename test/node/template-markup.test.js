'use strict';

// Checks that no HTML template under src/ has a tag left unterminated, for example "</span" followed by
// the next tag instead of "</span>". A browser silently repairs such a mistake, which hides it until the
// repair goes wrong. Templates are AngularJS templates, so "{{ ... }}" expressions, quoted attribute values
// and comments are skipped over; a ">" inside them does not end a tag.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Returns a list of problem descriptions for one template.
function unterminatedTags(text) {
  const problems = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) { problems.push('line ' + lineOf(text, i) + ': unterminated comment'); break; }
      i = end + 3;
      continue;
    }
    if (text.startsWith('{{', i)) {
      const end = text.indexOf('}}', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    const m = text[i] === '<' && /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(text.slice(i, i + 80));
    if (!m) { i++; continue; }
    const start = i;
    i += m[0].length;
    let terminated = false;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") {
        const end = text.indexOf(c, i + 1);
        i = end < 0 ? text.length : end + 1;
      } else if (text.startsWith('{{', i)) {
        const end = text.indexOf('}}', i + 2);
        i = end < 0 ? text.length : end + 2;
      } else if (c === '<') {
        break; // another tag starts before this one ended
      } else if (c === '>') {
        i++;
        terminated = true;
        break;
      } else {
        i++;
      }
    }
    if (!terminated) problems.push('line ' + lineOf(text, start) + ': <' + m[0].slice(1) + ' is not terminated by ">"');
  }
  return problems;
}

function templates(dir) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(templates(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  });
  return out;
}

test('the checker flags a tag that is not terminated', function () {
  const problems = unterminatedTags('<form>\n<span class="a">\n<i></i>\n</span\n</form>\n');
  assert.deepStrictEqual(problems, ['line 4: </span is not terminated by ">"']);
  assert.strictEqual(unterminatedTags('<div class="a"').length, 1);
});

test('the checker accepts AngularJS template syntax', function () {
  const good = '<div ng-class="{a: x > 1, b: y < 2}" title="{{ a > b ? \'x\' : \'y\' }}">\n' +
    '<input type="text" ng-model="m"/><br>\n<ul><li>one<li>two</ul>{{ n < 3 }} 1 < 2 <!-- <b --></div>\n';
  assert.deepStrictEqual(unterminatedTags(good), []);
});

test('no template under src has an unterminated tag', function () {
  const files = templates(path.join(root, 'src'));
  assert.ok(files.length > 50, 'expected to find the shipped templates, found ' + files.length);
  const failures = [];
  files.forEach(function (file) {
    unterminatedTags(fs.readFileSync(file, 'utf8')).forEach(function (p) {
      failures.push(path.relative(root, file) + ' ' + p);
    });
  });
  assert.deepStrictEqual(failures, []);
});
