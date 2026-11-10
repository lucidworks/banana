# Contributing to Banana

Thank you for your interest in Banana. Contributions of all sizes are welcome: bug fixes, new panels, documentation and
tests.

## Questions, bugs and ideas

Please use [GitHub Issues](https://github.com/lucidworks/banana/issues). For a larger change, open an issue first and
describe what you would like to do. Someone may already be working on it, and there are often several ways to solve a
problem, so it helps to agree on an approach before you write much code.

Do not report security vulnerabilities in a public issue. See [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository on GitHub.
2. Create a branch from `release` in your fork.
3. Make your change. Keep it focused: one fix or feature per pull request.
4. Add or update tests where it makes sense, and run the project's tests before you open the pull request.
5. Open a pull request against the `release` branch of this repository. Describe what you changed and why, and how you
   tested it. Include sample data or dashboards if they help a reviewer try the change.
6. Automated checks on the pull request must pass. A maintainer will review your pull request and may ask for changes.

## Running the tests

```
npm ci                            # installs the exact versions in package-lock.json
npx playwright install chromium   # once, for the browser the unit tests run in
npm test                          # unit specs in headless Chromium (test/unit)
npm run test:node                 # checks of the build tooling and configuration (test/node)
npm run build                     # builds dist/ and checks it
```

Use Node.js 22.18 or later in the 22 line, 24.11 or later in the 24 line, or 26 or later (`.nvmrc` selects the 22 line, so the installed 22.x must be 22.18 or later). If you change a dependency, run
`npm install` and commit the updated `package-lock.json`; `npm run check:lockfile` (also part of `npm run test:node`) checks that
every entry comes from the public npm registry and has an integrity hash. Do not point the lockfile at a mirror.

The unit specs load Banana's real modules through the same webpack configuration as the build. Add a
`*Spec.js` file under `test/unit` and it is picked up. `npm run test:watch` runs them again when a file changes.
If you already have Chrome or Chromium, set `CHROME_BIN` to it instead of installing a browser.

The specs under `test/unit/recorded` run the services (`dashboard`, `solrSrv`, `kbnIndex`, `fields`, `lucidworksSrv`, `querySrv`,
`filterSrv`) against recorded responses in `test/fixtures`. Each fixture says in `source` whether it was recorded from a Fusion 5.9.16
gateway, recorded through Fusion's Solr proxy, or derived. `npm run test:coverage` runs the same specs and prints coverage for
`src/app/services`. A fixture must pass `node tools/fixtures/check.js`, which `npm run test:node` runs: no host other than localhost,
no cookie or authorization header, no session or user id. If you set `FUSION_URL`, `FUSION_USER`, `FUSION_PASSWORD` and `FUSION_API_KEY`
for the instance you recorded on, it also looks for those values. See `docs/adr/0025-service-tests-on-recorded-responses.md`
before you record anything.

`npm run test:hostile` loads a build in a browser against stubbed responses in which every string a document, the schema or a dashboard can supply is a script payload, uses the page (editors, typeaheads, tooltips, dashboard menu, every panel setting), and fails if any payload ran or reached the markup. Run it after a change to how a panel, a filter or a template writes text into the page, and after `npm run build`, which it needs first. It takes from about 10 minutes to an hour, depending on the machine. CI runs it, on Node.js 22 after a build, in two separate jobs, one per style ("Hostile-content check (markup)" and "Hostile-content check (url)", each running `node tools/hostile.js --styles <style>` with a 75-minute limit, because both styles together did not finish within 90 minutes on a hosted runner), when a pull request changes `src/`, `tools/hostile.js`, `tools/lib/`, `tools/webpack/`, `webpack.config.js`, `package.json`, `package-lock.json` or the workflow file, whenever the job that detects those changes cannot decide, and on every push to `release`; for other pull requests those jobs are skipped, which counts as passing. To run it as CI does, one style at a time: `npm ci && npx playwright install chromium && npm run build && node tools/hostile.js --styles markup` (or `--styles url`). `npm run test:hostile` runs both styles in one process.

The pull request checks (`.github/workflows/ci.yml`) run the build, `npm test`, `npm run test:node`, the lockfile and live-test
source checks, `npm run test:live-local` and `npm run smoke` on Node.js 22, 24 and 26. None of them needs Fusion or credentials. The Docker-based proxy tests in `npm run test:node` skip unless the `nginx:alpine` image is already present (`docker pull nginx:alpine`); CI does not pull it. The tests of the Docker image (`test/node/image`) skip unless the image `banana-hosting:dev` exists; `npm run test:image` builds it and runs them (it needs Docker and network access for the base images). CI does not build the image, so these tests run only on a developer's machine: run `npm run test:image` before changing anything under `docker/`, the `Dockerfile` or `.dockerignore`.

## Compatibility

Existing dashboards should keep working. If your change requires a change to the dashboard structure, explain why in
the pull request. Please do not modify the existing dashboards under `src/app/dashboards`; adding new ones that show off
new capabilities is fine.

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0, the license of this
project.
