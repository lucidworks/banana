'use strict';

// The on-disk registry: a crash record of every id this process allocated and
// the state it reached. It holds ids and states only. A process deletes only
// ids it holds in memory; no later run reads a registry in order to delete.

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const ids = require('./ids');

const STATES = ['allocated', 'put-sent', 'created', 'delete-sent', 'deleted', 'collided'];

// The states an id may move to, from each state. `collided` has no successor.
const TRANSITIONS = {
  'allocated': ['put-sent', 'collided'],
  'put-sent': ['put-sent', 'created', 'delete-sent', 'collided'],
  'created': ['put-sent', 'delete-sent'],
  'delete-sent': ['delete-sent', 'deleted', 'put-sent', 'collided'],
  'deleted': ['put-sent', 'collided'],
  'collided': []
};

// States in which an id may exist on the instance.
const MAY_EXIST = ['put-sent', 'created', 'delete-sent', 'collided'];

function git(args, cwd) {
  try {
    return {
      ok: true,
      out: childProcess.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    };
  } catch (e) {
    return { ok: false, out: '' };
  }
}

// The directory must be absolute and exist. After resolving symbolic links it
// must be outside every git work tree, or inside one but untracked and ignored,
// so a registry file can never be committed. Returns the resolved path.
function checkRegistryDir(dir) {
  if (!git(['--version'], process.cwd()).ok) {
    throw new Error('git is needed to check the registry directory');
  }
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new Error('the registry directory must be an absolute path');
  }
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (e) {
    throw new Error('the registry directory does not exist');
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new Error('the registry path is not a directory');
  }
  const inside = git(['rev-parse', '--is-inside-work-tree'], real);
  if (inside.ok && inside.out === 'true') {
    const probe = path.join(real, 'registry-probe.jsonl');
    const ignored = git(['check-ignore', '-q', probe], real).ok;
    const tracked = git(['ls-files', '--', real], real);
    if (!ignored || !tracked.ok || tracked.out !== '') {
      throw new Error('the registry directory is inside a git work tree and is not ignored and untracked');
    }
  }
  return real;
}

class Registry {
  // dir: a directory that passed checkRegistryDir; fsync is injectable for tests.
  constructor(options) {
    if (!ids.isValidRunTag(options.runTag)) {
      throw new Error('the run tag must be 12 lowercase hexadecimal characters');
    }
    if (!/^[0-9a-f]{12}$/.test(options.identity)) {
      throw new Error('the identity must be 12 lowercase hexadecimal characters');
    }
    this.file = path.join(options.dir, options.runTag + '.' + options.identity + '.jsonl');
    this._fsync = options.fsync || fs.fsyncSync;
    // Exclusive creation: two processes cannot share an identity.
    this._fd = fs.openSync(this.file, 'wx', 0o600);
  }

  append(id, state) {
    const line = JSON.stringify({ time: new Date().toISOString(), id: id, state: state }) + '\n';
    fs.writeSync(this._fd, line);
    this._fsync(this._fd);
  }

  close() {
    if (this._fd !== null) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }
}

// The state of every id this process owns, written to the registry before it
// is acted on. A failed append throws, so the request that follows is not sent.
class Ledger {
  constructor(registry) {
    this.registry = registry;
    this.states = new Map();
  }

  stateOf(id) {
    return this.states.get(id);
  }

  allocated(id) {
    this.registry.append(id, 'allocated');
    this.states.set(id, 'allocated');
  }

  move(id, state) {
    const from = this.states.get(id);
    if (from === undefined) {
      throw new Error('the id is not owned by this process');
    }
    if (STATES.indexOf(state) === -1 || TRANSITIONS[from].indexOf(state) === -1) {
      throw new Error('the id cannot move from ' + from + ' to ' + state);
    }
    this.registry.append(id, state);
    this.states.set(id, state);
  }

  owned() {
    return Array.from(this.states.keys());
  }
}

// Read every registry file of one run (or all files) and return, per id, its
// last state and whether it ever reached put-sent.
function readRegistry(dir, options) {
  if (!options || (!options.run && !options.all)) {
    throw new Error('orphans needs --run <run-tag> or --all');
  }
  if (options.run && !ids.isValidRunTag(options.run)) {
    throw new Error('the run tag must be 12 lowercase hexadecimal characters');
  }
  const result = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    const m = /^([0-9a-f]{12})\.([0-9a-f]{12})\.jsonl$/.exec(name);
    if (!m || (options.run && m[1] !== options.run)) {
      continue;
    }
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) {
        continue;
      }
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (!ids.isValidId(rec.id) || STATES.indexOf(rec.state) === -1) {
        continue;
      }
      const cur = result.get(rec.id) || { id: rec.id, last: null, everPutSent: false, run: m[1] };
      cur.last = rec.state;
      cur.everPutSent = cur.everPutSent || rec.state === 'put-sent';
      result.set(rec.id, cur);
    }
  }
  return Array.from(result.values());
}

// The orphan report. `probe(id)` is optional and returns an HTTP status (or
// null on failure) for a read of the id; with it, every id that ever reached
// put-sent is checked, including ones whose last state is `deleted`.
async function orphans(dir, options, probe) {
  const entries = readRegistry(dir, options);
  const report = {
    mayExist: entries.filter(function (e) { return MAY_EXIST.indexOf(e.last) !== -1; }).map(function (e) { return e.id; }),
    neverSent: entries.filter(function (e) { return e.last === 'allocated'; }).map(function (e) { return e.id; }),
    found: []
  };
  if (probe) {
    for (const e of entries) {
      if (e.everPutSent) {
        const status = await probe(e.id);
        if (status === 200 || status === 204) {
          report.found.push(e.id);
        }
      }
    }
  }
  return report;
}

module.exports = {
  STATES: STATES,
  TRANSITIONS: TRANSITIONS,
  MAY_EXIST: MAY_EXIST,
  checkRegistryDir: checkRegistryDir,
  Registry: Registry,
  Ledger: Ledger,
  readRegistry: readRegistry,
  orphans: orphans
};
