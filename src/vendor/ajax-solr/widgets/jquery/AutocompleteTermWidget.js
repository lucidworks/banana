(function ($) {
  
/**
 * A <i>term</i> autocomplete search box, using jQueryUI.autocomplete. This
 * implementation uses Solr's facet.prefix technique. This technique benefits
 * from honoring the filter query state and by being able to put words prior to
 * the last one the user is typing into a filter query as well to get even more
 * relevant completion suggestions.
 *
 * Index instructions: 
 * 1. Put a facet warming query into Solr's "firstSearcher" in solrconfig.xml,
 * for the target field.
 * 2. Use appropriate text analysis to include a tokenizer (not keyword) and do
 * <i>not</i> do stemming or else you will see stems suggested. A 'light'
 * stemmer may produce acceptable stems.
 * 3. If you are auto-completing in a search box that would normally be using
 * the dismax query parser AND your qf parameter references more than one field,
 * then you might want to use a catch-all search field to autocomplete on.
 *
 * For large indexes, another implementation approach like the Suggester feature
 * or TermsComponent might be better than a faceting approach. 
 *
 * Other types of autocomplete (a.k.a. suggest) are "search-results",
 * "query-log", and "facet-value". This widget does term autocompletion.
 *
 * @author David Smiley <david.w.smiley at gmail.com>
 */
AjaxSolr.AutocompleteTermWidget = AjaxSolr.AbstractTextWidget.extend(
  /** @lends AjaxSolr.AutocompleteTermWidget.prototype */
  {
  /**
   * @param {Object} attributes
   * @param {String} attributes.field The Solr field to autocomplete indexed
   *   terms from.
   * @param {Boolean} [attributes.tokenized] Whether the underlying field is
   *   tokenized. This component will take words before the last word
   *   (whitespace separated) and generate a filter query for those words, while
   *   only the last word will be used for facet.prefix. For field-value
   *   completion (on just one field) or query log completion, you would have a
   *   non-tokenized field to complete against. Defaults to <tt>true</tt>.
   * @param {Boolean} [attributes.lowercase] Indicates whether to lowercase the
   *   facet.prefix value. Defaults to <tt>true</tt>.
   * @param {Number} [attributes.limit] The maximum number of results to show.
   *   Defaults to 10.
   * @param {Number} [attributes.minLength] The minimum number of characters
   *   required to show suggestions. Defaults to 2.
   * @param {String} [attributes.servlet] The URL path that follows the solr
   *   webapp, for use in auto-complete queries. If not specified, the manager's
   *   servlet property will be used. You may prepend the servlet with a core if
   *   using multiple cores. It is a good idea to use a non-default one to
   *   differentiate these requests in server logs and Solr statistics.
   */
  constructor: function (attributes) {
    AjaxSolr.AutocompleteTermWidget.__super__.constructor.apply(this, arguments);
    AjaxSolr.extend(this, {
      field: null,
      tokenized: true,
      lowercase: true,
      limit: 10,
      minLength: 2,
      servlet: null
    }, attributes);
  },

  init: function () {
    var self = this;

    if (!this.field) {
      throw '"field" must be set on AutocompleteTermWidget.';
    }
    this.servlet = this.servlet || this.manager.servlet;

    $(this.target).find('input').bind('keydown', function (e) {
      if (e.which == 13) {
        var q = $(this).val();
        if (self.set(q)) {
          self.doRequest();
        }
      }
    });

    $(this.target).find('input').autocomplete({
      source: function (request, response) { // note: must always call response()
        // If term ends with a space:
        if (request.term.charAt(request.term.length - 1).replace(/^ +/, '').replace(/ +$/, '') == '') {
          response();
          return;
        }

        var term = request.term,
            facetPrefix = term, // before the last word (if we tokenize)
            fq = '',
            store = new AjaxSolr.ParameterStore();

        store.addByValue('fq', self.manager.store.values('fq'));

        if (self.tokenized) {
          // Split out the last word of the term from the words before it.
          var lastSpace = term.lastIndexOf(' ');
          if (lastSpace > -1) {
            fq = term.substring(0, lastSpace);
            facetPrefix = term.substring(lastSpace + 1);
            store.addByValue('fq', '{!dismax qf=' + self.field + '}' + fq);
          }
        }
        if (self.lowercase) {
          facetPrefix = facetPrefix.toLowerCase();
        }

        store.addByValue('facet.field', self.field);
        store.addByValue('facet.limit', self.limit);
        store.addByValue('facet.prefix', facetPrefix);

        self.manager.executeRequest(self.servlet, 'json.nl=arrarr&q=*:*&rows=0&facet=true&facet.mincount=1&' + store.string(), function (data) {
          response($.map(data.facet_counts.facet_fields[self.field], function (term) {
            var q = (fq + ' ' + term[0]).replace(/^ +/, '').replace(/ +$/, '');
            return {
              label: q + ' (' + term[1] + ')',
              value: q
            }
          }));
        });
      },
      minLength: this.minLength,
      select: function(event, ui) {
        if (self.set(ui.item.value)) {
          self.doRequest();
        }      
      }
    });
  }
});

})(jQuery);
