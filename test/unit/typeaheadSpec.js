'use strict';

// Bootstrap's typeahead writes each suggestion into its menu as HTML. The suggestions come from dashboards
// (the query history) and from documents (field names, collection names), so the application escapes them.
describe('typeahead menus', function () {
  var angular = require('angular');
  var $ = require('jquery');
  require('bootstrap');
  require('angular-strap');
  require('components/typeahead-escape');

  var IMG = '<img src=x onerror=window.xssRan=1>';
  var host;

  beforeEach(function () {
    host = $('<div></div>').appendTo(document.body);
  });

  afterEach(function () {
    host.remove();
    $('.typeahead').remove();
  });

  function compile(list, attrs) {
    var injector = angular.injector(['ng', '$strap.directives']);
    var scope = injector.get('$rootScope').$new();
    scope.list = list;
    var input = injector.get('$compile')(angular.element('<input type="text" bs-typeahead="list" ' + (attrs || '') + ' ng-model="q">'))(scope);
    host.append(input);
    scope.$digest();
    return { input: input, scope: scope };
  }

  function menuFor(fixture, typed) {
    fixture.input.val(typed);
    fixture.input.data('typeahead').lookup();
    return fixture.input.data('typeahead').$menu[0];
  }

  it('shows a suggestion that holds markup as text', function () {
    var menu = menuFor(compile(['status:500 ' + IMG + ' " onmouseover="window.xssRan=1']), 'status');
    expect(menu.querySelector('img')).toBeNull();
    expect(menu.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(menu.textContent).toContain('status:500 ' + IMG + ' " onmouseover="window.xssRan=1');
  });

  it('shows a suggestion that matches only inside its markup as text', function () {
    var menu = menuFor(compile([IMG]), 'onerror');
    expect(menu.querySelector('img')).toBeNull();
    expect(menu.querySelector('strong').textContent).toBe('onerror');
    expect(menu.textContent).toBe(IMG);
  });

  it('shows every suggestion with an empty query when the minimum length is 0', function () {
    var menu = menuFor(compile([IMG, 'plain'], 'data-min-length=0'), '');
    expect(menu.querySelector('img')).toBeNull();
    expect(menu.querySelectorAll('li').length).toBe(2);
  });

  it('still wraps the matching part in strong, and keeps plain suggestions as they were', function () {
    var menu = menuFor(compile(['status_code', 'node_name']), 'ST');
    var items = menu.querySelectorAll('li');
    expect(items.length).toBe(1);
    expect(items[0].innerHTML).toContain('<strong>st</strong>atus_code');
    expect(items[0].textContent).toBe('status_code');
  });

  it('chooses the raw value, not the escaped one', function () {
    var fixture = compile(['a&b <i>x</i>']);
    var menu = menuFor(fixture, 'a&');
    expect(menu.querySelector('li').getAttribute('data-value')).toBe('a&b <i>x</i>');
    $(menu).find('li').first().addClass('active');
    fixture.input.data('typeahead').select();
    expect(fixture.input.val()).toBe('a&b <i>x</i>');
    expect(fixture.scope.q).toBe('a&b <i>x</i>');
  });
});
