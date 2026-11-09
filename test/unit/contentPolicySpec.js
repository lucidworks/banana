'use strict';

// Pieces that replace what a Content-Security-Policy without 'unsafe-inline' or 'unsafe-eval' refuses:
// the share-link input that selects its text without an inline handler, and the CSV reader that
// does not compile a function from the header row.
describe('content policy replacements', function () {
  var angular = require('angular');
  var d3 = require('d3');
  var csvRows = require('components/csv-rows');

  describe('selectOnFocus', function () {
    angular.module('kibana.directives', []);
    require('directives/selectOnFocus');

    function compileInput() {
      var injector = angular.injector(['ng', 'kibana.directives']);
      var input = injector.invoke(['$compile', '$rootScope', function ($compile, $rootScope) {
        var element = $compile('<input type="text" select-on-focus>')($rootScope);
        $rootScope.$digest();
        return element;
      }]);
      var selected = 0;
      input[0].select = function () { selected++; };
      return { element: input, selected: function () { return selected; } };
    }

    it('selects the text when the input is clicked', function () {
      var input = compileInput();
      input.element.triggerHandler('click');
      expect(input.selected()).toBe(1);
    });

    it('selects the text when the input receives focus', function () {
      var input = compileInput();
      input.element.triggerHandler('focus');
      expect(input.selected()).toBe(1);
    });

    it('sets no inline handler attribute', function () {
      var input = compileInput();
      expect(input.element[0].getAttribute('onclick')).toBe(null);
      expect(input.element[0].getAttribute('onfocus')).toBe(null);
    });
  });

  describe('csv-rows', function () {
    var text = 'x,y,label\n1,2,a\n3,4,"b, with comma"\n5,6,"say ""hi"""\n';

    it('returns what d3.csv.parse returns', function () {
      expect(csvRows.parse(text)).toEqual(d3.csv.parse(text));
    });

    it('maps each row like d3.csv.parse, with the index of the data row', function () {
      var indexes = [];
      var convert = function (row, i) { indexes.push(i); return { x: +row.x, label: row.label }; };
      expect(csvRows.parse(text, convert)).toEqual(d3.csv.parse(text, convert));
      expect(indexes).toEqual([0, 1, 2, 0, 1, 2]);
    });

    it('leaves out a row that the mapping drops', function () {
      var keep = function (row) { return row.x === '3' ? null : row; };
      expect(csvRows.parse(text, keep)).toEqual(d3.csv.parse(text, keep));
      expect(csvRows.parse(text, keep).length).toBe(2);
    });

    it('gives no rows for a header only and for no text', function () {
      expect(csvRows.parse('x,y\n')).toEqual([]);
      expect(csvRows.parse('')).toEqual([]);
    });

    it('does not compile code, which a policy without unsafe-eval forbids', function () {
      var RealFunction = window.Function;
      var compiled = 0;
      window.Function = function () { compiled++; return RealFunction.apply(this, arguments); };
      try {
        csvRows.parse(text);
      } finally {
        window.Function = RealFunction;
      }
      expect(compiled).toBe(0);
    });
  });
});
