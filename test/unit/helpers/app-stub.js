'use strict';

// Stands in for app.js in the unit tests: panels call app.useModule(module) when they load.
module.exports = {
  useModule: function (module) { return module; }
};
