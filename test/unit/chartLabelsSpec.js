'use strict';

// Labels that a panel hands to flot are written into the page as HTML (the axis labels and the pie slice
// labels). These specs compile the real chart directives of the panels, give them values that look like
// HTML, and check the DOM that flot wrote.
describe('chart labels written as HTML', function () {
  var angular = require('angular');
  var $ = require('jquery');
  var kbn = require('kbn');
  var helpers = require('./helpers/injector');
  require('panels/histogram/module');
  require('panels/timeseries/module');
  require('panels/rangeFacet/module');
  require('panels/terms/module');
  require('jquery.flot.pie');
  require('components/extend-jquery');

  var IMG = '<img src=x onerror=window.xssRan=1>';
  var HOSTILE = IMG + ' <b class="probe">b</b>';
  var host;

  beforeEach(function () {
    host = $('<div style="position:absolute;left:0;top:0;width:500px;height:250px"></div>').appendTo(document.body);
  });

  afterEach(function () {
    host.remove();
  });

  function fakeSeries() {
    var series = {
      getOrderedTimes: function () { return [1000, 2000]; },
      getFlotPairs: function () { return [[1000, 1], [2000, 3]]; }
    };
    // the range facet panel names it numeric_series
    return { info: { alias: 'a', query: '*:*', color: '#ff0000' }, time_series: series, numeric_series: series };
  }

  // Compiles `<div attribute>` with the directive of a module and returns the element after a render event.
  function render(moduleName, attribute, panel, extraScope, provided) {
    var injector = helpers.createInjector(angular.extend({
      dashboard: angular.extend(helpers.fakeDashboard(), { numberWithCommas: function (n) { return String(n); } }),
      filterSrv: { getTimeField: function () { return HOSTILE; }, idsByTypeAndField: function () { return []; } }
    }, provided), [moduleName]);
    var scope = injector.get('$rootScope').$new();
    scope.panel = angular.extend({ height: '200px' }, panel);
    scope.row = { height: '200px' };
    angular.extend(scope, extraScope);
    var element = injector.get('$compile')(angular.element('<div ' + attribute + '></div>'))(scope);
    host.append(element);
    scope.$digest();
    scope.$broadcast('render');
    return element[0];
  }

  function expectEscapedAxisLabels(root, expectedTexts) {
    var labels = root.querySelector('.axisLabels');
    expect(labels).not.toBeNull();
    expect(labels.querySelector('img')).toBeNull();
    expect(labels.querySelector('b.probe')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
    var text = labels.textContent;
    expectedTexts.forEach(function (t) { expect(text).toContain(t); });
  }

  var common = {
    'x-axis': true, 'y-axis': true, interval: '1h', timezone: 'browser', lines: true, fill: 1, linewidth: 1,
    bars: false, points: false, stack: false, percentage: false, interactive: false, tooltip: {}
  };
  var range = { from: new Date(0), to: new Date(10000) };

  it('escapes the mode and the time field in the axis labels of the histogram', function () {
    var root = render('kibana.panels.histogram', 'histogram-chart',
      angular.extend({ mode: HOSTILE }, common), { data: [fakeSeries()], range: range });
    expectEscapedAxisLabels(root, [IMG, '<b class="probe">b</b>']);
  });

  it('escapes the metric, the field and the time field in the axis labels of the time series', function () {
    var root = render('kibana.panels.timeseries', 'timeseries-chart',
      angular.extend({ metric: IMG, field: '<b class="probe">b</b>' }, common), { data: [fakeSeries()], range: range });
    expectEscapedAxisLabels(root, [IMG, '<b class="probe">b</b>']);
  });

  it('escapes the range field in the axis label of the range facet', function () {
    var root = render('kibana.panels.rangeFacet', 'rangefacet-chart',
      angular.extend({ range_field: HOSTILE, chart_minimum: 0, chart_maximum: 10, interval: 1 }, common),
      {
        data: [fakeSeries()], range_count: 1,
        get_facet_range: function () { return { from: 0, to: 10 }; },
        calculate_tick_value: function () { return 1; },
        calculate_tick_decimals: function () { return 0; }
      });
    expectEscapedAxisLabels(root, [IMG, '<b class="probe">b</b>']);
  });

  // Hovering a point shows a tooltip that names the series by its alias (or query), which a dashboard sets.
  [['histogram', 'kibana.panels.histogram', 'histogram-chart', { mode: 'count' }],
    ['time series', 'kibana.panels.timeseries', 'timeseries-chart', { metric: 'count', field: '*' }]].forEach(function (c) {
    it('escapes the alias in the tooltip of the ' + c[0] + ' panel', function () {
      var series = fakeSeries();
      series.info.alias = HOSTILE;
      var root = render(c[1], c[2], angular.extend(c[3], common), { data: [series], range: range });
      var plot = $(root).find('canvas').parent().data('plot') || $(root).data('plot');
      var plotted = plot.getData()[0];
      var item = { series: plotted, seriesIndex: 0, dataIndex: 0, datapoint: [1000, 1, 0] };
      $(root).trigger('plothover', [{ x: 1000, y: 1, pageX: 20, pageY: 20 }, item]);
      var tooltip = $(document.body).children('div').filter(function () { return $(this).find('.icon-circle').length > 0; })[0];
      expect(tooltip).toBeDefined();
      expect(tooltip.querySelector('img')).toBeNull();
      expect(tooltip.querySelector('b.probe')).toBeNull();
      expect(tooltip.textContent).toContain(IMG);
      $(tooltip).remove();
    });
  });

  // The colour of a series comes from the dashboard (the colour of a query) and is written into the markup of
  // the tooltip, both in the dot and in the inline style of the alias.
  // Chromium keeps a value with var() or env() exactly as written, strings and quotes included
  var VERBATIM = ['var(--a,"><img src=x onerror=window.xssRan=1>")', 'env(x,"><img src=x onerror=window.xssRan=1>")',
    'calc(1px + "><img src=x onerror=window.xssRan=1>")', 'attr(x,"><img src=x onerror=window.xssRan=1>")',
    'color-mix(in srgb, red, "><img src=x onerror=window.xssRan=1>")', 'red var(--b,")"><img src=x onerror=window.xssRan=1>")']
    .map(function (v) { return [v, '']; });
  var COLOUR = 'red/*"><img src=x onerror=window.xssRan=1>*/';
  [['histogram', 'kibana.panels.histogram', 'histogram-chart', angular.extend({ mode: 'count' }, common), { range: range }],
    ['time series', 'kibana.panels.timeseries', 'timeseries-chart', angular.extend({ metric: 'count', field: '*' }, common), { range: range }],
    ['range facet', 'kibana.panels.rangeFacet', 'rangefacet-chart',
      angular.extend({ range_field: 'f', chart_minimum: 0, chart_maximum: 10, interval: 1 }, common),
      {
        range_count: 1, get_facet_range: function () { return { from: 0, to: 10 }; },
        calculate_tick_value: function () { return 1; }, calculate_tick_decimals: function () { return 0; }
      }]].forEach(function (c) {
    [true, false].forEach(function (withAlias) {
     VERBATIM.concat([[COLOUR, '']]).forEach(function (pair) {
      it('keeps the query colour ' + pair[0].slice(0, 28) + ' out of the tooltip of the ' + c[0] + ' panel (' + (withAlias ? 'alias' : 'colour dot') + ')', function () {
        var series = fakeSeries();
        series.info.alias = withAlias ? 'my alias' : '';
        series.info.color = pair[0];
        var root = render(c[1], c[2], angular.extend({}, c[3]), angular.extend({ data: [series] }, c[4]));
        var plot = $(root).find('canvas').parent().data('plot') || $(root).data('plot');
        var item = { series: plot.getData()[0], seriesIndex: 0, dataIndex: 0, datapoint: [1000, 1, 0] };
        $(root).trigger('plothover', [{ x: 1000, y: 1, pageX: 20, pageY: 20 }, item]);
        var tooltip = $(document.body).children('div').filter(function () { return $(this).find('.icon-circle').length > 0; })[0];
        expect(tooltip).toBeDefined();
        expect(tooltip.querySelector('img')).toBeNull();
        expect(tooltip.querySelector('[onerror]')).toBeNull();
        expect(tooltip.querySelector('.icon-circle').style.color).toBe(pair[1]);
        expect(tooltip.innerHTML).not.toContain('onerror');
        $(tooltip).remove();
      });
     });
    });
  });

  it('shows a plain colour in a tooltip as before', function () {
    expect(kbn.safeColor('#7EB26D')).toBe('rgb(126, 178, 109)');
    expect(kbn.safeColor('red')).toBe('red');
    expect(kbn.safeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(kbn.safeColor('red/* a comment */')).toBe('red');
    expect(kbn.safeColor('red/*"><img src=x>*/')).toBe('');
    expect(kbn.safeColor('"><img src=x onerror=1>')).toBe('');
    expect(kbn.safeColor(undefined)).toBe('');
    VERBATIM.forEach(function (pair) { expect(kbn.safeColor(pair[0])).toBe(''); });
    expect(kbn.safeColor('rgb(0 0 0 / 50%)')).toBe('rgba(0, 0, 0, 0.5)');
    expect(kbn.safeColor('hsl(120, 100%, 50%)')).toMatch(/^rgb/);
    VERBATIM.forEach(function (pair) { expect(kbn.query_color_dot(pair[0], 15)).not.toMatch(/<img|onerror|var\(/); });
    expect(kbn.query_color_dot('"><img src=x onerror=1>', '15"><b>')).not.toMatch(/<img|<b>/);
  });

  describe('the terms panel with the field values used as colours', function () {
    var config = require('config');
    var savedFusion;

    beforeEach(function () {
      savedFusion = config.USE_FUSION;
      config.USE_FUSION = true;
      host.append('<div id="colorTest"></div>');
    });

    afterEach(function () {
      config.USE_FUSION = savedFusion;
    });

    // The real controller reads a Solr answer whose terms are colours, then the real chart directive draws them.
    function drawn(termList) {
      var dashboard = angular.extend(helpers.fakeDashboard(), { indices: ['logstash-2999.12.31'], numberWithCommas: String, escapeHtml: kbn.escapeHtml });
      dashboard.current.loader = {};
      var injector = helpers.createInjector({ dashboard: dashboard, fields: { typeList: {}, list: [] } }, ['kibana.panels.terms']);
      var $controller = injector.get('$controller');
      var dashScope = injector.get('$rootScope').$new();
      $controller('DashCtrl', { $scope: dashScope });
      var scope = dashScope.$new();
      scope.panel = { field: 'status', title: 'Status', useColorFromField: true, chart: 'pie', labels: false, donut: false, tilt: false, height: '200px', mode: 'count' };
      $controller('terms', { $scope: scope });
      var facet = [];
      termList.forEach(function (t, i) { facet.push(t, 10 - i); });
      var $httpBackend = injector.get('$httpBackend');
      $httpBackend.expectPOST(/\/select$/).respond(200, { responseHeader: { status: 0 }, response: { numFound: 9 }, facet_counts: { facet_fields: { status: facet } } });
      scope.get_data();
      $httpBackend.flush();
      scope.row = { height: '200px' };
      var element = injector.get('$compile')(angular.element('<div terms-chart></div>'))(scope);
      host.append(element);
      scope.$broadcast('render');
      return { scope: scope, element: element };
    }

    // the slices of the terms themselves, without the 'missing' and 'other' ones
    function terms(fixture) {
      return fixture.scope.data.filter(function (slice) { return !slice.meta; });
    }

    function hover(fixture, colour, done) {
      var started = Date.now();
      (function wait() {
        var plot = fixture.element.data('plot') || fixture.element.find('canvas').parent().data('plot');
        if (plot || Date.now() - started > 3000) {
          var series = plot.getData();
          var item = { series: series[0], seriesIndex: 0, dataIndex: 0, datapoint: [0, [[0, 9]]] };
          fixture.element.trigger('plothover', [{ x: 0, y: 0, pageX: 20, pageY: 20 }, item]);
          var tooltip = $(document.body).children('div').filter(function () { return $(this).find('.icon-circle').length > 0; })[0];
          expect(tooltip).toBeDefined();
          expect(tooltip.querySelector('img')).toBeNull();
          expect(tooltip.querySelector('[onerror]')).toBeNull();
          if (colour) { expect(tooltip.querySelector('.icon-circle').style.color).toBe(colour); }
          $(tooltip).remove();
          done();
        } else {
          setTimeout(wait, 10);
        }
      })();
    }

    it('does not take a term with a comment or markup as a colour', function () {
      var fixture = drawn([COLOUR, '"><img src=x onerror=window.xssRan=1>']);
      var slices = terms(fixture);
      expect(slices.length).toBe(2);
      slices.forEach(function (slice) { expect(slice.color).toBeUndefined(); });
    });

    it('keeps valid colour names, hex numbers and rgb() as slice colours', function () {
      var fixture = drawn(['red', '#7EB26D', 'rgb(1, 2, 3)']);
      expect(terms(fixture).map(function (slice) { return slice.color; })).toEqual(['red', 'rgb(126, 178, 109)', 'rgb(1, 2, 3)']);
    });

    it('shows a plain colour term in the tooltip (the dot has the colour)', function (done) {
      hover(drawn(['red', 'blue']), 'red', done);
    });

    it('shows a term with a comment or markup in the tooltip without its markup', function (done) {
      hover(drawn([COLOUR, 'blue']), null, done);
    });
  });

  describe('pie labels of the terms panel', function () {
    function pie(term, done, check) {
      var root = render('kibana.panels.terms', 'terms-chart',
        { chart: 'pie', labels: true, donut: false, tilt: false, field: 'status', chartColors: ['#f00', '#0f0'] },
        { data: [{ label: term, data: [[0, 9]] }, { label: 'other', data: [[1, 1]] }] });
      var started = Date.now();
      (function wait() {
        if (root.querySelector('.pieLabel') || Date.now() - started > 3000) {
          expect(root.querySelector('.pieLabel')).not.toBeNull();
          check(root);
          done();
        } else {
          setTimeout(wait, 10);
        }
      })();
    }

    it('shows a term that holds markup as text', function (done) {
      pie(HOSTILE, done, function (root) {
        expect(root.querySelector('.pieLabel img')).toBeNull();
        expect(root.querySelector('.pieLabel b.probe')).toBeNull();
        expect(root.querySelector('[onerror]')).toBeNull();
        expect(root.querySelector('.pieLabel').textContent).toContain(IMG);
      });
    });

    it('shows a plain term and its percentage', function (done) {
      pie('error', done, function (root) {
        expect(root.querySelector('.pieLabel').textContent).toBe('error90%');
      });
    });
  });
});
