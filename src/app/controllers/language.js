define([
        'angular',

        'underscore'
    ],
    function (angular, _) {
        'use strict';

        var module = angular.module('kibana.controllers');

        module.controller('LanguageSwitchingCtrl', ['$scope', '$translate', function (scope, $translate) {
            scope.switching = function(lang){
                $translate.use(lang);
                window.localStorage.lang = lang;
                window.location.reload();
            };
            scope.cur_lang = $translate.use();
        }]);

    });