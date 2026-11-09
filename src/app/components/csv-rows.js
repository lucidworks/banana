/**
 * Parses CSV text into objects keyed by the header row, like d3.csv.parse of the bundled d3 3.x.
 *
 * d3.csv.parse builds one function from the header with `new Function`, which a Content-Security-Policy
 * without 'unsafe-eval' refuses. This reads the same rows with d3.csv.parseRows and builds the objects
 * directly. As in d3, the optional `convert(row, index)` maps each row object, and a row for which it
 * returns null or undefined is left out.
 */
define(['d3'], function (d3) {
  'use strict';

  return {
    parse: function (text, convert) {
      var header;
      return d3.csv.parseRows(text, function (cells, n) {
        if (!header) {
          header = cells;
          return;
        }
        var row = {};
        for (var i = 0; i < header.length; i++) {
          row[header[i]] = cells[i];
        }
        return convert ? convert(row, n - 1) : row;
      });
    }
  };
});
