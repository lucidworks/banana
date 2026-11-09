'use strict';

/*
 * Webpack loader for the classic scripts under src/vendor and the other vendored libraries.
 *
 * Two jobs:
 *
 * 1. Licence notices. The minifier keeps only comments that start with /*! or contain @license,
 *    and it can drop even those when it merges the statement they are attached to. The comments at
 *    the very top of a vendored file (the licence header) are therefore copied in front of the
 *    module as /*! comments, so that every vendored library keeps its notice in the build output.
 *
 * 2. Optionally (option `shim`), the equivalent of a RequireJS `shim` entry: load `deps` first, run
 *    the classic script with `this === window` and with CommonJS and AMD detection switched off,
 *    then export the global that the script creates. Scripts that look for `module` or `define`
 *    would otherwise take a Node or AMD branch that does not do what they did under RequireJS.
 *
 * Options:
 *   shim    true to wrap the script as described above (default false: only the header is kept)
 *   deps    module ids to load before the script (shim only)
 *   global  name of the global the script creates, exported as the module value (shim only)
 *   expr    expression to assign to that global when the script keeps its object in a local
 *           variable instead (shim only)
 */

// The run of comments (and blank lines) at the top of the file, as a list of { block, text } where
// `text` is the comment exactly as written and `block` tells /* */ from // lines.
function splitLeading(source) {
  var rest = source.replace(/^\uFEFF/, '');
  var out = [];
  var m;
  for (;;) {
    m = /^\s*(\/\*[\s\S]*?\*\/)/.exec(rest);
    if (m) {
      out.push({ block: true, text: m[1] });
      rest = rest.slice(m[0].length);
      continue;
    }
    m = /^\s*((?:\/\/[^\n]*(?:\n|$))+)/.exec(rest);
    if (m) {
      out.push({ block: false, text: m[1].replace(/\s+$/, '') });
      rest = rest.slice(m[0].length);
      continue;
    }
    break;
  }
  return out;
}

// The same comments, rewritten as /*! */ comments (the form that the minifier keeps).
function leadingComments(source) {
  return splitLeading(source).map(function (c) {
    if (c.block) {
      return c.text.replace(/^\/\*[!*]?/, '/*!');
    }
    return '/*!\n' + c.text.replace(/^\s*\/\/ ?/gm, ' * ').replace(/\*\//g, '* /') + '\n */';
  }).join('\n');
}

module.exports = function (source) {
  var o = this.getOptions();
  var header = leadingComments(source);
  var out = header ? header + '\n' : '';
  if (!o.shim) {
    return out + source;
  }
  (o.deps || []).forEach(function (d) { out += 'require(' + JSON.stringify(d) + ');\n'; });
  out += '(function (module, exports, require, define) {\n' + source + '\n;\n';
  if (o.global) { out += 'window.' + o.global + ' = ' + (o.expr || 'window.' + o.global) + ';\n'; }
  out += '}).call(window, undefined, undefined, undefined, false);\n';
  if (o.global) { out += 'module.exports = window.' + o.global + ';\n'; }
  return out;
};

module.exports.leadingComments = leadingComments;
module.exports.splitLeading = splitLeading;
