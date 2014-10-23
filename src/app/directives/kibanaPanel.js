define([
  'angular'
],
function (angular) {
  'use strict';

  angular
    .module('kibana.directives')
    .directive('kibanaPanel', function($compile) {
      var container = '<div class="panelCont"></div>';

      var editorTemplate =

        '<div class="row-fluid panel-extra"><div class="panel-extra-container">' +

          '<span class="extra row-button" ng-hide="panel.draggable == false">' +
            '<span class="row-text pointer" bs-tooltip="\'Drag here to move\'"' +
            'data-drag=true data-jqyoui-options="{revert: \'invalid\',helper:\'clone\'}"'+
            ' jqyoui-draggable="'+
            '{'+
              'animate:false,'+
              'mutate:false,'+
              'index:{{$index}},'+
              'onStart:\'panelMoveStart\','+
              'onStop:\'panelMoveStop\''+
              '}"  ng-model="row.panels">{{panel.type}}</span>'+
          '</span>' +
          '<span class="extra row-button" ng-show="panel.draggable == false">' +
            '<span class="row-text">{{panel.type}}</span>'+
          '</span>' +

          '<span class="extra row-button" ng-show="panel.editable != false">' +
            '<span confirm-click="row.panels = _.without(row.panels,panel)" '+
            'confirmation="Are you sure you want to remove this {{panel.type}} panel?" class="pointer">'+
            '<i class="icon-remove pointer" bs-tooltip="\'Remove\'"></i></span>'+
          '</span>' +

          '<span class="row-button extra" ng-show="panel.editable != false">' +
            '<span bs-modal="\'app/partials/paneleditor.html\'" class="pointer">'+
            '<i class="icon-cog pointer" bs-tooltip="\'Configure\'"></i></span>'+
          '</span>' +

          '<span class="row-button extra" ng-show="panel.transpose_show">' +
          '<span class="rotate-icon pointer" bs-tooltip="\'Transpose Rows and Columns\'" ng-click="flip()"></span>' +
          '</span>' +

          '<span ng-repeat="task in panelMeta.modals" class="row-button extra" ng-show="panel.spyable">' +
            '<span bs-modal="task.partial"class="pointer"><i ' +
              'bs-tooltip="task.description" ng-class="task.icon" class="pointer"></i></span>'+
          '</span>' +

          '<span class="dropdown row-button extra" bs-tooltip="\'Export\'" data-placement="bottom" ng-show="panelMeta.exportfile">' +
            '<span class="pointer" class="dropdown-toggle" data-toggle="dropdown">' +
                '<i class="icon-save" class="pointer"></i>' +
            '</span>' +
            '<ul class="dropdown-menu" style="padding:10px; left:-150px;">' +
          '<h5>Number of Rows</h5><form><input type="number" value="panel.exportSize" ng-model="panel.exportSize" placeholder="{{panel.size * panel.pages}}"/>' +
          '<input type="checkbox" ng-model="panel.exportAll"/> All Fields <tip>If this option is checked, all fields in the Solr schema will be exported. Otherwise, only the fields that you have selected to appear in your Table view will be exported</tip></form>' +
                '<li>' +
                    '<h5>Export to File</h5>' +
                        '<ul class="unstyled">' +
                            '<li><a class="link" ng-click="exportfile(\'csv\')"><i class="icon-file"></i> CSV</a></li>' +
                            '<li><a class="link" ng-click="exportfile(\'xml\')"><i class="icon-file"></i> XML</a></li>' +
                            '<li><a class="link" ng-click="exportfile(\'json\')"><i class="icon-file"></i> JSON</a></li>' +
                        '</ul>' +
                '</li>' +
            '</ul>' +
          '</span>' +

//          '<span ng-repeat="dropdown in panelMeta.dropdowns" class="row-button extra">' +
//            '<span class="dropdown" data-placement="bottom" bs-tooltip="dropdown.description"><a href="#" class="dropdown-toggle" data-toggle="dropdown" bs-dropdown="dropdown.list"><i ' +
//              'ng-class="dropdown.icon" class="pointer"></i></a></span>'+
//          '</span>' +

          '<span class="row-button extra" ng-show="panelMeta.loading == true">' +
            '<span>'+
              '<i class="icon-spinner smaller icon-spin icon-large"></i>' +
            '</span>'+
          '</span>' +

          '<span class="row-button row-text panel-title" ng-show="panel.title">' +
            '{{panel.title}}' +
          '</span>'+

        '</div></div>';
      return {
        restrict: 'E',
        link: function($scope, elem, attr) {
          // once we have the template, scan it for controllers and
          // load the module.js if we have any

          // compile the module and uncloack. We're done
          function loadModule($module) {
            $module.appendTo(elem);
            elem.wrap(container);
            /* jshint indent:false */
            $compile(elem.contents())($scope);
            elem.removeClass("ng-cloak");
          }

          $scope.$watch(attr.type, function (name) {
            elem.addClass("ng-cloak");
            // load the panels module file, then render it in the dom.
            $scope.require([
              'jquery',
              'text!panels/'+name+'/module.html'
            ], function ($, moduleTemplate) {
              var $module = $(moduleTemplate);
              // top level controllers
              var $controllers = $module.filter('ngcontroller, [ng-controller], .ng-controller');
              // add child controllers
              $controllers = $controllers.add($module.find('ngcontroller, [ng-controller], .ng-controller'));

              if ($controllers.length) {
                $controllers.first().prepend(editorTemplate);
                $scope.require([
                  'panels/'+name+'/module'
                ], function() {
                  loadModule($module);
                });
              } else {
                loadModule($module);
              }
            });
          });
        }
      };
    });

});
