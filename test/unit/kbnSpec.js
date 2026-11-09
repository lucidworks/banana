'use strict';

describe('kbn', function () {
  var kbn = require('kbn');

  describe('interval_to_seconds', function () {
    it('converts counts of each unit', function () {
      expect(kbn.interval_to_seconds('30s')).toBe(30);
      expect(kbn.interval_to_seconds('5m')).toBe(300);
      expect(kbn.interval_to_seconds('2h')).toBe(7200);
      expect(kbn.interval_to_seconds('1d')).toBe(86400);
    });

    it('rejects a string that is not an interval', function () {
      expect(function () { kbn.interval_to_seconds('soon'); }).toThrow();
    });
  });

  describe('addslashes', function () {
    it('escapes backslashes and quotes', function () {
      expect(kbn.addslashes('a"b\'c\\d')).toBe('a\\"b\\\'c\\\\d');
    });
  });

  describe('to_percent', function () {
    it('rounds down to two decimals', function () {
      expect(kbn.to_percent(1, 3)).toBe('33.33%');
    });
  });

  describe('flatten_json', function () {
    it('joins nested keys with dots', function () {
      expect(kbn.flatten_json({ a: 1, b: { c: 25 } })).toEqual({ a: 1, 'b.c': 25 });
    });
  });
});
