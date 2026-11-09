# 6. Fusion defaults, and a Solr preset selected by copying a file

Date: 2026-11-05

Status: Accepted

## Context

The package is named `banana-fusion` and Lucidworks Fusion 5.9 installs it as the admin UI without injecting any configuration. The last release (1.6.30) therefore ships Fusion defaults: `USE_FUSION: true`, the query pipelines API under `/api/query-pipelines/_system/collections/`, the `system_logs` collection, `system_banana` as the internal index, and a default dashboard that points at those.

The unreleased 1.7.0 code had switched `config.js` and `default.json` to standalone-Solr defaults (`USE_FUSION: false`, `/solr/`, `logs`, `banana-int`, collection `collection1`). Under Fusion that sends every query to a path the gateway does not route, and saved dashboards, which live in the Fusion blob store, stop appearing. Standalone Solr users still need working defaults, and Banana is built so that `config.js` can be replaced after the build (it is excluded from bundling and minification).

`settings.js` only copies keys it has a default for, and its fallbacks disagreed with `config.js` (Fusion flag on, but a Solr host and `logs` core). `banana_server` was commented out in `settings.js`, so setting it in `config.js` had no effect.

## Options considered

1. **Keep Solr defaults, document how to switch to Fusion.** Rejected: it breaks every Fusion install on upgrade, and Fusion is the shipped runtime.
2. **A runtime switch inside one `config.js`, for example detecting the URL prefix.** Rejected: it adds logic and guesswork to a file that is meant to be a plain list of values, and makes behaviour hard to predict.
3. **A build-time flag.** Rejected: the preset must be selectable without a rebuild so that a container image can choose it at start.
4. **A second config file next to `config.js`, copied over it by the operator, plus a `default_dashboard` setting naming the default dashboard file.** Chosen.

## Decision

- `src/config.js` and `src/app/dashboards/default.json` reproduce 1.6.30. `default.json` is byte-for-byte the 1.6.30 file.
- `src/config.solr.js` is the Solr preset. It is `config.js` with these values changed: `USE_FUSION: false`, `solr: "/solr/"`, `solr_core: "logs"`, `banana_index: "banana-int"`, `default_dashboard: "default.solr.json"`. `src/app/dashboards/default.solr.json` is the standalone-Solr default dashboard (server `/solr/`, collection `collection1`). To select the preset, copy `config.solr.js` over `config.js`, in `src` or in `dist`, and reload (in a built `dist` the cache-busting tag is fixed at build time, so a hard reload or no-cache headers may be needed). No rebuild is needed in `dist`; since the webpack build (ADR 0009), a change in `src` takes effect only after `npm run build`. A single file copy is easy to do from a container start script.
- New setting `default_dashboard` (default `default.json`) names the file under `app/dashboards` that loads when the URL names no dashboard and the browser holds none. `dashboard.js` uses it in the two places that loaded `default.json`. The default reproduces 1.6.30.
- `config.solr.js` is excluded from minification, like `config.js`, so that its comments survive in `dist`.
- `settings.js` fallbacks now equal the `config.js` values for every key except `panel_names`, which stays empty there and is listed in `config.js`. `banana_server` is copied through when set; it has no default and only matters when `USE_FUSION` is false.
- A Node test (`test/node/default-config.test.js`) holds a snapshot of the 1.6.30 values and checks `config.js`, `default.json`, the preset, and the agreement of `settings.js` with `config.js`.

## Consequences

Differences from 1.6.30 that a user can see:

- `panel_names` also lists `graph`, `significantTerms`, `timeseries`, `sankey` and `force`, the panels added since 1.6.30. They appear in the "add panel" list.
- New optional setting `default_dashboard`; the default is the 1.6.30 behaviour.
- `banana_server` now takes effect when set in `config.js`. In 1.6.30 the key was silently ignored. Anyone who had set it without effect will see it start working.
- The `settings.js` fallbacks used when `config.js` omits a key changed from the 1.6.30 values (`solr` was `http://<current host>:8983/solr/`, `solr_core` was `logs`) to the Fusion values, matching `config.js`. A config file that lists every key is unaffected.
- Comments in `config.js` were corrected (collections come from the collections API, not the cores API; the solr value is a relative path).
- New files: `config.solr.js` and `default.solr.json`.

> Update, 2026-11-07: later records added to the list above. `panel_names` also lists `boxplot` ([ADR 0031](0031-unreleased-panel-features.md)). `config.js`, `config.solr.js` and `settings.js` carry a new optional `allowed_dashboard_servers` ([ADR 0021](0021-dashboard-server-parameter.md)), and `settings.js` has two more defaults, `FUSION_LOGIN_URL` and `FUSION_SESSION_API`, whose values reproduce 1.6.30 ([ADR 0003](0003-standalone-hosting-same-origin-proxy.md), [ADR 0023](0023-docker-image.md)). [docs/defaults.md](../defaults.md) lists every key with its 1.6.30 value.

Differences from the unreleased 1.7.0 code: the shipped defaults are the Fusion ones listed above instead of the Solr ones; `default.json` is the Fusion "Service Logs" dashboard instead of the generic Solr starter dashboard (which is now `default.solr.json`, unchanged); the `settings.js` fallbacks and `banana_server` as described above; and the `default_dashboard` setting.

Standalone Solr users must copy the preset over `config.js` once after installing or upgrading. When `USE_FUSION` is true, `dashboard.js` still forces `banana_index` to `system_banana`; that is existing behaviour and unchanged. The preset does not change Docker or packaging; selecting it at container start is left to the image.
