'use strict';

// Stream and graph requests: the expression scan.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers');

const stream = load('stream.js');

const root = path.resolve(__dirname, '..', '..', '..');

// The raw query string Banana sends: 'expr=' plus the expression, with the
// characters the browser itself escapes. Banana's own percent escapes stay.
function raw(expr) {
  return 'expr=' + expr.replace(/ /g, '%20').replace(/"/g, '%22');
}

function enc(expr) {
  return 'expr=' + encodeURIComponent(expr);
}

function pass(query) {
  assert.strictEqual(stream.checkStreamQuery(query), null, query);
}

function refuse(query, cls) {
  const bad = stream.checkStreamQuery(query);
  assert.ok(bad, 'should be refused: ' + query);
  assert.strictEqual(bad.cls, cls, query + ' refused as ' + bad.cls + ' (' + bad.reason + ')');
}

// The expressions the panels build, written from their templates. A drift test
// below checks that the panel sources still contain the same fragments.
function graphExpression(graphCollection, core, query, rootNodes) {
  return 'nodes(' + graphCollection + ', ' +
    'nodes(' + graphCollection + ', ' +
    'search(' + core + ', q="' + query + '", fl="join_s,sort_s", sort="sort_s asc", rows="' + rootNodes + '"), ' +
    'walk="join_s->from_s", ' +
    'trackTraversal="true", ' +
    'gather="to_s"), ' +
    'walk="node->from_s", ' +
    'scatter="leaves,branches", ' +
    'trackTraversal="true", ' +
    'gather="to_s")';
}

function baseExpression(graphCollection, core) {
  return 'fetch(' + core + ', select(' + graphExpression(graphCollection, core, '*:*', 10) + ', node as join_s), fl="label_s", on="join_s")';
}

const TIMESERIES = 'timeseries(system_logs, q="*:*", field="timestamp_tdt", start="NOW/DAY-30DAY", end="NOW", gap="+1DAY", count(*))';
const SIGNIFICANT = 'significantTerms(system_logs, q="(*:*) AND (timestamp_tdt:[NOW/DAY-1DAY TO NOW]) AND (level_s:ERROR)", field="message_t", limit="10", minDocFreq="5", maxDocFreq="0.3", minTermLength="4")';
// What the significantTerms panel builds for a dashboard with a terms filter: the double quotes of the
// filter value are written as \" inside the quoted q. The live guard refuses a backslash anywhere in
// an expression (so that its scan does not depend on how Solr treats escapes), so a live run cannot
// use a stream panel on a dashboard that has a quoted filter value, a phrase or an apostrophe. It
// fails closed; live runs use stream panels without such filters.
const SIGNIFICANT_TERMS_FILTER = 'significantTerms(system_logs, q="(*:*) AND (level_s:\\"ERROR\\")", field="message_t", limit="10", minDocFreq="5", maxDocFreq="0.3", minTermLength="4")';

test('the expressions the panels build pass', function () {
  pass(enc(graphExpression('banana-it-g', 'banana-it-c', '*:*', 10)));
  pass(enc(baseExpression('banana-it-g', 'banana-it-c')));
  pass(enc(graphExpression('system_logs', 'system_logs', 'a OR b', 5)));
  pass(enc(TIMESERIES));
  pass(enc(SIGNIFICANT));
  refuse(enc(SIGNIFICANT_TERMS_FILTER), 'stream-scope');
  pass(enc('timeseries(_system, q="*:*", field="t", start="2021-04-19T00:00:00.000Z", end="NOW", gap="+1HOUR", sum(price_f))'));
});

test('the panel sources still build the fragments the expressions above are written from', function () {
  const read = function (rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); };
  const graph = read('src/app/panels/graph/module.js');
  [
    "'nodes(' + graph_collection + ', '", "'search(' + name(dashboard.current.solr.core_name, 'collection name') + ', q=' + q(query)",
    "', fl=' + q(fl) + sort + rows + '), '", "'walk=' + q(join_field + '->' + from_field) + ', '", "'trackTraversal=\"true\", '",
    "'gather=' + q(to_field) + '), '", "'walk=' + q('node->' + from_field) + ', '", "'scatter=\"leaves,branches\", '",
    "'gather=' + q(to_field) + ')'", "'fetch(' + collection + ', select('",
    "', node as ' + join_field + '), fl=' + q(", "', on=' + q(join_field) + ')'"
  ].forEach(function (fragment) {
    assert.ok(graph.includes(fragment), 'graph panel no longer contains ' + fragment);
  });
  const significant = read('src/app/panels/significantTerms/module.js');
  [
    "'significantTerms('", "', q=' + streamExpression.quote(q)", "', field=' + ", "', limit=' + ", "', minDocFreq=' + ",
    "', maxDocFreq=' + ", "', minTermLength=' + "
  ].forEach(function (fragment) {
    assert.ok(significant.includes(fragment), 'significantTerms panel no longer contains ' + fragment);
  });
  const timeseries = read('src/app/panels/timeseries/module.js');
  [
    "'timeseries('", "', q=' + streamExpression.quote(", "', field=' + streamExpression.quote(", "', start=' + streamExpression.quote(start_time)",
    "', end=' + streamExpression.quote(end_time)", "', gap=' + streamExpression.quote(gap)", "', ' + metric + '(' + field + '))'"
  ].forEach(function (fragment) {
    assert.ok(timeseries.includes(fragment), 'timeseries panel no longer contains ' + fragment);
  });
});

test('a write function is refused, in every spelling', function () {
  ['update(', 'update (', 'update\t(', 'update\n(', 'update\r\n(', 'update (', 'update (', 'delete(', 'commit(', 'daemon(', 'topic(', 'jdbc('].forEach(function (name) {
    refuse(enc(name + 'banana-it-x, q="*:*")'), 'stream-write');
    refuse(enc('search(banana-it-x, q="*:*", fl=id, sort="id asc"), ' + name + 'x)'), 'stream-write');
  });
  // a write function nested at depth
  refuse(enc('fetch(banana-it-x, update(banana-it-x, search(banana-it-x, q="*:*")), fl="a", on="b")'), 'stream-write');
  // a name hidden by a zero-width character is a different name, so it is not in the set
  refuse(enc('upd​ate(banana-it-x, q="*:*")'), 'stream-write');
  refuse(enc('Search(banana-it-x, q="*:*")'), 'stream-write');
  refuse(enc('scoreNodes(search(system_logs, q="*:*", fl="a", sort="a asc"))'), 'stream-write');
});

test('a function name inside a double-quoted string is a string, not a call', function () {
  pass(enc('search(banana-it-x, q="update(x)", fl="id", sort="id asc")'));
});

test('a dollar sign is refused raw, as %24 and as %2524', function () {
  refuse('expr=search(banana-it-x,q=$%7Bx%7D)', 'stream-write');
  refuse('expr=search(banana-it-x,q=%24%7Bx%7D)', 'stream-write');
  refuse('expr=search(banana-it-x,q=%2524%7Bx%7D)', 'bad-param-value');
  refuse('expr=search(banana-it-x,q=%25%32%34)', 'bad-param-value');
  refuse('expr=search(banana-it-x,q=1)&x=$', 'stream-write');
  refuse(enc('search(banana-it-x, q="${x}")'), 'stream-write');
});

test('qt, shards and zkHost are refused in every position and in every function', function () {
  const funcs = ['facet', 'stats', 'timeseries', 'search', 'significantTerms', 'random', 'nodes', 'fetch'];
  funcs.forEach(function (f) {
    ['shards', 'x.shards', 'shards.qt', 'SHARDS', 'qt', 'x.qt', 'Qt'].forEach(function (name) {
      refuse(enc(f + '(banana-it-x, q="*:*", ' + name + '="a")'), 'refused-param');
    });
    refuse(enc(f + '(banana-it-x, q="*:*", zkHost="a")'), 'unlisted-param');
  });
  refuse(enc('search(banana-it-x, q="*:*", qt="/select")'), 'refused-param');
  refuse(enc('search(banana-it-x, q="*:*", qt=/update)'), 'refused-param');
  refuse(enc('search(banana-it-x, q="*:*", qt=\'/select\')'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="*:*", shards=http://other/solr)'), 'refused-param');
  refuse(enc('search(banana-it-x, q="*:*", qt = "/select")'), 'refused-param');
  // a field that is merely called something else with the letters inside
  pass(enc('search(banana-it-x, q="*:*", fl="shardsize_i,qty_i", sort="qty_i asc")'));
});

test('an argument name outside the allowlist is refused', function () {
  ['buckets', 'bucketSorts', 'bucketSizeLimit', 'zkHost', 'collection', 'docs', 'by', 'n', 'partitionKeys', 'wt', 'distrib', 'expr'].forEach(function (name) {
    refuse(enc('search(banana-it-x, q="*:*", ' + name + '="a")'), 'unlisted-param');
  });
  refuse(enc('search(banana-it-x, q="*:*" , name = x)'), 'unlisted-param');
});

test('only one non-empty expr parameter is allowed', function () {
  refuse('', 'unlisted-param');
  refuse('expr=', 'unlisted-param');
  refuse('expr', 'unlisted-param');
  refuse('x=1', 'unlisted-param');
  refuse(enc('search(banana-it-x)') + '&' + enc('search(banana-it-x)'), 'unlisted-param');
  refuse(enc('search(banana-it-x)') + '&x=1', 'unlisted-param');
  refuse('x=1&' + enc('search(banana-it-x)'), 'unlisted-param');
  refuse('expr=a&&', 'unlisted-param');
  refuse('EXPR=search(banana-it-x)', 'unlisted-param');
  // text added after the expression would ride on the query as a second parameter
  refuse(enc(TIMESERIES) + '&qt=/update', 'unlisted-param');
  refuse(enc(TIMESERIES) + '&shards=x', 'unlisted-param');
  // an extra parameter inside the expression string is a refused name
  refuse(enc(TIMESERIES + ',qt=/update'), 'refused-param');
});

test('a value that does not decode, or is encoded twice, is refused', function () {
  refuse('expr=%FF', 'bad-param-value');
  refuse('expr=%C3', 'bad-param-value');
  refuse('expr=search(banana-it-x%zz)', 'bad-param-value');
  refuse('expr=search(banana-it-x%', 'bad-param-value');
  refuse('expr=search(banana-it-x,q=%2520)', 'bad-param-value');
});

test('quotes and brackets must balance', function () {
  refuse(enc('search(banana-it-x, q="*:*"'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="*:*"))'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="a)'), 'stream-scope');
  refuse(enc('search(banana-it-x, q=[a)'), 'stream-scope');
  refuse(enc('search(banana-it-x, q=(a])'), 'stream-scope');
  refuse(enc('search(banana-it-x, q=a}'), 'stream-scope');
  refuse(enc('(search(banana-it-x, q="*:*")'), 'stream-scope');
  pass(enc('search(banana-it-x, q=a:[1 TO 2], fl="a")'));
});

test('a backslash or a single quote anywhere in the value is refused, so the scan does not depend on Solr escapes', function () {
  const payloads = [
    // payloads found by searching for expressions that a tokeniser without escapes reads differently
    'fetch(banana-it-x, search(banana-it-x, q="a\\", fl=id, sort=id asc), delete(other, search(other, q=*:*, fl=id, sort=id asc)), fl=""")"\\"", on=id)',
    'fetch(banana-it-x, search(banana-it-x, q="a\\", fl=id, sort=id asc), delete(other, search(other, q=*:*, fl=id, sort=id asc)), fl=""")\\"\\"", on=id)',
    'fetch(banana-it-x, search(banana-it-x, q="a\\", fl=id, sort=id asc), delete(other, search(other, q=*:*, fl=id, sort=id asc)), fl=""(\\""), on=id)',
    'fetch(banana-it-x, search(banana-it-x, q="a\\", fl=id, sort=id asc), delete(other, search(other, q=*:*, fl=id, sort=id asc)), fl="\\"))"("\\"", on=id)',
    // the opposite mismatch: a quote that is only closed by a single-quote reading
    'search(banana-it-x, q=\'"\', fl=\'x\', sort=\'a asc\') ',
    'search(banana-it-x, q="a\\\\", fl=id)',
    'search(banana-it-x, q="it\'s", fl=id)'
  ];
  payloads.forEach(function (p) {
    refuse(enc(p), 'stream-scope');
    refuse(raw(p), 'stream-scope');
  });
  refuse('expr=search(banana-it-x,q=%5C%22)', 'stream-scope');
  refuse('expr=search(banana-it-x,q=%27a%27)', 'stream-scope');
});

test('ADR 0008, scenario N29: the first argument of a collection-taking function must be a bare permitted collection', function () {
  ['search', 'nodes', 'fetch', 'facet', 'stats', 'random', 'timeseries', 'significantTerms'].forEach(function (f) {
    ['_system', 'system_logs', 'banana-it-x'].forEach(function (c) {
      pass(enc(f + '(' + c + ', q="*:*")'));
    });
    refuse(enc(f + '(other, q="*:*")'), 'stream-scope');
    refuse(enc(f + '("banana-it-x", q="*:*")'), 'stream-scope');
    refuse(enc(f + '("banana-it-x,other", q="*:*")'), 'stream-scope');
    refuse(enc(f + '(, q="*:*")'), 'stream-scope');
    refuse(enc(f + '()'), 'stream-scope');
    refuse(enc(f + '(banana-it-x other, q="*:*")'), 'stream-scope');
    refuse(enc(f + '(search(banana-it-x, q="*:*"), q="*:*")'), 'stream-scope');
    refuse(enc(f + '(collection=banana-it-x, q="*:*")'), 'stream-scope');
    refuse(enc(f + '(xbanana-it-x, q="*:*")'), 'stream-scope');
    refuse(enc(f + '(system_logs2, q="*:*")'), 'stream-scope');
    refuse(enc(f + '(system_logs.x, q="*:*")'), 'stream-scope');
    refuse(enc(f + '(banana-it-, q="*:*")'), 'stream-scope');
  });
});

test('a foreign collection is refused at every depth', function () {
  const inner = 'search(other, q="*:*", fl="a", sort="a asc")';
  [
    'fetch(banana-it-x, ' + inner + ', fl="a", on="b")',
    'select(' + inner + ', a as b)',
    'sort(' + inner + ', by="a asc")',
    'top(' + inner + ', n=3)',
    'rollup(' + inner + ', over=a)',
    'nodes(banana-it-x, ' + inner + ', walk="a->b", gather="c")',
    'count(' + inner + ')',
    'sum(select(' + inner + ', a as b))'
  ].forEach(function (e) {
    refuse(enc(e), 'stream-scope');
  });
  // a permitted first argument with a foreign name in a later nested stream
  refuse(enc('search(banana-it-x, q="*:*", ' + inner + ')'), 'stream-scope');
  refuse(enc('fetch(banana-it-x, search(banana-it-x, q="*:*", fl="a", sort="a asc"), search(other, q="*:*"), fl="a")'), 'stream-scope');
  // the graph panel's expression with a foreign collection
  refuse(raw(graphExpression('other', 'banana-it-c', '*%3A*', 10)), 'stream-scope');
  refuse(raw(baseExpression('banana-it-g', 'other')), 'stream-scope');
  refuse(raw(baseExpression('other', 'banana-it-c')), 'stream-scope');
});

test('a collection-taking function takes no bare positional argument after the first', function () {
  refuse(enc('search(banana-it-x, other, q="*:*")'), 'stream-scope');
  refuse(enc('search(banana-it-x,other,q="*:*")'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="*:*", other)'), 'stream-scope');
  refuse(enc('nodes(banana-it-x, other)'), 'stream-scope');
  refuse(enc('timeseries(system_logs, q=*:*, other, count(*))'), 'stream-scope');
  refuse(enc('search(banana-it-x, other count(x))'), 'stream-scope');
  refuse(enc('search(banana-it-x, other count(x), q="*:*")'), 'stream-scope');
  refuse(enc('search(banana-it-x, )'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="*:*",)'), 'stream-scope');
  // stream calls and named arguments are fine
  pass(enc('fetch(banana-it-x, search(banana-it-x, q="*:*", fl="a", sort="a asc"), fl="a", on="b")'));
  pass(enc('timeseries(system_logs, q=*:*, field=t, start=NOW, end=NOW, gap=+1DAY, count(*))'));
});

test('local-parameters prefixes are refused anywhere, quotes included', function () {
  refuse(enc('search(banana-it-x, q="{!join fromIndex=other from=id to=id}*:*")'), 'stream-scope');
  refuse(enc('search(banana-it-x, q="{!terms f=id}x")'), 'stream-scope');
  refuse(enc('search(banana-it-x, q={!join fromIndex=other from=id to=id}*:*)'), 'stream-scope');
  refuse(enc('search(banana-it-x, fq="{!tag=x}a:b", q="*:*")'), 'stream-scope');
  refuse('expr=search(banana-it-x,q=%22%7B%21join%20fromIndex%3Dother%20from%3Did%20to%3Did%7D*%3A*%22)', 'stream-scope');
  refuse('expr=search(banana-it-x,q=%7B!terms)', 'stream-scope');
  // an exclamation mark alone is not a prefix
  pass(enc('search(banana-it-x, q="a!b", fl="id", sort="id asc")'));
});

test('a stream expression carrying a name of the function set as an argument value is not a call', function () {
  pass(enc('search(banana-it-x, q=update, fl=id, sort="id asc")'));
});

test('the function set, the argument allowlist and the collection pattern are the documented ones', function () {
  assert.deepStrictEqual(Array.from(stream.FUNCTIONS).sort(),
    ['avg', 'count', 'facet', 'fetch', 'max', 'min', 'nodes', 'random', 'rollup', 'search', 'select', 'significantTerms', 'sort', 'stats', 'sum', 'timeseries', 'top'].sort());
  assert.ok(!stream.FUNCTIONS.has('scoreNodes'));
  assert.deepStrictEqual(Array.from(stream.COLLECTION_FUNCTIONS).sort(),
    ['facet', 'fetch', 'nodes', 'random', 'search', 'significantTerms', 'stats', 'timeseries'].sort());
  assert.deepStrictEqual(Array.from(stream.ARGUMENTS).sort(),
    ['end', 'fl', 'field', 'fq', 'gap', 'gather', 'limit', 'maxDocFreq', 'minDocFreq', 'minTermLength', 'on', 'q', 'rows', 'scatter', 'sort', 'start', 'trackTraversal', 'walk'].sort());
});
