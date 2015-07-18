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

        '<div class="panel-extra row"><div class="panel-extra-container col-md-12 col-xs-12">' +

          '<span class="extra row-button" ng-hide="panel.draggable == false || readonly"  bs-tooltip data-trigger="hover" container="body" data-placement="top" data-title="Drag&nbsp;here&nbsp;to&nbsp;move">' +
            '<span class="row-text pointer"' +
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
          '<span class="extra row-button" ng-show="panel.draggable == false && !readonly">' +
            '<span class="row-text">{{panel.type}}</span>'+
          '</span>' +

          '<span class="extra row-button" ng-show="panel.editable != false && !readonly">' +
            '<span confirm-click="row.panels = _.without(row.panels,panel)" '+
            'confirmation="Are you sure you want to remove this {{panel.type}} panel?" class="pointer">'+
            '<i class="fa fa-times pointer" bs-tooltip data-title="Remove" container="body" ></i></span>'+
          '</span>' +

          '<span class="row-button extra" ng-show="panel.editable != false && !readonly">' +
            '<span bs-modal data-content-template="app/partials/paneleditor.html" class="pointer">'+
            '<i class="fa fa-cog pointer" bs-tooltip data-title="Configure" container="body" ></i></span>'+
          '</span>' +

          '<span class="row-button extra" ng-show="panel.transpose_show && !readonly">' +
          '<span class="rotate-icon pointer" bs-tooltip data-title="Transpose Rows and Columns" ng-click="flip()" container="body" ></span>' +
          '</span>' +

          '<span ng-repeat="task in panelMeta.modals" class="row-button extra" ng-show="task.show && panel.spyable && !readonly">' +
            '<span bs-modal data-content-template="{{task.partial}}" class="pointer"><i ' +
              'class="fa fa-info-circle pointer" bs-tooltip data-title="{{task.description}}" container="body" ></i></span>'+
          '</span>' +

          '<span class="dropdown row-button extra" container="body"  bs-tooltip data-title="Export" data-placement="bottom" ng-show="panelMeta.exportfile">' +
            '<span class="pointer" class="dropdown-toggle" data-toggle="dropdown">' +
                '<i class="fa fa-save" class="pointer"></i>' +
            '</span>' +
            '<ul class="dropdown-menu" style="padding:10px; left:-150px;">' +
          '<h5>Number of Rows</h5><form><input type="number" value="panel.exportSize" ng-model="panel.exportSize" placeholder="{{panel.size * panel.pages}}"/>' +
          '<input type="checkbox" ng-model="panel.exportAll"/> All Fields <tip>If this option is checked, all fields in the Solr schema will be exported. Otherwise, only the fields that you have selected to appear in your Table view will be exported</tip></form>' +
                '<li>' +
                    '<h5>Export to File</h5>' +
                        '<ul class="unstyled">' +
                            '<li><a class="link" ng-click="exportfile(\'csv\')"><i class="fa fa-file"></i> CSV</a></li>' +
                            '<li><a class="link" ng-click="exportfile(\'xml\')"><i class="fa fa-file"></i> XML</a></li>' +
                            '<li><a class="link" ng-click="exportfile(\'json\')"><i class="fa fa-file"></i> JSON</a></li>' +
                        '</ul>' +
                '</li>' +
            '</ul>' +
          '</span>' +

          '<span class="row-button extra" ng-show="panelMeta.loading == true">' +
            '<span>'+
              '<i class="fa fa-spinner fa-3"></i>' +
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
