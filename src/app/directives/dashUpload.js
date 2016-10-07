define([
    'angular'
  ],
  function(angular) {
    'use strict';

    var module = angular.module('kibana.directives');

    module.directive('dashUpload', function(timer, dashboard, alertSrv) {
      return {
        restrict: 'A',
        link: function(scope) {
          function file_selected(evt) {
            var files = evt.target.files; // FileList object
            var readerOnload = function() {
              return function(e) {
                try {
                  dashboard.dash_load(JSON.parse(e.target.result));
                  scope.$apply();
                } catch (err) {
                  alertSrv.set('Loading Error', 'The file isn\'t valid JSON file', 'error',5000);
                  dashboard.refresh();
                }
              };
            };
            for (var i = 0, f; f = files[i]; i++) {
              var reader = new FileReader();
              reader.onload = (readerOnload)(f);
              reader.readAsText(f);
            }
            document.getElementById('dashupload').value = "";
          }
          // Check for the various File API support.
          if (window.File && window.FileReader && window.FileList && window.Blob) {
            // Something
            document.getElementById('dashupload').addEventListener('change', file_selected, false);
          } else {
            alertSrv.set('Oops', 'Sorry, the HTML5 File APIs are not fully supported in this browser.', 'error');
          }
        }
      };
    });
  });