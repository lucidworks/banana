'use strict';

// Select POST bodies: the parameter table, the content type, and the drift
// test against the parameter names Banana's own code builds.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers');

const select = load('select.js');
const stream = load('stream.js');

const root = path.resolve(__dirname, '..', '..', '..');

function pass(body) {
  assert.strictEqual(select.checkSelectBody(body), null, body);
}

function refuse(body, cls) {
  const bad = select.checkSelectBody(body);
  assert.ok(bad, 'should be refused: ' + body);
  assert.strictEqual(bad.cls, cls, body + ' refused as ' + bad.cls + ' (' + bad.reason + ')');
}

test('content type: the form type, with at most an optional UTF-8 charset', function () {
  ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded; charset=UTF-8', 'application/x-www-form-urlencoded;charset=utf-8',
    'Application/X-WWW-Form-Urlencoded'].forEach(function (t) {
    assert.strictEqual(select.isSelectContentType(t), true, t);
  });
  ['application/x-www-form-urlencoded; charset=ISO-8859-1', 'application/x-www-form-urlencoded; charset=UTF-16',
    'application/x-www-form-urlencoded; charset=UTF-8; x=1', 'application/x-www-form-urlencoded; x=1', 'multipart/form-data',
    'application/json', 'text/plain', '', undefined, null].forEach(function (t) {
    assert.strictEqual(select.isSelectContentType(t), false, String(t));
  });
});

test('a body built the way the panels build one passes', function () {
  [
    'q=*%3A*&wt=json&rows=0&fq=timestamp_tdt:[NOW/DAY-1DAY%20TO%20NOW]&facet=true&facet.range=timestamp_tdt&facet.range.start=NOW/DAY-30DAY&facet.range.end=NOW&facet.range.gap=%2B1DAY&facet.limit=10',
    'q=message_t%3Aerror&fq=level_s:"ERROR"&fq=-host_s:"a"&wt=json&omitHeader=true&rows=50&sort=timestamp_tdt%20desc&fl=id,message_t,timestamp_tdt',
    'q=*%3A*&facet=true&facet.field=level_s&facet.limit=-1&facet.missing=true&f.level_s.facet.limit=5&f.level_s.facet.sort=count&wt=json&rows=0',
    'q=*%3A*&wt=json&rows=0&facet=true&facet.pivot={!tag=t1}level_s,host_s&facet.pivot.mincount=1&stats=true&stats.field={!stats=t1}price_f&stats.facet=level_s',
    'q=*%3A*&wt=csv&rows=0&hl=true&hl.fl=message_t&hl.fragsize=100&hl.simple.pre=%3Cem%3E&hl.simple.post=%3C%2Fem%3E',
    'q=*%3A*&group=true&group.field=host_s&group.limit=5&wt=json',
    'q=*:*&df=message_t&defType=edismax&fq=a:b',
    'q=*%3A*&facet=true&facet.range=ts&facet.range.start=2021-04-19T00:00:00.000Z&facet.range.end=NOW&facet.range.gap=%2B1HOUR&facet.range.other=before&facet.range.hardend=true',
    'q=a+b',
    ''
  ].forEach(pass);
});

test('every row of the parameter table is allowed with a value of its shape', function () {
  const samples = {
    q: ['*:*', 'a b', '"x y"', ''],
    fq: ['a:b', '-a:"b"', 'a:[1 TO 2]'],
    wt: ['json', 'xml', 'csv'],
    rows: ['0', '10', '100000'],
    omitHeader: ['true', 'false'],
    fl: ['id', '*', 'id,score', 'a b', 'a.b_c-d'],
    sort: ['a asc', 'a desc', 'a asc,b desc', 'a_s desc, b_t asc'],
    df: ['text'],
    defType: ['lucene', 'dismax', 'edismax', 'lucid'],
    facet: ['true'], stats: ['true'], hl: ['true'], group: ['true'],
    'facet.limit': ['10', '-1'],
    'facet.missing': ['true', 'false'], 'facet.range.hardend': ['true', 'false'],
    'facet.field': ['a', 'a,b'], 'facet.range': ['ts'], 'stats.facet': ['a'], 'hl.fl': ['a'], 'group.field': ['a'],
    'facet.pivot': ['a,b', '{!tag=x1}a,b', '{!stats=y_2}a'],
    'stats.field': ['a', '{!tag=x1}a', '{!stats=x}a'],
    'facet.pivot.mincount': ['1'], 'hl.fragsize': ['100'], 'group.limit': ['3'],
    'facet.range.start': ['NOW/DAY-30DAY', '2021-04-19T00:00:00.000Z', '*', '0'],
    'facet.range.end': ['NOW', '100'], 'facet.range.gap': ['+1DAY', '10', '+1HOUR'],
    'facet.range.other': ['before', 'after', 'between', 'all', 'none'],
    'hl.simple.pre': ['<em>', ''], 'hl.simple.post': ['</em>'],
    'f.price_f.facet.limit': ['5'], 'f.a.b.facet.sort': ['count', 'index']
  };
  Object.keys(select.PARAMETERS).forEach(function (name) {
    assert.ok(samples[name], 'no sample for ' + name);
  });
  Object.keys(samples).forEach(function (name) {
    samples[name].forEach(function (value) {
      pass(encodeURIComponent(name) + '=' + encodeURIComponent(value));
    });
  });
});

test('shards and qt are refused as a name component, also inside an allowed family', function () {
  ['shards', 'shards.qt', 'x.shards', 'shards.x', 'SHARDS', 'Shards', 'qt', 'QT', 'x.qt', 'f.qt.facet.limit', 'f.shards.facet.sort', 'qt.x'].forEach(function (name) {
    refuse('q=*&' + name + '=a', 'refused-param');
    refuse(name + '=a&q=*', 'refused-param');
  });
  // the shards parameter carrying an address
  refuse('q=*&shards=other:8983/solr/admin/collections%3Faction%3DDELETE%26name%3Dx%26y%3D', 'refused-param');
  // a field query on a field called shards is a value, not a parameter
  pass('q=shards%3Afoo');
  pass('q=qt%3Afoo&fq=shards:bar');
});

test('a name outside the table is refused as unlisted', function () {
  ['collection', 'distrib', 'start', 'echoParams', 'debug', 'json.nl', 'expr', 'stmt', 'stream.body', 'stream.url', 'tr', 'q.op',
    'zkHost', 'facet.mincount', 'facet.sort', 'facet.offset', 'mm', 'bf', 'indent', 'json', 'WT', 'Q', 'f..facet.limit',
    'f.a b.facet.limit', 'f.a.facet.other', 'hl.snippets', 'cursorMark', 'timeAllowed', 'shards.tolerant'].forEach(function (name) {
    if (/shards/.test(name)) {
      refuse('q=*&' + name + '=1', 'refused-param');
    } else {
      refuse('q=*&' + name + '=1', 'unlisted-param');
    }
  });
});

test('an empty, undecodable or doubly encoded name is refused as unlisted', function () {
  refuse('=a', 'unlisted-param');
  refuse('q=*&=a', 'unlisted-param');
  refuse('q=*&&wt=json', 'unlisted-param');
  refuse('q=*&%zz=1', 'unlisted-param');
  refuse('q=*&%FF=1', 'unlisted-param');
  refuse('q=*&%2577t=json', 'unlisted-param');
  refuse('q=*&w%2574=json', 'unlisted-param');
});

test('a value of the wrong shape is refused', function () {
  [
    'wt=javabin', 'wt=velocity', 'wt=JSON', 'wt=', 'defType=xmlparser', 'defType=func', 'fl=[subquery]', 'fl=docs:[shard]', 'fl=a,[docid]',
    'fl=', 'rows=-1', 'rows=a', 'rows=1.5', 'rows=', 'sort=x', 'sort=x%20up', 'sort=a%20asc%3Bb%20desc', 'sort=%7B!func%7Dx%20asc',
    'omitHeader=1', 'facet=false', 'facet=1', 'hl=yes', 'facet.limit=a', 'facet.limit=1.5', 'facet.missing=maybe',
    'facet.field=%7B!terms%20f%3Did%7Da', 'facet.field=a;b', 'facet.range.start=%7B!x%7D',
    'facet.range.start=' + 'a'.repeat(65), 'facet.range.start=', 'facet.range.gap=a%0Ab', 'facet.range.other=other',
    'f.a.facet.limit=x', 'f.a.facet.sort=other', 'facet.pivot=%7B!join%20fromIndex%3Dx%7Da', 'facet.pivot=%7B!tag=%7Da',
    'facet.pivot={!tag=a-b}x', 'stats.field=%7B!func%7Dx', 'df=a%20b', 'df=a,b'
  ].forEach(function (pair) {
    refuse('q=*&' + pair, 'bad-param-value');
  });
  // local parameters in the free-text values
  refuse('q=%7B!join%20fromIndex%3Dother%20from%3Did%20to%3Did%7D*%3A*', 'bad-param-value');
  refuse('q=*&fq=%7B!join%20fromIndex%3Dother%20from%3Did%20to%3Did%7Da', 'bad-param-value');
  refuse('q=*&fq=%7B!tag%3Dx%7Da%3Ab', 'bad-param-value');
  refuse('q=*&hl.simple.pre=%7B!x%7D', 'bad-param-value');
  refuse('q=a%7B!x', 'bad-param-value');
  refuse('q=*&facet.field=%7B!x%7Da', 'bad-param-value');
  // an exclamation mark or a brace alone is free text
  pass('q=a!b&fq=%7Bx%7D');
});

test('a dollar sign is refused raw and as %24, in any value', function () {
  refuse('q=$%7Bx%7D', 'select-write');
  refuse('q=%24%7Bx%7D', 'select-write');
  refuse('q=*&fq=a:%24b', 'select-write');
  refuse('q=*&hl.simple.pre=%24', 'select-write');
  refuse('q=*&wt=json&$=1', 'select-write');
  refuse('q=a+%24+b', 'select-write');
  // the check applies before the name checks
  refuse('collection=x&q=%24', 'select-write');
  // a doubly encoded dollar sign is a percent sign in a value
  pass('q=%2524');
});

test('a body or value that is not UTF-8 is refused', function () {
  refuse('q=%FF', 'bad-param-value');
  refuse('q=%C3', 'bad-param-value');
  refuse('q=%C3%28', 'bad-param-value');
  refuse('q=a%', 'bad-param-value');
  refuse('q=%zz', 'bad-param-value');
  refuse(Buffer.from([0x71, 0x3d, 0xff]), 'bad-param-value');
  pass(Buffer.from('q=%C3%A9', 'utf8'));
  pass(Buffer.from('q=é', 'utf8'));
});

test('the order of checks is as documented', function () {
  // a name that is both refused and unlisted is refused
  refuse('shards=x&collection=y', 'refused-param');
  // a name check comes before a value check
  refuse('collection=x&wt=javabin', 'unlisted-param');
  // an undecodable name comes first
  refuse('q=%FF&%zz=1', 'bad-param-value');
});

// Parameter names that appear in Banana's source but are not select body
// parameters, each with the reason.
const NOT_SELECT = {
  expr: 'the stream route, checked by the stream scan',
  style: 'a CSS style, not a query parameter',
  param2: 'a placeholder in a code comment',
  commit: 'the Solr-mode update path, which the rule table refuses'
};

test('drift: every parameter name Banana builds is in the table, a stream argument, or an explained exception', function () {
  const files = [];
  const panels = path.join(root, 'src', 'app', 'panels');
  fs.readdirSync(panels).forEach(function (dir) {
    const file = path.join(panels, dir, 'module.js');
    if (fs.existsSync(file)) {
      files.push(file);
    }
  });
  fs.readdirSync(path.join(root, 'src', 'app', 'services')).forEach(function (name) {
    if (/\.js$/.test(name)) {
      files.push(path.join(root, 'src', 'app', 'services', name));
    }
  });
  files.push(path.join(root, 'src', 'vendor', 'solrjs', 'solr.js'));
  const known = function (name) {
    return Object.prototype.hasOwnProperty.call(select.PARAMETERS, name) ||
      select.FAMILIES.some(function (f) { return f.name.test(name); }) ||
      select.GET_ONLY_PARAMETERS.indexOf(name) !== -1 ||
      stream.ARGUMENTS.has(name) ||
      Object.prototype.hasOwnProperty.call(NOT_SELECT, name);
  };
  const found = new Set();
  files.forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /[&'"`]([A-Za-z][A-Za-z0-9_.]*)=/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      found.add(m[1]);
      assert.ok(known(m[1]), path.relative(root, file) + ' builds the parameter "' + m[1] + '", which is not in the select table, the stream arguments or the exceptions');
    }
  });
  // the scan found the usual names, so it is looking at the right files
  ['q', 'fq', 'wt', 'rows', 'facet.range', 'facet.pivot'].forEach(function (name) {
    assert.ok(found.has(name), 'the scan did not find ' + name);
  });
});

test('the select table, its families and the GET-only list are the documented ones', function () {
  assert.deepStrictEqual(Object.keys(select.PARAMETERS).sort(), [
    'df', 'defType', 'facet', 'facet.field', 'facet.limit', 'facet.missing', 'facet.pivot', 'facet.pivot.mincount',
    'facet.range', 'facet.range.end', 'facet.range.gap', 'facet.range.hardend', 'facet.range.other', 'facet.range.start',
    'fl', 'fq', 'group', 'group.field', 'group.limit', 'hl', 'hl.fl', 'hl.fragsize', 'hl.simple.post', 'hl.simple.pre',
    'omitHeader', 'q', 'rows', 'sort', 'stats', 'stats.facet', 'stats.field', 'wt'
  ].sort());
  assert.deepStrictEqual(select.GET_ONLY_PARAMETERS, ['facet.mincount']);
  assert.strictEqual(select.FAMILIES.length, 2);
});
