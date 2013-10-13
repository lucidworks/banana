(function (callback) {
  if (typeof define === 'function' && define.amd) {
    define(['core/AbstractWidget'], callback);
  }
  else {
    callback();
  }
}(function () {

/**
 * Interacts with Solr's SpellCheckComponent.
 *
 * @see http://wiki.apache.org/solr/SpellCheckComponent
 *
 * @class AbstractSpellcheckWidget
 * @augments AjaxSolr.AbstractWidget
 */
AjaxSolr.AbstractSpellcheckWidget = AjaxSolr.AbstractWidget.extend(
  /** @lends AjaxSolr.AbstractSpellcheckWidget.prototype */
  {
  constructor: function (attributes) {
    AjaxSolr.AbstractSpellcheckWidget.__super__.constructor.apply(this, arguments);
    AjaxSolr.extend(this, {
      // The suggestions.
      suggestions: {}
    }, attributes);
  },

  /**
   * Uses the top suggestion for each word to return a suggested query.
   *
   * @returns {String} A suggested query.
   */
  suggestion: function () {
    var suggestion = this.manager.response.responseHeader.params['spellcheck.q'];
    for (var word in this.suggestions) {
      suggestion = suggestion.replace(new RegExp(word, 'g'), this.suggestions[word][0]);
    }
    return suggestion;
  },

  beforeRequest: function () {
    if (this.manager.store.get('spellcheck').val() && this.manager.store.get('q').val()) {
      this.manager.store.get('spellcheck.q').val(this.manager.store.get('q').val());
    }
    else {
      this.manager.store.remove('spellcheck.q');
    }
  },

  afterRequest: function () {
    this.suggestions = {};

    if (this.manager.response.spellcheck && this.manager.response.spellcheck.suggestions) {
      var suggestions = this.manager.response.spellcheck.suggestions,
          empty = true;

      for (var word in suggestions) {
        if (word == 'collation' || word == 'correctlySpelled') continue;

        this.suggestions[word] = [];
        for (var i = 0, l = suggestions[word].suggestion.length; i < l; i++) {
          if (this.manager.response.responseHeader.params['spellcheck.extendedResults']) {
            this.suggestions[word].push(suggestions[word].suggestion[i].word);
          }
          else {
            this.suggestions[word].push(suggestions[word].suggestion[i]);
          }
        }
        empty = false;
      }

      if (!empty) {
        this.handleSuggestions(this.manager.response);
      }
    }
  },

  /**
   * An abstract hook for child implementations.
   *
   * <p>Allow the child to handle the suggestions without parsing the response.</p>
   */
  handleSuggestions: function () {}
});

}));
