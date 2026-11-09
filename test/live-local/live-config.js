'use strict';

// The live configuration of the client module, pointed at the local specs. The
// artefact settings, the output directory and the environment variable it sets
// are the ones a live run uses; only the directory of specs and the reporter
// differ.

const path = require('node:path');
const live = require('../live/fusion-client/playwright.config.js');

module.exports = Object.assign({}, live, {
  testDir: path.join(__dirname, 'specs'),
  reporter: [['json']]
});
