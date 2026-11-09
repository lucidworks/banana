define(['jquery'],
function ($) {
  'use strict';

  /**
   * jQuery extensions
   */
  var $win = $(window);

  /**
   * `$('#')` returns an empty set again, as it did before jQuery 3 (which throws "unrecognized expression" for it).
   * Bootstrap 2's plugins pass a link's `href` to `$()` to find their target, and the menu toggles in the navigation
   * bar have `href="#"`; with the throw, the menu never opens and the browser follows the link, which replaces the
   * dashboard that is open. Only the exact selector `#` is handled; everything else goes to jQuery's own parser.
   * The check is made where jQuery parses a selector, so `$('#', context)` and `.find('#')` also return an empty set now,
   * where jQuery 1.12.1 threw; nothing in Banana or Bootstrap uses those forms.
   */
  var find = $.find;
  $.find = function (selector) {
    if (selector === '#') {
      return arguments[2] || [];
    }
    return find.apply(this, arguments);
  };
  $.extend($.find, find);

  $.fn.place_tt = (function () {
    var defaults = {
      offset: 5,
      css: {
        position : 'absolute',
        top : -1000,
        left : 0,
        color : "#c8c8c8",
        padding : '10px',
        'font-size': '11pt',
        'font-weight' : 200,
        'background-color': '#1f1f1f',
        'border-radius': '5px',
      }
    };

    return function (x, y, opts) {
      opts = $.extend(true, {}, defaults, opts);
      return this.each(function () {
        var $tooltip = $(this), width, height;

        $tooltip.css(opts.css);
        if (!$.contains(document.body, $tooltip[0])) {
          $tooltip.appendTo(document.body);
        }

        width = $tooltip.outerWidth(true);
        height = $tooltip.outerHeight(true);

        $tooltip.css('left', x + opts.offset + width > $win.width() ? x - opts.offset - width : x + opts.offset);
        $tooltip.css('top', y + opts.offset + height > $win.height() ? y - opts.offset - height : y + opts.offset);
      });
    };
  })();

  return $;
});