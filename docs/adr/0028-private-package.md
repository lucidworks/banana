# 0028. The package is private: Banana is built from source or from the Docker image

Date: 2026-11-06

Status: Accepted

## Context

Until 1.6.30 Banana was published to the npm registry as `banana-fusion`. Fusion 5.9.16's admin UI pins
`"banana-fusion": "1.6.30"` exactly (`fw:package.json:45`) and copies the package's `dist` at build time
(`fw:webpack.common.js:71`; `fw` is the Fusion 5.9.16 admin UI source). Since then the project has become community-maintained and the way people obtain Banana
has changed:

- The repository now ships a Docker image definition, and the documentation for hosting and for building from source is
  maintained alongside the code.
- Publishing under that name moves the `latest` version that unpinned installs resolve. Fusion installations are not
  affected, because Fusion pins 1.6.30 exactly. Whoever publishes from a checkout, by hand or from a script, still
  changes what everyone else who installs `banana-fusion` receives, and the registry does not allow the action to be
  undone (a published version number cannot be reused).
- Nobody has yet decided who may hold publish rights for the name, or whether a different name is wanted.

## Options considered

1. **Keep publishing as `banana-fusion`.** Rejected: it keeps a one-step, irreversible action open to anyone with the
   credentials, with no agreed owner and no automation that makes a release reproducible.
2. **Publish under a new name.** Rejected for now: it needs a decision about naming and ownership, and a second name would
   split the users of the old one.
3. **Do not publish, and mark the package private.** Chosen. npm refuses to publish a package that has
   `"private": true`, so an accidental attempt fails with a clear error.

## Decision

The project owner decided on 2026-11-06 that Banana is not published to npm. This qualifies the rationale of ADR 0020
(`0020-package-contents.md`): the package contents are still checked, but nothing is published from this repository.

`package.json` gets `"private": true`. The documentation tells people to build Banana from this repository (`npm ci` and
`npm run build`, which writes `dist/`) or to build the Docker image. A later decision can lift this: the field is removed
in one line, and a name and an owner for the package would be recorded in a new decision record then.

## Consequences

- The `banana-fusion` package that is already on npm is not touched. Nothing is unpublished or deprecated, and it stays at
  1.6.30; installations that resolve it keep working, and receive nothing newer. New versions of Banana reach users through
  the source repository and the Docker image only.
- The `files` list and the `prepack` script in `package.json` stay as they are. `"private": true` does not stop
  `npm pack`, and a tarball built that way is still correct (it contains `dist/`, `LICENSE`, `NOTICE` and `README.md`,
  which `test/node/package-contents.test.js` checks), so the checks keep guarding the contents in case publishing is
  reintroduced.
- The single-version test and the changelog heading form are affected when a release is cut: see the note at the top of
  `CHANGELOG.md`.
- A change of name, a registry other than npm's, or a different release channel needs its own decision record.
