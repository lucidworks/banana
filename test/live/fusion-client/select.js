'use strict';

// Checks for the body of a POST to a select path. A select body is a form
// string whose parameter names and value shapes are a closed table built from
// what Banana sends. Anything outside the table is refused, so the guard needs
// no knowledge of which Solr parameters reroute a request.

const codec = require('./codec');

const FIELD = '[A-Za-z0-9_.*-]+';
const FIELD_LIST = new RegExp('^' + FIELD + '([ ,]+' + FIELD + ')*$');
const SORT = new RegExp('^' + FIELD + ' (asc|desc)(\\s*,\\s*' + FIELD + ' (asc|desc))*$');
const INTEGER = /^-?[0-9]+$/;
const TRUE_FALSE = /^(true|false)$/;
const PIVOT = new RegExp('^(\\{!(tag|stats)=[A-Za-z0-9_]+\\})?' + FIELD + '([ ,]+' + FIELD + ')*$');

function any() {
  return true;
}
function re(pattern) {
  return function (v) {
    return pattern.test(v);
  };
}

// Exact parameter names. `free` values may hold any text except a dollar sign
// and a local-parameters prefix, which every value is checked for.
const PARAMETERS = {
  q: any,
  fq: any,
  wt: re(/^(json|xml|csv)$/),
  rows: re(/^[0-9]+$/),
  omitHeader: re(TRUE_FALSE),
  fl: re(FIELD_LIST),
  sort: re(SORT),
  df: re(new RegExp('^' + FIELD + '$')),
  defType: re(/^(lucene|dismax|edismax|lucid)$/),
  facet: re(/^true$/),
  stats: re(/^true$/),
  hl: re(/^true$/),
  group: re(/^true$/),
  'facet.limit': re(INTEGER),
  'facet.missing': re(TRUE_FALSE),
  'facet.range.hardend': re(TRUE_FALSE),
  'facet.field': re(FIELD_LIST),
  'facet.range': re(FIELD_LIST),
  'stats.facet': re(FIELD_LIST),
  'hl.fl': re(FIELD_LIST),
  'group.field': re(FIELD_LIST),
  'facet.pivot': re(PIVOT),
  'stats.field': re(PIVOT),
  'facet.pivot.mincount': re(INTEGER),
  'hl.fragsize': re(INTEGER),
  'group.limit': re(INTEGER),
  'facet.range.start': re(/^[A-Za-z0-9_:.+/* -]{1,64}$/),
  'facet.range.end': re(/^[A-Za-z0-9_:.+/* -]{1,64}$/),
  'facet.range.gap': re(/^[A-Za-z0-9_:.+/* -]{1,64}$/),
  'facet.range.other': re(/^(before|after|between|all|none)$/),
  'hl.simple.pre': any,
  'hl.simple.post': any
};

// Parameter families with a field name inside the name.
const FAMILIES = [
  { name: new RegExp('^f\\.' + FIELD + '\\.facet\\.limit$'), valid: re(INTEGER) },
  { name: new RegExp('^f\\.' + FIELD + '\\.facet\\.sort$'), valid: re(/^(count|index)$/) }
];

// Parameters that Banana sends only in a GET select, which has no row.
const GET_ONLY_PARAMETERS = ['facet.mincount'];

function refuse(cls, reason) {
  return { cls: cls, reason: reason };
}

function validatorFor(name) {
  if (Object.prototype.hasOwnProperty.call(PARAMETERS, name)) {
    return PARAMETERS[name];
  }
  for (const family of FAMILIES) {
    if (family.name.test(name)) {
      return family.valid;
    }
  }
  return null;
}

// The only content types a select body may have: the form type Banana sends,
// compared case-insensitively, with an optional UTF-8 charset parameter.
function isSelectContentType(contentType) {
  if (typeof contentType !== 'string') {
    return false;
  }
  const parts = contentType.split(';');
  if (parts[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    return false;
  }
  if (parts.length === 1) {
    return true;
  }
  return parts.length === 2 && /^charset=utf-8$/i.test(parts[1].trim());
}

// Check a select body (a Buffer or a string). Returns null when it passes.
function checkSelectBody(body) {
  let raw;
  try {
    raw = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body || new Uint8Array());
  } catch (e) {
    return refuse('bad-param-value', 'the body is not UTF-8');
  }
  const pairs = [];
  if (raw !== '') {
    for (const part of raw.split('&')) {
      const eq = part.indexOf('=');
      const rawName = eq === -1 ? part : part.slice(0, eq);
      const rawValue = eq === -1 ? '' : part.slice(eq + 1);
      const name = codec.formDecode(rawName);
      if (rawName === '' || name === null || name === '' || codec.looksDoublyEncoded(name)) {
        return refuse('unlisted-param', 'a parameter name that is empty, does not decode or is encoded twice');
      }
      const value = codec.formDecode(rawValue);
      if (value === null) {
        return refuse('bad-param-value', 'the value of "' + name + '" does not decode');
      }
      pairs.push({ name: name, value: value });
    }
  }
  if (raw.includes('$') || pairs.some(function (p) { return p.value.includes('$'); })) {
    return refuse('select-write', 'a dollar sign in a select body');
  }
  for (const p of pairs) {
    if (/(^|\.)(shards|qt)(\.|$)/i.test(p.name)) {
      return refuse('refused-param', 'parameter "' + p.name + '" is refused');
    }
  }
  for (const p of pairs) {
    if (validatorFor(p.name) === null) {
      return refuse('unlisted-param', 'parameter "' + p.name + '" is not in the allowed table');
    }
  }
  for (const p of pairs) {
    const valid = validatorFor(p.name);
    const pivot = p.name === 'facet.pivot' || p.name === 'stats.field';
    if (!valid(p.value) || (!pivot && p.value.includes('{!'))) {
      return refuse('bad-param-value', 'the value of "' + p.name + '" has the wrong shape');
    }
  }
  return null;
}

module.exports = {
  PARAMETERS: PARAMETERS,
  FAMILIES: FAMILIES,
  GET_ONLY_PARAMETERS: GET_ONLY_PARAMETERS,
  isSelectContentType: isSelectContentType,
  checkSelectBody: checkSelectBody
};
