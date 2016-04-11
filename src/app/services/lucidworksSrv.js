define([
    'angular',
    'underscore'
],
function (angular, _) {
    'use strict';

    var module = angular.module('kibana.services');

    module.service('lucidworksSrv', function($http) {
        var self = this;

        self.fusionHost = 'http://localhost:8764';
        self.fusionSessionApi = self.fusionHost + '/api/session';

        self.getFusionUsername = function () {
            return $http.get(this.fusionSessionApi).then(function(sessionResponse) {

                return sessionResponse.data.user.username;
            }, function(error) {
                console.log('ERROR: Cannot get response from Fusion Session API.', error);
            });
        }
    });
});
