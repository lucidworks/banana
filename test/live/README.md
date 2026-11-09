# Live tests

Live tests run Banana against a real Fusion instance. The instance is usually shared, so the tests may only create dashboards under ids of the form `banana-it-<identity>-<n>` and may only delete the ones the same process created. A guarded client enforces that; see `docs/adr/0008-guarded-live-test-client.md` for the design and the reasons.

## Running

```
export BANANA_LIVE_FUSION_URL=https://<your fusion host>
export BANANA_LIVE_REGISTRY_DIR=/absolute/path/to/an/existing/ignored/directory
export FUSION_USER=<user>
export FUSION_PASSWORD=<password>
export BANANA_LIVE_BANANA_DIR=/path/to/a/built/dist   # default: ./dist
npx playwright install chromium
npm run test:live
```

`npm run test:live` checks the sources of the live tests, starts a proxy container (Docker is needed) in front of the instance, serves Banana from `BANANA_LIVE_BANANA_DIR` under `/admin/banana/`, and runs Playwright. The registry directory must exist and must be outside every git work tree, or inside one but ignored and untracked.

`BANANA_LIVE_TRACE_FILE` (optional) names a file that receives one JSON line per request: who sent it, the method, the path, the names of the query parameters, the content type, the verdict and the status. It holds no host, no header, no body and no credential.

## What the smoke test checks

`smoke.spec.js` opens `banana-it-dashboard.json`, a dashboard with one panel of each panel type the build offers on the `banana-it-logs` collection (240 generated documents; see `npm run fusion-it-setup`), and requires each data panel to show something only the data produces (coloured map regions, values on the time series axis, graph nodes, a numeric ticker percentage, facet counts, table rows and so on) and the page to log no console errors. The five control panels (column, time picker, query, filtering, text) are checked for structure only. It then saves, reopens and deletes a dashboard through Banana's own screens and checks every step with an independent read. See `docs/adr/0012-live-smoke-test.md`.

Playwright's error artefacts are off for live runs (no failure page snapshot, trace, screenshot or video), because a failed login could otherwise leave the typed credentials in a file. The runner's output goes to a temporary directory outside the repository, which the launcher removes after the run. `docs/adr/0012-live-smoke-test.md` has the reasons.

## Rules for specs

- Import `test` and `expect` from `./fusion-client`, and use the `page` and `live` fixtures. Do not import from `@playwright/test` or `playwright`, do not create contexts or browsers, and do not send requests yourself. `npm run test:live:check` lists what the check refuses.
- Take every id from `live.allocate()` and use it as the dashboard title.
- Log in with `live.loginBrowser(page)` before opening Banana.

## After a crash

A crash can leave `banana-it-*` blobs on the instance. No later run deletes them. List them with:

```
npm run test:live:orphans -- --run <run tag>
```

The run tag is printed when `npm run test:live` ends, and is the first part of the registry file name.

## Tests of the client itself

- `npm run test:node` runs the unit tests (`test/node/live/`). They need no Fusion.
- `npm run test:live-local` runs the tests that need a browser or the Playwright test runner (`test/live-local/`) against local servers. They need Chromium for the pinned Playwright version (`npx playwright install chromium`).
