# 13. Commit a public-registry lockfile, pin the Node.js range, and fix the audit findings that can be fixed

Date: 2026-11-06

Status: Accepted

## Context

`package-lock.json` was listed in `.gitignore`, so every install resolved the version ranges in `package.json` afresh and two builds of the same commit could differ. The only lockfile ever published for this project (in the 1.6.30 release) is an npm 1 file that no longer matches its own `package.json`, so `npm ci` rejects it.

The developer machines this project is built on often have a user-level npm configuration that points at a private registry mirror and sets `legacy-peer-deps=true`. A lockfile generated there would embed the mirror's URLs in every `resolved` field, and the legacy peer-dependency setting changes which versions npm picks for peers and which optional peers it installs (for this project a lockfile generated with it differs from one generated with the npm default, because a transitive dependency is placed in a different directory). Contributors who do not have that setting would then see `npm install` rewrite the lockfile.

The build needs a recent Node.js: Babel 8 declares `^22.18.0 || >=24.11.0` and the dev server (`http-proxy-middleware` 4) declares `^22.15.0 || ^24.0.0 || >=26.0.0`. The release of Banana that Fusion 5.9 ships pinned Node.js 8.1.4 with `engine-strict`, which stopped anyone on another Node.js from installing.

`npm audit` on the previous dependency set reported critical findings in `http-server` 0.11 (through `optimist` and `minimist`) and a moderate one in `ecstatic`. All of it is development tooling: the package has no runtime `dependencies`, and none of it reaches the browser.

## Options considered

1. **Keep ignoring the lockfile.** Rejected: builds stay irreproducible.
2. **Commit a lockfile generated with the user-level npm configuration as it was.** Rejected: it carries private mirror URLs and peer resolution that other users do not get.
3. **Generate with `legacy-peer-deps=false` and rely on contributors' own settings.** Works for `npm ci` (checked with the setting both on and off), but a contributor with the legacy setting who runs `npm update` or regenerates the lockfile would still churn it. Rejected as the only measure.
4. **Generate with `legacy-peer-deps=false` and also commit a project `.npmrc` that sets it.** Chosen. The project file overrides the user-level one, so every install in this directory resolves peers the same way. The `.npmrc` sets no registry: a registry belongs to the machine, and the lockfile check (below) is what keeps mirror URLs out of the file.
5. **`engines.node` of `>=22`.** Rejected: Node 22 releases before 22.18 cannot run the build, so the range would promise something that fails. The accurate range is used instead.
6. **`engine-strict=true`.** Rejected: it turns the range into a hard install failure, which is what hurt with Node.js 8. Without it npm prints a warning on an unsupported Node.js, and on Node.js 20 the build then stops with Node's `ERR_REQUIRE_ESM` error when `babel-loader` loads `@babel/core`.
7. **Upgrade `http-server` or drop it.** `http-server` only serves `dist/` for `npm start`. Upgrading to 14 keeps the same command line (`-a`, `-p`) and clears the critical findings. Chosen over removing it, which would change `npm start`.

## Decision

- `package-lock.json` (lockfile version 3) is committed and no longer ignored. It was generated from an empty `node_modules` with the public registry and `legacy-peer-deps=false`.
- A project `.npmrc` sets `legacy-peer-deps=false`. `npm ci` was run on Node.js 22 with the user-level setting both true and false and exited 0 in both cases.
- `tools/check-lockfile.js` fails if any package in the lockfile has a `resolved` URL outside `https://registry.npmjs.org/` or no `integrity`, or if the lockfile's root dependencies differ from `package.json`. It is run by `npm run check:lockfile` and by a test in `test/node/lockfile.test.js`, which also covers the check failing on bad input.
- `engines.node` is `^22.18.0 || ^24.11.0 || >=26.0.0` (the intersection of what Babel 8 and the dev server support, so Node.js 25 is excluded) and `.nvmrc` holds `lts/jod`, the 22 line. `engine-strict` is not set.
- `playwright` and `@playwright/test` stay pinned to exactly 1.65.0, and `karma-webpack` is pinned to exactly 5.0.0.
- `http-server` moves to `^14.1.1`.
- README and CONTRIBUTING tell people to run `npm ci` on a fresh clone.

## Consequences

- `npm audit --omit=optional` now reports no vulnerabilities. `karma-webpack` is pinned to exactly 5.0.0 because 5.0.1 pulls in a `minimatch` release with a moderate advisory (GHSA-g3hv-75wg-m249, denial of service through glob patterns with many globstars). 5.0.0 also supports webpack 5 and uses `minimatch` 3. Moving to a newer `karma-webpack` needs a fresh audit.
- Changing a dependency now means committing the updated lockfile. A contributor whose npm is configured for a private mirror must make sure the new entries are rewritten to the public registry before committing; the check fails otherwise.
- Contributors on an older Node.js get an npm warning rather than a refusal.
- `npm start` no longer runs `npm install` first (1.6.30's `prestart` did). An install inside `npm start` could rewrite the committed lockfile; installing is now the explicit `npm ci` step, and `prestart` only checks that `dist/` has been built.
