'use strict';

// Checks for stream and graph requests (GET, one `expr` parameter). The content
// of the expression decides whether the request is a read, so it is scanned
// here. Every constant below changes only together with its tests.

const codec = require('./codec');

// The functions a stream expression may call: the ones the panels build plus
// plain aggregation functions.
const FUNCTIONS = new Set([
  'search', 'nodes', 'fetch', 'select', 'significantTerms', 'timeseries',
  'facet', 'stats', 'random', 'sort', 'top', 'count', 'sum', 'avg', 'min',
  'max', 'rollup'
]);

// The functions whose first argument names a collection.
const COLLECTION_FUNCTIONS = new Set([
  'search', 'nodes', 'fetch', 'facet', 'stats', 'random', 'timeseries',
  'significantTerms'
]);

// The named arguments the panels build.
const ARGUMENTS = new Set([
  'q', 'fq', 'fl', 'sort', 'rows', 'field', 'limit', 'minDocFreq',
  'maxDocFreq', 'minTermLength', 'walk', 'gather', 'scatter', 'trackTraversal',
  'on', 'start', 'end', 'gap'
]);

// The collections a read may name, in a path and in an expression.
const COLLECTION_PATTERN = /^(_system|system_logs|banana-it-[A-Za-z0-9_.-]+)$/;

// Characters that end a function or argument name.
const SEPARATORS = '\\s\\u0000-\\u001f\\u007f(),="\'\\[\\]{}';
const NAME_CALL = new RegExp('([^' + SEPARATORS + ']+)\\s*\\(', 'g');
const NAME_EQ = new RegExp('([^' + SEPARATORS + ']+)\\s*=', 'g');
const NAME_START = new RegExp('^[^' + SEPARATORS + ']+\\s*=');
const CALL_WHOLE = new RegExp('^[^' + SEPARATORS + ']+\\s*\\(');

function refuse(cls, reason) {
  return { cls: cls, reason: reason };
}

// True when a name has shards or qt as a dot-separated component.
function isRefusedName(name) {
  return /(^|\.)(shards|qt)(\.|$)/i.test(name);
}

// Mask the double-quoted strings and check that quotes and brackets balance.
// Backslashes and single quotes are refused before this runs, so a quote
// always starts or ends a string.
function mask(expr) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let out = '';
  let inQuote = false;
  for (const c of expr) {
    if (c === '"') {
      inQuote = !inQuote;
      out += '"';
    } else if (inQuote) {
      out += '\u0001';
    } else {
      if (c === '(' || c === '[' || c === '{') {
        stack.push(c);
      } else if (c === ')' || c === ']' || c === '}') {
        if (stack.pop() !== pairs[c]) {
          return null;
        }
      }
      out += c;
    }
  }
  return inQuote || stack.length ? null : out;
}

// The index of the bracket that closes the one opened at `open`.
function closing(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

// Split the text between two brackets at its top-level commas.
function splitArgs(text) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  args.push(text.slice(start));
  return args;
}

// Scan a decoded expression. Returns null when it passes.
function scanExpression(expr) {
  const masked = mask(expr);
  if (masked === null) {
    return refuse('stream-scope', 'quotes or brackets do not balance');
  }
  let m;
  NAME_CALL.lastIndex = 0;
  while ((m = NAME_CALL.exec(masked)) !== null) {
    const name = m[1];
    if (!FUNCTIONS.has(name)) {
      return refuse('stream-write', 'function "' + name + '" is not in the allowed set');
    }
    if (!COLLECTION_FUNCTIONS.has(name)) {
      continue;
    }
    const open = m.index + m[0].length - 1;
    const close = closing(masked, open);
    const args = splitArgs(masked.slice(open + 1, close));
    const first = args[0].trim();
    if (!COLLECTION_PATTERN.test(first)) {
      return refuse('stream-scope', 'the first argument of ' + name + ' is not a permitted collection');
    }
    for (let i = 1; i < args.length; i++) {
      const arg = args[i].trim();
      // A later argument is a named argument or a call of a function.
      if (!NAME_START.test(arg) && !(CALL_WHOLE.test(arg) && arg.endsWith(')'))) {
        return refuse('stream-scope', name + ' has a positional argument after the first');
      }
    }
  }
  NAME_EQ.lastIndex = 0;
  while ((m = NAME_EQ.exec(masked)) !== null) {
    const name = m[1];
    if (isRefusedName(name)) {
      return refuse('refused-param', 'argument "' + name + '" is refused');
    }
    if (!ARGUMENTS.has(name)) {
      return refuse('unlisted-param', 'argument "' + name + '" is not in the allowed list');
    }
  }
  return null;
}

// Check the raw query string of a stream or graph request.
function checkStreamQuery(rawQuery) {
  if (rawQuery.includes('$')) {
    return refuse('stream-write', 'a dollar sign in the query string');
  }
  const parts = rawQuery === '' ? [] : rawQuery.split('&');
  if (parts.length !== 1) {
    return refuse('unlisted-param', 'a stream request carries exactly one expr parameter');
  }
  const pairs = codec.parsePairs(rawQuery);
  if (pairs === null) {
    return refuse('bad-param-value', 'the query string does not decode');
  }
  const pair = pairs[0];
  if (pair.name !== 'expr' || !pair.rawValue.length || !pair.value.length) {
    return refuse('unlisted-param', 'a stream request carries exactly one non-empty expr parameter');
  }
  const value = pair.value;
  if (value.includes('$')) {
    return refuse('stream-write', 'a dollar sign in the expression');
  }
  if (codec.looksDoublyEncoded(value)) {
    return refuse('bad-param-value', 'the expression is encoded twice');
  }
  if (value.includes('{!')) {
    return refuse('stream-scope', 'a local-parameters prefix in the expression');
  }
  if (value.includes('\\') || value.includes('\'')) {
    return refuse('stream-scope', 'a backslash or a single quote in the expression');
  }
  return scanExpression(value);
}

module.exports = {
  FUNCTIONS: FUNCTIONS,
  COLLECTION_FUNCTIONS: COLLECTION_FUNCTIONS,
  ARGUMENTS: ARGUMENTS,
  COLLECTION_PATTERN: COLLECTION_PATTERN,
  scanExpression: scanExpression,
  checkStreamQuery: checkStreamQuery
};
