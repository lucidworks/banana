'use strict';

/*
 * The percent-stacking plugin for Flot (src/vendor/jquery/jquery.flot.stackpercent.js).
 *
 * The expected values are the datapoints that the plugin of earlier Banana releases produced for the same series,
 * recorded from that plugin and kept here as literals: a replacement has to give the same chart.
 * Every entry of `cases` is [name, plot options, series, expected series], an expected series being
 * { points, percents } as Flot holds them after stacking (`points` are x, y, bottom triples; for horizontal bars the
 * values are x, the key is y).
 */

describe('Flot plugin stackpercent', function () {
  var $ = require('jquery');
  require('jquery.flot');
  require('jquery.flot.stackpercent');

  var bars = { show: true, fill: 1, barWidth: 0.5, zero: false, lineWidth: 0 };
  var verticalBars = { stackpercent: true, bars: bars, lines: { show: false } };

  var cases = [
    ['vertical bars, three series, shared columns',
      { series: verticalBars },
      [{ data: [[1, 2], [2, 4], [3, 1]] }, { data: [[1, 3], [2, 4], [3, 0]] }, { data: [[1, 5], [2, 0], [3, 3]] }],
      [{ points: [1, 20, 0, 2, 50, 0, 3, 25, 0], percents: [20, 50, 25] },
        { points: [1, 50, 20, 2, 100, 50, 3, 25, 25], percents: [30, 50, 0] },
        { points: [1, 100, 50, 2, 100, 100, 3, 100, 25], percents: [50, 0, 75] }]],
    ['filled lines, series with different columns',
      { series: { stackpercent: true, lines: { show: true, fill: 0.001, lineWidth: 1 }, bars: { show: false }, points: { show: false } } },
      [{ data: [[10, 1], [20, 2], [30, 3]] }, { data: [[10, 4], [30, 1]] }, { data: [[20, 6], [30, 2], [40, 5]] }],
      [{ points: [10, 20, 0, 20, 25, 0, 30, 50, 0], percents: [20, 25, 50] },
        { points: [10, 100, 20, 30, 66.66666666666667, 50], percents: [80, 16.666666666666668] },
        { points: [20, 100, 25, 30, 100, 66.66666666666667, 40, 100, 0], percents: [75, 33.333333333333336, 100] }]],
    ['horizontal bars',
      { series: { stackpercent: true, bars: { show: true, horizontal: true, fill: 1, barWidth: 0.5, zero: false, lineWidth: 0 }, lines: { show: false } } },
      [{ data: [[2, 1], [4, 2]] }, { data: [[6, 1], [2, 2]] }, { data: [[1, 1], [3, 2]] }],
      [{ points: [22.22222222222222, 1, 0, 44.44444444444444, 2, 0], percents: [22.22222222222222, 44.44444444444444] },
        { points: [88.88888888888889, 1, 22.22222222222222, 66.66666666666667, 2, 44.44444444444444], percents: [66.66666666666667, 22.22222222222222] },
        { points: [100, 1, 88.88888888888889, 100, 2, 66.66666666666667], percents: [11.11111111111111, 33.333333333333336] }]],
    ['columns that add up to zero',
      { series: verticalBars },
      [{ data: [[1, 0], [2, 3]] }, { data: [[1, 0], [2, 1]] }],
      [{ points: [1, 0, 0, 2, 75, 0], percents: [0, 75] },
        { points: [1, 0, 0, 2, 100, 75], percents: [0, 25] }]],
    ['a series that is not percent-stacked is left out',
      { series: verticalBars },
      [{ data: [[1, 2], [2, 2]] }, { data: [[1, 100], [2, 100]], stackpercent: false }, { data: [[1, 6], [2, 2]] }],
      [{ points: [1, 25, 0, 2, 50, 0], percents: [25, 50] },
        { points: [1, 100, 0, 2, 100, 0], percents: null },
        { points: [1, 100, 25, 2, 100, 50], percents: [75, 50] }]],
    ['a missing y value counts as zero and leaves a gap',
      { series: verticalBars },
      [{ data: [[1, 2], [2, null], [3, 4]] }, { data: [[1, 2], [2, 2], [3, 4]] }],
      [{ points: [1, 50, 0, null, 0, 0, 3, 50, 0], percents: [50, 0, 50] },
        { points: [1, 100, 50, 2, 100, 0, 3, 100, 50], percents: [50, 100, 50] }]],
    ['the option switched off leaves the points alone',
      { series: { stackpercent: false, bars: bars, lines: { show: false } } },
      [{ data: [[1, 2], [2, 4]] }, { data: [[1, 3], [2, 4]] }],
      [{ points: [1, 2, 0, 2, 4, 0], percents: null },
        { points: [1, 3, 0, 2, 4, 0], percents: null }]],
    ['fractional columns',
      { series: verticalBars },
      [{ data: [[1.5, 0.25], [2.5, 0.75]] }, { data: [[1.5, 0.75], [2.5, 0.25]] }],
      [{ points: [1.5, 25, 0, 2.5, 75, 0], percents: [25, 75] },
        { points: [1.5, 100, 25, 2.5, 100, 75], percents: [75, 25] }]]
  ];

  var holder;

  beforeEach(function () {
    holder = $('<div style="width:400px;height:300px"></div>').appendTo(document.body);
  });

  afterEach(function () {
    holder.remove();
  });

  function stacked(plot) {
    return plot.getData().map(function (s) {
      return { points: s.datapoints.points.slice(), percents: s.percents || null };
    });
  }

  // the recorded values are floating point results of the same formulas: compare with a tolerance
  function expectSame(actual, expected) {
    expect(actual.length).toBe(expected.length);
    actual.forEach(function (series, i) {
      expect(series.points.length).toBe(expected[i].points.length);
      series.points.forEach(function (value, j) {
        if (expected[i].points[j] === null) { expect(value).toBeNull(); }
        else { expect(value).toBeCloseTo(expected[i].points[j], 9); }
      });
      if (expected[i].percents === null) { expect(series.percents).toBeNull(); }
      else {
        expect(series.percents.length).toBe(expected[i].percents.length);
        series.percents.forEach(function (value, j) { expect(value).toBeCloseTo(expected[i].percents[j], 9); });
      }
    });
  }

  cases.forEach(function (c) {
    it('stacks as the earlier plugin did: ' + c[0], function () {
      expectSame(stacked($.plot(holder, c[2], c[1])), c[3]);
    });
  });

  it('stacks a chart that shows only points, which has two values per point', function () {
    var plot = $.plot(holder, [{ data: [[1, 1], [2, 3]] }, { data: [[1, 3], [2, 1]] }],
      { series: { stackpercent: true, points: { show: true }, lines: { show: false }, bars: { show: false } } });
    expect(plot.getData()[0].datapoints.pointsize).toBe(2);
    expectSame(stacked(plot), [
      { points: [1, 25, 2, 75], percents: [25, 75] },
      { points: [1, 100, 2, 100], percents: [75, 25] }
    ]);
  });

  it('registers itself with Flot under the same name and option', function () {
    var found = $.plot.plugins.filter(function (p) { return p.name === 'stackpercent'; });
    expect(found.length).toBe(1);
    expect(found[0].options.series.stackpercent).toBeNull();
  });

  it('works for a plot that only passes the option (a panel that did not load the plugin itself)', function () {
    var plot = $.plot(holder, [{ data: [[1, 1]] }, { data: [[1, 3]] }], { series: { stackpercent: true, bars: bars, lines: { show: false } } });
    expect(plot.getData()[1].datapoints.points).toEqual([1, 100, 25]);
  });

  it('starts from scratch when the data of a plot is set again', function () {
    var plot = $.plot(holder, cases[0][2], cases[0][1]);
    var first = stacked(plot);
    plot.setData(cases[0][2]);
    plot.setupGrid();
    plot.draw();
    expectSame(stacked(plot), first);
  });
});
