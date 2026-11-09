'use strict';

// The shipped jQuery, Underscore and Moment.js are newer than AngularJS 1.0.8 and Bootstrap 2, which stay as they are.
// These specs check the points where the old framework meets the new libraries.
describe('the shipped libraries together', function () {
  var angular = require('angular');
  var $ = require('jquery');
  var _ = require('underscore');
  var moment = require('moment');

  it('lets AngularJS use the shipped jQuery instead of its own small replacement', function () {
    expect(angular.element).toBe($);
  });

  it('compiles and updates a template with repeated rows, an attribute binding and a class binding', function () {
    var injector = angular.injector(['ng']);
    var element = injector.invoke(['$rootScope', '$compile', function ($rootScope, $compile) {
      var scope = $rootScope.$new();
      scope.items = ['a', 'b', 'c'];
      scope.cls = 'on';
      var el = $compile('<ul><li ng-repeat="i in items" ng-class="cls" title="{{i}}">{{i}}</li></ul>')(scope);
      scope.$digest();
      scope.items.push('d');
      scope.cls = 'off';
      scope.$digest();
      return el;
    }]);
    expect(element.find('li').length).toBe(4);
    expect(element.find('li').eq(3).text()).toBe('d');
    expect(element.find('li').eq(3).attr('title')).toBe('d');
    expect(element.find('li').eq(0).hasClass('off')).toBe(true);
    expect(element.find('li').eq(0).hasClass('on')).toBe(false);
  });

  it('keeps the Underscore functions that the panels call', function () {
    expect(_.contains(['hour', 'day'], 'day')).toBe(true);
    expect(_.pluck([{ a: 1 }, { a: 2 }], 'a')).toEqual([1, 2]);
    expect(_.sortBy([3, 1, 2], _.identity)).toEqual([1, 2, 3]);
    expect(_.uniq([1, 1, 2])).toEqual([1, 2]);
    expect(_.escape('<a & b>')).toBe('&lt;a &amp; b&gt;');
    expect(_.isFunction(_.mixin)).toBe(true);
    expect(_.isFunction(_.move)).toBe(true);
  });

  it('formats and adds dates with the Moment.js call forms that the panels use', function () {
    var start = moment.utc('2014-03-05T10:20:30Z');
    expect(start.format('MM/DD HH:mm:ss')).toBe('03/05 10:20:30');
    expect(start.clone().add(1, 'days').format('MM/DD')).toBe('03/06');
    expect(start.clone().subtract(2, 'hours').format('HH:mm')).toBe('08:20');
    expect(start.diff(moment.utc('2014-03-05T10:20:00Z'), 'seconds')).toBe(30);
  });
});
