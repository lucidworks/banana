(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['microplugin'], factory);
  }
  else if (typeof exports === 'object') {
    module.exports = factory(require('microplugin'));
  }
  else {
    root.BubbleChart = factory(root.MicroPlugin);
  }
}(this, function (MicroPlugin) {
  var pi2 = Math.PI * 2;
  /**
   * Bubble Chart implementation using {@link d3js.org|d3js}
   *
   * @class BubbleChart
   * @example
   *  - [test-bubble-chart](../test/test-bubble-chart.html)
   *
   * @param {settings} settings - Settings of bubble chart
   */
  d3.svg.BubbleChart = function (settings) {
    var self = this;
    var defaultViewBoxSize = settings.size;
    var defaultInnerRadius = settings.size / 3;
    var defaultOuterRadius = settings.size / 2;
    var defaultRadiusMin = settings.size / 10;
    self.options = {};
    $.extend(self.options, {
      plugins: [],
      container: ".bubbleChart",
      viewBoxSize: defaultViewBoxSize,
      innerRadius: defaultInnerRadius,
      outerRadius: defaultOuterRadius,
      radiusMin: defaultRadiusMin,
      intersectDelta: 0,
      transitDuration: 1000
    }, settings);

    $.extend(self.options, {
      radiusMax: (self.options.outerRadius - self.options.innerRadius) / 2,
      intersectInc: self.options.intersectDelta
    }, settings);

    self.initializePlugins(self.options.plugins);

    self.setup();
    self.registerClickEvent(self.getNodes());
    self.moveToCentral(d3.select(".node"));
  };


  $.extend(d3.svg.BubbleChart.prototype, {
    getTransition: function() {
      return this.transition;
    },

    getClickedNode: function () {
      return this.clickedNode;
    },

    getCentralNode: function () {
      return this.centralNode;
    },

    getOptions: function () {
      return this.options;
    },

    randomCirclesPositions: function (delta) {
      var self = this;
      var circles = [];
      var interval = 0;
      var options = self.options;
      while (circles.length < self.items.length && ++interval < self.intervalMax) {
        var val = self.values[circles.length];
        var rad = Math.max((val * options.radiusMax) / self.valueMax, options.radiusMin);
        var dist = self.innerRadius + rad + Math.random() * (self.outerRadius - self.innerRadius - rad * 2);
        var angle = Math.random() * pi2;
        var cx = self.centralPoint + dist * Math.cos(angle);
        var cy = self.centralPoint + dist * Math.sin(angle);

        var hit = false;
        $.each(circles, function (i, circle) {
          var dx = circle.cx - cx;
          var dy = circle.cy - cy;
          var r = circle.r + rad;
          if (dx * dx + dy * dy < Math.pow(r - delta, 2)) {
            hit = true;
            return false;
          }
        });
        if (!hit) {
          circles.push({cx: cx, cy: cy, r: rad, item: self.items[circles.length]});
        }
      }
      if (circles.length < self.items.length) {
        if (delta === options.radiusMin) {
          throw {
            message: "Not enough space for all bubble. Please change the options.",
            options: options
          }
        }
        return self.randomCirclesPositions(delta + options.intersectInc);
      }
      return circles.shuffle();
    },

    getValues: function () {
      var values = [];
      var self = this;
      $.each(self.items, function (i, item) {values.push(self.options.data.eval(item));});
      return values;
    },

    setup: function () {
      var self = this;
      var options = self.options;
      self.innerRadius = options.innerRadius;
      self.outerRadius = options.outerRadius;
      self.centralPoint = options.size / 2;
      self.intervalMax = options.size * options.size;
      self.items = options.data.items;
      self.values = self.getValues();
      self.valueMax = self.values.max();
      self.svg = d3.select(options.container).append("svg")
        .attr({preserveAspectRatio: "xMidYMid", width: options.size, height: options.size, class: "bubbleChart"})
        .attr("viewBox", function (d) {return ["0 0", options.viewBoxSize, options.viewBoxSize].join(" ")});
      self.circlePositions = self.randomCirclesPositions(options.intersectDelta);

      var node = self.svg.selectAll(".node")
        .data(self.circlePositions)
        .enter().append("g")
        .attr("class", function (d) {return ["node", options.data.classed(d.item)].join(" ");});

      var fnColor = d3.scale.category20();
      node.append("circle")
        .attr({r: function (d) {return d.r;}, cx: function (d) {return d.cx;}, cy: function (d) {return d.cy;}})
        .style("fill", function (d) {
          return options.data.color !== undefined ? options.data.color(d.item) : fnColor(d.item.text);
        })
        .attr("opacity", "0.8");
      node.sort(function (a, b) {return options.data.eval(b.item) - options.data.eval(a.item);});

      self.transition = {};
      self.event = $.microObserver.get($.misc.uuid());

      if (options.supportResponsive) {
        $(window).resize(function() {
          var width = $(options.container).width();
          self.svg.attr("width", width);
          self.svg.attr("height", width);
        });
        $(window).resize();
      }
    },

    getCirclePositions: function () {
      return this.circlePositions;
    },

    moveToCentral: function (node) {
      var self = this;
      var toCentralPoint = d3.svg.transform()
        .translate(function (d) {
          var cx = node.select('circle').attr("cx");
          var dx = self.centralPoint - d.cx;
          var dy = self.centralPoint - d.cy;
          return [dx, dy];
        });
      self.centralNode = node;
      self.transition.centralNode = node.classed({active: true})
        .transition().duration(self.options.transitDuration);
      self.transition.centralNode.attr('transform', toCentralPoint)
        .select("circle")
        .attr('r', function (d) {return self.options.innerRadius;});
    },

    moveToReflection: function (node, swapped) {
      var self = this;
      var toReflectionPoint = d3.svg.transform()
        .translate(function (d) {
          var dx = 2 * (self.centralPoint - d.cx);
          var dy = 2 * (self.centralPoint - d.cy);
          return [dx, dy];
        });

      node.transition()
        .duration(self.options.transitDuration)
        .delay(function (d, i) {return i * 10;})
        .attr('transform', swapped ? "" : toReflectionPoint)
        .select("circle")
        .attr('r', function (d) {return d.r;});
    },

    reset: function (node) {
      var self = this;
      node.classed({active: false});
    },

    registerClickEvent: function (node) {
      var self = this;
      var swapped = false;
      node.style("cursor", "pointer").on("click", function (d) {
        self.clickedNode = d3.select(this);
        self.event.send("click", self.clickedNode);
        self.reset(self.centralNode);
        self.moveToCentral(self.clickedNode);
        self.moveToReflection(self.svg.selectAll(".node:not(.active)"), swapped);
        swapped = !swapped;
      });
    },

    getNodes: function () {
      return this.svg.selectAll(".node");
    },

    get: function () {
      return this.svg;
    }
  });

  MicroPlugin.mixin(d3.svg.BubbleChart);

  return d3.svg.BubbleChart;
}));
/**
 * Settings of bubble chart
 *
 * @typedef {object} settings
 *
 * @param {(object[]|string[])} plugins - Array of plugin [microplugin](https://github.com/brianreavis/microplugin.js|microplugin)
 * @param {string} [container=".bubbleChart"] - Jquery selector which will contain the chart
 * @param {number} size - Size of the chart, in pixel
 * @param {number} [viewBoxSize=size] - Size of the viewport of the chart, in pixel [ViewBoxAttribute](http://www.w3.org/TR/SVG/coords.html#ViewBoxAttribute)
 * @param {number} [innerRadius=size/3] - Radius of the Inner Circle, in pixel
 * @param {number} [outerRadius=size/2] - Radius of the Outer Circle, in pixel
 * @param {number} [radiusMin=size/10] - Minimum radius, in pixel
 * @param {number} [radiusMax=(outerRadius  innerRadius)/2] - Maximum radius, in pixel
 * @param {number} [intersectDelta=0] - Intersection between circles, in pixel
 * @param {number} [intersectInc=intersectDelta] - Increment of settings.intersectDelta, in pixel
 * @param {number} [transitDuration=1000] - Duration of transition when do animations, in mili-seconds
 * @param {data} data - Data information
 */

/**
 * Data information
 *
 * @typedef {object} data
 * @param {object[]} items - Array of items <br/> ex:
 * ```js
 * data.items = [{number: 179, label: "something"}, {number: 220, label: "everything"}]
 * ```
 * @param {function} eval - Function should return a number used to evaluate an item <br/> ex:
 * ```js
 * data.eval = function(d){
 *   return d.number;
 * }
 * ```
 * @param {function} [color=d3.scale.category20] - Function should return a string used to fill bubbles <br/>ex:
 * ```js
 * data.color = function(d){
 *   return "white";
 * }
 * ```
 */