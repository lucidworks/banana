/*
  ## Text
  ### Parameters
  * mode :: 'text', 'html', 'markdown'
  * content :: Content of the panel
  * style :: Hash containing css properties
*/
define([
  'angular',
  'app',
  'underscore',
  'require'
],
function (angular, app, _, require) {
  'use strict';

  var module = angular.module('kibana.panels.text', []);
  app.useModule(module);

  module.controller('text', function($scope) {
    $scope.panelMeta = {
      status  : "Stable",
      description : "A static text panel that can use plain text, markdown, or (sanitized) HTML"
    };

    // Set and populate defaults
    var _d = {
      status  : "Stable",
      mode    : "markdown",
        display:'block',
        icon:"icon-caret-down",
      content : "",
      style: {},
    };
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.ready = false;
    };
      $scope.display=function() {
          if($scope.panel.display === 'none'){
              $scope.panel.display='block';
              $scope.panel.icon="icon-caret-down";


          }else{
              $scope.panel.display='none';
              $scope.panel.icon="icon-caret-up";
          }
      };

  });

  module.directive('markdown', function() {
    return {
      restrict: 'E',
      link: function(scope, element) {
        scope.$on('render', function() {
          render_panel();
        });

        function render_panel() {
          require(['./lib/showdown'], function (Showdown) {
            scope.ready = true;
            var converter = new Showdown.converter();
            var text = scope.panel.content.replace(/&/g, '&amp;')
              .replace(/>/g, '&gt;')
              .replace(/</g, '&lt;');
            var htmlText = converter.makeHtml(text);
            element.html(htmlText);
            // For whatever reason, this fixes chrome. I don't like it, I think
            // it makes things slow?
            if(!scope.$$phase) {
              scope.$apply();
            }
          });
        }

        render_panel();
      }
    };
  });

  module.filter('newlines', function(){
    return function (input) {
      if(input) {
        return input.replace(/\n/g, '<br/>');
      }
    };
  });

  module.filter('striphtml', function () {
    return function(text) {
      if(text) {
        return text.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;');
      }
    };
  });
});
