'use strict';

// The rule table (classify): one test per rule and class.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const { load, ctx, get, ORIGIN, ID1, ID2 } = require('./helpers');

const rules = load('rules.js');

function allowed(req, context) {
  const v = rules.classify(req, context || ctx({}));
  assert.strictEqual(v.allow, true, JSON.stringify(req) + ' should be allowed, got ' + JSON.stringify(v));
  return v;
}

function refused(req, cls, context) {
  const v = rules.classify(req, context || ctx({}));
  assert.strictEqual(v.allow, false, JSON.stringify(req) + ' should be refused');
  assert.strictEqual(v.cls, cls, JSON.stringify(req) + ' refused as ' + v.cls);
}

const JSON_TYPE = 'application/json';
const FORM = 'application/x-www-form-urlencoded';

function put(id, query, url) {
  return { method: 'PUT', url: url || ORIGIN + '/api/blobs/' + encodeURIComponent(id) + '?' + (query === undefined ? 'resourceType=banana' : query), body: '[]' };
}

function del(url) {
  return { method: 'DELETE', url: url, body: null };
}

test('rule 1: the URL must parse with scheme http or https', function () {
  refused({ method: 'GET', url: 'not a url' }, 'bad-url');
  refused({ method: 'GET', url: 'file:///etc/passwd' }, 'bad-url');
  refused({ method: 'GET', url: 'ftp://127.0.0.1:9/api' }, 'bad-url');
  refused({ method: 'GET', url: 'http://[::1' }, 'bad-url');
  refused({ method: 'GET', url: '' }, 'bad-url');
});

test('rule 2: the origin must equal the allowed origin exactly', function () {
  refused({ method: 'POST', url: 'https://api.github.com/gists', body: '{}', contentType: JSON_TYPE }, 'off-origin');
  refused(get('/api', 'http://127.0.0.1:10'), 'off-origin');
  refused(get('/api', 'https://127.0.0.1:9'), 'off-origin');
  refused(get('/api', 'http://localhost:9'), 'off-origin');
  refused({ method: 'GET', url: 'http://127.0.0.1:9' + '@evil.example/api' }, 'off-origin');
  refused({ method: 'GET', url: 'http://127.0.0.1:9\\@evil.example/api' }, 'off-origin');
  refused({ method: 'GET', url: 'http://evil.example#@127.0.0.1:9/api' }, 'off-origin');
  refused({ method: 'GET', url: 'http://127.0.0.1:9.evil.example/api' }, 'bad-url');
  refused({ method: 'GET', url: 'http://127.0.0.1.evil.example:9/api' }, 'off-origin');
  allowed(get('/api'));
  allowed({ method: 'GET', url: 'HTTP://127.0.0.1:9/api' });
});

test('rule 3: a path segment that does not decode, or is empty, dot or dot-dot, is refused', function () {
  refused(get('/api/%zz'), 'bad-path');
  refused(get('/api/%C3'), 'bad-path');
  refused(get('/api//collections'), 'bad-path');
  refused(get('/api/./collections'), 'bad-path');
  refused(get('/api/../api/collections'), 'bad-path');
  refused(get('/api/%2e%2e/collections'), 'bad-path');
  refused(get('/api/%2E/collections'), 'bad-path');
});

test('rule 3: an update, index or _update segment is a write path, whatever the method', function () {
  const paths = [
    '/api/solr/banana-it-x/update', '/api/solr/banana-it-x/update/json', '/api/solr/banana-it-x/index',
    '/api/index-pipelines/_system/collections/banana-it-x/index', '/api/solr/banana-it-x/UPDATE',
    '/api/solr/banana-it-x/Index', '/api/solr/banana-it-x/_update', '/api/blobs/a/index/b',
    '/api/blobs/a%2Fupdate', '/api/blobs/a%2fUpdate/x', '/api/blobs/%75pdate', '/admin/banana/update'
  ];
  paths.forEach(function (p) {
    ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'].forEach(function (m) {
      refused({ method: m, url: ORIGIN + p, body: null }, 'write-path');
    });
  });
  // a segment that only contains the word is not the word
  allowed(get('/api/blobs/updated'));
  allowed(get('/admin/banana/index.html'));
});

test('rule 4: POST /api/ui-logs is telemetry', function () {
  refused({ method: 'POST', url: ORIGIN + '/api/ui-logs', body: '{}', contentType: JSON_TYPE }, 'telemetry');
  refused({ method: 'POST', url: ORIGIN + '/api/ui-logs?x=1', body: '{}' }, 'telemetry');
  // GET of the same path is a read that no row names
  refused(get('/api/ui-logs'), 'unlisted-read');
});

test('rule 5: PATCH and every other method are refused', function () {
  ['PATCH', 'TRACE', 'CONNECT', 'PURGE', 'MOVE'].forEach(function (m) {
    refused({ method: m, url: ORIGIN + '/api/blobs/' + ID1 }, 'unlisted-write', ctx({ [ID1]: 'created' }));
  });
});

test('POST: only the login and select are allowed; any other POST is an unlisted write', function () {
  refused({ method: 'POST', url: ORIGIN + '/api/blobs/' + ID1, body: '[]', contentType: JSON_TYPE }, 'unlisted-write');
  refused({ method: 'POST', url: ORIGIN + '/api/collections', body: '{}', contentType: JSON_TYPE }, 'unlisted-write');
  refused({ method: 'POST', url: ORIGIN + '/api/apps', body: '{}', contentType: JSON_TYPE }, 'unlisted-write');
  refused({ method: 'POST', url: ORIGIN + '/api-ws', body: '' }, 'unlisted-write');
  refused({ method: 'POST', url: ORIGIN + '/api/solr/banana-it-x/stream', body: 'expr=search(banana-it-x)' }, 'unlisted-write');
});

test('login and logout: the exact forms are allowed', function () {
  allowed({ method: 'POST', url: ORIGIN + '/api/session', body: '{}', contentType: JSON_TYPE });
  allowed({ method: 'POST', url: ORIGIN + '/api/session?realmName=native', body: '{}', contentType: JSON_TYPE });
  allowed({ method: 'POST', url: ORIGIN + '/api/session?realmName=native', body: '{}', contentType: 'Application/JSON' });
  allowed(del(ORIGIN + '/api/session'));
  assert.strictEqual(allowed(del(ORIGIN + '/api/session')).kind, 'logout');
});

test('login and logout: near misses abort', function () {
  const login = function (query, type) {
    return { method: 'POST', url: ORIGIN + '/api/session' + query, body: '{}', contentType: type };
  };
  refused(login('?realmName=ldap', JSON_TYPE), 'unlisted-write');
  refused(login('?realmName=native&x=1', JSON_TYPE), 'unlisted-write');
  refused(login('?realmName=native&realmName=native', JSON_TYPE), 'unlisted-write');
  refused(login('?x=1&realmName=native', JSON_TYPE), 'unlisted-write');
  refused(login('?realmName=native', FORM), 'unlisted-write');
  refused(login('?realmName=native', undefined), 'unlisted-write');
  refused(login('?realmName=native', 'application/json;charset=latin1'), 'unlisted-write');
  refused(login('?realmName=native', 'application/json;charset=UTF-8'), 'unlisted-write');
  refused(login('?realmName=native', 'application/jsonx'), 'unlisted-write');
  refused(login('?realmName=native', 'text/plain'), 'unlisted-write');
  refused(login('?_cookie=false', JSON_TYPE), 'unlisted-write');
  refused(login('/x?realmName=native', JSON_TYPE), 'unlisted-write');
  refused(del(ORIGIN + '/api/session?x=1'), 'delete');
  refused(del(ORIGIN + '/api/session/x'), 'delete');
  refused(del(ORIGIN + '/api/session#x'), 'delete');
  refused(del(ORIGIN + '/api/session/'), 'delete');
  refused({ method: 'DELETE', url: ORIGIN + '/api/session', body: 'x' }, 'delete');
  refused(del('http://127.0.0.2:9/api/session'), 'off-origin');
});

test('collections and pipelines: the permitted names pass in every read row, any other aborts', function () {
  ['_system', 'system_logs', 'banana-it-x', 'banana-it-logs'].forEach(function (c) {
    allowed(get('/api/collections/' + c + '/schema/fields'));
    allowed(get('/api/query-pipelines/' + c + '/collections/' + c + '/schema/uniquekey?wt=json&omitHeader=true'));
    allowed(get('/api/solr/' + c + '/schema/dynamicfields'));
    allowed(get('/api/query-pipelines/' + c + '/collections/' + c + '/stream?expr=search(' + c + ',q=*:*)'));
    allowed(get('/api/solr/' + c + '/graph?expr=nodes(' + c + ',q=*:*)'));
  });
  ['other', 'banana-it', 'xbanana-it-x', 'banana-it-x/y', 'system_logs2', 'default', 'banana-it-'].forEach(function (c) {
    const e = encodeURIComponent(c);
    refused(get('/api/collections/' + e + '/schema/fields'), 'unlisted-read');
    refused(get('/api/solr/' + e + '/schema/fields'), 'unlisted-read');
    refused(get('/api/query-pipelines/' + e + '/collections/system_logs/schema/fields'), 'unlisted-read');
    refused(get('/api/query-pipelines/_system/collections/' + e + '/stream?expr=search(system_logs,q=*:*)'), 'unlisted-read');
    refused(get('/api/solr/' + e + '/stream?expr=search(system_logs,q=*:*)'), 'unlisted-read');
  });
});

test('the read allowlist: every row is allowed with its exact query', function () {
  [
    '/admin/banana/', '/admin/banana/index.html', '/admin/banana/app/app.js?r=1', '/admin/banana/config.js',
    '/auth/login', '/auth/login?return=%2Fadmin%2Fbanana%2Findex.html', '/auth/build/app.esm.js', '/auth/build/p-1.js',
    '/admin', '/admin/', '/admin/bundle.js', '/admin/ui-common/a.js', '/admin/webfonts/x.woff', '/admin/config/banner-config.json',
    '/admin/favicon.png', '/api/apps', '/api/license', '/api/configurations/quickstart.enabled',
    '/api/query-pipelines', '/api/index-pipelines', '/api-ws',
    '/api', '/api/session', '/api/collections',
    '/api/collections/system_logs/schema/fields', '/api/collections/system_logs/schema/dynamicfields',
    '/api/query-pipelines/_system/collections/system_logs/schema/uniquekey?wt=json&omitHeader=true',
    '/api/query-pipelines/_system/collections/system_logs/schema/uniquekey?omitHeader=true&wt=json',
    '/api/query-pipelines/_system/collections/system_logs/schema/uniquekey?wt=json',
    '/api/solr/system_logs/schema/fields',
    '/api/blobs?q=id%3Abanana*&resourceType=banana', '/api/blobs?resourceType=banana&q=id:x*',
    '/api/blobs/' + ID1, '/api/blobs/Ops%3Fv2'
  ].forEach(function (p) {
    allowed(get(p));
    allowed({ method: 'HEAD', url: ORIGIN + p, body: null });
    allowed({ method: 'OPTIONS', url: ORIGIN + p, body: null });
  });
});

test('the read allowlist: near misses abort as unlisted-read', function () {
  [
    '/api/solr/banana-it-x/admin/ping?action=disable',
    '/api/solr/admin/collections?action=LIST',
    '/api/solr/banana-it-x/select?q=*:*',
    '/api/query-pipelines/_system/collections/system_logs/select?q=*:*',
    '/api/solr/banana-it-x/sql', '/api/solr/banana-it-x/terms', '/api/solr/banana-it-x/admin/luke',
    '/api/blobs/a/b', '/api/blobs/x?y', '/api/blobs/x?resourceType=banana', '/api/blobs',
    '/api/blobs?q=x', '/api/blobs?resourceType=banana', '/api/blobs?q=x&resourceType=banana&z=1',
    '/api/blobs?q=x&q=y&resourceType=banana', '/api/blobs?q=x&resourceType=other',
    '/api/collections?x=1', '/api/collections/', '/api/collections/system_logs/schema/other',
    '/api/collections/system_logs/schema/fields?x=1', '/api/collections/system_logs/schema/fields?wt=xml',
    '/api/collections/system_logs/schema/fields?wt=json&wt=json',
    '/api/collections/system_logs/schema/fields/',
    '/api/collections/system_logs', '/api/collections/system_logs/schema',
    '/api/query-pipelines/_system', '/api/query-pipelines/_system/collections/system_logs',
    '/api/apps?x=1', '/api/apps/test', '/api-ws?x=1', '/api-ws/x', '/api-ws/',
    '/api/session?x=1', '/api/', '/api/apollo/collections',
    '/admin/banana', '/admin/?x=1', '/admin/other', '/admin/config/other.json', '/admin/x/y.png',
    '/admin/ui-common', '/admin/bundle.js?v=1', '/auth/other', '/auth/login/x', '/auth', '/', '/index.html',
    '/api/configurations/other', '/api/query-pipelines/' + 'other'
  ].forEach(function (p) {
    refused(get(p), 'unlisted-read');
  });
});

test('Banana static files are allowed under /admin/banana/ and, when configured, from the served roots', function () {
  const c = ctx({}, { staticRoots: new Set(['index.html', 'app', 'config.js', 'api', 'admin']) });
  allowed(get('/index.html'), c);
  allowed(get('/app/app.js'), c);
  allowed(get('/config.js'), c);
  refused(get('/other.js'), 'unlisted-read', c);
  // the guarded prefixes cannot be made static roots
  refused(get('/api/solr/other/stream?expr=x'), 'unlisted-read', c);
  refused(get('/admin/other'), 'unlisted-read', c);
  // without roots only /admin/banana/ is static
  refused(get('/index.html'), 'unlisted-read');
});

test('PUT: only /api/blobs/<owned id> with resourceType=banana, and the 404 check is required except from created', function () {
  const states = { [ID1]: 'created', [ID2]: 'allocated' };
  const c = ctx(states);
  const v = allowed(put(ID1), c);
  assert.strictEqual(v.kind, 'put');
  assert.strictEqual(v.id, ID1);
  assert.strictEqual(v.check404, false);
  ['allocated', 'put-sent', 'delete-sent', 'deleted'].forEach(function (s) {
    const r = allowed(put(ID2), ctx({ [ID2]: s }));
    assert.strictEqual(r.check404, true, s);
  });
  refused(put(ID2), 'collided', ctx({ [ID2]: 'collided' }));
});

test('PUT: near misses abort as blob-put', function () {
  const c = ctx({ [ID1]: 'created' });
  refused(put(ID1, 'resourceType=other'), 'blob-put', c);
  refused(put(ID1, ''), 'blob-put', c);
  refused(put(ID1, 'resourceType=banana&x=1'), 'blob-put', c);
  refused(put(ID1, 'x=1&resourceType=banana'), 'blob-put', c);
  refused(put(ID1, 'resourceType=banana#x'), 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/blobs/' + ID1, body: '[]' }, 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/blobs/' + ID1 + '/x?resourceType=banana' }, 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/blobs/' + ID1 + '/?resourceType=banana' }, 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/blobs?resourceType=banana' }, 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/collections/x?resourceType=banana' }, 'blob-put', c);
  // a title with a question mark (suffix case, query in the id)
  refused(put(ID1 + '?x', undefined), 'blob-put', c);
  refused({ method: 'PUT', url: ORIGIN + '/api/blobs/' + ID1 + '?x?resourceType=banana' }, 'blob-put', c);
  refused(put('x-' + ID1), 'blob-put', ctx({ ['x-' + ID1]: 'created' }));
  refused(put(ID1 + '\n'), 'blob-put', ctx({ [ID1 + '\n']: 'created' }));
  refused(put('banana-it-0123456789ab-0'), 'blob-put', ctx({ 'banana-it-0123456789ab-0': 'created' }));
  // an id that matches the pattern but is not owned by this process
  refused(put('banana-it-ba9876543210-1'), 'blob-put', c);
  // an owned id: ok
  allowed(put(ID1), c);
});

test('DELETE: only the exact delete URL of an owned id at put-sent, created or delete-sent', function () {
  const url = rules.deleteUrl(ORIGIN, ID1);
  assert.strictEqual(url, ORIGIN + '/api/blobs/' + ID1);
  ['put-sent', 'created', 'delete-sent'].forEach(function (s) {
    const v = allowed(del(url), ctx({ [ID1]: s }));
    assert.strictEqual(v.kind, 'delete');
    assert.strictEqual(v.id, ID1);
  });
  ['allocated', 'deleted', 'collided'].forEach(function (s) {
    refused(del(url), 'delete', ctx({ [ID1]: s }));
  });
  // owned by another process
  refused(del(rules.deleteUrl(ORIGIN, 'banana-it-ba9876543210-1')), 'delete', ctx({ [ID1]: 'created' }));
});

test('DELETE: a query, a fragment, an extra segment, another origin or a body is refused', function () {
  const c = ctx({ [ID1]: 'created' });
  const url = rules.deleteUrl(ORIGIN, ID1);
  refused(del(url + '?resourceType=banana'), 'delete', c);
  refused(del(url + '?'), 'delete', c);
  refused(del(url + '#x'), 'delete', c);
  refused(del(url + '/'), 'delete', c);
  refused(del(url + '/x'), 'delete', c);
  refused(del(url.replace('/blobs/', '/blobs//')), 'bad-path', c);
  refused(del(url.replace('/api/blobs', '/api/blobs/x/..')), 'bad-path', c);
  refused(del(ORIGIN + '/api/blobs/'), 'delete', c);
  refused(del(ORIGIN + '/api/blobs'), 'delete', c);
  refused(del(ORIGIN + '/api/collections/system_logs'), 'delete', c);
  refused(del(url.replace('127.0.0.1:9', '127.0.0.1:10')), 'off-origin', c);
  refused({ method: 'DELETE', url: url, body: 'x' }, 'delete', c);
  // the truncated id Banana's list sends for an id that contains a slash
  refused(del(ORIGIN + '/api/blobs/' + ID1.slice(1)), 'delete', c);
  refused(del(ORIGIN + '/api/blobs/' + ID1.slice(0, -1)), 'delete', c);
  // an encoded form of the same id is a different URL string, so it is refused
  refused(del(url.replace('banana-it', 'banana%2Dit')), 'delete', c);
  refused(del(url + '%00'), 'delete', c);
  // an id that is not a run id, even if owned
  const odd = 'Ops?v2';
  refused(del(ORIGIN + '/api/blobs/Ops?v2'), 'delete', ctx({ [odd]: 'created' }));
  refused(del(ORIGIN + '/api/blobs/Ops%3Fv2'), 'delete', ctx({ [odd]: 'created' }));
});

test('ADR 0008, scenario S6: a title with a question mark is not an owned id, so neither its PUT nor its DELETE is allowed', function () {
  const title = ID1 + '?x';
  const c = ctx({ [ID1]: 'created' });
  refused(put(title, undefined), 'blob-put', c);
  // Banana sends the delete unencoded; the server reads it as the shorter id plus a query
  refused(del(ORIGIN + '/api/blobs/' + title), 'delete', c);
});

test('ADR 0008, scenario S5: the id Banana sends after dropping the first character is refused', function () {
  const id = 'banana-it-0123456789ab-1';
  const c = ctx({ [id]: 'created' });
  refused(del(ORIGIN + '/api/blobs/' + id.substring(1)), 'delete', c);
  refused(del(ORIGIN + '/api/blobs/' + ID1 + '%2Fx'), 'delete', c);
});

test('ADR 0008, scenario S7: Solr-mode saves and deletes are refused', function () {
  refused({ method: 'POST', url: ORIGIN + '/solr/system_banana/update?commit=true', body: '{}', contentType: JSON_TYPE }, 'write-path');
  refused({ method: 'POST', url: ORIGIN + '/solr/system_banana/update', body: '<delete/>', contentType: 'text/xml' }, 'write-path');
  refused({ method: 'DELETE', url: ORIGIN + '/solr/system_banana/_query?q=id:x', body: null }, 'delete');
  refused(get('/solr/banana-it-x/select?q=*:*'), 'unlisted-read');
  refused(get('/solr/admin/collections?action=LIST'), 'unlisted-read');
});

test('ADR 0008, scenario N3: navigation to an administrative GET is refused', function () {
  refused(get('/api/solr/banana-it-x/admin/ping?action=disable'), 'unlisted-read');
  refused(get('/api/solr/admin/collections?action=DELETE&name=other'), 'unlisted-read');
  refused(get('/api/solr/banana-it-x/admin/collections?action=DELETE&name=other'), 'unlisted-read');
});

test('ADR 0008, decision 11: the delete URL form is pinned', function () {
  assert.strictEqual(rules.deleteUrl('http://127.0.0.1:9', 'banana-it-0123456789ab-7'), 'http://127.0.0.1:9/api/blobs/banana-it-0123456789ab-7');
  assert.strictEqual(rules.deleteUrl('http://h', 'a b?c'), 'http://h/api/blobs/a%20b%3Fc');
});

test('ADR 0008, decision 3: the stream and select rows apply the content checks', function () {
  const c = ctx({});
  allowed(get('/api/solr/system_logs/stream?expr=' + encodeURIComponent('search(system_logs,q="*:*",fl="id",sort="id asc")')), c);
  refused(get('/api/solr/system_logs/stream?expr=' + encodeURIComponent('update(system_logs,q="*:*")')), 'stream-write', c);
  refused(get('/api/solr/system_logs/stream?x=1'), 'unlisted-param', c);
  const post = function (body, type) {
    return { method: 'POST', url: ORIGIN + '/api/query-pipelines/_system/collections/system_logs/select', body: body, contentType: type === null ? undefined : (type === undefined ? FORM : type) };
  };
  allowed(post('q=*%3A*&wt=json&rows=0'), c);
  refused(post('q=*%3A*&shards=x'), 'refused-param', c);
  refused(post('q=*%3A*', 'application/json'), 'unlisted-write', c);
  refused(post('q=*%3A*', null), 'unlisted-write', c);
  refused({ method: 'POST', url: ORIGIN + '/api/solr/system_logs/select?x=1', body: 'q=*', contentType: FORM }, 'unlisted-write', c);
  refused({ method: 'POST', url: ORIGIN + '/api/solr/other/select', body: 'q=*', contentType: FORM }, 'unlisted-write', c);
});
