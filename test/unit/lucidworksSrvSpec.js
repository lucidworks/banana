'use strict';

// The session lookup that supplies the dashboard owner's name reads FUSION_SESSION_API. Its default is
// a root-relative path, which is the same URL as the host-and-protocol form Banana 1.6.30 built.
describe('lucidworksSrv session lookup', function () {
  var config = require('config');
  var helpers = require('./helpers/injector');
  var saved;

  beforeEach(function () {
    saved = config.FUSION_SESSION_API;
  });

  afterEach(function () {
    config.FUSION_SESSION_API = saved;
  });

  function userFor(sessionPath) {
    config.FUSION_SESSION_API = sessionPath;
    var injector = helpers.createInjector();
    var $httpBackend = injector.get('$httpBackend');
    var lucidworksSrv = injector.get('lucidworksSrv');
    var name = null;
    $httpBackend.expectGET(sessionPath).respond(200, { user: { username: 'alice' } });
    lucidworksSrv.getFusionUsername().then(function (n) { name = n; });
    $httpBackend.flush();
    $httpBackend.verifyNoOutstandingExpectation();
    return name;
  }

  it('asks /api/session by default', function () {
    expect(config.FUSION_SESSION_API).toBe('/api/session');
    expect(userFor('/api/session')).toBe('alice');
  });

  it('asks the path named by FUSION_SESSION_API', function () {
    expect(userFor('/gateway/api/session')).toBe('alice');
  });
});
