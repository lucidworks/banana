'use strict';

// The one entry point that Karma bundles: every *Spec.js file under test/unit.
// A focused spec (fdescribe/fit) would silently skip every other spec, so it fails the run instead.
['fdescribe', 'fit'].forEach(function (name) {
  window[name] = function () { throw new Error(name + ' left in a spec: use ' + name.slice(1) + ' instead'); };
});

var context = require.context('./', true, /Spec\.js$/);
context.keys().forEach(context);
