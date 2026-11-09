# 10. Run the unit tests with Karma, Jasmine and headless Chromium, loaded through the webpack build

Date: 2026-11-06

Status: Accepted

## Context

The test setup that came with the repository could not fail. `test/karma.conf.js` loaded only `dummySpec.js` (`expect(true).toBeTruthy()`), through RequireJS files that no longer exist. The other specs were never run: `directivesSpec`, `filtersSpec` and `servicesSpec` were left over from the AngularJS seed project and tested modules called `myApp.*` that do not exist in Banana, and `controllersSpec` and `tableSpec` targeted Banana's table panel but were not in the Karma file list. Karma 0.12 does not start on a current Node.js (it reads `process.EventEmitter`, which was removed), so `npm test` exited with an error before it ran anything. The end-to-end suite in `test/e2e`, run by protractor and Selenium, was a Banana suite from 2016: it logged in through an old Fusion login page and drove the dashboard, time picker, search box and histogram at a fixed local address and port. It cannot run against a current Fusion without being rewritten, and the live browser test in `test/live` (see ADR 8) now covers that ground.

The tests need to load Banana's real modules the way the application does. Since the move to webpack (see ADR 9), that means module ids such as `kbn` and `services/all`, the shims for plain vendored scripts, the annotation step that AngularJS 1.0.8 needs, and the `config` module that reads `config.js`. AngularJS stays at 1.0.8.

## Options considered

1. **Vitest with jsdom (or Vitest browser mode).** Fast and well maintained. Rejected: Vitest is built on Vite, so it would resolve modules with a second bundler. The point of the tests is to load code the way the production build does, and ADR 9 chose webpack and rejected Vite for this code base because of AMD, sloppy-mode vendored scripts and shims. jsdom is also not a browser; the vendored libraries (jQuery, flot, Leaflet) behave differently in it.
2. **Jest.** Rejected for the same reason: it has its own module system and transform pipeline, and would need a third description of the aliases and shims.
3. **A small custom runner that bundles the specs with webpack and drives Playwright.** Faithful to the build. Rejected: it would be new code to maintain (reporting, exit codes, watching), where Karma already does this.
4. **Keep Karma 0.12 and repair it.** Rejected: it does not run on a maintained Node.js.
5. **Karma 6 with `karma-webpack`, Jasmine and ChromeHeadless.** Chosen. Jasmine is the version `karma-jasmine` 5 brings with it (Jasmine 4); the project does not declare its own `jasmine-core`. Karma is deprecated upstream, but it is stable, runs in a real browser and feeds the specs through the project's own webpack configuration. Replacing the runner later only touches `test/karma.conf.js`; the specs do not depend on Karma.

## Decision

- `npm test` runs `karma start test/karma.conf.js --single-run`: headless, one run, exit code 0 when every spec passes and non-zero when a spec fails or the bundle does not compile. `npm run test:watch` keeps the browser open and runs again on a change (`--no-single-run --auto-watch`).
- **Same build.** `test/webpack.test.config.js` takes `resolve` and `module` from `webpack.config.js`, so the aliases, the vendored-script rules, the annotation step and the text and CSS handling are the build's own, not a copy. The one difference is an alias that replaces `app` with `test/unit/helpers/app-stub.js`: panels call `app.useModule(...)` when they load, and the real `app.js` would bootstrap the whole page. It leaves out what only produces `dist/` (entry, output, copying, licence report, dev server). `src/config-boot.js` and `src/config.js` are loaded as plain scripts before the bundle, as `index.html` does, so the `config` module is the production bridge.
- **One entry.** `test/unit/index.js` bundles every `*Spec.js` file under `test/unit`. A new spec needs no registration. It also replaces `fdescribe` and `fit` with functions that throw, so a focused spec left in by mistake fails the run instead of silently skipping the rest of the suite.
- **Real modules, no application bootstrap.** The helper `test/unit/helpers/injector.js` creates the `kibana.services`, `kibana.filters` and `kibana.controllers` modules as `app.js` does, loads the real `services/all`, `filters/all` and the `dash` and `dashLoader` controllers, and builds an AngularJS injector. It does not load `app.js`, which bootstraps the whole page on load. A spec replaces what it must (for example `dashboard`) with `$provide.value`.
- **angular-mocks.** The vendored file is 1.0.8, as AngularJS. Its `module()` and `inject()` helpers only work with Jasmine 1.x, so specs use the `ngMock` module (the mock `$httpBackend` and `$browser`) through an injector instead. The helper hides the global `jasmine` while the file loads, so that it does not register a hook that current Jasmine cannot run. `angular-mocks` has a test-only alias and shim entry (ADR 9 noted that the build itself has no use for one). The alias and shim live in `webpack.config.js`; no application module requires it, and it is listed as not shipped, so it is not in `dist/`.
- **The browser.** `test/karma.conf.js` uses `CHROME_BIN` if it is set; otherwise the Chromium that Playwright installed (`npx playwright install chromium`; `PLAYWRIGHT_BROWSERS_PATH` chooses where it lives, and the smoke check uses the same one); otherwise a Chrome or Chromium on the machine. A fresh clone runs `npm install` and, once, `npx playwright install chromium`. Setting `CI` adds `--no-sandbox` for containers.
- **Starter specs** are real checks of real code: `config` (the shipped defaults reach the bundle), `kbn` (interval parsing, escaping, flattening), `filters` (`noXml`, `slice`, `stringify`, `urlLink`), `querySrv` (adding, removing, encoding, selection by mode) and `filterSrv` (adding, duplicates, `fq` building).
- **`test:node` stays separate.** `npm run test:node` runs the Node-side checks (build checks, configuration, scripts) with Node's own runner. They test tools and files and need no browser, so they are quick to run alone and are not part of the browser run.
- **`pretest` removed.** 1.6.30 ran `npm install` before every `npm test`. That made the test command slow, made it need the network, and could change `node_modules` during a test run. Install is now an explicit step before the tests.
- **Removed.** The seed specs (`controllersSpec`, `directivesSpec`, `filtersSpec`, `servicesSpec`, `tableSpec`, `dummySpec`), `test/test-main.js`, `test/karma.conf.js.orig`, the protractor configuration and `test/e2e`, and the `test-single-run` and webdriver scripts. The dependencies `karma-firefox-launcher`, `karma-junit-reporter`, `karma-requirejs`, `protractor`, `shelljs` and `tmp` are removed; nothing in the repository used them.

## Consequences

- A failing assertion, a throwing module or a build error in the test bundle makes `npm test` exit non-zero. This was checked by inverting one assertion in a scratch copy.
- The specs run in a real browser engine against the real vendored libraries, so a change to an alias or shim in `webpack.config.js` that breaks a module shows up in the tests as well as in the build.
- The services that call Fusion or Solr over HTTP (`dashboard`, `solrSrv`, `fields`, `kbnIndex`, `lucidworksSrv`) are loaded, but not yet tested. The mock `$httpBackend` is available for that. (Update, 2026-11-07: they are tested now, on responses recorded from Fusion 5.9.16, [ADR 0025](0025-service-tests-on-recorded-responses.md).)
- The specs run against synthetic data. They show the code works as written, not how a Fusion or Solr server answers.
- Karma is deprecated by its maintainers. The cost of moving to another browser runner is limited to `test/karma.conf.js` and the reporter output.
- The test run needs a Chromium. It takes one `npx playwright install chromium` on a new machine.
- The old `.travis.yml` was replaced by GitHub Actions workflows (see the CI decision record).
