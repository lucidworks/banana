exports.config = {
  // allScriptsTimeout: 11000,

  seleniumAddress: 'http://localhost:4444/wd/hub',

  // The URL where the server we are testing is running
  baseUrl: 'http://localhost:8764/banana/',

  capabilities: {
    'browserName': 'chrome'
  },

  specs: [
    'e2e/*Spec.js'
  ],

  framework: 'jasmine',

  jasmineNodeOpts: {
    // defaultTimeoutInterval: 30000
    showColors: true
  }
};
