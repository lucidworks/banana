'use strict';

// The map files that tools/maps/build-maps.js generates must stay interchangeable with the ones of release 1.6.30:
// same map name, same region codes and names (so that saved dashboards shade the same regions), and every region
// a real SVG path. The fixture lists the codes of release 1.6.30; the geometry is allowed to differ.
// Run with: npm run test:node

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const lib = path.join(root, 'src', 'app', 'panels', 'map', 'lib');
const old = require('./fixtures/map-regions-1.6.30.json');

// Runs a map file with a stand-in for jQuery and returns what it passed to addMap.
function loadMap(file) {
  const calls = [];
  const sandbox = { $: { fn: { vectorMap: function () { calls.push(Array.prototype.slice.call(arguments)); } } } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return calls;
}

['japan', 'world-antarctica'].forEach(function (name) {
  const file = path.join(lib, 'map.' + name + '.js');

  test('map ' + name + ': one addMap call with the name of release 1.6.30', function () {
    const calls = loadMap(file);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'addMap');
    assert.strictEqual(calls[0][1], old[name].mapName);
  });

  test('map ' + name + ': the region codes are exactly those of release 1.6.30', function () {
    const paths = loadMap(file)[0][2].paths;
    assert.deepStrictEqual(Object.keys(paths).sort(), Object.keys(old[name].regions).sort());
  });

  test('map ' + name + ': the region names are those of release 1.6.30', function () {
    const paths = loadMap(file)[0][2].paths;
    Object.keys(old[name].regions).forEach(function (code) {
      assert.strictEqual(paths[code].name, old[name].regions[code], 'name of region ' + code);
    });
  });

  test('map ' + name + ': every region is a non-empty SVG path inside the map', function () {
    const map = loadMap(file)[0][2];
    assert.ok(map.width > 0 && map.height > 0);
    assert.ok(map.projection && map.projection.type && typeof map.projection.centralMeridian === 'number');
    assert.strictEqual(map.insets.length, 1);
    Object.keys(map.paths).forEach(function (code) {
      const d = map.paths[code].path;
      assert.match(d, /^M-?[\d.]+,-?[\d.]+(l-?[\d.]+,-?[\d.]+)*Z(M-?[\d.]+,-?[\d.]+(l-?[\d.]+,-?[\d.]+)*Z)*$/, 'path of region ' + code);
      // walk the relative moves: every point has to lie inside the map (a little slack for rounding)
      d.split('M').filter(Boolean).forEach(function (ring) {
        const steps = ring.replace('Z', '').split('l').map(function (p) { return p.split(',').map(Number); });
        let x = 0; let y = 0;
        steps.forEach(function (s, i) {
          x = i === 0 ? s[0] : x + s[0];
          y = i === 0 ? s[1] : y + s[1];
          assert.ok(x >= -0.5 && x <= map.width + 0.5 && y >= -0.5 && y <= map.height + 0.5, 'region ' + code + ' has a point outside the map: ' + x + ',' + y);
        });
        assert.ok(steps.length >= 3, 'region ' + code + ' has a ring with fewer than three points');
      });
    });
  });

  test('map ' + name + ': the file names its source', function () {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text.split('\n')[0], /^\/\*! .*Natural Earth v\d+\.\d+\.\d+.*public domain/);
  });
});
