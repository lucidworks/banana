'use strict';

// The on-disk registry: write order, exclusive creation, the directory check,
// and the orphans report.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { load, tempDir, startStubFusion, ID1, ID2 } = require('./helpers');

const registry = load('registry.js');
const clientModule = load('client.js');
const ids = load('ids.js');

const TAG = 'aaaaaaaaaaaa';
const HIDDEN_USER = 'hidden-user-name';
const HIDDEN_CREDENTIAL = 'hidden-credential-value';
const IDENTITY = '0123456789ab';

function lines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

function git(args, cwd) {
  childProcess.execFileSync('git', args, { cwd: cwd, stdio: 'ignore' });
}

test('a state line is on disk before the call that follows it returns', function () {
  const dir = tempDir();
  const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY });
  const ledger = new registry.Ledger(reg);
  ledger.allocated(ID1);
  ledger.move(ID1, 'put-sent');
  // Read through a second handle without closing the first: the line is there.
  assert.deepStrictEqual(lines(reg.file).map(function (l) { return l.state; }), ['allocated', 'put-sent']);
});

test('every append is followed by an fsync, and a failing fsync throws', function () {
  const dir = tempDir();
  let syncs = 0;
  const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY, fsync: function () { syncs++; } });
  reg.append(ID1, 'allocated');
  reg.append(ID1, 'put-sent');
  assert.strictEqual(syncs, 2);
  const failing = new registry.Registry({
    dir: dir, runTag: TAG, identity: 'ba9876543210',
    fsync: function () { throw new Error('disk full'); }
  });
  assert.throws(function () { failing.append(ID1, 'allocated'); }, /disk full/);
});

test('a failed append stops the request that would follow it', async function () {
  const stub = await startStubFusion();
  try {
    const dir = tempDir();
    const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY });
    const ledger = new registry.Ledger(reg);
    const c = new clientModule.FusionClient({
      base: stub.origin, user: 'u', password: 'p', ledger: ledger, allocator: new ids.Allocator(IDENTITY), confirmDelayMs: 1
    });
    await c.login();
    const id = c.allocate();
    reg._fsync = function () { throw new Error('disk full'); };
    await assert.rejects(c.create(id, {}), /disk full|cannot move/);
    assert.strictEqual(stub.log.filter(function (e) { return e.method === 'PUT'; }).length, 0);
  } finally {
    await stub.close();
  }
});

test('a PUT stub that dies after put-sent leaves the line on disk', function () {
  const dir = tempDir();
  const script = [
    'const r = require(' + JSON.stringify(path.resolve(__dirname, '..', '..', 'live', 'fusion-client', 'registry.js')) + ');',
    'const reg = new r.Registry({ dir: ' + JSON.stringify(dir) + ', runTag: "' + TAG + '", identity: "' + IDENTITY + '" });',
    'const l = new r.Ledger(reg);',
    'l.allocated("' + ID1 + '"); l.move("' + ID1 + '", "put-sent");',
    'process.kill(process.pid, "SIGKILL");'
  ].join('\n');
  const res = childProcess.spawnSync(process.execPath, ['-e', script]);
  assert.strictEqual(res.signal, 'SIGKILL');
  const file = path.join(dir, TAG + '.' + IDENTITY + '.jsonl');
  assert.deepStrictEqual(lines(file).map(function (l) { return l.state; }), ['allocated', 'put-sent']);
});

test('exclusive creation refuses a second file of the same identity', function () {
  const dir = tempDir();
  new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY });
  assert.throws(function () { return new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY }); }, /EEXIST/);
});

test('the file name carries the run tag and the file is private', function () {
  const dir = tempDir();
  const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY });
  assert.strictEqual(path.basename(reg.file), TAG + '.' + IDENTITY + '.jsonl');
  assert.strictEqual(fs.statSync(reg.file).mode & 0o777, 0o600);
});

test('a missing or malformed run tag refuses to start', function () {
  const dir = tempDir();
  [undefined, '', 'XYZ', 'AAAAAAAAAAAA', 'aaaaaaaaaaa'].forEach(function (tag) {
    assert.throws(function () { return new registry.Registry({ dir: dir, runTag: tag, identity: IDENTITY }); }, /run tag/);
  });
});

test('a registry line holds the time, the id and the state, and no host or credential', async function () {
  const stub = await startStubFusion();
  try {
    const dir = tempDir();
    const reg = new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY });
    const ledger = new registry.Ledger(reg);
    const c = new clientModule.FusionClient({
      base: stub.origin, user: HIDDEN_USER, password: HIDDEN_CREDENTIAL, ledger: ledger,
      allocator: new ids.Allocator(IDENTITY), confirmDelayMs: 1
    });
    await c.login();
    const id = c.allocate();
    await c.create(id, {});
    await c.remove(id);
    const text = fs.readFileSync(reg.file, 'utf8');
    assert.ok(!text.includes('127.0.0.1'));
    assert.ok(!text.includes(HIDDEN_USER));
    assert.ok(!text.includes(HIDDEN_CREDENTIAL));
    assert.ok(!text.includes(String(new URL(stub.origin).port)));
    lines(reg.file).forEach(function (l) {
      assert.deepStrictEqual(Object.keys(l).sort(), ['id', 'state', 'time']);
    });
    assert.deepStrictEqual(lines(reg.file).map(function (l) { return l.state; }),
      ['allocated', 'put-sent', 'created', 'delete-sent', 'deleted']);
  } finally {
    await stub.close();
  }
});

test('the ledger enforces the state order and collided has no successor', function () {
  const dir = tempDir();
  const ledger = new registry.Ledger(new registry.Registry({ dir: dir, runTag: TAG, identity: IDENTITY }));
  ledger.allocated(ID1);
  assert.throws(function () { ledger.move(ID1, 'deleted'); }, /cannot move/);
  assert.throws(function () { ledger.move(ID2, 'put-sent'); }, /not owned/);
  ledger.move(ID1, 'collided');
  ['allocated', 'put-sent', 'created', 'delete-sent', 'deleted', 'collided'].forEach(function (s) {
    assert.throws(function () { ledger.move(ID1, s); }, /cannot move|/);
  });
  assert.strictEqual(ledger.stateOf(ID1), 'collided');
  ledger.allocated(ID2);
  ledger.move(ID2, 'put-sent');
  ledger.move(ID2, 'created');
  ledger.move(ID2, 'put-sent');
  ledger.move(ID2, 'created');
  ledger.move(ID2, 'delete-sent');
  ledger.move(ID2, 'deleted');
  ledger.move(ID2, 'put-sent');
});

test('the registry directory must be absolute and exist', function () {
  assert.throws(function () { registry.checkRegistryDir('relative/dir'); }, /absolute/);
  assert.throws(function () { registry.checkRegistryDir(undefined); }, /absolute/);
  assert.throws(function () { registry.checkRegistryDir(path.join(tempDir(), 'missing')); }, /does not exist/);
  const file = path.join(tempDir(), 'f');
  fs.writeFileSync(file, '');
  assert.throws(function () { registry.checkRegistryDir(file); }, /not a directory/);
});

test('a directory outside every work tree is accepted', function (t) {
  const dir = tempDir();
  try {
    childProcess.execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'ignore' });
    t.skip('the temporary directory is itself inside a work tree on this machine');
    return;
  } catch (e) {
    // not inside a work tree: the case this test is about
  }
  assert.strictEqual(registry.checkRegistryDir(dir), fs.realpathSync(dir));
});

test('a directory inside a work tree is refused unless it is ignored and untracked', function () {
  const repo = tempDir('live-repo-');
  git(['init', '-q'], repo);
  fs.mkdirSync(path.join(repo, 'plain'));
  fs.mkdirSync(path.join(repo, 'scratch'));
  fs.writeFileSync(path.join(repo, '.gitignore'), 'scratch/\n');
  // not ignored: refused
  assert.throws(function () { registry.checkRegistryDir(path.join(repo, 'plain')); }, /not ignored and untracked/);
  // ignored and untracked: accepted
  assert.strictEqual(registry.checkRegistryDir(path.join(repo, 'scratch')), fs.realpathSync(path.join(repo, 'scratch')));
  // ignored, but a tracked file lives under it: refused
  fs.writeFileSync(path.join(repo, 'scratch', 'kept.txt'), 'x');
  git(['add', '-f', 'scratch/kept.txt'], repo);
  assert.throws(function () { registry.checkRegistryDir(path.join(repo, 'scratch')); }, /not ignored and untracked/);
});

test('a symbolic link is resolved before the directory is judged', function () {
  const repo = tempDir('live-repo-');
  git(['init', '-q'], repo);
  fs.mkdirSync(path.join(repo, 'plain'));
  const outside = tempDir();
  const link = path.join(outside, 'link');
  fs.symlinkSync(path.join(repo, 'plain'), link);
  assert.throws(function () { registry.checkRegistryDir(link); }, /not ignored and untracked/);
});

test('orphans refuses without --run or --all', async function () {
  const dir = tempDir();
  await assert.rejects(registry.orphans(dir, {}), /--run/);
  await assert.rejects(registry.orphans(dir, undefined), /--run/);
  await assert.rejects(registry.orphans(dir, { run: 'XYZ' }), /run tag/);
});

function write(dir, tag, identity, rows) {
  fs.writeFileSync(path.join(dir, tag + '.' + identity + '.jsonl'),
    rows.map(function (r) { return JSON.stringify({ time: 't', id: r[0], state: r[1] }); }).join('\n') + '\n');
}

test('orphans reads only the named run and lists may-exist ids apart from never-sent ones', async function () {
  const dir = tempDir();
  const A = 'banana-it-aaaaaaaaaaaa-1';
  const B = 'banana-it-aaaaaaaaaaaa-2';
  const C = 'banana-it-aaaaaaaaaaaa-3';
  const D = 'banana-it-aaaaaaaaaaaa-4';
  const E = 'banana-it-aaaaaaaaaaaa-5';
  const OTHER = 'banana-it-bbbbbbbbbbbb-1';
  write(dir, TAG, 'aaaaaaaaaaaa', [
    [A, 'allocated'], [B, 'allocated'], [B, 'put-sent'], [C, 'allocated'], [C, 'put-sent'], [C, 'created'],
    [D, 'allocated'], [D, 'put-sent'], [D, 'created'], [D, 'delete-sent'],
    [E, 'allocated'], [E, 'collided']
  ]);
  write(dir, 'cccccccccccc', 'bbbbbbbbbbbb', [[OTHER, 'allocated'], [OTHER, 'put-sent'], [OTHER, 'created']]);
  const run = await registry.orphans(dir, { run: TAG });
  assert.deepStrictEqual(run.mayExist.sort(), [B, C, D, E].sort());
  assert.deepStrictEqual(run.neverSent, [A]);
  assert.ok(!run.mayExist.includes(OTHER));
  const all = await registry.orphans(dir, { all: true });
  assert.ok(all.mayExist.includes(OTHER));
});

test('orphans with a probe reports an id at deleted that the instance still has', async function () {
  const dir = tempDir();
  const A = 'banana-it-aaaaaaaaaaaa-1';
  const B = 'banana-it-aaaaaaaaaaaa-2';
  const C = 'banana-it-aaaaaaaaaaaa-3';
  write(dir, TAG, 'aaaaaaaaaaaa', [
    [A, 'allocated'], [A, 'put-sent'], [A, 'created'], [A, 'delete-sent'], [A, 'deleted'],
    [B, 'allocated'], [B, 'put-sent'], [B, 'created'], [B, 'delete-sent'], [B, 'deleted'],
    [C, 'allocated']
  ]);
  const asked = [];
  const report = await registry.orphans(dir, { run: TAG }, async function (id) {
    asked.push(id);
    return id === A ? 200 : 404;
  });
  assert.deepStrictEqual(asked.sort(), [A, B]);          // never-sent C is not probed
  assert.deepStrictEqual(report.found, [A]);
  assert.deepStrictEqual(report.mayExist, []);
});

test('the orphans command refuses without --run or --all and never deletes', async function () {
  const cli = load('cli.js');
  const dir = tempDir();
  const out = [];
  await assert.rejects(cli.run(['orphans'], { BANANA_LIVE_REGISTRY_DIR: dir }, function (l) { out.push(l); }), /--run/);
  await assert.rejects(cli.run(['nope'], {}, function () {}), /usage/);
  write(dir, TAG, 'aaaaaaaaaaaa', [['banana-it-aaaaaaaaaaaa-1', 'put-sent']]);
  const report = await cli.run(['orphans', '--run', TAG], { BANANA_LIVE_REGISTRY_DIR: dir }, function (l) { out.push(l); });
  assert.deepStrictEqual(report.mayExist, ['banana-it-aaaaaaaaaaaa-1']);
  assert.ok(out.some(function (l) { return /may exist \(1\)/.test(l); }));
});
