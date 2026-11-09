// Loaded before config.js. config.js calls define(['settings'], factory); capture the factory
// so the bundled application can run it once the Settings class is available.
window.define = function (deps, factory) { window.__bananaConfigFactory = factory; };
window.define.__bananaStub = true;
