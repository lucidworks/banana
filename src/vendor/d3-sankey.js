// https://github.com/d3/d3-sankey v0.12.1 Copyright 2019 Mike Bostock
(function (global, factory) {
typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('d3-array'), require('d3-shape')) :
typeof define === 'function' && define.amd ? define(['exports', 'd3-array', 'd3-shape'], factory) :
(global = global || self, factory(global.d3 = global.d3 || {}, global.d3, global.d3));
}(this, function (exports, d3Array, d3Shape) { 'use strict';

function _typeof(obj) {
  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
    _typeof = function (obj) {
      return typeof obj;
    };
  } else {
    _typeof = function (obj) {
      return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
    };
  }

  return _typeof(obj);
}

function _slicedToArray(arr, i) {
  return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest();
}

function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}

function _iterableToArrayLimit(arr, i) {
  var _arr = [];
  var _n = true;
  var _d = false;
  var _e = undefined;

  try {
    for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
      _arr.push(_s.value);

      if (i && _arr.length === i) break;
    }
  } catch (err) {
    _d = true;
    _e = err;
  } finally {
    try {
      if (!_n && _i["return"] != null) _i["return"]();
    } finally {
      if (_d) throw _e;
    }
  }

  return _arr;
}

function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance");
}

function targetDepth(d) {
  return d.target.depth;
}

function left(node) {
  return node.depth;
}
function right(node, n) {
  return n - 1 - node.height;
}
function justify(node, n) {
  return node.sourceLinks.length ? node.depth : n - 1;
}
function center(node) {
  return node.targetLinks.length ? node.depth : node.sourceLinks.length ? d3Array.min(node.sourceLinks, targetDepth) - 1 : 0;
}

function constant(x) {
  return function () {
    return x;
  };
}

function ascendingSourceBreadth(a, b) {
  return ascendingBreadth(a.source, b.source) || a.index - b.index;
}

function ascendingTargetBreadth(a, b) {
  return ascendingBreadth(a.target, b.target) || a.index - b.index;
}

function ascendingBreadth(a, b) {
  return a.y0 - b.y0;
}

function value(d) {
  return d.value;
}

function defaultId(d) {
  return d.index;
}

function defaultNodes(graph) {
  return graph.nodes;
}

function defaultLinks(graph) {
  return graph.links;
}

function find(nodeById, id) {
  var node = nodeById.get(id);
  if (!node) throw new Error("missing: " + id);
  return node;
}

function computeLinkBreadths(_ref) {
  var nodes = _ref.nodes;
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = nodes[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var node = _step.value;
      var y0 = node.y0;
      var y1 = y0;
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = node.sourceLinks[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var link = _step2.value;
          link.y0 = y0 + link.width / 2;
          y0 += link.width;
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2["return"] != null) {
            _iterator2["return"]();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }

      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = node.targetLinks[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          var _link = _step3.value;
          _link.y1 = y1 + _link.width / 2;
          y1 += _link.width;
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3["return"] != null) {
            _iterator3["return"]();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator["return"] != null) {
        _iterator["return"]();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }
}

function Sankey() {
  var x0 = 0,
      y0 = 0,
      x1 = 1,
      y1 = 1; // extent

  var dx = 24; // nodeWidth

  var py = 8; // nodePadding

  var id = defaultId;
  var align = justify;
  var sort;
  var linkSort;
  var nodes = defaultNodes;
  var links = defaultLinks;
  var iterations = 6;

  function sankey() {
    var graph = {
      nodes: nodes.apply(null, arguments),
      links: links.apply(null, arguments)
    };
    computeNodeLinks(graph);
    computeNodeValues(graph);
    computeNodeDepths(graph);
    computeNodeHeights(graph);
    computeNodeBreadths(graph);
    computeLinkBreadths(graph);
    return graph;
  }

  sankey.update = function (graph) {
    computeLinkBreadths(graph);
    return graph;
  };

  sankey.nodeId = function (_) {
    return arguments.length ? (id = typeof _ === "function" ? _ : constant(_), sankey) : id;
  };

  sankey.nodeAlign = function (_) {
    return arguments.length ? (align = typeof _ === "function" ? _ : constant(_), sankey) : align;
  };

  sankey.nodeSort = function (_) {
    return arguments.length ? (sort = _, sankey) : sort;
  };

  sankey.nodeWidth = function (_) {
    return arguments.length ? (dx = +_, sankey) : dx;
  };

  sankey.nodePadding = function (_) {
    return arguments.length ? (py = +_, sankey) : py;
  };

  sankey.nodes = function (_) {
    return arguments.length ? (nodes = typeof _ === "function" ? _ : constant(_), sankey) : nodes;
  };

  sankey.links = function (_) {
    return arguments.length ? (links = typeof _ === "function" ? _ : constant(_), sankey) : links;
  };

  sankey.linkSort = function (_) {
    return arguments.length ? (linkSort = _, sankey) : linkSort;
  };

  sankey.size = function (_) {
    return arguments.length ? (x0 = y0 = 0, x1 = +_[0], y1 = +_[1], sankey) : [x1 - x0, y1 - y0];
  };

  sankey.extent = function (_) {
    return arguments.length ? (x0 = +_[0][0], x1 = +_[1][0], y0 = +_[0][1], y1 = +_[1][1], sankey) : [[x0, y0], [x1, y1]];
  };

  sankey.iterations = function (_) {
    return arguments.length ? (iterations = +_, sankey) : iterations;
  };

  function computeNodeLinks(_ref2) {
    var nodes = _ref2.nodes,
        links = _ref2.links;
    var _iteratorNormalCompletion4 = true;
    var _didIteratorError4 = false;
    var _iteratorError4 = undefined;

    try {
      for (var _iterator4 = nodes.entries()[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
        var _step4$value = _slicedToArray(_step4.value, 2),
            i = _step4$value[0],
            node = _step4$value[1];

        node.index = i;
        node.sourceLinks = [];
        node.targetLinks = [];
      }
    } catch (err) {
      _didIteratorError4 = true;
      _iteratorError4 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion4 && _iterator4["return"] != null) {
          _iterator4["return"]();
        }
      } finally {
        if (_didIteratorError4) {
          throw _iteratorError4;
        }
      }
    }

    var nodeById = new Map(nodes.map(function (d, i) {
      return [id(d, i, nodes), d];
    }));
    var _iteratorNormalCompletion5 = true;
    var _didIteratorError5 = false;
    var _iteratorError5 = undefined;

    try {
      for (var _iterator5 = links.entries()[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
        var _step5$value = _slicedToArray(_step5.value, 2),
            i = _step5$value[0],
            link = _step5$value[1];

        link.index = i;
        var source = link.source,
            target = link.target;
        if (_typeof(source) !== "object") source = link.source = find(nodeById, source);
        if (_typeof(target) !== "object") target = link.target = find(nodeById, target);
        source.sourceLinks.push(link);
        target.targetLinks.push(link);
      }
    } catch (err) {
      _didIteratorError5 = true;
      _iteratorError5 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion5 && _iterator5["return"] != null) {
          _iterator5["return"]();
        }
      } finally {
        if (_didIteratorError5) {
          throw _iteratorError5;
        }
      }
    }
  } // Compute the value (size) of each node by summing the associated links.


  function computeNodeValues(_ref3) {
    var nodes = _ref3.nodes;
    var _iteratorNormalCompletion6 = true;
    var _didIteratorError6 = false;
    var _iteratorError6 = undefined;

    try {
      for (var _iterator6 = nodes[Symbol.iterator](), _step6; !(_iteratorNormalCompletion6 = (_step6 = _iterator6.next()).done); _iteratorNormalCompletion6 = true) {
        var node = _step6.value;
        node.value = node.fixedValue === undefined ? Math.max(d3Array.sum(node.sourceLinks, value), d3Array.sum(node.targetLinks, value)) : node.fixedValue;
      }
    } catch (err) {
      _didIteratorError6 = true;
      _iteratorError6 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion6 && _iterator6["return"] != null) {
          _iterator6["return"]();
        }
      } finally {
        if (_didIteratorError6) {
          throw _iteratorError6;
        }
      }
    }
  }

  function computeNodeDepths(_ref4) {
    var nodes = _ref4.nodes;
    var n = nodes.length;
    var current = new Set(nodes);
    var next = new Set();
    var x = 0;

    while (current.size) {
      var _iteratorNormalCompletion7 = true;
      var _didIteratorError7 = false;
      var _iteratorError7 = undefined;

      try {
        for (var _iterator7 = current[Symbol.iterator](), _step7; !(_iteratorNormalCompletion7 = (_step7 = _iterator7.next()).done); _iteratorNormalCompletion7 = true) {
          var node = _step7.value;
          node.depth = x;
          var _iteratorNormalCompletion8 = true;
          var _didIteratorError8 = false;
          var _iteratorError8 = undefined;

          try {
            for (var _iterator8 = node.sourceLinks[Symbol.iterator](), _step8; !(_iteratorNormalCompletion8 = (_step8 = _iterator8.next()).done); _iteratorNormalCompletion8 = true) {
              var target = _step8.value.target;
              next.add(target);
            }
          } catch (err) {
            _didIteratorError8 = true;
            _iteratorError8 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion8 && _iterator8["return"] != null) {
                _iterator8["return"]();
              }
            } finally {
              if (_didIteratorError8) {
                throw _iteratorError8;
              }
            }
          }
        }
      } catch (err) {
        _didIteratorError7 = true;
        _iteratorError7 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion7 && _iterator7["return"] != null) {
            _iterator7["return"]();
          }
        } finally {
          if (_didIteratorError7) {
            throw _iteratorError7;
          }
        }
      }

      if (++x > n) throw new Error("circular link");
      current = next;
      next = new Set();
    }
  }

  function computeNodeHeights(_ref5) {
    var nodes = _ref5.nodes;
    var n = nodes.length;
    var current = new Set(nodes);
    var next = new Set();
    var x = 0;

    while (current.size) {
      var _iteratorNormalCompletion9 = true;
      var _didIteratorError9 = false;
      var _iteratorError9 = undefined;

      try {
        for (var _iterator9 = current[Symbol.iterator](), _step9; !(_iteratorNormalCompletion9 = (_step9 = _iterator9.next()).done); _iteratorNormalCompletion9 = true) {
          var node = _step9.value;
          node.height = x;
          var _iteratorNormalCompletion10 = true;
          var _didIteratorError10 = false;
          var _iteratorError10 = undefined;

          try {
            for (var _iterator10 = node.targetLinks[Symbol.iterator](), _step10; !(_iteratorNormalCompletion10 = (_step10 = _iterator10.next()).done); _iteratorNormalCompletion10 = true) {
              var source = _step10.value.source;
              next.add(source);
            }
          } catch (err) {
            _didIteratorError10 = true;
            _iteratorError10 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion10 && _iterator10["return"] != null) {
                _iterator10["return"]();
              }
            } finally {
              if (_didIteratorError10) {
                throw _iteratorError10;
              }
            }
          }
        }
      } catch (err) {
        _didIteratorError9 = true;
        _iteratorError9 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion9 && _iterator9["return"] != null) {
            _iterator9["return"]();
          }
        } finally {
          if (_didIteratorError9) {
            throw _iteratorError9;
          }
        }
      }

      if (++x > n) throw new Error("circular link");
      current = next;
      next = new Set();
    }
  }

  function computeNodeLayers(_ref6) {
    var nodes = _ref6.nodes;
    var x = d3Array.max(nodes, function (d) {
      return d.depth;
    }) + 1;
    var kx = (x1 - x0 - dx) / (x - 1);
    var columns = new Array(x);
    var _iteratorNormalCompletion11 = true;
    var _didIteratorError11 = false;
    var _iteratorError11 = undefined;

    try {
      for (var _iterator11 = nodes[Symbol.iterator](), _step11; !(_iteratorNormalCompletion11 = (_step11 = _iterator11.next()).done); _iteratorNormalCompletion11 = true) {
        var node = _step11.value;
        var i = Math.max(0, Math.min(x - 1, Math.floor(align.call(null, node, x))));
        node.layer = i;
        node.x0 = x0 + i * kx;
        node.x1 = node.x0 + dx;
        if (columns[i]) columns[i].push(node);else columns[i] = [node];
      }
    } catch (err) {
      _didIteratorError11 = true;
      _iteratorError11 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion11 && _iterator11["return"] != null) {
          _iterator11["return"]();
        }
      } finally {
        if (_didIteratorError11) {
          throw _iteratorError11;
        }
      }
    }

    if (sort) {
      for (var _i = 0, _columns = columns; _i < _columns.length; _i++) {
        var column = _columns[_i];
        column.sort(sort);
      }
    }

    return columns;
  }

  function initializeNodeBreadths(columns) {
    var ky = d3Array.min(columns, function (c) {
      return (y1 - y0 - (c.length - 1) * py) / d3Array.sum(c, value);
    });
    var _iteratorNormalCompletion12 = true;
    var _didIteratorError12 = false;
    var _iteratorError12 = undefined;

    try {
      for (var _iterator12 = columns[Symbol.iterator](), _step12; !(_iteratorNormalCompletion12 = (_step12 = _iterator12.next()).done); _iteratorNormalCompletion12 = true) {
        var _nodes = _step12.value;
        var y = y0;
        var _iteratorNormalCompletion13 = true;
        var _didIteratorError13 = false;
        var _iteratorError13 = undefined;

        try {
          for (var _iterator13 = _nodes[Symbol.iterator](), _step13; !(_iteratorNormalCompletion13 = (_step13 = _iterator13.next()).done); _iteratorNormalCompletion13 = true) {
            var _node = _step13.value;
            _node.y0 = y;
            _node.y1 = y + _node.value * ky;
            y = _node.y1 + py;
            var _iteratorNormalCompletion14 = true;
            var _didIteratorError14 = false;
            var _iteratorError14 = undefined;

            try {
              for (var _iterator14 = _node.sourceLinks[Symbol.iterator](), _step14; !(_iteratorNormalCompletion14 = (_step14 = _iterator14.next()).done); _iteratorNormalCompletion14 = true) {
                var link = _step14.value;
                link.width = link.value * ky;
              }
            } catch (err) {
              _didIteratorError14 = true;
              _iteratorError14 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion14 && _iterator14["return"] != null) {
                  _iterator14["return"]();
                }
              } finally {
                if (_didIteratorError14) {
                  throw _iteratorError14;
                }
              }
            }
          }
        } catch (err) {
          _didIteratorError13 = true;
          _iteratorError13 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion13 && _iterator13["return"] != null) {
              _iterator13["return"]();
            }
          } finally {
            if (_didIteratorError13) {
              throw _iteratorError13;
            }
          }
        }

        y = (y1 - y + py) / (_nodes.length + 1);

        for (var i = 0; i < _nodes.length; ++i) {
          var node = _nodes[i];
          node.y0 += y * (i + 1);
          node.y1 += y * (i + 1);
        }

        reorderLinks(_nodes);
      }
    } catch (err) {
      _didIteratorError12 = true;
      _iteratorError12 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion12 && _iterator12["return"] != null) {
          _iterator12["return"]();
        }
      } finally {
        if (_didIteratorError12) {
          throw _iteratorError12;
        }
      }
    }
  }

  function computeNodeBreadths(graph) {
    var columns = computeNodeLayers(graph);
    initializeNodeBreadths(columns);

    for (var i = 0; i < iterations; ++i) {
      var alpha = Math.pow(0.99, i);
      var beta = Math.max(1 - alpha, (i + 1) / iterations);
      relaxRightToLeft(columns, alpha, beta);
      relaxLeftToRight(columns, alpha, beta);
    }
  } // Reposition each node based on its incoming (target) links.


  function relaxLeftToRight(columns, alpha, beta) {
    for (var i = 1, n = columns.length; i < n; ++i) {
      var column = columns[i];
      var _iteratorNormalCompletion15 = true;
      var _didIteratorError15 = false;
      var _iteratorError15 = undefined;

      try {
        for (var _iterator15 = column[Symbol.iterator](), _step15; !(_iteratorNormalCompletion15 = (_step15 = _iterator15.next()).done); _iteratorNormalCompletion15 = true) {
          var target = _step15.value;
          var y = 0;
          var w = 0;
          var _iteratorNormalCompletion16 = true;
          var _didIteratorError16 = false;
          var _iteratorError16 = undefined;

          try {
            for (var _iterator16 = target.targetLinks[Symbol.iterator](), _step16; !(_iteratorNormalCompletion16 = (_step16 = _iterator16.next()).done); _iteratorNormalCompletion16 = true) {
              var _step16$value = _step16.value,
                  source = _step16$value.source,
                  _value = _step16$value.value;
              var v = _value * (target.layer - source.layer);
              y += targetTop(source, target) * v;
              w += v;
            }
          } catch (err) {
            _didIteratorError16 = true;
            _iteratorError16 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion16 && _iterator16["return"] != null) {
                _iterator16["return"]();
              }
            } finally {
              if (_didIteratorError16) {
                throw _iteratorError16;
              }
            }
          }

          if (!(w > 0)) continue;
          var dy = (y / w - target.y0) * alpha;
          target.y0 += dy;
          target.y1 += dy;
          reorderNodeLinks(target);
        }
      } catch (err) {
        _didIteratorError15 = true;
        _iteratorError15 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion15 && _iterator15["return"] != null) {
            _iterator15["return"]();
          }
        } finally {
          if (_didIteratorError15) {
            throw _iteratorError15;
          }
        }
      }

      if (sort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  } // Reposition each node based on its outgoing (source) links.


  function relaxRightToLeft(columns, alpha, beta) {
    for (var n = columns.length, i = n - 2; i >= 0; --i) {
      var column = columns[i];
      var _iteratorNormalCompletion17 = true;
      var _didIteratorError17 = false;
      var _iteratorError17 = undefined;

      try {
        for (var _iterator17 = column[Symbol.iterator](), _step17; !(_iteratorNormalCompletion17 = (_step17 = _iterator17.next()).done); _iteratorNormalCompletion17 = true) {
          var source = _step17.value;
          var y = 0;
          var w = 0;
          var _iteratorNormalCompletion18 = true;
          var _didIteratorError18 = false;
          var _iteratorError18 = undefined;

          try {
            for (var _iterator18 = source.sourceLinks[Symbol.iterator](), _step18; !(_iteratorNormalCompletion18 = (_step18 = _iterator18.next()).done); _iteratorNormalCompletion18 = true) {
              var _step18$value = _step18.value,
                  target = _step18$value.target,
                  _value2 = _step18$value.value;
              var v = _value2 * (target.layer - source.layer);
              y += sourceTop(source, target) * v;
              w += v;
            }
          } catch (err) {
            _didIteratorError18 = true;
            _iteratorError18 = err;
          } finally {
            try {
              if (!_iteratorNormalCompletion18 && _iterator18["return"] != null) {
                _iterator18["return"]();
              }
            } finally {
              if (_didIteratorError18) {
                throw _iteratorError18;
              }
            }
          }

          if (!(w > 0)) continue;
          var dy = (y / w - source.y0) * alpha;
          source.y0 += dy;
          source.y1 += dy;
          reorderNodeLinks(source);
        }
      } catch (err) {
        _didIteratorError17 = true;
        _iteratorError17 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion17 && _iterator17["return"] != null) {
            _iterator17["return"]();
          }
        } finally {
          if (_didIteratorError17) {
            throw _iteratorError17;
          }
        }
      }

      if (sort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  }

  function resolveCollisions(nodes, alpha) {
    var i = nodes.length >> 1;
    var subject = nodes[i];
    resolveCollisionsBottomToTop(nodes, subject.y0 - py, i - 1, alpha);
    resolveCollisionsTopToBottom(nodes, subject.y1 + py, i + 1, alpha);
    resolveCollisionsBottomToTop(nodes, y1, nodes.length - 1, alpha);
    resolveCollisionsTopToBottom(nodes, y0, 0, alpha);
  } // Push any overlapping nodes down.


  function resolveCollisionsTopToBottom(nodes, y, i, alpha) {
    for (; i < nodes.length; ++i) {
      var node = nodes[i];
      var dy = (y - node.y0) * alpha;
      if (dy > 1e-6) node.y0 += dy, node.y1 += dy;
      y = node.y1 + py;
    }
  } // Push any overlapping nodes up.


  function resolveCollisionsBottomToTop(nodes, y, i, alpha) {
    for (; i >= 0; --i) {
      var node = nodes[i];
      var dy = (node.y1 - y) * alpha;
      if (dy > 1e-6) node.y0 -= dy, node.y1 -= dy;
      y = node.y0 - py;
    }
  }

  function reorderNodeLinks(_ref7) {
    var sourceLinks = _ref7.sourceLinks,
        targetLinks = _ref7.targetLinks;

    if (linkSort === undefined) {
      var _iteratorNormalCompletion19 = true;
      var _didIteratorError19 = false;
      var _iteratorError19 = undefined;

      try {
        for (var _iterator19 = targetLinks[Symbol.iterator](), _step19; !(_iteratorNormalCompletion19 = (_step19 = _iterator19.next()).done); _iteratorNormalCompletion19 = true) {
          var _sourceLinks = _step19.value.source.sourceLinks;

          _sourceLinks.sort(ascendingTargetBreadth);
        }
      } catch (err) {
        _didIteratorError19 = true;
        _iteratorError19 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion19 && _iterator19["return"] != null) {
            _iterator19["return"]();
          }
        } finally {
          if (_didIteratorError19) {
            throw _iteratorError19;
          }
        }
      }

      var _iteratorNormalCompletion20 = true;
      var _didIteratorError20 = false;
      var _iteratorError20 = undefined;

      try {
        for (var _iterator20 = sourceLinks[Symbol.iterator](), _step20; !(_iteratorNormalCompletion20 = (_step20 = _iterator20.next()).done); _iteratorNormalCompletion20 = true) {
          var _targetLinks = _step20.value.target.targetLinks;

          _targetLinks.sort(ascendingSourceBreadth);
        }
      } catch (err) {
        _didIteratorError20 = true;
        _iteratorError20 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion20 && _iterator20["return"] != null) {
            _iterator20["return"]();
          }
        } finally {
          if (_didIteratorError20) {
            throw _iteratorError20;
          }
        }
      }
    }
  }

  function reorderLinks(nodes) {
    if (linkSort === undefined) {
      var _iteratorNormalCompletion21 = true;
      var _didIteratorError21 = false;
      var _iteratorError21 = undefined;

      try {
        for (var _iterator21 = nodes[Symbol.iterator](), _step21; !(_iteratorNormalCompletion21 = (_step21 = _iterator21.next()).done); _iteratorNormalCompletion21 = true) {
          var _step21$value = _step21.value,
              sourceLinks = _step21$value.sourceLinks,
              targetLinks = _step21$value.targetLinks;
          sourceLinks.sort(ascendingTargetBreadth);
          targetLinks.sort(ascendingSourceBreadth);
        }
      } catch (err) {
        _didIteratorError21 = true;
        _iteratorError21 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion21 && _iterator21["return"] != null) {
            _iterator21["return"]();
          }
        } finally {
          if (_didIteratorError21) {
            throw _iteratorError21;
          }
        }
      }
    }
  } // Returns the target.y0 that would produce an ideal link from source to target.


  function targetTop(source, target) {
    var y = source.y0 - (source.sourceLinks.length - 1) * py / 2;
    var _iteratorNormalCompletion22 = true;
    var _didIteratorError22 = false;
    var _iteratorError22 = undefined;

    try {
      for (var _iterator22 = source.sourceLinks[Symbol.iterator](), _step22; !(_iteratorNormalCompletion22 = (_step22 = _iterator22.next()).done); _iteratorNormalCompletion22 = true) {
        var _step22$value = _step22.value,
            node = _step22$value.target,
            width = _step22$value.width;
        if (node === target) break;
        y += width + py;
      }
    } catch (err) {
      _didIteratorError22 = true;
      _iteratorError22 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion22 && _iterator22["return"] != null) {
          _iterator22["return"]();
        }
      } finally {
        if (_didIteratorError22) {
          throw _iteratorError22;
        }
      }
    }

    var _iteratorNormalCompletion23 = true;
    var _didIteratorError23 = false;
    var _iteratorError23 = undefined;

    try {
      for (var _iterator23 = target.targetLinks[Symbol.iterator](), _step23; !(_iteratorNormalCompletion23 = (_step23 = _iterator23.next()).done); _iteratorNormalCompletion23 = true) {
        var _step23$value = _step23.value,
            node = _step23$value.source,
            width = _step23$value.width;
        if (node === source) break;
        y -= width;
      }
    } catch (err) {
      _didIteratorError23 = true;
      _iteratorError23 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion23 && _iterator23["return"] != null) {
          _iterator23["return"]();
        }
      } finally {
        if (_didIteratorError23) {
          throw _iteratorError23;
        }
      }
    }

    return y;
  } // Returns the source.y0 that would produce an ideal link from source to target.


  function sourceTop(source, target) {
    var y = target.y0 - (target.targetLinks.length - 1) * py / 2;
    var _iteratorNormalCompletion24 = true;
    var _didIteratorError24 = false;
    var _iteratorError24 = undefined;

    try {
      for (var _iterator24 = target.targetLinks[Symbol.iterator](), _step24; !(_iteratorNormalCompletion24 = (_step24 = _iterator24.next()).done); _iteratorNormalCompletion24 = true) {
        var _step24$value = _step24.value,
            node = _step24$value.source,
            width = _step24$value.width;
        if (node === source) break;
        y += width + py;
      }
    } catch (err) {
      _didIteratorError24 = true;
      _iteratorError24 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion24 && _iterator24["return"] != null) {
          _iterator24["return"]();
        }
      } finally {
        if (_didIteratorError24) {
          throw _iteratorError24;
        }
      }
    }

    var _iteratorNormalCompletion25 = true;
    var _didIteratorError25 = false;
    var _iteratorError25 = undefined;

    try {
      for (var _iterator25 = source.sourceLinks[Symbol.iterator](), _step25; !(_iteratorNormalCompletion25 = (_step25 = _iterator25.next()).done); _iteratorNormalCompletion25 = true) {
        var _step25$value = _step25.value,
            node = _step25$value.target,
            width = _step25$value.width;
        if (node === target) break;
        y -= width;
      }
    } catch (err) {
      _didIteratorError25 = true;
      _iteratorError25 = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion25 && _iterator25["return"] != null) {
          _iterator25["return"]();
        }
      } finally {
        if (_didIteratorError25) {
          throw _iteratorError25;
        }
      }
    }

    return y;
  }

  return sankey;
}

function horizontalSource(d) {
  return [d.source.x1, d.y0];
}

function horizontalTarget(d) {
  return [d.target.x0, d.y1];
}

function sankeyLinkHorizontal () {
  return d3Shape.linkHorizontal().source(horizontalSource).target(horizontalTarget);
}

exports.sankey = Sankey;
exports.sankeyCenter = center;
exports.sankeyJustify = justify;
exports.sankeyLeft = left;
exports.sankeyLinkHorizontal = sankeyLinkHorizontal;
exports.sankeyRight = right;

Object.defineProperty(exports, '__esModule', { value: true });

}));
