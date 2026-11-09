#!/usr/bin/env node
'use strict';

/*
 * Browser smoke check for a built dist/.
 *
 * A build can succeed and still produce a page that is dead at run time (for example when the AngularJS
 * annotation step is missing, or a panel module cannot be found). This script serves dist/ under each base
 * path, opens it in headless Chromium against stubbed Solr and Fusion responses, and checks that
 *   - the page loads with no script errors, console errors or failed requests,
 *   - AngularJS starts and picks up the settings from config.js,
 *   - every panel type listed in config.js loads and renders, and
 *   - the charting panels draw (including the ones that load extra scripts on demand), and the text and table panels show their content,
 *   - the histogram, timeseries and rangeFacet charts, set to percent stacking, were stacked by the plugin (every column adds up to 100).
 *   - the heatmap's stylesheet reaches only the heatmap: the axes of the bar, scatterplot, multiseries and box plot panels are styled as on a dashboard with no heatmap.
 * The server answers 404 for anything outside the base path, so a pass also shows that every asset URL is relative.
 *
 * With --csp the server also sends `Content-Security-Policy: script-src 'self'; object-src 'none'; frame-ancestors 'self'`
 * (no unsafe-eval, no unsafe-inline), and any policy violation, reported by the browser as a console error, fails the run.
 *
 * Usage: node tools/smoke.js [--dist dist] [--bases /,/banana/,/admin/banana/] [--json report.json] [--headed] [--csp]
 * Needs Playwright with a Chromium browser: `npx playwright install chromium`
 * (PLAYWRIGHT_BROWSERS_PATH selects where the browser is kept). Exit code 0 means every check passed.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { panelNamesFromConfig } = require('./lib/panel-names');
const { buildDashboard, stubRoute, DRAWN, PERCENT_STACKED } = require('./lib/smoke-stubs');

// The panels that draw axes with d3, which the heatmap's stylesheet must not restyle.
const STYLE_PANELS = ['bar', 'scatterplot', 'multiseries', 'boxplot'];
// The heatmap's computed styles, recorded before its stylesheet was scoped to the heatmap panel. After a deliberate
// change to how the heatmap looks, record them again: run `node tools/smoke.js --json <file>`, take any base path's
// entry in the report (an array with one entry per base path), and copy its styles.withHeatmap.heatmap into the
// "heatmap" key and its styles.withHeatmap.probes.heatmap into the "probes" key of tools/lib/heatmap-look.json; commit
// the new file with the change.
const HEATMAP_LOOK = require('./lib/heatmap-look.json');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.xml': 'application/xml'
};

function parseArgs(argv) {
  const args = { dist: 'dist', bases: ['/', '/banana/', '/admin/banana/'], json: null, headed: false, csp: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') { args.dist = argv[++i]; }
    else if (argv[i] === '--bases') { args.bases = argv[++i].split(','); }
    else if (argv[i] === '--json') { args.json = argv[++i]; }
    else if (argv[i] === '--headed') { args.headed = true; }
    else if (argv[i] === '--csp') { args.csp = true; }
    else { throw new Error('unknown argument ' + argv[i]); }
  }
  return args;
}

// The strict policy that --csp enforces: scripts only from the page's own origin, no eval.
const STRICT_CSP = "script-src 'self'; object-src 'none'; frame-ancestors 'self'";

// Policy violations the libraries cause on purpose and survive, each checked below by what is known about it:
//  - feature probe: Leaflet tests `ontouchstart` (and jQuery before version 3 tested `onfocusin` and `onsubmit`), by setting
//    an event handler attribute on a detached element and reading it back; without 'unsafe-inline' the browser
//    refuses the handler, which gives the same answer as on a browser without the feature.
//  - vis wraps a guarded `Function('return this')()` (its bundled copy of webpack's global shim, which falls
//    back to `window` when the evaluation is refused). It runs in the graph panel's chunk.
const PROBE_ATTRIBUTES = ['onfocusin', 'onsubmit', 'onchange', 'ontouchstart'];
const GUARDED_EVAL_FILE = /\/panel-graph-module\.[0-9a-f]+\.js$/;

// Installed before any page script runs: records the violations and the handler attributes that are set.
function recordPolicyViolations() {
  window.__cspViolations = [];
  window.__handlerAttributes = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, file: e.sourceFile });
  });
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name) {
    // the libraries' feature probes set the attribute on an element that is not in the page
    if (/^on[a-z]+$/i.test(name) && !this.isConnected) { window.__handlerAttributes.push(String(name).toLowerCase()); }
    return setAttribute.apply(this, arguments);
  };
}

// The violations that nothing above explains. The refused handler attributes are matched by count: each
// probe attribute set on a detached element must cause exactly one inline-handler violation, so a count that
// differs either way is reported (the browser's report does not say which attribute it was). Two cases
// are not told apart: a probe that causes no violation while a real inline handler does at the same time,
// and page script that sets a real handler under a probe attribute name (onfocusin, onsubmit, onchange,
// ontouchstart) on a detached element, which is counted as a probe.
function unexplainedViolations(seen) {
  const probes = seen.attributes.filter((n) => PROBE_ATTRIBUTES.indexOf(n) !== -1).length;
  const inline = seen.violations.filter((v) => v.directive === 'script-src-attr' && v.blocked === 'inline').length;
  const unexplained = seen.violations.filter((v) => {
    if (v.directive === 'script-src-attr' && v.blocked === 'inline') { return false; }
    return !((v.directive === 'script-src-elem' || v.directive === 'script-src') && v.blocked === 'eval' && GUARDED_EVAL_FILE.test(v.file || ''));
  });
  if (inline !== probes) {
    unexplained.push({ directive: 'script-src-attr', blocked: inline + ' inline-handler violations for ' + probes + ' probe attributes', file: '' });
  }
  return unexplained;
}

// Runs in the page. Reads the computed styles that the panels' own stylesheets decide, so that two page loads
// can be compared. For each panel in `types` it reads the first axis tick (its text and line) and a set of probe
// elements, one for every selector that the heatmap stylesheet has rules for, appended inside the panel and removed
// again. The heatmap's own drawn labels, ticks and grid lines are read too.
function readPanelStyles(types) {
  const PROPS = ['font-size', 'font-family', 'font-weight', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
    'fill', 'position', 'width', 'padding-top', 'background-color', 'border-top-left-radius', 'box-shadow', 'pointer-events',
    'z-index', 'display', 'line-height', 'margin-top'];
  const read = (el) => {
    const cs = window.getComputedStyle(el);
    const out = {};
    PROPS.forEach((p) => { out[p] = cs.getPropertyValue(p); });
    return out;
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const panelBox = (type) => {
    const panel = Array.from(document.querySelectorAll('kibana-panel'))
      .filter((e) => window.angular.element(e).scope().panel.type === type)[0];
    return panel && panel.parentElement;
  };
  const out = { axis: {}, probes: {}, heatmap: {} };
  types.forEach((type) => {
    const box = panelBox(type);
    const svg = box && box.querySelector('svg');
    if (!svg) { return; }
    const tick = svg.querySelector('.tick text');
    out.axis[type] = tick ? { text: read(tick), line: read(tick.parentNode.querySelector('line') || tick) } : null;
    // probes: an element for each selector the heatmap stylesheet has rules for
    const svgProbe = (tag, cls, parent) => { const e = document.createElementNS(SVG, tag); e.setAttribute('class', cls); (parent || svg).appendChild(e); return e; };
    const probes = {};
    const added = [];
    const add = (name, el) => { added.push(el); probes[name] = read(el); };
    const g = svgProbe('g', '', svg);
    added.push(g);
    ['selection', 'cell-border', 'cell-selected', 'cell-hover'].forEach((c) => add('rect.' + c, svgProbe('rect', c)));
    ['text-selected', 'text-highlight', 'text-hover', 'plain'].forEach((c) => add('text.' + c, svgProbe('text', c, g)));
    add('g>text', svgProbe('text', '', g));
    add('.tick', svgProbe('line', 'tick', g));
    add('.grid', svgProbe('line', 'grid', g));
    const popup = document.createElement('div');
    popup.className = 'popup';
    const para = document.createElement('p');
    popup.appendChild(para);
    // a heatmap's popup belongs inside the heatmap panel's own element, which is what the stylesheet is scoped to
    (type === 'heatmap' && box.querySelector('.heatmap-panel') || box).appendChild(popup);
    added.push(popup);
    probes['.popup'] = read(popup);
    probes['.popup p'] = read(para);
    popup.className = 'popup hidden';
    probes['.popup.hidden'] = read(popup);
    added.forEach((e) => { if (e.parentNode) { e.parentNode.removeChild(e); } });
    out.probes[type] = probes;
    if (type === 'heatmap') {
      const first = (sel) => { const e = svg.querySelector(sel); return e ? read(e) : null; };
      out.heatmap = {
        rowLabel: first('text[class*=rowLabel_]'),
        colLabel: first('text[class*=colLabel_]'),
        axisTitle: first('text.axis-label:not([class*=Label_])'),
        tick: first('line.tick'),
        grid: first('line.grid'),
        cell: first('rect[class*=cell_]'),
        counts: { rowLabels: svg.querySelectorAll('text[class*=rowLabel_]').length, grid: svg.querySelectorAll('line.grid').length, ticks: svg.querySelectorAll('line.tick').length }
      };
    }
  });
  return out;
}

// Serves `dir` under `prefix`; everything outside the prefix is a 404.
function startServer(dir, prefix, csp) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(prefix)) { res.writeHead(404); return res.end('outside base path: ' + url); }
    let rel = url.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) { rel += 'index.html'; }
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); return res.end('not found: ' + url); }
      const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
      if (csp) { headers['content-security-policy'] = STRICT_CSP; }
      res.writeHead(200, headers);
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function checkBase(chromium, args, base, panels) {
  const server = await startServer(args.dist, base, args.csp);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: !args.headed });
  const problems = [];
  const result = { base, checks: {}, problems };
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const stubbed = [];
    page.on('pageerror', (e) => problems.push('page error: ' + String(e && e.message || e).split('\n')[0]));
    if (args.csp) { await page.addInitScript(recordPolicyViolations); }
    // under --csp the violations are judged one by one from the browser's reports (see unexplainedViolations)
    const policyNoise = /^(Executing inline event handler|Refused to evaluate a string)/;
    page.on('console', (m) => { if (m.type() === 'error' && !(args.csp && policyNoise.test(m.text()))) { problems.push('console error: ' + m.text().slice(0, process.env.SMOKE_FULL ? 4000 : 300)); } });
    page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()));
    page.on('response', (r) => {
      const u = new URL(r.url());
      const isStub = /^\/(api|solr)\//.test(u.pathname) || /banana-smoke\.json$/.test(u.pathname);
      if (r.status() >= 400 && !isStub) { problems.push('HTTP ' + r.status() + ' ' + u.pathname); }
    });
    const dashboard = buildDashboard(panels);
    await page.route((u) => /^\/(api|solr)\//.test(u.pathname) || /banana-smoke\.json$/.test(u.pathname), (route) => {
      stubbed.push(route.request().url());
      return stubRoute(route, dashboard);
    });

    await page.goto('http://127.0.0.1:' + port + base + 'index.html#/dashboard/file/banana-smoke.json', { waitUntil: 'load' });

    const check = async (name, fn) => {
      try { result.checks[name] = await fn(); } catch (e) { result.checks[name] = false; problems.push(name + ': ' + String(e.message).split('\n')[0]); }
    };

    await check('angular_started', async () => {
      await page.waitForFunction(() => window.angular && document.querySelector('.ng-scope'), null, { timeout: 20000 });
      return true;
    });
    await check('config_applied', () => page.evaluate(() => {
      const scope = window.angular.element(document.body).scope();
      return !!scope && !!scope.config && scope.config.solr === '/api/query-pipelines/_system/collections/' && scope.config.USE_FUSION === true;
    }));
    await check('all_panels_rendered', async () => {
      // kibana-panel loses its ng-cloak class once the panel module and template have loaded and been compiled
      const renderedPanels = () => page.evaluate(() => Array.from(document.querySelectorAll('kibana-panel'))
        .filter((e) => !e.classList.contains('ng-cloak'))
        .map((e) => window.angular.element(e).scope().panel.type));
      try {
        await page.waitForFunction((n) => {
          return document.querySelectorAll('kibana-panel').length >= n &&
            Array.from(document.querySelectorAll('kibana-panel')).filter((e) => !e.classList.contains('ng-cloak')).length >= n;
        }, panels.length, { timeout: 30000 });
      } catch (e) { /* the panels that did render are counted below */ }
      const rendered = await renderedPanels();
      const missing = panels.filter((p) => rendered.indexOf(p) === -1);
      result.panelsRendered = panels.length - missing.length;
      if (missing.length) { throw new Error('panels not rendered: ' + missing.join(', ')); }
      return true;
    });
    await check('charts_drawn', async () => {
      const wanted = DRAWN.filter((d) => panels.indexOf(d[0]) !== -1);
      await page.waitForFunction((list) => list.every((d) => {
        const panel = Array.from(document.querySelectorAll('kibana-panel'))
          .filter((e) => window.angular.element(e).scope().panel.type === d[0])[0];
        return !!panel && !!panel.parentElement.querySelector(d[1]);
      }), wanted, { timeout: 20000 });
      return true;
    });
    await check('percent_stacking', async () => {
      const wanted = PERCENT_STACKED.filter((t) => panels.indexOf(t) !== -1);
      // Each chart shows one series in the smoke dashboard, so a percent-stacked column is the whole of its column: 100.
      // Without the plugin the points keep the counts of the stub (1, 2 and 3) and there are no percents.
      await page.waitForFunction((types) => types.every((type) => {
        const panel = Array.from(document.querySelectorAll('kibana-panel'))
          .filter((e) => window.angular.element(e).scope().panel.type === type)[0];
        const canvas = panel && panel.parentElement.querySelector('canvas');
        const plot = canvas && window.jQuery(canvas.parentElement).data('plot');
        const series = plot && plot.getData()[0];
        return !!series && Array.isArray(series.percents) && series.percents.length > 0 &&
          series.datapoints.points.filter((v, i) => i % series.datapoints.pointsize === 1 && v !== null && v !== 0).every((v) => Math.abs(v - 100) < 1e-9);
      }), wanted, { timeout: 20000 });
      return true;
    });
    await check('leaflet_plugins_loaded', () => page.evaluate(() => !!window.L && typeof window.L.MarkerClusterGroup === 'function'));
    await check('text_panel_markdown', async () => {
      await page.locator('markdown strong', { hasText: 'smoke-markdown' }).first().waitFor({ state: 'visible', timeout: 15000 });
      return true;
    });
    await check('table_panel_rows', async () => {
      const rows = page.locator('td', { hasText: /smoke-doc-[123]$/ });
      await rows.first().waitFor({ state: 'visible', timeout: 15000 });
      return true;
    });
    await check('panel_stylesheets', () => page.evaluate(() => {
      // css! panel styles are injected by the bundle: bettermap/leaflet, heatmap and query
      const text = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
      return /leaflet-container/.test(text) && /short-query/.test(text);
    }));
    // The heatmap's stylesheet is injected into the page when the heatmap panel loads. It must only reach the heatmap:
    // with a heatmap on the dashboard, the other panels' axes and probe elements must be styled as they are on a
    // dashboard that has no heatmap, and the heatmap itself must keep its own look.
    if (panels.indexOf('heatmap') !== -1) {
      await check('heatmap_stylesheet_scoped', async () => {
        const differences = [];
        const types = STYLE_PANELS.filter((t) => panels.indexOf(t) !== -1);
        await page.waitForFunction((list) => list.every((t) => {
          const panel = Array.from(document.querySelectorAll('kibana-panel')).filter((e) => window.angular.element(e).scope().panel.type === t)[0];
          return !!panel && !!panel.parentElement.querySelector(t === 'heatmap' ? 'line.grid' : '.tick text');
        }), types.concat(['heatmap']), { timeout: 20000 });
        const withHeatmap = await page.evaluate(readPanelStyles, types.concat(['heatmap']));
        // the same dashboard without the heatmap, in a page of its own, so that the heatmap's stylesheet is not loaded
        const bareDashboard = buildDashboard(panels.filter((p) => p !== 'heatmap'));
        const bare = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
        await bare.route((u) => /^\/(api|solr)\//.test(u.pathname) || /banana-smoke\.json$/.test(u.pathname), (route) => stubRoute(route, bareDashboard));
        await bare.goto('http://127.0.0.1:' + port + base + 'index.html#/dashboard/file/banana-smoke.json', { waitUntil: 'load' });
        await bare.waitForFunction((list) => list.every((t) => {
          const panel = Array.from(document.querySelectorAll('kibana-panel')).filter((e) => window.angular.element(e).scope().panel.type === t)[0];
          return !!panel && !!panel.parentElement.querySelector('.tick text');
        }), types, { timeout: 30000 });
        const without = await bare.evaluate(readPanelStyles, types);
        // every rule of the heatmap's stylesheet must name the heatmap panel
        const unscoped = await page.evaluate(() => {
          const sheet = Array.from(document.styleSheets).filter((ss) => ss.ownerNode && ss.ownerNode.tagName === 'STYLE' &&
            Array.from(ss.cssRules).some((r) => /cell-border/.test(r.cssText)))[0];
          if (!sheet) { return ['the heatmap stylesheet was not found']; }
          return Array.from(sheet.cssRules).map((r) => r.selectorText).filter((sel) => sel && sel.split(',').some((one) => !/^\s*\.heatmap-panel[\s.:\[]/.test(one)));
        });
        unscoped.forEach((sel) => { differences.push('the heatmap stylesheet has a rule that is not inside the heatmap panel: ' + sel); });
        const hasHeatmapRules = await bare.evaluate(() => Array.from(document.querySelectorAll('style')).some((s) => /cell-border/.test(s.textContent)));
        await bare.close();
        result.styles = { withHeatmap, without };
        if (hasHeatmapRules) { differences.push('the dashboard without a heatmap still loaded the heatmap stylesheet'); }
        types.forEach((t) => {
          if (!withHeatmap.axis[t]) { differences.push(t + ': no axis was drawn, so its styles were not checked'); return; }
          if (!without.axis[t]) { differences.push(t + ': no axis was drawn on the dashboard without a heatmap'); return; }
          ['text', 'line'].forEach((part) => {
            Object.keys(without.axis[t][part]).forEach((p) => {
              if (withHeatmap.axis[t][part][p] !== without.axis[t][part][p]) {
                differences.push(t + ' axis ' + part + ' ' + p + ': ' + without.axis[t][part][p] + ' without a heatmap, ' + withHeatmap.axis[t][part][p] + ' with one');
              }
            });
          });
          Object.keys(without.probes[t]).forEach((name) => {
            Object.keys(without.probes[t][name]).forEach((p) => {
              if (withHeatmap.probes[t][name][p] !== without.probes[t][name][p]) {
                differences.push(t + ' ' + name + ' ' + p + ': ' + without.probes[t][name][p] + ' without a heatmap, ' + withHeatmap.probes[t][name][p] + ' with one');
              }
            });
          });
        });
        // the heatmap keeps its look: its drawn labels, ticks and grid, and what each of its rules gives an element inside it
        const own = { heatmap: withHeatmap.heatmap, probes: withHeatmap.probes.heatmap };
        const expected = HEATMAP_LOOK;
        const compare = (path, want, got) => {
          if (want && typeof want === 'object') {
            if (!got || typeof got !== 'object') { differences.push('heatmap ' + path + ' was not drawn'); return; }
            Object.keys(want).forEach((k) => compare(path + ' ' + k, want[k], got[k]));
          } else if (want !== got) {
            differences.push('heatmap ' + path + ': ' + want + ' expected, ' + got + ' drawn');
          }
        };
        compare('', expected, own);
        differences.slice(0, 12).forEach((d) => problems.push('heatmap_stylesheet_scoped: ' + d));
        if (differences.length > 12) { problems.push('heatmap_stylesheet_scoped: ' + (differences.length - 12) + ' more differences'); }
        return differences.length === 0;
      });
    }
    // Clicking is what exercises the Bootstrap plugins: a toggle whose handler throws lets the browser follow its
    // href="#", which replaces the open dashboard, so every step also checks that the route did not change.
    let step = 'start';
    await check('bootstrap_interactions', async () => {
     try {
      const route = () => page.evaluate(() => window.location.hash);
      const startRoute = await route();
      const closeMenus = async () => { await page.mouse.click(700, 990); await page.waitForTimeout(150); };
      const toggles = page.locator('.navbar .dropdown-toggle[data-toggle="dropdown"]');
      const count = await toggles.count();
      const opened = [];
      for (let i = 0; i < count; i++) {
        const t = toggles.nth(i);
        if (!(await t.isVisible())) { continue; }
        await t.click();
        await page.waitForTimeout(200);
        if (!(await t.evaluate((el) => el.parentElement.classList.contains('open')))) { throw new Error('navigation menu ' + i + ' did not open'); }
        if ((await route()) !== startRoute) { throw new Error('clicking navigation menu ' + i + ' changed the route to ' + (await route())); }
        opened.push(i);
        await closeMenus();
      }
      if (opened.length < 3) { throw new Error('only ' + opened.length + ' navigation menus (New, Load, Save) were opened'); }

      step = 'panel header menu';
      const panelMenus = page.locator('kibana-panel span.pointer[data-toggle="dropdown"]');
      let panelMenu = null;
      for (let i = 0; i < await panelMenus.count() && !panelMenu; i++) {
        // the buttons in a panel's header are shown while the pointer is over the panel
        await panelMenus.nth(i).locator('xpath=ancestor::kibana-panel').hover({ force: true });
        if (await panelMenus.nth(i).isVisible()) { panelMenu = panelMenus.nth(i); }
      }
      if (!panelMenu) { throw new Error('no panel header menu is visible'); }
      await panelMenu.click();
      await page.waitForTimeout(200);
      if (!(await panelMenu.evaluate((el) => !!el.closest('.open')))) { throw new Error('the panel header menu did not open'); }
      if ((await route()) !== startRoute) { throw new Error('the route changed to ' + (await route())); }
      await closeMenus();

      step = 'collapse';
      const collapse = page.locator('[data-toggle="collapse"]').first();
      if (!(await collapse.count())) { throw new Error('no collapse toggle found'); }
      await collapse.click({ force: true });
      await page.waitForTimeout(700);
      if (!(await collapse.evaluate((el) => document.querySelector(el.getAttribute('href')).classList.contains('in')))) { throw new Error('the collapse did not open'); }

      step = 'modal and tabs';
      await page.locator('kibana-panel [bs-modal]').first().click({ force: true });
      const modal = page.locator('.modal:visible').first();
      await modal.waitFor({ state: 'visible', timeout: 5000 });
      const tabs = modal.locator('.nav-tabs a[data-toggle="tab"]');
      if ((await tabs.count()) < 2) { throw new Error('the panel editor has no tabs'); }
      await tabs.nth(1).click();
      await page.waitForTimeout(400);
      if (!(await tabs.nth(1).evaluate((el) => el.parentElement.classList.contains('active')))) { throw new Error('the second tab did not become active'); }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      if ((await route()) !== startRoute) { throw new Error('the route changed to ' + (await route())); }
      return true;
     } catch (e) { e.message = step + ': ' + e.message; throw e; }
    });
    // let late responses and render events finish before the error list is read
    await page.waitForTimeout(1500);
    if (args.csp) {
      await check('csp_violations', async () => {
        const seen = await page.evaluate(() => ({ violations: window.__cspViolations, attributes: window.__handlerAttributes }));
        result.cspViolations = seen.violations.length;
        result.probeAttributes = seen.attributes;
        const bad = unexplainedViolations(seen);
        bad.forEach((v) => problems.push('policy violation: ' + v.directive + ' ' + v.blocked + ' ' + v.file));
        return bad.length === 0;
      });
    }
    result.stubbedRequests = stubbed.length;
    result.checks.no_errors = problems.length === 0;
  } finally {
    await browser.close();
    server.close();
  }
  result.ok = Object.keys(result.checks).every((k) => result.checks[k] === true);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distDir = path.resolve(args.dist);
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('smoke: ' + args.dist + '/index.html does not exist. Run `npm run build` first.');
    process.exit(1);
  }
  const panels = panelNamesFromConfig(fs.readFileSync(path.join(distDir, 'config.js'), 'utf8'));
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) {
    console.error('smoke: Playwright is not installed. Run `npm ci`, then `npx playwright install chromium`.');
    process.exit(1);
  }
  const report = [];
  for (const base of args.bases) {
    let r;
    try { r = await checkBase(chromium, args, base, panels); } catch (e) { r = { base, ok: false, problems: [String(e.message || e)], checks: {} }; }
    report.push(r);
    console.log((r.ok ? 'PASS ' : 'FAIL ') + base + '  panels rendered: ' + (r.panelsRendered || 0) + '/' + panels.length);
    Object.keys(r.checks).forEach((k) => { if (r.checks[k] !== true) { console.log('  failed check: ' + k); } });
    r.problems.slice(0, 15).forEach((p) => console.log('  ' + p));
  }
  if (args.json) { fs.writeFileSync(args.json, JSON.stringify(report, null, 2)); }
  const ok = report.every((r) => r.ok);
  console.log(ok ? 'smoke: all base paths passed' : 'smoke: FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
