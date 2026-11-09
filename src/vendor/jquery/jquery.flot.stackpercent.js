/*!
 * Flot plugin for percent stacking, written for Banana.
 *
 * Copyright 2013-2026 Lucidworks, Inc. and Banana contributors
 * Licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE in this distribution).
 *
 * It does the job of the plugin that earlier Banana releases carried under the same name, with the same option and
 * the same results: series that set the option `stackpercent` are stacked, and every column is scaled so that
 * the series of that column add up to 100.
 *
 *     series: { stackpercent: true }                  // all series, or
 *     $.plot(el, [{ data: [...], stackpercent: true }, ...])
 *
 * The stacking order is the order of the series. A column is the set of points that share an x value (or a y value
 * for horizontal bars). A point whose column adds up to zero (or to less) is drawn at 0. The plugin also sets
 * `series.percents` on every percent-stacked series: the share of each of its points in its column, in percent.
 *
 * Panels that only pass the option (rangeFacet) rely on this file having been loaded by another panel; it registers
 * itself with Flot like Flot's own plugins do. The y axis of a percent chart may need `max: 100`.
 */
(function ($) {
  'use strict';

  var options = {
    series: {
      stackpercent: null // true to stack the series as percentages
    }
  };

  // Index of the column key and of the value within a point: x and y, or y and x for horizontal bars.
  function axes(series) {
    var horizontal = !!(series.bars && series.bars.horizontal === true);
    return { key: horizontal ? 1 : 0, value: horizontal ? 0 : 1 };
  }

  // The total of every column, over all series that are percent-stacked, from their raw data.
  function columnTotals(allSeries) {
    var totals = Object.create(null);
    allSeries.forEach(function (series) {
      if (!series.stackpercent) { return; }
      var at = axes(series);
      (series.data || []).forEach(function (point) {
        if (!point) { return; }
        var column = String(point[at.key]);
        // a point without a y value counts as zero; values are added as numbers (earlier releases added the raw
        // values, which joined numeric strings as text)
        var amount = point[1] != null ? +point[at.value] : 0;
        totals[column] = (totals[column] || 0) + amount;
      });
    });
    return totals;
  }

  function init(plot) {
    // Totals and the running base of every column are valid for one set of series: Flot builds a new array each time
    // the data is set, so the state is rebuilt whenever the array is not the one it was made for.
    var state = null;

    function stateFor(allSeries) {
      if (!state || state.source !== allSeries) {
        state = { source: allSeries, totals: columnTotals(allSeries), bases: Object.create(null) };
      }
      return state;
    }

    function processRawData(plot, series) {
      var current = stateFor(plot.getData());
      // a loose comparison, as in earlier releases: 1 counts as true here
      if (series.stackpercent == true) {
        var at = axes(series);
        series.percents = (series.data || []).map(function (point) {
          if (!point) { return 0; }
          var total = current.totals[String(point[at.key])];
          return total > 0 ? point[at.value] * 100 / total : 0;
        });
      }
    }

    function processDatapoints(plot, series, datapoints) {
      if (!series.stackpercent) { return; }
      var current = stateFor(plot.getData());
      var at = axes(series);
      var size = datapoints.pointsize;
      var points = datapoints.points;
      var stacked = [];

      for (var i = 0; i < points.length; i += size) {
        var column = String(points[i + at.key]);
        var base = current.bases[column] || 0;
        var amount = points[i + at.value];
        var total = current.totals[column];
        var top = 0;
        var bottom = 0;
        if (total > 0) {
          top = (amount + base) * 100 / total;
          bottom = base * 100 / total;
        }
        stacked[i + at.key] = points[i + at.key];
        stacked[i + at.value] = top;
        if (size > 2) { stacked[i + 2] = bottom; }
        current.bases[column] = base + amount;
      }
      datapoints.points = stacked;
    }

    plot.hooks.processRawData.push(processRawData);
    plot.hooks.processDatapoints.push(processDatapoints);
  }

  $.plot.plugins.push({
    init: init,
    options: options,
    name: 'stackpercent',
    version: '0.2'
  });
})(jQuery);
