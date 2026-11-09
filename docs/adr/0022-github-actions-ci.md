# 0022. Continuous integration on GitHub Actions

Date: 2026-11-06
Status: Accepted

## Context

The only CI configuration was `.travis.yml`, which targeted Node.js 6, npm 2, PhantomJS and Bower and ran a placeholder spec; it no longer matched any part of the build. The `release` branch (tip `b3ff48dc`) has a CodeQL workflow, `.github/workflows/codeql-analysis.yml`, pinned to `codeql-action@v1` and `actions/checkout@v2`; the branch this work is based on has no `.github/` directory. The project now has a committed lockfile, a webpack build, Karma unit tests in headless Chromium, Node-based tooling tests, a local live-test harness and a browser smoke check. Pull requests need one automatic place to run all of them.

## Options considered

- **Keep Travis CI.** Rejected: the file is for a toolchain the project no longer uses, and the repository's checks live on GitHub.
- **Pin every action to a full commit SHA.** Stronger against a moved tag. Rejected for now: the SHAs could not be looked up or verified when this was written, and a hand-typed SHA is worse than a tag. Dependabot's `github-actions` ecosystem is enabled, which proposes updates (and, once a SHA is pinned, keeps it current), so moving to SHAs later is a small change.
- **Run the live suites against a real Fusion in CI.** Rejected: they need credentials and a shared system, and workflows must never reference secrets. They stay manual.
- **Run only Node.js 22.** Rejected: `engines` allows 22.18+, 24.11+ and 26+, so the matrix tests the 22, 24 and 26 lines. Node.js 26 is also allowed and has been a long-term support line since October 2026, so the matrix tests it too.

## Decision

- `.github/workflows/ci.yml` runs on pull requests, on pushes to `release`, and on demand, on Node.js `22.x`, `24.x` and `26.x` (the newest release of each line satisfies `engines`). Steps: `npm ci`, install Chromium with `npx playwright install --with-deps chromium`, `npm run check:lockfile`, `npm run build`, `npm test`, `npm run test:node`, `npm run test:live:check`, `npm run test:live-local`, `npm run smoke`. `CI=true` makes the Karma configuration start Chromium with `--no-sandbox`. (Update, 2026-11-07: two more jobs were added. "Detect rendering changes" lists the files a pull request changes, and "Hostile-content check" runs `npm run test:hostile` after a build on Node.js 22.x only when those files include `src/`, `tools/hostile.js`, `tools/lib/`, `tools/webpack/`, `webpack.config.js`, `package.json`, `package-lock.json` or `ci.yml`, when the detection job fails or cannot decide, and always on pushes and manual runs. Pushes run it every time because they normally come only from merged pull requests into `release`, nobody waits for that run, and a missed check there would go unnoticed. The choice is made in jobs and not with a workflow-level `paths` filter, so every pull request still gets a complete set of checks and a skipped job reports as passing.)
- Update, 2026-11-09: the single "Hostile-content check" job was cancelled at its 90-minute limit on a hosted runner (the markup style passed after about 50 minutes; the url style did not finish). It is replaced by two jobs, not a matrix, so that each has its own name and its own limit: "Hostile-content check (markup)" runs `node tools/hostile.js --styles markup` and "Hostile-content check (url)" runs `node tools/hostile.js --styles url`. Both run after `npm run build` on Node.js 22.x, have a 75-minute limit, and use the same condition as before (they run unless the detection job decided `false`). Those two names are the ones a branch-protection rule would require; the old name "Hostile-content check" no longer exists, so a rule that required it must be changed.
- `test:live-local` is included: it runs the Playwright runner against servers started on the runner itself, and needs no Docker, no Fusion and no secrets. `test:live:check` only checks the live-test sources. `test:live` and `test:live:orphans` are not run.
- Actions are pinned to major-version tags (`actions/checkout@v4`, `actions/setup-node@v4`, `github/codeql-action/*@v3`). Checkout does not persist credentials.
- Each workflow sets `permissions: contents: read`; only the CodeQL job adds `security-events: write`.
- `.github/workflows/codeql-analysis.yml` runs CodeQL for JavaScript on pull requests, pushes to `release` and weekly. It has the same file name as the old workflow on `release` on purpose, so that merging into `release` replaces the old file instead of leaving two. **Whoever merges into `release` will get an add/add conflict on this file: take the new content.** `.github/codeql/codeql-config.yml` excludes the vendored third-party files listed in `tools/vendor-licenses.json` (`src/vendor`, the bundled d3, leaflet, jVectorMap, showdown and map data files) from analysis, because findings there are not fixable here.
- `.github/dependabot.yml` covers npm in `/`, npm in `/tools/maps` (the separate map-data tooling) and GitHub Actions.
- The Docker-based proxy tests in `npm run test:node` skip themselves unless the `nginx:alpine` image is already present, and the CI workflow does not pull it, to keep CI simple. They run on a machine that has pulled the image (`docker pull nginx:alpine`). The tests of Banana's own image (`test/node/image`) skip unless the image `banana-hosting:dev` (or the one named by `BANANA_IMAGE`) exists, and CI does not build it either ([ADR 0023](0023-docker-image.md)).
- A check that recorded Fusion fixtures contain no host names, cookies, tokens or user ids belongs in CI once fixtures exist. No fixtures were recorded and no such script existed when this was written, so `ci.yml` held a marked placeholder comment and no step. (Update, 2026-11-07: fixtures are recorded and `tools/fixtures/check.js` runs inside `npm run test:node`, which the workflow already runs, so the check runs in CI without its own step, [ADR 0025](0025-service-tests-on-recorded-responses.md). The placeholder comment in `ci.yml` is out of date.)
- `.travis.yml` is removed and the README badge points at the new workflow.

## Consequences

- The workflows were checked with `actionlint` and every command was run locally in the same order, but they have not run on GitHub. The first run on a pull request is the real confirmation.
- The unit-level tooling tests read their 1.6.30 reference data from committed fixtures (`test/node/fixtures`), not from git history, because the test job checks out only one commit.
- Tags can move; the risk is accepted until SHA pinning is adopted.
- `npx playwright install --with-deps` uses `sudo apt-get` on the runner and downloads from the Playwright CDN, so CI needs network access to both.
