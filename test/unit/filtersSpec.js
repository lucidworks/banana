'use strict';

describe('filters', function () {
  var helpers = require('./helpers/injector');
  var $filter;

  beforeEach(function () {
    $filter = helpers.createInjector().get('$filter');
  });

  describe('noXml', function () {
    it('escapes markup characters', function () {
      expect($filter('noXml')('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });

    it('escapes every element of an array and leaves other values alone', function () {
      expect($filter('noXml')(['<b>', 'c'])).toEqual(['&lt;b&gt;', 'c']);
      expect($filter('noXml')(5)).toBe(5);
    });
  });

  describe('slice', function () {
    it('returns part of an array', function () {
      expect($filter('slice')([1, 2, 3, 4], 1, 3)).toEqual([2, 3]);
    });
  });

  describe('stringify', function () {
    it('writes an object as JSON and anything else as a string', function () {
      expect($filter('stringify')({ a: 1 })).toBe('{"a":1}');
      expect($filter('stringify')(42)).toBe('42');
    });
  });

  describe('urlLink', function () {
    it('links a web address', function () {
      expect($filter('urlLink')('see http://example.com/x now'))
        .toBe('see <a href="http://example.com/x" target="_blank">http://example.com/x</a> now');
    });

    it('leaves text without an address as it is', function () {
      expect($filter('urlLink')('nothing here')).toBe('nothing here');
    });
  });
});
