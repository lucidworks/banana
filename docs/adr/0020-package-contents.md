# 20. The npm package contains the built output, and only that

Date: 2026-11-06

Status: Accepted. The rationale is qualified by [ADR 0028](0028-private-package.md): nothing is published from this repository, but the contents of a packed tarball are still checked.

## Context

Fusion 5.9 takes Banana from npm: it installs the `banana-fusion` package and copies exactly `node_modules/banana-fusion/dist` into its admin interface. Anyone who builds and packs this repository themselves, for Fusion or for another host, therefore needs `dist/` to be in the package.

The release of Banana that Fusion 5.9 ships (1.6.30) committed `dist/` to the repository, so the package had it by virtue of being a copy of the working tree. This repository builds `dist/` with webpack and ignores it in git (see ADR 9, `0009-webpack-build.md`), and `package.json` had no `files` field. A package made from it had no `dist/` at all, and instead carried the sources, the tests, the Jetty servlet jars under `resources/enable-cors` and the build tooling: an empty Banana for the one consumer that matters.

The packlist (the file list npm would put in the package) is decided by `npm-packlist`, which npm bundles. It can be run without creating a tarball, which is how this repository checks it.

## Options considered

1. **Commit `dist/` again, as 1.6.30 did.** Rejected: build output in git produces noisy diffs and merge conflicts, and a committed `dist/` can drift from the sources it claims to be built from. The build check already guards the output; committing it adds a second copy to keep in step.
2. **An `.npmignore` that removes the development files.** Rejected: an ignore list must be extended every time a development directory is added, and anything forgotten ships. An `.npmignore` also takes the place of `.gitignore` entirely, so `dist/` would be packed, but so would every development path not listed in it.
3. **A `files` allowlist in `package.json`, with `dist/` built before packing.** Chosen.
4. **Publish from CI after building.** Not needed here. Whether to publish is a separate decision and is not made by this change.

## Decision

- `dist/` is built at package time and is not committed. `package.json` has a `prepack` script that runs `npm run build` (webpack followed by the output check). npm runs `prepack` before it creates a tarball for `npm pack` and `npm publish` (unless they run with `--ignore-scripts`, which skips `prepack` and packages whatever `dist/` is on disk, stale or missing), and a build that fails stops the packing. The build needs the development dependencies, so it works in a checkout after `npm ci`.
- `package.json` has a `files` allowlist: `dist/`, `LICENSE`, `NOTICE` and `README.md`. npm always adds `package.json`. Everything else is left out: `src/`, `test/`, `tools/`, `scripts/`, `docs/`, `resources/` (its Jetty servlet jars are only for the old Solr-bundled deployment), `licenses/` (the licence texts are copied into `dist/licenses/` by the build), build descriptors and lock files. A `files` entry of `dist/` is included even though `.gitignore` lists `dist`.
- Production builds write no source maps (`devtool` is off outside development mode), so none are in the package. The test fails if one appears.
- `test/node/package-contents.test.js` computes the packlist with the `npm-packlist` and Arborist modules bundled with npm (found next to the running Node.js), so it adds no dependency and does not create a tarball. It checks that the `files` list and `prepack` exist, that the licence files and readme are included, that nothing but `dist/`, those files and `package.json` is included, and, when `dist/` has been built, that every file of `dist/` is in the list. The `dist/` check is skipped with a message when `dist/` does not exist; the full verification builds first, so it runs there. The test is also skipped, with a message, on a Node.js whose npm does not bundle those modules.

## Consequences

- A package made after `npm run build` (which `prepack` runs) holds the whole `dist/` tree plus the licence files, about 220 files, and nothing else.
- Someone who adds a new top-level file that should ship must add it to `files`; the test fails on any file outside the allowlist, so it is noticed.
- Packing takes as long as a production build.
- The fast test run does not build, so there the `dist/` content check is skipped; the package-level checks still run.
