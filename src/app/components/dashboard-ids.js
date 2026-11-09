/**
 * How the title of a saved dashboard is turned into the things that name it: the path of its blob in Fusion,
 * a phrase in a Solr query, and the address of a link to it. A saved dashboard is stored under its title, so
 * every request that names one goes through here, and the four of them (look up, load, save, delete) cannot
 * disagree about what the title means.
 */
define([], function () {
  'use strict';

  var ids = {};

  // A surrogate half that has no partner. encodeURIComponent throws on one.
  function hasLoneSurrogate(text) {
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          i++;
        } else {
          return true;
        }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        return true;
      }
    }
    return false;
  }

  /**
   * Why the Fusion blob store cannot hold a dashboard under this title, as a sentence for the person who typed it,
   * or null when it can. The gateway in front of the blob store decodes a request path once and refuses a decoded
   * `%`, `;`, `\`, a NUL, `//` and a `.` or `..` segment. A browser rewrites `.` and `..` segments before it sends a
   * request. The checks are deliberately a little stricter than the gateway (a trailing slash, an empty segment,
   * other control characters), and a lone surrogate cannot be encoded at all.
   */
  ids.blobIdProblem = function (id) {
    if (typeof id !== 'string' || id === '') {
      return 'The title is empty.';
    }
    if (hasLoneSurrogate(id)) {
      return 'The title contains a character that cannot be encoded (half of a surrogate pair).';
    }
    if (id.indexOf('%') !== -1) {
      return 'The title cannot contain "%": the Fusion gateway refuses it in the address of a saved dashboard.';
    }
    if (id.indexOf(';') !== -1 || id.indexOf('\\') !== -1) {
      return 'The title cannot contain ";" or "\\": the Fusion gateway refuses them in the address of a saved dashboard.';
    }
    if (/[\u0000-\u001f\u007f]/.test(id)) {
      return 'The title cannot contain a control character.';
    }
    var segments = id.split('/');
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] === '' || segments[i] === '.' || segments[i] === '..') {
        return 'The title cannot start or end with "/", contain "//", or have a part between slashes that is empty, "." or "..".';
      }
    }
    return null;
  };

  ids.isStorableBlobId = function (id) {
    return ids.blobIdProblem(id) === null;
  };

  /** The one codec for the path segment that names a dashboard in the Fusion blob store. */
  ids.blobSegment = function (id) {
    return encodeURIComponent(id);
  };

  /** The id as a quoted Solr phrase: a backslash or a quote inside it is escaped, so it cannot end the phrase. */
  ids.solrPhrase = function (id) {
    return '"' + String(id).replace(/[\\"]/g, '\\$&') + '"';
  };

  /**
   * The id as it is written after /dashboard/solr/ in a link. AngularJS decodes the address once before it matches
   * a route, so a link that carries the id encoded once would let a "/" in it split the route. It is encoded twice;
   * the route decodes once more (see routeId). An id that cannot be encoded gives a link that opens nothing.
   */
  ids.linkId = function (id) {
    try {
      return encodeURIComponent(encodeURIComponent(id));
    } catch (e) {
      return '';
    }
  };

  /** The id a route parameter carries: decoded once more, or as it is when it is not valid encoded text. */
  ids.routeId = function (id) {
    try {
      return decodeURIComponent(id);
    } catch (e) {
      return id;
    }
  };

  return ids;
});
