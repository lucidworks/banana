/**
 * Helpers for the panels that build Solr streaming expressions (graph, significantTerms,
 * timeseries).
 *
 * An expression is sent in the `expr` parameter of a GET request to the collection's `/stream` or
 * `/graph` handler. Everything a dashboard author or a viewer can influence (query text, filter
 * values, field and collection names) goes into it through the functions below, so that it cannot
 * end a string early, close a function or add one:
 *
 * - quote() writes a string parameter value in double quotes. Solr's expression parser
 *   (StreamExpressionParser) finds the end of a quoted value by scanning for the next double quote
 *   that is not escaped, where a backslash escapes the character after it. It then removes the
 *   quotes and turns every `\"` back into `"`; it does not turn `\\` back into `\`, and it turns
 *   a backtick into a double quote. So the only escape that can be written is `\"`, and a value
 *   is sent exactly only if it has no backtick, no odd run of backslashes right before a double
 *   quote and no odd run of backslashes at its end. quote() refuses any other value with an
 *   Error instead of sending a changed one. Solr also trims whitespace at both ends of the
 *   quoted value, so quote() trims first: after trimming a value is sent exactly or refused. Other backslashes (`foo\:bar`) and commas,
 *   parentheses, equals signs and inner spaces are plain text inside quotes. Line breaks in a
 *   value become spaces, because the parser drops lines that start with `#`.
 * - name() accepts a collection or field name only when it is made of letters, digits, `_`, `.`
 *   and `-`. Such a name is written unquoted.
 * - assertReadOnly() checks the finished expression: every function in it must be one of
 *   FUNCTIONS, which only read data, and the text must be a single balanced expression. Nothing
 *   that writes (update, commit, delete, daemon, ...) is in the list, so a panel cannot send one
 *   even if a setting names it.
 */
define([
  'underscore'
], function (_) {
  'use strict';

  // The only functions the panels emit: the search, graph traversal, join and metric functions
  // they use. None of them changes data.
  var FUNCTIONS = ['search', 'nodes', 'fetch', 'select', 'significantTerms', 'timeseries',
    'count', 'sum', 'avg', 'min', 'max'];

  var NAME = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;

  var streamExpression = {};

  streamExpression.FUNCTIONS = FUNCTIONS;

  // The value that Solr hands to the function once it has read the quoted text written by quote().
  // Only used by the tests of this module.
  streamExpression.unquote = function (text) {
    return text.substring(1, text.length - 1).replace(/\\"/g, '"');
  };

  streamExpression.quote = function (value) {
    // Solr trims whitespace (characters up to U+0020) at both ends of a quoted value after it removes
    // the quotes, so trim here first: the checks below then see the value Solr will see (`foo\ `
    // becomes `foo\`, a dangling escape, and is refused). Line breaks become single spaces.
    var text = String(value).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\r\n]+/g, ' ');
    if (text.indexOf('`') !== -1) {
      throw new Error('A value with a backtick cannot be sent in a streaming expression: ' + text);
    }
    if (/(^|[^\\])(\\\\)*\\("|$)/.test(text)) {
      throw new Error('A value with a backslash before a double quote or at its end cannot be sent ' +
        'in a streaming expression: ' + text);
    }
    return '"' + text.replace(/"/g, '\\"') + '"';
  };

  // A collection or field name, or throw an Error that names what was wrong.
  streamExpression.name = function (value, what) {
    if (!_.isString(value) || !NAME.test(value)) {
      throw new Error('Invalid ' + what + ': ' + (_.isString(value) ? '"' + value + '"' : 'not set'));
    }
    return value;
  };

  // A whole number, or throw an Error that names what was wrong.
  streamExpression.integer = function (value, what) {
    var n = Number(value);
    if (value === '' || value === null || _.isUndefined(value) || !isFinite(n) || Math.floor(n) !== n) {
      throw new Error('Invalid ' + what + ': ' + value);
    }
    return String(n);
  };

  // A finite number (whole or decimal), or throw an Error that names what was wrong.
  streamExpression.number = function (value, what) {
    var n = Number(value);
    if (value === '' || value === null || _.isUndefined(value) || !isFinite(n)) {
      throw new Error('Invalid ' + what + ': ' + value);
    }
    return String(n);
  };

  // Join a query and the dashboard's filters into one query. A filter that only excludes
  // (for example `-status:"x"`) is paired with *:* so that it still selects documents.
  streamExpression.combine = function (query, filters) {
    var oneLine = function (text) {
      return String(text).replace(/[\r\n]+/g, ' ');
    };
    var q = oneLine(query === null || _.isUndefined(query) ? '' : query);
    if (q.trim() === '') {
      q = '*:*';
    }
    var clean = _.filter(filters || [], function (f) {
      return _.isString(f) && f.trim() !== '';
    });
    if (clean.length === 0) {
      return q;
    }
    var parts = ['(' + q + ')'];
    _.each(clean, function (f) {
      f = oneLine(f);
      parts.push(f.charAt(0) === '-' ? '(*:* ' + f + ')' : '(' + f + ')');
    });
    return parts.join(' AND ');
  };

  // Throw an Error unless `expr` is one balanced expression that uses only FUNCTIONS.
  streamExpression.assertReadOnly = function (expr) {
    var inQuote = false;
    var depth = 0;
    var closedAt = -1;
    var i = 0;
    var c, match, rest;

    while (i < expr.length) {
      c = expr.charAt(i);
      if (inQuote) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '"') {
          inQuote = false;
        }
        i++;
        continue;
      }
      if (c === '\\') {
        // Solr's scanner treats a backslash as escaping the next character outside quotes too
        i += 2;
        continue;
      }
      // (a single quote is not modelled: the builders cannot emit one outside a quoted value)
      if (c === '"') {
        inQuote = true;
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth < 0) {
          throw new Error('The streaming expression is not balanced');
        }
        if (depth === 0) {
          closedAt = i;
        }
      } else if (/[A-Za-z_]/.test(c)) {
        rest = expr.substring(i);
        match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)[0];
        if (/^\s*\(/.test(rest.substring(match.length)) && !_.contains(FUNCTIONS, match)) {
          throw new Error('The function ' + match + ' is not allowed in a streaming expression');
        }
        i += match.length;
        continue;
      }
      i++;
    }
    if (inQuote || depth !== 0 || closedAt !== expr.length - 1) {
      throw new Error('The streaming expression is not balanced');
    }
    return expr;
  };

  // The request goes through a Fusion query pipeline (`.../query-pipelines/<id>/collections/`).
  streamExpression.isPipelineRoute = function (server) {
    return _.isString(server) && /\/query-pipelines\//.test(server);
  };

  // Text for a panel whose stream or graph request was refused or failed. `detail` is the usual
  // description of the failed request. When the request went through a query pipeline and failed with
  // HTTP 500 (what Fusion answers for a handler the pipeline does not allow), Fusion does
  // not allow the stream and graph handlers there unless the pipeline is configured for them, so
  // the text says so and says what to change. Banana does not retry on a direct route itself:
  // that would bypass the pipeline's security.
  streamExpression.failureMessage = function (server, response, detail) {
    if (streamExpression.isPipelineRoute(server) && response && response.status === 500) {
      return 'This panel requires direct Solr access. Its dashboard sends requests through a ' +
        'query pipeline, and Fusion does not allow the stream and graph request handlers there ' +
        'unless the pipeline is set up for them. Set the dashboard\'s Solr server to a direct ' +
        'route such as /api/solr/ to use this panel. (' + detail + ')';
    }
    return detail;
  };

  return streamExpression;
});
