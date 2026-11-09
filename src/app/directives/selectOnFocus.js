define([
  'angular'
],
function (angular) {
  'use strict';

  // Selects the whole text of an input when it is clicked or receives focus, so that a link shown in
  // it can be copied in one step. It replaces inline onclick/onfocus handlers, which a
  // Content-Security-Policy without 'unsafe-inline' blocks.
  angular
    .module('kibana.directives')
    .directive('selectOnFocus', function() {
      return function(scope, element) {
        var select = function() { this.select(); };
        element.bind('click', select);
        element.bind('focus', select);
      };
    });

});
