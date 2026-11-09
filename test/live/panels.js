'use strict';

// Helpers for the live smoke test: which panel types the fixture dashboard
// covers, how to read what each panel put on the page, and what each panel
// type must show when it has rendered the data of the test collection. The
// functions that judge a summary are pure, so unit tests can run them without
// a browser.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'banana-it-dashboard.json');

// The panel types the build offers, read from the shipped configuration.
function configuredPanelTypes() {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
  const match = /panel_names\s*:\s*\[([^\]]*)\]/.exec(text);
  if (!match) {
    throw new Error('panel_names not found in src/config.js');
  }
  return match[1].split(',').map(function (s) { return s.replace(/['"\s]/g, ''); }).filter(Boolean);
}

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

// Every panel type used by a dashboard, including panels inside a column.
function dashboardPanelTypes(dashboard) {
  const found = [];
  function walk(panels) {
    (panels || []).forEach(function (panel) {
      found.push(panel.type);
      if (panel.panels) {
        walk(panel.panels);
      }
    });
  }
  (dashboard.rows || []).forEach(function (row) { walk(row.panels); });
  return found;
}

// Runs in the page. For every panel it reports what the panel put on the page,
// plus the error banners that are showing.
function summarisePage(types) {
  const out = { panels: {}, banners: [] };
  types.forEach(function (type) {
    const el = document.querySelector('[ng-controller="' + type + '"]');
    if (!el) {
      return;
    }
    // what only data can produce: the colours of the map regions, the numbers on
    // the time series axes, and the nodes the graph panel was given
    const fills = {};
    el.querySelectorAll('path').forEach(function (path) {
      const fill = path.getAttribute('fill');
      fills[fill] = (fills[fill] || 0) + 1;
    });
    const ticks = [];
    el.querySelectorAll('.flot-tick-label').forEach(function (label) {
      if (/^-?\d+(\.\d+)?$/.test(label.textContent.trim())) {
        ticks.push(parseFloat(label.textContent));
      }
    });
    let graphNodes = 0;
    try {
      const nodes = window.angular.element(el).scope().graphML.graphml.graph.node;
      graphNodes = nodes ? (Array.isArray(nodes) ? nodes.length : 1) : 0;
    } catch (e) {
      graphNodes = 0;
    }
    out.panels[type] = {
      fills: fills,
      ticks: ticks,
      graphNodes: graphNodes,
      text: el.innerText.replace(/\s+/g, ' '),
      svg: el.querySelectorAll('svg').length,
      svgText: el.querySelectorAll('svg text').length,
      canvas: el.querySelectorAll('canvas').length,
      rows: el.querySelectorAll('tr').length,
      paths: el.querySelectorAll('path').length,
      leaflet: el.querySelectorAll('.leaflet-container').length
    };
  });
  document.querySelectorAll('.panel-error, .alert-error').forEach(function (e) {
    if (e.offsetParent !== null && e.textContent.trim()) {
      out.banners.push(e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
    }
  });
  return out;
}

// What each panel type must show once it has rendered the 240 documents of the
// test collection. Each rule returns a short reason when the panel is wrong.
// The number of regions whose fill differs from the most common one: the map
// panel paints every region the same neutral colour until it has values.
function coloured(fills) {
  const counts = Object.keys(fills || {}).map(function (k) { return fills[k]; }).sort(function (a, b) { return b - a; });
  return counts.slice(1).reduce(function (a, b) { return a + b; }, 0);
}

const RULES = {
  column: function (p) { return p.text.indexOf('TIMEPICKER') >= 0 ? null : 'does not hold its panels'; },
  timepicker: function (p) { return p.text.indexOf('Absolute') >= 0 ? null : 'no mode links'; },
  query: function (p) { return p.text.length > 0 ? null : 'empty'; },
  filtering: function (p) { return p.text.indexOf('timestamp_tdt') >= 0 ? null : 'does not list the time filter'; },
  text: function (p) { return p.text.indexOf('Fixture dashboard') >= 0 ? null : 'markdown not shown'; },
  hits: function (p) { return /\d+\.\d+ mean response/.test(p.text) ? null : 'no mean value'; },
  ticker: function (p) { return /(^|\s)-?\d+(\.\d+)?%/.test(p.text) ? null : 'no numeric percentage'; },
  histogram: function (p) { return p.canvas >= 2 && p.text.indexOf('(240)') >= 0 ? null : 'no chart of 240 hits'; },
  rangeFacet: function (p) { return p.canvas >= 2 && p.text.indexOf('(240)') >= 0 ? null : 'no chart of 240 hits'; },
  timeseries: function (p) { return p.canvas >= 2 && Math.max.apply(null, [0].concat(p.ticks)) >= 100 ? null : 'no series values on the axis'; },
  bar: function (p) { return p.svg >= 1 && p.text.indexOf('INFO') >= 0 ? null : 'no bars for level_s'; },
  terms: function (p) { return p.canvas >= 2 && p.text.indexOf('gateway (60)') >= 0 ? null : 'no terms for service_s'; },
  tagcloud: function (p) { return p.svgText >= 4 ? null : 'fewer than 4 words'; },
  map: function (p) { return p.paths >= 100 && coloured(p.fills) >= 8 ? null : 'fewer than 8 regions coloured by data'; },
  bettermap: function (p) { return p.leaflet >= 1 && /\b30\b/.test(p.text) ? null : 'no clusters'; },
  heatmap: function (p) { return p.svg >= 1 && p.text.indexOf('gateway') >= 0 ? null : 'no heatmap'; },
  scatterplot: function (p) { return p.svg >= 1 && p.text.indexOf('DEBUG') >= 0 ? null : 'no plot'; },
  table: function (p) { return p.rows >= 11 ? null : 'fewer than 10 rows'; },
  fullTextSearch: function (p) { return p.rows >= 10 ? null : 'fewer than 10 rows'; },
  facet: function (p) { return p.text.indexOf('INFO (120)') >= 0 ? null : 'no facet counts'; },
  docviewer: function (p) { return p.text.indexOf('of 20 available') >= 0 && p.text.indexOf('Content') >= 0 ? null : 'no document'; },
  multiseries: function (p) { return p.paths >= 2 ? null : 'no lines'; },
  sunburst: function (p) { return p.paths >= 10 ? null : 'no rings'; },
  sankey: function (p) { return p.paths >= 5 && p.text.indexOf('INFO') >= 0 ? null : 'no flows'; },
  force: function (p) { return p.svg >= 1 && p.text.indexOf('INFO') >= 0 ? null : 'no graph'; },
  boxplot: function (p) { return p.svg >= 1 && p.svgText >= 2 ? null : 'no boxes'; },
  significantTerms: function (p) { return p.rows >= 5 ? null : 'no terms'; },
  graph: function (p) { return p.canvas >= 1 && p.graphNodes > 0 ? null : 'no nodes'; }
};

// The problems in a page summary: a panel that is missing, one that shows too
// little, and every error banner. An empty list means every panel rendered.
function problems(summary, types) {
  const list = [];
  types.forEach(function (type) {
    const panel = summary.panels[type];
    if (!panel) {
      list.push(type + ': not on the page');
      return;
    }
    const rule = RULES[type];
    if (!rule) {
      list.push(type + ': no rule for this panel type');
      return;
    }
    const reason = rule(panel);
    if (reason) {
      list.push(type + ': ' + reason);
    }
  });
  summary.banners.forEach(function (b) { list.push('error banner: ' + b); });
  return list;
}

module.exports = {
  FIXTURE: FIXTURE,
  RULES: RULES,
  configuredPanelTypes: configuredPanelTypes,
  readFixture: readFixture,
  dashboardPanelTypes: dashboardPanelTypes,
  summarisePage: summarisePage,
  problems: problems
};
