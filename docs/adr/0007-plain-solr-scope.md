# 7. Plain Solr support is limited to keeping the Solr preset working

Date: 2026-11-05

Status: Accepted

## Context

Banana began as a Solr dashboard tool, and the original README describes installing it inside a Solr web app. The project is now maintained for Lucidworks Fusion 5.9, where it is installed as the admin UI, and for standalone hosting that calls the Fusion API. The defaults now target Fusion, and a Solr preset (see ADR 6) keeps the earlier standalone-Solr configuration available.

## Options considered

1. **Remove standalone-Solr support.** Rejected: existing Solr users would lose a working configuration for no gain, and the preset costs one extra config file.
2. **Support plain Solr fully, with its own tests, documentation and features.** Rejected: the maintainers cannot test against current Solr releases, and it would double the surface for every change.
3. **Keep the preset working, without further investment.** Chosen.

## Decision

Support for plain Solr is limited to keeping the Solr preset (`config.solr.js` and `default.solr.json`) loading and consistent with `config.js`. Automated checks cover the preset values and that it differs from `config.js` only in its Solr keys. Behaviour against a live Solr server is not tested here. New features are designed and verified for Fusion; fixes that affect plain Solr are welcome as contributions but are not committed to.

## Consequences

Plain-Solr users get the preset and the existing README instructions, and nothing more. A change that would break the preset is a defect to fix, but a Solr-specific enhancement is out of scope. If the project later drops the preset, that needs a new decision and a note in the release notes.
