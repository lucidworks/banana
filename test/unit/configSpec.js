'use strict';

// config.js is not bundled: Karma loads it as a plain script, as index.html does, and the 'config'
// module hands its settings to the bundled code.
describe('config', function () {
  var config = require('config');

  it('has the Fusion defaults that config.js ships with', function () {
    expect(config.USE_FUSION).toBe(true);
    expect(config.solr).toBe('/api/query-pipelines/_system/collections/');
    expect(config.SYSTEM_BANANA_BLOB_API).toBe('/api/blobs');
  });

  it('keeps the 1.6.30 login redirect and session lookup unless told otherwise', function () {
    expect(config.FUSION_LOGIN_URL).toBe('../login');
    expect(config.FUSION_SESSION_API).toBe('/api/session');
  });

  it('lists the panels the application can load', function () {
    expect(config.panel_names).toContain('histogram');
    expect(config.panel_names).toContain('table');
  });
});
