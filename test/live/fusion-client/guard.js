'use strict';

// The browser rule set. A Guard holds what one browser context needs: the rule
// context, the record of aborts and debts, and the route handlers that apply
// the rule table to every request Banana makes. Playwright objects are only
// touched through the small route, request and WebSocket interfaces used
// below, so the logic can be tested with stand-ins and with a real browser.

const rules = require('./rules');
const client = require('./client');
const traceModule = require('./trace');

// A queue that runs one function at a time, in order.
function makeQueue() {
  let tail = Promise.resolve();
  return function serialise(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(function () {}, function () {});
    return run;
  };
}

class Guard {
  // options: client (a FusionClient), origin (the proxy origin), staticRoots.
  constructor(options) {
    this.client = options.client;
    this.origin = options.origin;
    this.ctx = {
      origin: options.origin,
      staticRoots: options.staticRoots,
      stateOf: (id) => options.client.ledger.stateOf(id)
    };
    this.aborts = [];
    this.debts = [];
    this._trace = options.trace || null;
    // Shared by every guard of one process, so all its writes are in one queue.
    this._serialise = options.serialise || makeQueue();
    this.handleRoute = this.handleRoute.bind(this);
    this.handleWebSocket = this.handleWebSocket.bind(this);
    this.onRequest = this.onRequest.bind(this);
  }

  _record(method, cls, url, extra) {
    this.aborts.push(Object.assign({ method: method, cls: cls, path: client.pathOf(url) }, extra || {}));
    this._emit(method, url, { verdict: 'abort', cls: cls });
  }

  _emit(method, url, extra) {
    if (this._trace) {
      const m = /^https?:\/\/[^/?#]*([^?#]*)(?:\?([^#]*))?/i.exec(url);
      this._trace(Object.assign({ who: 'browser', method: method, path: m ? m[1] : '(unparsed)', query: traceModule.queryNames(m && m[2]) }, extra));
    }
  }

  _debt(message) {
    this.debts.push(message);
  }

  // A failure inside the handler is recorded, except the ones that come from a
  // page or context that is already closed.
  async handleRoute(route) {
    try {
      await this._handle(route);
    } catch (e) {
      const message = String(e && e.message ? e.message : e).split('\n')[0];
      if (!/closed|disposed|destroyed/i.test(message)) {
        this._debt('the route handler failed: ' + message);
      }
      // Without this the request would hang until it times out.
      try {
        await route.abort();
      } catch (ignored) {
        // the route was already handled, or the page is closed
      }
    }
  }

  async _handle(route) {
    const request = route.request();
    const req = {
      method: request.method(),
      url: request.url(),
      contentType: request.headers()['content-type'],
      body: request.postDataBuffer()
    };
    const verdict = rules.classify(req, this.ctx);
    if (!verdict.allow) {
      this._record(req.method, verdict.cls, req.url);
      await route.abort();
      return;
    }
    if (!rules.isWrite(req.method)) {
      this._emit(req.method, req.url, { verdict: 'allow', kind: verdict.kind, row: verdict.row });
      await route.continue();
      return;
    }
    if (verdict.kind === 'select') {
      if (this._trace) {
        const names = req.body ? req.body.toString('utf8').split('&').map(function (p) { return p.split('=')[0]; }) : [];
        this._emit(req.method, req.url, { verdict: 'allow', kind: 'select', params: names });
      }
      await this._passThrough(route, req);
      return;
    }
    // The state of an id changes while earlier writes run, so the request is
    // classified again when its turn comes.
    await this._serialise(async () => {
      const current = rules.classify(req, this.ctx);
      if (!current.allow) {
        this._record(req.method, current.cls, req.url);
        await route.abort();
        return;
      }
      await this._write(route, req, current);
    });
  }

  // Send an allowed non-read request without following redirects and answer
  // the page from the fetched response. A redirect answer is not passed on.
  async _passThrough(route, req, afterFetch) {
    let res = null;
    try {
      res = await route.fetch({ maxRedirects: 0 });
    } catch (e) {
      this._debt(req.method + ' ' + client.pathOf(req.url) + ' failed to send');
    }
    const status = res === null ? null : res.status();
    if (res !== null) {
      this._emit(req.method, req.url, { verdict: 'allow', contentType: req.contentType || null, status: status });
    }
    if (afterFetch) {
      await afterFetch();
    }
    if (res === null) {
      await route.abort();
      return;
    }
    if (status >= 300 && status < 400) {
      this._record(req.method, 'redirect', req.url, { status: status });
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'redirect refused by the live-test guard' });
      return;
    }
    await route.fulfill({ response: res });
  }

  async _write(route, req, verdict) {
    const c = this.client;
    try {
      if (verdict.kind === 'put') {
        if (verdict.check404) {
          await c.requireAbsent(verdict.id);
        }
        c.beginPut(verdict.id);
        await this._passThrough(route, req, async () => {
          try {
            await c.confirmPut(verdict.id);
          } catch (e) {
            this._debt(e.message);
          }
        });
      } else if (verdict.kind === 'delete') {
        c.beginDelete(verdict.id);
        await this._passThrough(route, req, async () => {
          try {
            await c.confirmDelete(verdict.id);
          } catch (e) {
            this._debt(e.message);
          }
        });
      } else {
        await this._passThrough(route, req);
      }
    } catch (e) {
      // A collision, a session error or a guard error: nothing is sent.
      this._debt(e.message);
      this._record(req.method, e instanceof client.CollisionError ? 'collision' : 'guard-error', req.url);
      try {
        await route.abort();
      } catch (ignored) {
        // the route was already handled
      }
    }
  }

  // A redirect hop of a GET is not seen by the route. Check it afterwards.
  onRequest(request) {
    if (!request.redirectedFrom()) {
      return;
    }
    const req = { method: request.method(), url: request.url(), contentType: request.headers()['content-type'], body: request.postDataBuffer() };
    const verdict = rules.classify(req, this.ctx);
    if (!verdict.allow) {
      this._record(req.method, verdict.cls, req.url, { hop: true });
    }
  }

  // Every WebSocket is closed without connecting it to a server. The admin
  // UI's channel is counted as telemetry; any other is a failure.
  handleWebSocket(ws) {
    let cls = 'websocket';
    try {
      const url = new URL(ws.url());
      const proto = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : null;
      if (proto !== null && (proto + '//' + url.host).toLowerCase() === this.origin.toLowerCase() &&
          url.pathname === '/api-ws' && url.search === '') {
        cls = 'telemetry';
      }
    } catch (e) {
      cls = 'websocket';
    }
    this._record('WEBSOCKET', cls, ws.url().replace(/^ws/i, 'http'));
    return ws.close();
  }

  // The aborts that fail the test: every class but telemetry, except a read
  // of another origin.
  failures() {
    const out = [];
    for (const a of this.aborts) {
      const harmless = a.cls === 'telemetry' || (a.cls === 'off-origin' && (a.method === 'GET' || a.method === 'HEAD'));
      if (!harmless) {
        out.push(a.method + ' ' + a.path + ' aborted as ' + a.cls + (a.hop ? ' (redirect hop)' : ''));
      }
    }
    return out.concat(this.debts);
  }

  telemetryCount() {
    return this.aborts.filter(function (a) { return a.cls === 'telemetry'; }).length;
  }

  reset() {
    this.aborts = [];
    this.debts = [];
  }
}

module.exports = { Guard: Guard, makeQueue: makeQueue };
