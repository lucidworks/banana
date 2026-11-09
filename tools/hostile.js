#!/usr/bin/env node
'use strict';

/*
 * Hostile-data render check for a built dist/.
 *
 * Reading the code for places that write text into the page as HTML kept missing places, so this runs it.
 * It serves dist/ (as tools/smoke.js does), opens it in headless Chromium against stubbed Solr and Fusion
 * responses in which EVERY string a person could influence is a payload (document fields, facet terms,
 * highlight snippets, field names from the schema, collection names, saved dashboard names, stream results,
 * the user name) and in which the dashboard itself holds payloads (titles, text panel content). Each payload
 * calls window.__d3canary(N); the number N says where the payload was put (see tools/lib/hostile-stubs.js).
 *
 * Then it uses the page: opens every panel's editor and types into every typeahead, hovers every tooltip and
 * chart, opens table rows and their views, and runs the dashboard menu actions that raise alerts. In a
 * second pass it sets every string setting of every panel, one at a time, to a payload.
 *
 * After every step it checks that the canary never ran and that no element has an event-handler attribute
 * that carries a canary, or a javascript: address. Exit code 0 means nothing leaked.
 *
 * What it cannot reach is listed in docs/adr/0024-render-document-data-and-markdown-safely.md.
 *
 * Usage: node tools/hostile.js [--dist dist] [--styles markup,url] [--no-settings] [--headed] [--dump selector]
 * Needs a build (`npm run build`) and Playwright with Chromium, like the smoke check.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { panelNamesFromConfig } = require('./lib/panel-names');
const { buildDashboard } = require('./lib/smoke-stubs');
const { createStubs, sources } = require('./lib/hostile-stubs');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.xml': 'application/xml'
};

function parseArgs(argv) {
  const args = { dist: 'dist', styles: ['markup', 'url'], settings: true, headed: false, dump: null, evaluate: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') { args.dist = argv[++i]; }
    else if (argv[i] === '--styles') { args.styles = argv[++i].split(','); }
    else if (argv[i] === '--no-settings') { args.settings = false; }
    else if (argv[i] === '--headed') { args.headed = true; }
    else if (argv[i] === '--dump') { args.dump = argv[++i]; }
    else if (argv[i] === '--eval') { args.evaluate = argv[++i]; }
    else { throw new Error('unknown argument ' + argv[i]); }
  }
  return args;
}

function startServer(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let rel = url.slice(1);
    if (rel === '' || rel.endsWith('/')) { rel += 'index.html'; }
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); return res.end('not found: ' + url); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Dashboard for one run: the smoke dashboard, a few more panels, and payloads in its own texts.
function hostileDashboard(panels, H) {
  const dashboard = buildDashboard(panels);
  dashboard.title = H('dashboard title');
  const settings = {
    docviewer: { titleField: 'title_s', contentField: 'message_txt' },
    fullTextSearch: { header_field: 'title_s', body_field: 'message_txt', url_field: 'link_s', fields: ['type_s'] },
    facet: { fields: ['type_s'] },
    terms: { field: 'type_s', chart: 'pie', useColorFromField: true },
    boxplot: { facet_pivot_strings: ['type_s', 'count_i'] },
    sunburst: { facet_pivot_strings: ['type_s', 'title_s'], labels: true, label_rings: 3 },
    force: { facet_pivot_strings: ['type_s', 'title_s'], node_limit: 5, facet_limit: '3,5' },
    sankey: { facet_pivot_strings: ['type_s', 'title_s'] },
    table: { fields: ['id', 'title_s', 'message_txt', 'link_s', 'nested_s'], enableHyperlink: true, hyperlinkColumnForURI: 'link_s', hyperlinkColumnHeader: H('hyperlink header'), imageFields: ['link_s'] }
  };
  dashboard.rows.forEach((row) => {
    row.title = H('row title ' + row.title);
    const panel = row.panels[0];
    Object.assign(panel, settings[panel.type] || {});
    panel.title = H('panel title ' + panel.type);
    if (panel.type === 'text') {
      panel.content = '**smoke-markdown** [link](' + H('markdown link') + ') ![img](' + H('markdown image') + ') ' + H('markdown text');
    }
  });
  // the Hits panel in each of its styles, the box plot, and the settings that the harvested panels added
  const hitsStyles = ['total', 'bar', 'pie', 'list'];
  hitsStyles.forEach((chart) => {
    dashboard.rows.push({
      title: 'hits ' + chart, height: '150px', editable: true, collapse: false, collapsable: true,
      panels: [{ type: 'hits', span: 12, title: H('hits panel title ' + chart), chart: chart, labels: true, editable: true, error: false }]
    });
  });
  // panel types that config.js does not offer but a dashboard can still name
  [['derivequeries', { field: 'type_s', history: [H('query history 1'), H('query history 2')] }], ['template', {}]].forEach((extra) => {
    if (panels.indexOf(extra[0]) === -1) {
      dashboard.rows.push({
        title: extra[0], height: '100px', editable: true, collapse: false, collapsable: true,
        panels: [Object.assign({ type: extra[0], span: 12, title: H('panel title ' + extra[0]), editable: true, error: false }, extra[1])]
      });
    }
  });
  // queries and filters
  const query = dashboard.services.query.list[0];
  query.alias = H('query alias');
  query.color = H('query colour');
  // Chromium keeps a colour with one of these functions exactly as written, strings and quotes included
  ['var(--a,"', 'env(x,"', 'calc(1px + "', 'attr(x,"', 'color-mix(in srgb, red, "'].forEach((open, i) => {
    const id = i + 1;
    dashboard.services.query.list[id] = { query: '*:*', alias: 'q' + id, color: open + H('query colour in ' + open) + '")', id: id, pin: false, type: 'lucene' };
    dashboard.services.query.ids.push(id);
  });
  dashboard.services.query.idQueue = [6];
  query.query = H('query text');
  dashboard.services.filter.list[1] = { type: 'terms', field: 'type_s', value: H('filter value'), mandate: 'must', active: true, alias: H('filter alias'), id: 1 };
  dashboard.services.filter.ids.push(1);
  dashboard.services.filter.idQueue = [2];
  ['html', 'text'].forEach((mode) => {
    dashboard.rows.push({
      title: 'text ' + mode, height: '100px', editable: true, collapse: false, collapsable: true,
      panels: [{ type: 'text', span: 12, mode: mode, title: 't', editable: true, error: false,
        content: H('text panel content, mode ' + mode) + ' <a href="' + H('text panel link, mode ' + mode) + '">link</a>' }]
    });
  });
  return dashboard;
}

// Runs in the page: what to look at after each step.
const PAGE_SCAN = function () {
  const bad = [];
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const tag = el.tagName.toLowerCase();
    for (let j = 0; j < el.attributes.length; j++) {
      const name = el.attributes[j].name.toLowerCase();
      const value = el.attributes[j].value;
      if (/^on/.test(name) && value.indexOf('__d3canary') >= 0) { bad.push(tag + ' ' + name + '=' + value.slice(0, 80)); }
      if (/^(href|src|action|formaction|xlink:href|data)$/.test(name) && /^[\s\u0000- ]*javascript:/i.test(value)) { bad.push(tag + ' ' + name + '=' + value.slice(0, 80)); }
    }
    if (tag === 'img' && el.getAttribute('src') === 'x') { bad.push('img src=x'); }
    if (tag === 'script' && el.textContent.indexOf('__d3canary') >= 0) { bad.push('script with canary'); }
  }
  return bad;
};


// Shows every tooltip, hovers every flot chart with a point built from its own first series, and sends mouse
// events to every d3 mark, map region and marker. `label` names the step.
async function hoverEverything(page, step, label, withTooltips) {
  if (withTooltips) {
    await page.evaluate(() => {
      const $ = window.jQuery;
      $('[bs-tooltip]').each(function () { try { $(this).tooltip('show'); } catch (e) { /* not a tooltip yet */ } });
    });
    await step('tooltips shown' + label);
  }
  await page.evaluate((scanSource) => {
    const scan = window.eval('(' + scanSource + ')');
    window.__extra = window.__extra || [];
    // a hover tooltip is one element that the next hover rewrites, so the page is checked after each hover
    const check = function () { scan().forEach(function (b) { window.__extra.push(b); }); };
    const $ = window.jQuery;
    $('.legendLabel, canvas').parent().each(function () {
      const plot = $(this).data('plot');
      if (!plot) { return; }
      const data = plot.getData();
      const offset = plot.getPlaceholder().offset();
      // every series (a pie has one per slice), and three points of each
      data.slice(0, 8).forEach(function (series, s) {
        [0, 1, 2].forEach(function (i) {
          const point = series.data && series.data[i];
          const pos = { x: point ? point[0] : 1, y: point ? point[1] : 1, pageX: offset.left + 40 + i * 40, pageY: offset.top + 40 };
          const item = { series: series, seriesIndex: s, dataIndex: i, datapoint: point ? [point[0], point[1], 0] : [1, 1, 0], pageX: pos.pageX, pageY: pos.pageY };
          try { plot.getPlaceholder().trigger('plothover', [pos, item]); } catch (e) { /* the handler needs more */ }
          check();
          // a pie reports the point as [percent, [[x, y]]]
          const pieItem = Object.assign({}, item, { datapoint: [series.percent || 0, series.data && series.data.length ? series.data : [[0, 1]]] });
          try { plot.getPlaceholder().trigger('plothover', [pos, pieItem]); } catch (e) { /* not a pie handler */ }
          check();
        });
      });
    });
  }, PAGE_SCAN.toString());
  await step('flot hover' + label);
  await page.evaluate(() => {
    const events = ['mouseover', 'mousemove', 'mouseenter', 'click'];
    document.querySelectorAll('kibana-panel svg *, kibana-panel .leaflet-marker-icon, kibana-panel .jvectormap-container path').forEach((el) => {
      events.forEach((type) => { try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 50, clientY: 50 })); } catch (e) { /* ignore */ } });
    });
  });
  await step('mouse over chart marks' + label);
  // the tooltips and the hover tooltips of the charts stay in the page until removed; clear them so that
  // the page does not grow with every round
  await page.evaluate(() => { window.jQuery('.tooltip').remove(); window.jQuery('body > div[style*="absolute"]').filter(function () { return window.jQuery(this).find('.icon-circle').length > 0 && !window.jQuery(this).find('kibana-panel').length; }).remove(); });
}

async function run(chromium, args, style, panels) {
  const server = await startServer(args.dist);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: !args.headed });
  const report = { style: style, steps: 0, leaks: [], failures: [], expectedPanels: 0, notes: [], unstubbed: [], seen: { shownAsText: 0, typeaheadItems: 0, tooltips: 0, canvases: 0, svgMarks: 0, alerts: 0, panels: 0 } };
  const stubs = createStubs(style);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.addInitScript(() => {
      window.__fired = [];
      window.__d3canary = function (n) { window.__fired.push(n); };
    });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('pageerror', () => {});
    const dashboard = hostileDashboard(panels, stubs.H);
    report.expectedPanels = dashboard.rows.length;
    await page.route((u) => /^\/(api|solr)\//.test(u.pathname) || /banana-hostile\.json$/.test(u.pathname) || /api\.github\.com/.test(u.hostname),
      (route) => stubs.route(route, dashboard, report.unstubbed));
    // anything else that leaves the machine is refused (map tiles and the like)
    await page.route((u) => !/^127\.0\.0\.1$/.test(u.hostname) && !/api\.github\.com/.test(u.hostname), (route) => route.abort());

    const step = async (name) => {
      report.steps++;
      if (process.env.HOSTILE_PROGRESS && report.steps % 25 === 0) { console.log('  ... ' + report.steps + ' steps, at: ' + name); }
      await page.waitForTimeout(150);
      const fired = await page.evaluate(() => { const f = window.__fired.slice(); window.__fired.length = 0; return f; });
      const bad = (await page.evaluate(PAGE_SCAN)).concat(await page.evaluate(() => { const e = window.__extra || []; window.__extra = []; return e; }));
      const seen = await page.evaluate(() => ({
        shownAsText: (document.body.textContent.match(/__d3canary\(/g) || []).length,
        typeaheadItems: document.querySelectorAll('.typeahead li').length,
        tooltips: document.querySelectorAll('.tooltip').length,
        canvases: document.querySelectorAll('kibana-panel canvas').length,
        svgMarks: document.querySelectorAll('kibana-panel svg *').length,
        alerts: document.querySelectorAll('.dashboard-notice').length,
        panels: Array.from(document.querySelectorAll('kibana-panel')).filter((e) => !e.classList.contains('ng-cloak')).length
      }));
      Object.keys(seen).forEach((k) => { report.seen[k] = Math.max(report.seen[k], seen[k]); });
      fired.forEach((n) => report.leaks.push({ step: name, kind: 'canary ran', where: sources[n] }));
      Array.from(new Set(bad)).forEach((b) => report.leaks.push({ step: name, kind: 'dom', detail: b, where: (/__d3canary\((\d+)\)/.exec(b) || /\((\d+)\)/.exec(b) || [])[1] !== undefined ? sources[Number((/\((\d+)\)/.exec(b) || [])[1])] : undefined }));
    };

    await page.goto('http://127.0.0.1:' + port + '/index.html#/dashboard/file/banana-hostile.json', { waitUntil: 'load' });
    await page.waitForFunction((n) => document.querySelectorAll('kibana-panel').length >= n &&
      Array.from(document.querySelectorAll('kibana-panel')).filter((e) => !e.classList.contains('ng-cloak')).length >= n, panels.length,
    { timeout: 30000 }).catch(() => report.failures.push('not every panel finished loading'));
    await page.waitForTimeout(2500);
    await step('page loaded');
    if (args.evaluate) {
      console.log('  eval: ' + JSON.stringify(await page.evaluate(args.evaluate)));
    }
    if (args.dump) {
      // a debugging aid: show what the page holds for a selector, to confirm that a panel really drew the payloads
      const html = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).slice(0, 3).map((e) => e.outerHTML.slice(0, 600)), args.dump);
      console.log('  dump of ' + args.dump + ': ' + JSON.stringify(html, null, 1));
    }

    await hoverEverything(page, step, '', true);

    await page.evaluate(() => {
      const $ = window.jQuery;
      $('kibana-panel tr.pointer').each(function () { $(this).click(); });
      ['Table', 'JSON', 'Raw'].forEach(function (view) {
        $('kibana-panel a.link').filter(function () { return $(this).text().trim() === view; }).each(function () { $(this).click(); });
      });
    });
    await step('table rows opened, every view');
    await page.evaluate(() => {
      const $ = window.jQuery;
      $('kibana-panel .icon-arrow-right, kibana-panel .icon-chevron-sign-down, kibana-panel .icon-arrow-left').each(function () { $(this).click(); });
    });
    await step('document viewer and full text rows paged');

    // each panel's editor: open it, look at every tab, type into every typeahead
    const count = await page.evaluate(() => document.querySelectorAll('kibana-panel').length);
    for (let i = 0; i < count; i++) {
      const type = await page.evaluate((i) => {
        const el = document.querySelectorAll('kibana-panel')[i];
        const scope = window.angular.element(el).scope();
        const link = el.parentElement.querySelector('a[title="Configure"]');
        if (link) { link.click(); }
        return scope.panel.type;
      }, i);
      await page.waitForTimeout(400);
      await step('editor of ' + type + ' opened');
      await page.evaluate(() => {
        window.jQuery('.modal.in .nav-tabs a, .modal .nav-tabs a').each(function () { window.jQuery(this).click(); });
      });
      await step('every tab of the editor of ' + type);
      // Bootstrap's highlighter wraps what was typed in <strong>, which can cut a tag in two: a query that
      // matches the middle of a payload hides it. So each query is tried alone, and the menu is checked after
      // each: `x="` matches only the end of a markup payload, `//` only the end of a url payload.
      for (const prefix of ['x="', '//', '<', ' ', 'id']) {
        await page.evaluate((prefix) => {
          const $ = window.jQuery;
          $('input[data-provide="typeahead"]').each(function () {
            const typeahead = $(this).data('typeahead');
            if (!typeahead) { return; }
            $(this).val(prefix);
            try { typeahead.lookup(); } catch (e) { /* the source is not ready */ }
          });
        }, prefix);
        await step('typeaheads in the editor of ' + type + ' with "' + prefix + '"');
      }
      await page.evaluate(() => {
        const $ = window.jQuery;
        $('.typeahead.dropdown-menu').hide();
        $('.modal').modal('hide');
        $('.modal-backdrop').remove();
      });
    }

    // the other dialogs: dashboard settings, row editor, new dashboard
    const dialogs = await page.evaluate(() => window.jQuery('[bs-modal]').filter(function () { return !window.jQuery(this).closest('kibana-panel').length; }).length);
    for (let i = 0; i < dialogs; i++) {
      const template = await page.evaluate((i) => {
        const el = window.jQuery('[bs-modal]').filter(function () { return !window.jQuery(this).closest('kibana-panel').length; })[i];
        window.jQuery(el).click();
        return el.getAttribute('bs-modal');
      }, i);
      await page.waitForTimeout(400);
      await step('dialog ' + template + ' opened');
      for (const prefix of ['x="', '//', '<', ' ', 'id']) {
        await page.evaluate((prefix) => {
          const $ = window.jQuery;
          $('input[data-provide="typeahead"]').each(function () {
            const typeahead = $(this).data('typeahead');
            if (!typeahead) { return; }
            $(this).val(prefix);
            try { typeahead.lookup(); } catch (e) { /* the source is not ready */ }
          });
        }, prefix);
        await step('typeaheads in dialog ' + template + ' with "' + prefix + '"');
      }
      await page.evaluate(() => {
        window.jQuery('.typeahead.dropdown-menu').hide();
        window.jQuery('.modal').modal('hide');
        window.jQuery('.modal-backdrop').remove();
      });
    }

    if (args.settings) {
      // every string setting of every panel, one at a time
      const keys = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('kibana-panel').forEach((el, index) => {
          const panel = window.angular.element(el).scope().panel;
          const walk = function (obj, prefix, depth) {
            Object.keys(obj).forEach(function (key) {
              const value = obj[key];
              if (prefix === '' && (key === 'type' || key === 'span' || key === 'error')) { return; }
              if (typeof value === 'string') { out.push([index, prefix + key]); }
              else if (Array.isArray(value) && value.length && typeof value[0] === 'string') { out.push([index, prefix + key]); }
              else if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) { walk(value, prefix + key + '.', depth + 1); }
            });
          };
          walk(panel, '', 0);
        });
        return out;
      });
      report.notes.push('settings tried: ' + keys.length);
      for (const pair of keys) {
        const where = await page.evaluate(([index, key, payload]) => {
          const el = document.querySelectorAll('kibana-panel')[index];
          const scope = window.angular.element(el).scope();
          const parts = key.split('.');
          let holder = scope.panel;
          for (let i = 0; i < parts.length - 1; i++) { holder = holder[parts[i]]; }
          const last = parts[parts.length - 1];
          window.__restore = function () {
            holder[last] = window.__saved;
            scope.$apply();
            window.angular.element(document.body).injector().get('dashboard').refresh();
          };
          window.__saved = holder[last];
          holder[last] = Array.isArray(holder[last]) ? [payload] : payload;
          scope.$apply();
          window.angular.element(document.body).injector().get('dashboard').refresh();
          return scope.panel.type + '.' + key;
        }, [pair[0], pair[1], stubs.H('setting of panel ' + pair[0] + ': ' + pair[1])]);
        await page.waitForTimeout(250);
        await step('setting ' + where);
        await page.evaluate(() => window.__restore());
        await page.waitForTimeout(100);
      }
    }

    // the dashboard menu: saving, loading, deleting and sharing raise alerts that quote titles and ids.
    // Saving loads the saved dashboard afterwards, so this comes last.
    await page.evaluate(() => {
      const $ = window.jQuery;
      const scope = window.angular.element(document.querySelector('[ng-controller="dashLoader"]')).scope();
      const alerts = window.angular.element(document.body).injector().get('alertSrv');
      const dash = window.angular.element(document.body).injector().get('dashboard');
      window.__alertSteps = [];
      const say = function (name) { window.__alertSteps.push(name); };
      try { scope.$apply(function () { scope.set_default(); }); say('set default'); } catch (e) { /* ignore */ }
      try { scope.$apply(function () { scope.elasticsearch.title = dash.current.title; scope.elasticsearch_save('dashboard'); }); say('save'); } catch (e) { /* ignore */ }
      try { scope.$apply(function () { scope.elasticsearch_dblist(''); }); say('list'); } catch (e) { /* ignore */ }
      try { scope.$apply(function () { scope.gist = { title: 'g' }; scope.save_gist(); }); say('gist'); } catch (e) { /* ignore */ }
      window.__alerts = alerts;
      void $;
    });
    await page.waitForTimeout(1200);
    await step('dashboard menu: set default, save, list, share');
    await page.evaluate(() => {
      const scope = window.angular.element(document.querySelector('[ng-controller="dashLoader"]')).scope();
      const list = scope.elasticsearch.dashboards || [];
      if (list[0]) { scope.$apply(function () { scope.elasticsearch_delete(list[0].id || list[0].name); }); }
    });
    await page.waitForTimeout(800);
    await step('dashboard menu: delete');

    if (args.settings) {
      // the strings of the query and filter lists (a query's colour and alias, a filter's value), one at a time:
      // these live under `services`, not in a panel, and every panel's tooltip and legend reads them
      const serviceKeys = await page.evaluate(() => {
        const injector = window.angular.element(document.body).injector();
        const out = [];
        [['query', injector.get('querySrv')], ['filter', injector.get('filterSrv')]].forEach(function (pair) {
          Object.keys(pair[1].list).slice(0, 2).forEach(function (id) {
            Object.keys(pair[1].list[id]).forEach(function (key) {
              if (typeof pair[1].list[id][key] === 'string') { out.push([pair[0], id, key]); }
            });
          });
        });
        return out;
      });
      report.notes.push('service settings tried: ' + serviceKeys.length);
      for (const [kind, id, key] of serviceKeys) {
        await page.evaluate(([kind, id, key, payload]) => {
          const injector = window.angular.element(document.body).injector();
          const list = injector.get(kind === 'query' ? 'querySrv' : 'filterSrv').list;
          window.__saved = list[id][key];
          list[id][key] = payload;
          window.__restore = function () {
            list[id][key] = window.__saved;
            window.angular.element(document.body).scope().$apply();
            injector.get('dashboard').refresh();
          };
          window.angular.element(document.body).scope().$apply();
          injector.get('dashboard').refresh();
        }, [kind, id, key, stubs.H('service ' + kind + ' ' + id + ': ' + key)]);
        await page.waitForTimeout(450);
        await step('service ' + kind + ' ' + id + ' ' + key);
        await hoverEverything(page, step, ' after setting ' + kind + ' ' + key, false);
        await page.evaluate(() => window.__restore());
        await page.waitForTimeout(150);
      }
    }
    await page.waitForTimeout(500);
    await step('end');
  } finally {
    await browser.close();
    server.close();
  }
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distDir = path.resolve(args.dist);
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('hostile: ' + args.dist + '/index.html does not exist. Run `npm run build` first.');
    process.exit(1);
  }
  const panels = panelNamesFromConfig(fs.readFileSync(path.join(distDir, 'config.js'), 'utf8'));
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) {
    console.error('hostile: Playwright is not installed. Run `npm ci`, then `npx playwright install chromium`.');
    process.exit(1);
  }
  let failed = false;
  for (const style of args.styles) {
    const report = await run(chromium, args, style, panels);
    // a run in which nothing rendered proves nothing
    const floors = { panels: report.expectedPanels, shownAsText: 1, typeaheadItems: 1, tooltips: 1, canvases: 1, svgMarks: 1, alerts: 1 };
    Object.keys(floors).forEach((k) => { if (report.seen[k] < floors[k]) { report.failures.push('only ' + report.seen[k] + ' ' + k + ' seen, expected at least ' + floors[k]); } });
    report.failures.forEach((f) => console.log('  FAILURE: ' + f));
    const unique = {};
    report.leaks.forEach((l) => { const key = (l.where || l.detail || '?') + ' | ' + l.kind; if (!unique[key]) { unique[key] = l; l.first = l.step; } });
    const keys = Object.keys(unique);
    console.log((keys.length || report.failures.length ? 'FAIL ' : 'PASS ') + style + ' payloads: ' + report.steps + ' steps, ' + keys.length + ' leaks');
    console.log('  most seen at once: ' + JSON.stringify(report.seen));
    report.notes.forEach((n) => console.log('  note: ' + n));
    if (process.env.HOSTILE_DEBUG) { report.unstubbed.slice(0, 20).forEach((u) => console.log('  unstubbed: ' + u)); }
    keys.slice(0, 80).forEach((k) => console.log('  leak: ' + k + '  (first at: ' + unique[k].first + ')'));
    if (keys.length || report.failures.length) { failed = true; }
  }
  console.log(failed ? 'hostile: FAILED' : 'hostile: nothing leaked');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
