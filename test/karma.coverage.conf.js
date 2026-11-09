'use strict';

/*
 * The unit tests with a coverage report for the services (src/app/services).
 *
 *   npm run test:coverage
 *
 * It runs the same specs as `npm test`, with the services instrumented by babel-plugin-istanbul (see
 * test/webpack.test.config.js), and writes the report to coverage/ (an lcov report, an HTML report and a
 * JSON summary), and a table with one row per file to the console. It does not enforce a threshold.
 */

process.env.COVERAGE = '1';

const baseConfig = require('./karma.conf.js');

module.exports = function (config) {
  baseConfig(config);
  config.set({
    plugins: config.plugins.concat([require('karma-coverage')]),
    reporters: ['dots', 'coverage'],
    coverageReporter: {
      dir: 'coverage',
      reporters: [
        { type: 'text' },
        { type: 'json-summary', subdir: '.', file: 'coverage-summary.json' },
        { type: 'lcovonly', subdir: '.' },
        { type: 'html', subdir: 'html' }
      ]
    }
  });
};
