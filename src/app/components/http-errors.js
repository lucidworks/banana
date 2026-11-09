/**
 * Response interceptor for $http (AngularJS 1.0.x `responseInterceptors`).
 *
 * - A 401 sends the browser to the login page, with the current location as the return address, as
 *   before. The promise then resolves with no value, as it did in 1.6.30, because the page is leaving.
 * - Every other error is passed on as a rejection, so that the code that made the request (the
 *   `.error()` and `.then(ok, failed)` handlers) learns that it failed.
 */
define(['config'], function (config) {
  'use strict';

  function httpErrors($q, $window) {
    return function (promise) {
      return promise.then(
        function (response) {
          return response;
        },
        function (err) {
          if (err && err.status === 401) {
            // Send in the current location for a post login redirect
            // -- the "return" param.
            // The login page comes from the FUSION_LOGIN_URL setting. Its default is a relative path
            // (login is 1 level up from where Banana is served), because the root path is not known.
            var query = $window.location.search,
              hash = $window.location.hash,
              goto = config.FUSION_LOGIN_URL + '?return=' + $window.location.pathname;
            goto += (hash ? hash : "");
            goto += (query ? "?" + encodeURIComponent(query) : "");
            goto = goto.replace(/#/g, '%23');
            $window.location = goto;
            return;
          }
          return $q.reject(err);
        }
      );
    };
  }
  httpErrors.$inject = ['$q', '$window'];

  return httpErrors;
});
