'use strict';

// Used by the image build. Evaluates settings.js and config.js the way the browser does (with a stub
// loader) and writes the setting names with their defaults and the Fusion preset as JSON, so the
// container start-up reads the same lists the application does and cannot drift from them.
//
// Usage: node docker/extract-settings.js <output file>

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadAmd(rel, resolve) {
  let result;
  const sandbox = {
    window: { location: { hostname: 'localhost' } },
    define: function (deps, factory) {
      if (typeof deps === 'function') {
        factory = deps;
        deps = [];
      }
      result = factory.apply(null, deps.map(resolve));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  return result;
}

// settings.js only uses each() from underscore.
const underscore = {
  each: function (obj, fn) {
    Object.keys(obj).forEach(function (key) {
      fn(obj[key], key);
    });
  }
};

const Settings = loadAmd('src/app/components/settings.js', function () {
  return underscore;
});
const fusion = loadAmd('src/config.js', function () {
  return Settings;
});

const out = {
  defaults: JSON.parse(JSON.stringify(Settings({}))),
  presets: { fusion: JSON.parse(JSON.stringify(fusion)) }
};
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
