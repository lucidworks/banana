define(['jquery', 'kbn', 'bootstrap'],
function ($, kbn) {
  'use strict';

  /**
   * Bootstrap's typeahead writes each suggestion into the menu as HTML, and its own highlighter does not
   * escape the suggestion. The suggestions come from dashboards (the query history) and from documents
   * (field names, collection names), so they are escaped here, once, for every input that uses the
   * typeahead. The part that matches what was typed is wrapped in <strong> as before. The value that
   * is chosen is not changed: it is read from the item itself, not from this markup.
   */
  function highlighter(item) {
    var text = String(item);
    var query = String(this.query || '').replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, '\\$&');
    if (query === '') {
      return kbn.escapeHtml(text);
    }
    var pattern = new RegExp(query, 'ig');
    var out = '';
    var last = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0] === '') {
        pattern.lastIndex++;
        continue;
      }
      out += kbn.escapeHtml(text.substring(last, match.index)) + '<strong>' + kbn.escapeHtml(match[0]) + '</strong>';
      last = match.index + match[0].length;
    }
    return out + kbn.escapeHtml(text.substring(last));
  }

  $.fn.typeahead.Constructor.prototype.highlighter = highlighter;

  return highlighter;
});
