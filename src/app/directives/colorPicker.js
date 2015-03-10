define([
  'angular',
  'app',
  'underscore',
  'chroma'
],
   function (angular, app, _, chroma) {
    'use strict';

    angular
      .module('kibana.directives')
      .directive('colorPicker', function () {
        return {
          templateUrl: 'app/partials/colorpicker.html',
          restrict: 'A',
          scope: {
            colors: '=colorPicker',
            palette: '=',
            defaultColors: '=',
            field: '=',
            data: '=',
            mode: '='
          },
          link: function ($scope) {

            function init() {
              // List of values with associated color
              if (!$scope.palette) {
                $scope.palette = [];
              }
              $scope.paletteValueFoundInData = true;
              $scope.mode = $scope.mode || 'list';
              $scope.brewer = chroma.brewer;
              $scope.nbOfClasses = $scope.data.length || 6;
            }


            $scope.addValue = function () {
              $scope.palette.push({
                label: 'value' + $scope.palette.length,
                color: '#FFFFFF'
              });
            };
            $scope.addValuesFromIndex = function () {
              angular.forEach($scope.data, function (item) {
                $scope.palette.push({label: item.label, color: '#FFFFFF'});
                item.color = '#FFFFFF';
              });
            };


            $scope.removeValue = function (index) {
              $scope.palette.splice(index, 1);
            };
            $scope.removeAllValues = function () {
              $scope.palette = [];
            };


            // Restore to default color palette
            // (define as directive attribute)
            $scope.setDefault = function () {
              $scope.colors = $scope.defaultColors;
            };

            function getColor(label) {
              var i, item;
              for (i = 0; i < $scope.palette.length; i + 1) {
                item = $scope.palette[i];
                if (item.label === label) {
                  return item.color;
                }
              }
              return null;
            }


            // Add or delete color property to data items
            // based on the palette.
            $scope.updateDataColors = function () {
              var paletteValueFoundInData = false, i, item, color;
              for (i = 0; i < $scope.data.length; i + 1) {
                item = $scope.data[i];
                color = getColor(item.label);
                if (color === null) {
                  delete item.color;
                } else {
                  item.color = color;
                  paletteValueFoundInData = true;
                }
              }
              // Display a warning if the palette describes
              // values not in current dataset
              $scope.paletteValueFoundInData = paletteValueFoundInData;
            };

            // Create a map of label and colors based on
            // the selected palette.
            $scope.createPalette = function (b) {
              var scale = chroma.scale(b).out('hex'), i, item,
                nbOfValues = $scope.palette.length;
              for (i = 0; i < nbOfValues; i + 1) {
                item = $scope.palette[i];
                item.color = scale(1 / nbOfValues * i);
              }
              $scope.updateDataColors();
            };

            // Create an array of colors from the selected palette.
            $scope.createPaletteList = function (b) {
              var colors = [], i,
                scale = chroma.scale(b).out('hex'),
                nbOfValues = $scope.nbOfClasses;
              for (i = 0; i < nbOfValues; i + 1) {
                colors.push('"' + scale(1 / nbOfValues * i) + '"');
              }
              $scope.colors = colors;
              // Reset the label/color map as both can't be defined.
              $scope.palette = [];
            };


            $scope.$watchCollection('palette', $scope.updateDataColors);
            $scope.$watch('palette.color', $scope.updateDataColors);


            init();
          }
        };
      });
  });