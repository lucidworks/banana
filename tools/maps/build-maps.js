#!/usr/bin/env node
'use strict';

/*
 * Generates the two jVectorMap data files of the map panel that are not taken from Kibana 3:
 *
 *   src/app/panels/map/lib/map.japan.js             the 47 prefectures of Japan (map name "japan")
 *   src/app/panels/map/lib/map.world-antarctica.js  the world with Antarctica (map name "world-antarctica")
 *
 * The data comes from Natural Earth (https://www.naturalearthdata.com), which is in the public domain. The script
 * downloads the pinned release below, checks the SHA-256 of every file, projects the geometry with the same formulas
 * as jVectorMap (so that latitude/longitude markers land where they should), simplifies it with mapshaper, and writes
 * paths in the format `$.fn.vectorMap('addMap', name, { insets, paths, height, projection, width })`.
 *
 * The region codes and the region names are the ones of the files that Banana 1.6.30 shipped, so that saved dashboards
 * keep shading the same regions: tools/maps/region-names.json lists them, and the script stops when the Natural Earth
 * data does not produce exactly that set of codes.
 *
 * Usage: node tools/maps/build-maps.js [--out src/app/panels/map/lib] [--cache DIR] [--only japan|world-antarctica]
 *   --cache DIR   keep the downloads in DIR and reuse files that are already there (their checksums are still verified);
 *                 without it the files go to a temporary directory that is removed afterwards.
 *
 * mapshaper does the simplification. It is not a dependency of the application: tools/maps has its own package.json and
 * lockfile, and it is installed only when the maps are regenerated:
 *
 *     npm ci --prefix tools/maps
 *     node tools/maps/build-maps.js
 *
 * Re-running the script with the same versions gives the same files. Only the Japan map is simplified; the world map is
 * Natural Earth's 110 m data as it is (joined and rounded to 0.01 pixel, nothing more).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEASE = 'v5.1.2';
const BASE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/' + RELEASE + '/geojson/';
const SOURCES = {
  countries: {
    file: 'ne_110m_admin_0_countries.geojson',
    sha256: '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f'
  },
  provinces: {
    file: 'ne_10m_admin_1_states_provinces.geojson',
    sha256: '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5'
  }
};

const R = 6381372; // the earth radius that jVectorMap uses
const RAD = Math.PI / 180;
const WIDTH = 900;

// The projections are the ones of jVectorMap (jquery.jvectormap.min.js, jvm.Proj); y is already turned downwards.
const PROJECTIONS = {
  mill: (lat, lng, cm) => ({ x: R * (lng - cm) * RAD, y: -R * Math.log(Math.tan((45 + 0.4 * lat) * RAD)) / 0.8 }),
  aea: (lat, lng, cm) => {
    const s = 29.5 * RAD;
    const o = 45.5 * RAD;
    const f = (Math.sin(s) + Math.sin(o)) / 2;
    const l = Math.cos(s) * Math.cos(s) + 2 * f * Math.sin(s);
    const c = f * (lng * RAD - cm * RAD);
    const h = Math.sqrt(l - 2 * f * Math.sin(lat * RAD)) / f;
    const p = Math.sqrt(l) / f;
    return { x: h * Math.sin(c) * R, y: -(p - h * Math.cos(c)) * R };
  }
};

// Each map: where its regions come from, how they are coded, and how it is drawn.
const MAPS = {
  'japan': {
    projection: { type: 'aea', centralMeridian: 135 },
    source: 'provinces',
    // Prefecture code: the two digits of the ISO 3166-2:JP code (JP-13 is Tokyo).
    regions(features) {
      return features.filter((f) => f.properties.iso_a2 === 'JP')
        .map((f) => ({ code: f.properties.iso_3166_2.replace(/^JP-/, ''), geometry: f.geometry }));
    },
    // The remote islands (Minami-Torishima and others) would shrink the rest of the map to a corner.
    window: { lngMin: 122, lngMax: 150, latMin: 24, latMax: 46 },
    simplify: '20%',
    minArea: 0.4
  },
  'world-antarctica': {
    projection: { type: 'mill', centralMeridian: 11.5 },
    source: 'countries',
    // Country code: ISO 3166-1 alpha-2; the four places that have none are coded _0 to _3, as in the 1.6.30 file.
    regions(features) {
      const special = { CYN: '_0', KOS: '_1', SAH: '_2', SOL: '_3' };
      return features.map((f) => {
        const p = f.properties;
        const code = special[p.ADM0_A3] || (p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2);
        return { code, geometry: f.geometry };
      });
    },
    simplify: '100%',
    // Antarctica is cut at the edge of the map, and the two pieces meet again at 180 degrees: join them.
    joinPieces: true,
    minArea: 0
  }
};

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

async function fetchSource(key, dir) {
  const src = SOURCES[key];
  const target = path.join(dir, src.file);
  if (!fs.existsSync(target)) {
    const res = await fetch(BASE_URL + src.file);
    if (!res.ok) { throw new Error('download of ' + BASE_URL + src.file + ' failed: HTTP ' + res.status); }
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  }
  const data = fs.readFileSync(target);
  if (sha256(data) !== src.sha256) {
    throw new Error(src.file + ' does not match the pinned checksum ' + src.sha256 + ' (Natural Earth ' + RELEASE + ')');
  }
  return JSON.parse(data.toString('utf8'));
}

// ---- geometry helpers (rings are arrays of [lng, lat]) ----

function polygonsOf(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

// Sutherland-Hodgman clip of one ring against lng >= seam (keep 'east') or lng <= seam (keep 'west').
function clipRing(ring, seam, keep) {
  const inside = (p) => (keep === 'east' ? p[0] >= seam : p[0] <= seam);
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) { out.push(a); }
    if (ia !== ib) {
      const t = (seam - a[0]) / (b[0] - a[0]);
      out.push([seam, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length) { out.push(out[0]); }
  return out;
}

// The world map is centred on a meridian, so the edge of the map is the opposite meridian: the shapes that lie
// beyond it come in again on the other side, and a ring that crosses it (Antarctica) is cut in two.
function wrapPolygons(polygons, centralMeridian) {
  const seam = centralMeridian - 180;
  const result = [];
  polygons.forEach((rings) => {
    const outer = rings[0];
    const west = outer.some((p) => p[0] < seam);
    const east = outer.some((p) => p[0] >= seam);
    if (!west) { result.push(rings); return; }
    const shift = (ring) => ring.map((p) => [p[0] + 360, p[1]]);
    if (!east) { result.push(rings.map(shift)); return; }
    if (rings.length > 1) { throw new Error('a polygon with holes crosses the edge of the map; this script does not cut those'); }
    result.push([clipRing(outer, seam, 'east')]);
    result.push([shift(clipRing(outer, seam, 'west'))]);
  });
  return result;
}

function inWindow(rings, w) {
  return rings[0].every((p) => p[0] >= w.lngMin && p[0] <= w.lngMax && p[1] >= w.latMin && p[1] <= w.latMax);
}

// ---- output ----

const num = (v) => +v.toFixed(2);

// "M x,y l dx,dy ... Z" with the differences taken between the rounded points, so that rounding does not drift.
function ringPath(ring, toPixel) {
  const pts = [];
  ring.forEach((p) => {
    const q = toPixel(p);
    const r = [num(q[0]), num(q[1])];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== r[0] || last[1] !== r[1]) { pts.push(r); }
  });
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) { pts.pop(); }
  if (pts.length < 3) { return ''; }
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    d += 'l' + num(pts[i][0] - pts[i - 1][0]) + ',' + num(pts[i][1] - pts[i - 1][1]);
  }
  return d + 'Z';
}

async function build(name, cfg, sources, mapshaper) {
  const regions = cfg.regions(sources[cfg.source].features);
  const wanted = require('./region-names.json')[name];
  const codes = regions.map((r) => r.code);
  const missing = Object.keys(wanted).filter((c) => codes.indexOf(c) === -1);
  const extra = codes.filter((c) => !(c in wanted));
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (missing.length || extra.length || dupes.length) {
    throw new Error(name + ': region codes differ from region-names.json; missing [' + missing + '], unexpected [' + extra + '], duplicated [' + dupes + ']');
  }

  // project every polygon
  const project = PROJECTIONS[cfg.projection.type];
  const cm = cfg.projection.centralMeridian;
  const features = regions.map((r) => {
    let polys = polygonsOf(r.geometry);
    if (cfg.projection.type === 'mill') { polys = wrapPolygons(polys, cm); }
    if (cfg.window) { polys = polys.filter((rings) => inWindow(rings, cfg.window)); }
    const coordinates = polys.map((rings) => rings.map((ring) => ring.map((p) => {
      const q = project(p[1], p[0], cm);
      return [q.x, q.y];
    })));
    return { type: 'Feature', properties: { code: r.code }, geometry: { type: 'MultiPolygon', coordinates } };
  });

  // the extent of the unsimplified data fixes the scale, so that the same data always gives the same picture
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  features.forEach((f) => f.geometry.coordinates.forEach((rings) => rings.forEach((ring) => ring.forEach((p) => {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }))));
  const scale = WIDTH / (maxX - minX);
  const height = (maxY - minY) * scale;
  const toPixel = (p) => [(p[0] - minX) * scale, (p[1] - minY) * scale];

  // simplify (topology-aware, so that neighbouring regions keep sharing their borders)
  let commands = '-i in.json';
  if (cfg.simplify !== '100%') { commands += ' -simplify visvalingam percentage=' + cfg.simplify + ' keep-shapes'; }
  if (cfg.joinPieces) { commands += ' -dissolve2 code'; }
  if (cfg.minArea) { commands += ' -filter-islands min-area=' + Math.round(cfg.minArea / (scale * scale)) + ' remove-empty'; }
  commands += ' -o out.json format=geojson';
  const done = await mapshaper.applyCommands(commands, { 'in.json': JSON.stringify({ type: 'FeatureCollection', features }) });
  const simplified = JSON.parse(done['out.json'].toString());

  const paths = {};
  simplified.features.forEach((f) => {
    const polys = f.geometry ? polygonsOf(f.geometry) : [];
    const d = polys.map((rings) => rings.map((ring) => ringPath(ring, toPixel)).join('')).join('');
    if (!d) { throw new Error(name + ': region ' + f.properties.code + ' has no geometry after simplification'); }
    paths[f.properties.code] = { path: d, name: wanted[f.properties.code] };
  });
  // simplification and island removal must not lose a region
  const lost = Object.keys(wanted).filter((c) => !paths[c]);
  if (lost.length) { throw new Error(name + ': regions dropped by simplification: [' + lost + ']'); }
  const ordered = {};
  Object.keys(wanted).sort().forEach((c) => { ordered[c] = paths[c]; });

  const bbox = [{ y: minY, x: minX }, { y: maxY, x: maxX }];
  const data = {
    insets: [{ width: WIDTH, top: 0, height, bbox, left: 0 }],
    paths: ordered,
    height,
    projection: cfg.projection,
    width: WIDTH
  };
  const header = '/*! Map data for ' + (name === 'japan' ? 'Japan' : 'the world with Antarctica') + ': generated by tools/maps/build-maps.js from Natural Earth ' +
    RELEASE + ' (' + SOURCES[cfg.source].file + '), which is in the public domain. https://www.naturalearthdata.com */\n';
  return header + "$.fn.vectorMap('addMap', '" + name + "'," + JSON.stringify(data) + ');\n';
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { out: path.resolve(__dirname, '..', '..', 'src', 'app', 'panels', 'map', 'lib'), cache: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { opts.out = path.resolve(argv[++i]); }
    else if (argv[i] === '--cache') { opts.cache = path.resolve(argv[++i]); }
    else if (argv[i] === '--only') { opts.only = argv[++i]; }
    else { console.error('unknown argument ' + argv[i]); process.exit(2); }
  }
  if (opts.only && !MAPS[opts.only]) { console.error('unknown map ' + opts.only + ' (japan or world-antarctica)'); process.exit(2); }
  let mapshaper;
  try { mapshaper = require('mapshaper'); } catch (e) {
    console.error('build-maps: mapshaper is not installed. Run `npm ci --prefix tools/maps` first.');
    process.exit(1);
  }
  const dir = opts.cache || fs.mkdtempSync(path.join(os.tmpdir(), 'banana-maps-'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const names = Object.keys(MAPS).filter((n) => !opts.only || n === opts.only);
    const sources = {};
    for (const key of Array.from(new Set(names.map((n) => MAPS[n].source)))) { sources[key] = await fetchSource(key, dir); }
    for (const name of names) {
      const text = await build(name, MAPS[name], sources, mapshaper);
      const file = path.join(opts.out, 'map.' + name + '.js');
      fs.writeFileSync(file, text);
      console.log('build-maps: wrote ' + file + ' (' + text.length + ' bytes)');
    }
  } finally {
    if (!opts.cache) { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

if (require.main === module) { main().catch((e) => { console.error('build-maps: ' + (e && e.message || e)); process.exit(1); }); }

module.exports = { PROJECTIONS, RELEASE, SOURCES };
