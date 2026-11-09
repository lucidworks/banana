'use strict';

const { test, expect } = require('../../live/fusion-client');

test('wrapper: every launch, connect and request-context call throws, and the rest works', async ({ playwright }) => {
  const names = ['chromium', 'firefox', 'webkit'];
  for (const name of names) {
    const type = playwright[name];
    expect(type.name()).toBe(name);
    for (const method of ['launch', 'launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP']) {
      let thrown = null;
      try {
        await type[method]('x');
      } catch (e) {
        thrown = e;
      }
      expect(thrown, name + '.' + method).toBeTruthy();
      expect(thrown.message, name + '.' + method).toContain('not available in live tests');
      expect(thrown.message).toContain('guarded');
    }
  }
  for (const member of ['_android', '_electron']) {
    let thrown = null;
    try {
      void playwright[member];
    } catch (e) {
      thrown = e;
    }
    expect(thrown, member).toBeTruthy();
    expect(thrown.message).toContain('not available in live tests');
  }
  let thrown = null;
  try {
    await playwright.request.newContext();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeTruthy();
  expect(thrown.message).toContain('request.newContext');
  // the members the runner's auto fixtures use, and others a spec may use
  expect(playwright._instrumentation).toBeTruthy();
  expect(Array.isArray(playwright._allContexts())).toBe(true);
  expect(playwright.request._contexts instanceof Set).toBe(true);
  const before = playwright._defaultLaunchOptions;
  playwright._defaultLaunchOptions = { marker: 1 };
  expect(playwright._defaultLaunchOptions).toEqual({ marker: 1 });
  playwright._defaultLaunchOptions = before;
  const timeout = playwright._defaultContextTimeout;
  playwright._defaultContextTimeout = 123;
  expect(playwright._defaultContextTimeout).toBe(123);
  playwright._defaultContextTimeout = timeout;
  playwright._defaultContextNavigationTimeout = playwright._defaultContextNavigationTimeout;
  expect(typeof playwright.devices).toBe('object');
  expect(typeof playwright.selectors).toBe('object');
  expect(typeof playwright.errors).toBe('object');
});
