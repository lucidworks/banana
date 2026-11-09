'use strict';

// The Node client for direct writes. It exposes only login, logout, allocate,
// get, create and remove (plus the steps the browser route uses). Every request
// is built here, run through the rule table, and sent without following
// redirects. One request is in flight at a time, so a run cannot become a load
// test. Messages carry a path, never the host or a credential.

const rules = require('./rules');
const ids = require('./ids');
const traceModule = require('./trace');

class GuardError extends Error {
  constructor(cls, message) {
    super(message);
    this.name = 'GuardError';
    this.cls = cls;
  }
}

class SessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionError';
  }
}

class CollisionError extends Error {
  constructor(id, message) {
    super(message);
    this.name = 'CollisionError';
    this.id = id;
  }
}

class ConfirmError extends Error {
  constructor(id, message) {
    super(message);
    this.name = 'ConfirmError';
    this.id = id;
  }
}

function pathOf(url) {
  const m = /^https?:\/\/[^/?#]*([^?#]*)/i.exec(url);
  return m ? m[1] : '(unparsed)';
}

function sleepMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

class FusionClient {
  // options: base (an origin), user, password, ledger, allocator, and for tests
  // fetchImpl and confirmDelayMs.
  constructor(options) {
    this.base = options.base;
    this._user = options.user;
    this._password = options.password;
    this.ledger = options.ledger;
    this.allocator = options.allocator;
    this._fetch = options.fetchImpl || fetch;
    this._trace = options.trace || null;
    this._delay = options.confirmDelayMs === undefined ? 500 : options.confirmDelayMs;
    this._cookies = new Map();
    this._needsLogin = false;
    this._chain = Promise.resolve();
  }

  _ctx() {
    const ledger = this.ledger;
    return { origin: this.base, stateOf: function (id) { return ledger.stateOf(id); } };
  }

  _enqueue(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(function () {}, function () {});
    return run;
  }

  _assert(req) {
    const verdict = rules.classify(req, this._ctx());
    if (!verdict.allow) {
      throw new GuardError(verdict.cls, 'refused ' + req.method + ' ' + pathOf(req.url) + ': ' + verdict.cls);
    }
    return verdict;
  }

  async _once(req) {
    const headers = { accept: 'application/json' };
    if (req.contentType) {
      headers['content-type'] = req.contentType;
    }
    if (this._cookies.size) {
      headers.cookie = Array.from(this._cookies.entries()).map(function (e) { return e[0] + '=' + e[1]; }).join('; ');
    }
    let res;
    try {
      res = await this._fetch(req.url, {
        method: req.method,
        headers: headers,
        body: req.body === null || req.body === undefined ? undefined : req.body,
        redirect: 'manual',
        cache: 'no-store'
      });
    } catch (e) {
      throw new Error(req.method + ' ' + pathOf(req.url) + ' failed to connect');
    }
    const status = res.status;
    if (status >= 300 && status < 400) {
      throw new Error(req.method + ' ' + pathOf(req.url) + ' answered a redirect (' + status + '), which is not followed');
    }
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const text = await res.text();
    if (this._trace) {
      const m = /^https?:\/\/[^/?#]*([^?#]*)(?:\?([^#]*))?/i.exec(req.url);
      this._trace({ who: 'node', method: req.method, path: m[1], query: traceModule.queryNames(m[2]), contentType: req.contentType || null, status: status });
    }
    return { status: status, text: text, setCookie: setCookie };
  }

  async _loginInner() {
    const req = {
      method: 'POST',
      url: this.base + '/api/session?realmName=native',
      contentType: 'application/json',
      body: JSON.stringify({ username: this._user, password: this._password })
    };
    this._assert(req);
    const res = await this._once(req);
    if (res.status < 200 || res.status > 299) {
      throw new SessionError('the login at /api/session answered ' + res.status);
    }
    this._cookies = new Map();
    for (const c of res.setCookie) {
      const pair = c.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this._cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
    this._needsLogin = false;
  }

  login() {
    return this._enqueue(() => this._loginInner());
  }

  // One request through the rule table. After a 401 the next request logs in
  // first, and a GET that got the 401 is repeated once; a write is never
  // repeated inside the same call.
  async _send(req) {
    this._assert(req);
    return this._enqueue(async () => {
      if (this._needsLogin) {
        await this._loginInner();
      }
      let res = await this._once(req);
      if (res.status === 401) {
        this._needsLogin = true;
        if (req.method === 'GET') {
          await this._loginInner();
          res = await this._once(req);
          if (res.status === 401) {
            throw new SessionError('the session answered 401 after a new login (' + pathOf(req.url) + ')');
          }
        }
      }
      return res;
    });
  }

  async logout() {
    const res = await this._send({ method: 'DELETE', url: this.base + '/api/session', body: null });
    this._cookies = new Map();
    return res.status;
  }

  allocate() {
    const id = this.allocator.next();
    this.ledger.allocated(id);
    return id;
  }

  _owned(id) {
    if (this.ledger.stateOf(id) === undefined) {
      throw new GuardError('not-owned', 'the id is not owned by this process');
    }
  }

  async _getBlob(id) {
    const res = await this._send({ method: 'GET', url: rules.deleteUrl(this.base, id), body: null });
    let json = null;
    try {
      json = JSON.parse(res.text);
    } catch (e) {
      json = null;
    }
    return { status: res.status, json: json };
  }

  async get(id) {
    this._owned(id);
    return this._getBlob(id);
  }

  // Read-only check of an id from a registry file (the orphans command). It
  // returns a status or null; it does not need the id to be owned.
  async probe(id) {
    if (!ids.isValidId(id)) {
      throw new GuardError('not-owned', 'the id is not a run id');
    }
    try {
      return (await this._getBlob(id)).status;
    } catch (e) {
      if (e instanceof GuardError) {
        throw e;
      }
      return null;
    }
  }

  // The 404 check: only an exact 404 allows the first PUT of an id. Anything
  // else moves the id to the terminal state `collided`, except a 401 that
  // persists after a new login, which says nothing about the id.
  async requireAbsent(id) {
    this._owned(id);
    let status = null;
    try {
      status = (await this._getBlob(id)).status;
    } catch (e) {
      if (e instanceof SessionError || e instanceof GuardError) {
        throw e;
      }
      status = null;
    }
    if (status !== 404) {
      this.ledger.move(id, 'collided');
      throw new CollisionError(id, 'the 404 check for ' + id + ' did not answer 404 (' + (status === null ? 'no answer' : status) + '); the id is collided');
    }
  }

  beginPut(id) {
    this._owned(id);
    this.ledger.move(id, 'put-sent');
  }

  // The confirmation after a save: a GET must answer 200 with a body whose
  // first element has the id.
  async confirmPut(id) {
    let res;
    try {
      res = await this._getBlob(id);
    } catch (e) {
      if (e instanceof SessionError || e instanceof GuardError) {
        throw e;
      }
      throw new ConfirmError(id, 'the confirmation GET for ' + id + ' failed');
    }
    const first = Array.isArray(res.json) ? res.json[0] : null;
    if (res.status !== 200 || !first || first.id !== id) {
      throw new ConfirmError(id, 'the save of ' + id + ' was not confirmed (GET answered ' + res.status + ')');
    }
    this.ledger.move(id, 'created');
  }

  beginDelete(id) {
    this._owned(id);
    this._assert({ method: 'DELETE', url: rules.deleteUrl(this.base, id), body: null });
    this.ledger.move(id, 'delete-sent');
  }

  // The confirmation after a delete: a GET must answer exactly 404 (so the 204
  // of a directory is a failure). It is retried at most twice, waiting for the
  // final state; it never repeats the write.
  async confirmDelete(id) {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await sleepMs(this._delay);
      }
      try {
        last = (await this._getBlob(id)).status;
      } catch (e) {
        if (e instanceof GuardError) {
          throw e;
        }
        last = null;
      }
      if (last === 404) {
        this.ledger.move(id, 'deleted');
        return;
      }
    }
    throw new ConfirmError(id, 'the delete of ' + id + ' was not confirmed (GET answered ' + (last === null ? 'nothing' : last) + ')');
  }

  async create(id, dashboard) {
    this._owned(id);
    const state = this.ledger.stateOf(id);
    if (state === 'collided') {
      throw new GuardError('collided', 'the id ' + id + ' is collided');
    }
    if (state !== 'created') {
      await this.requireAbsent(id);
    }
    const body = JSON.stringify([blobDocument(id, dashboard)]);
    this.beginPut(id);
    const res = await this._send({
      method: 'PUT',
      url: rules.deleteUrl(this.base, id) + '?resourceType=banana',
      contentType: 'application/json;charset=UTF-8',
      body: body
    });
    if (res.status < 200 || res.status > 299) {
      throw new ConfirmError(id, 'the save of ' + id + ' answered ' + res.status);
    }
    await this.confirmPut(id);
  }

  async remove(id) {
    this._owned(id);
    const state = this.ledger.stateOf(id);
    if (['put-sent', 'created', 'delete-sent'].indexOf(state) === -1) {
      throw new GuardError('delete', 'the id ' + id + ' is not at a state that allows a delete (' + state + ')');
    }
    this.beginDelete(id);
    try {
      await this._send({ method: 'DELETE', url: rules.deleteUrl(this.base, id), body: null });
    } catch (e) {
      if (e instanceof GuardError) {
        throw e;
      }
      // A failed send is settled by the confirmation GET below.
    }
    await this.confirmDelete(id);
  }

  // Remove every owned id that may exist. An id left at delete-sent is retried
  // once. Returns the lists for the run output.
  async teardown() {
    const report = { removed: [], orphans: [], collided: [], neverSent: [] };
    for (const id of this.ledger.owned()) {
      const state = this.ledger.stateOf(id);
      if (state === 'collided') {
        report.collided.push(id);
      } else if (state === 'allocated') {
        report.neverSent.push(id);
      } else if (state === 'deleted') {
        report.removed.push(id);
      } else {
        let done = false;
        for (let attempt = 0; attempt < 2 && !done; attempt++) {
          if (attempt === 1 && this.ledger.stateOf(id) !== 'delete-sent') {
            break;
          }
          try {
            await this.remove(id);
            done = true;
          } catch (e) {
            done = false;
          }
        }
        (done ? report.removed : report.orphans).push(id);
      }
    }
    return report;
  }
}

// The blob document with the field names Banana uses, so a direct save looks
// like a save from the UI.
function blobDocument(id, dashboard) {
  const doc = {
    id: id,
    banana_user_s: 'banana-it',
    banana_group_s: 'none',
    banana_title_s: id,
    banana_dashboard_s: JSON.stringify(Object.assign({ title: id }, dashboard || {})),
    is_public_b: false
  };
  return doc;
}

module.exports = {
  FusionClient: FusionClient,
  GuardError: GuardError,
  SessionError: SessionError,
  CollisionError: CollisionError,
  ConfirmError: ConfirmError,
  blobDocument: blobDocument,
  pathOf: pathOf
};
