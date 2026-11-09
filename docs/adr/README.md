# Decision records

Each file in this directory records one decision: the situation, the options that were rejected and why, what was
decided, and what follows from it. They are written for someone who was not there. Records are not rewritten when
the code moves on: a later change adds a dated note, or a later record takes over a point, and the status below says so.

Where a record cites a line of Banana's source without saying which version, the line numbers belong to the code at the
time the record was written and have moved since; look for the named function or setting. A record that cites the
Fusion sources says which tag or commit it read.

For the value of every configuration key and how it differs from release 1.6.30, see [../defaults.md](../defaults.md).

## Index

Status values: **Accepted** is in force. **Accepted, partly superseded** means a later record replaces the part named;
the rest still holds.

| No. | Title | Status | Summary |
|---|---|---|---|
| [0003](0003-standalone-hosting-same-origin-proxy.md) | Standalone hosting: a same-origin proxy in front of Fusion, per-user login only | Accepted, partly superseded by [0029](0029-content-security-policy-without-unsafe-eval.md) (the script policy) | The design for running Banana outside Fusion: one same-origin proxy, every person logs in to Fusion as themselves, no shared credential. Includes the residual-risk tables. Implemented by 0023. |
| [0004](0004-inside-fusion-mode-verified-by-imitation.md) | The inside-Fusion layout is verified by imitation | Accepted | The `/admin/banana/` layout is checked by serving the build at that path behind the proxy, not by installing into a Fusion admin UI. |
| [0005](0005-cross-origin-hosting-not-supported.md) | Hosting Banana on a different origin from Fusion is not supported | Accepted | Why a separate origin does not work with Fusion's gateway and cookie, and what an operator would have to build to try. |
| [0006](0006-fusion-defaults-and-solr-preset.md) | Fusion defaults, and a Solr preset selected by copying a file | Accepted | `config.js` reproduces the 1.6.30 Fusion defaults; `config.solr.js` is the plain-Solr preset; new `default_dashboard` setting. |
| [0007](0007-plain-solr-scope.md) | Plain Solr support is limited to keeping the Solr preset working | Accepted | The Solr preset is kept loading and consistent; no further Solr-specific work is promised. |
| [0008](0008-guarded-live-test-client.md) | A guarded client is the only way live tests write or delete dashboards | Accepted | The rule table, registry and checks that let tests run against a shared Fusion without being able to damage it. |
| [0009](0009-webpack-build.md) | Build with webpack 5, keeping the AMD modules | Accepted, partly superseded by [0026](0026-remove-war-build.md) (the WAR consequence) and [0013](0013-committed-lockfile-and-node-range.md) (the `engines` field) | `npm run build` bundles the AMD modules into `dist/` with webpack; panels become chunks; `config.js` stays a separate file. |
| [0010](0010-unit-test-harness.md) | Run the unit tests with Karma, Jasmine and headless Chromium, loaded through the webpack build | Accepted | `npm test` runs the specs in a real browser through the build's own module rules. |
| [0011](0011-licence-and-notices.md) | Licence, notice and third-party licence texts | Accepted, partly superseded by [0015](0015-replace-files-without-a-stated-licence.md) (the three files with no licence) and [0026](0026-remove-war-build.md) (the Maven and Ant files named in the metadata decision); the npm package is no longer published, [0028](0028-private-package.md) | The full Apache 2.0 text, a corrected `NOTICE`, and the third-party licence texts shipped in `dist/`. |
| [0012](0012-live-smoke-test.md) | The live smoke test: one fixture dashboard, direct Solr route for stream panels | Accepted | What the live smoke test opens, how it decides that a panel rendered, and why stream panels use the direct Solr route. |
| [0013](0013-committed-lockfile-and-node-range.md) | Commit a public-registry lockfile, pin the Node.js range, and fix the audit findings that can be fixed | Accepted | A committed lockfile that uses only the public registry, the supported Node.js range, and the dependency audit fixes. |
| [0014](0014-report-failed-requests.md) | Report failed requests instead of treating them as success | Accepted | A failed request now rejects and is shown in the panel or an alert, where 1.6.30 turned it into a silent success. |
| [0015](0015-replace-files-without-a-stated-licence.md) | Replace the shipped files that have no stated licence | Accepted | Two map data files and the percent-stacking chart plugin are regenerated or rewritten from sources with a stated licence. |
| 0016, 0017 | Not used | None | These numbers were reserved and no record was written under them. |
| [0018](0018-dashboard-parameters-without-code-execution.md) | Dashboard parameters without code execution | Accepted | `{{ARGS.name}}` is still substituted in a loaded dashboard; any other `{{ ... }}` is no longer run as JavaScript. |
| [0019](0019-stream-expression-panels.md) | Stream-expression panels build quoted, read-only expressions | Accepted | The graph, significant terms and time series panels quote every value and may only use a fixed list of read-only functions. |
| [0020](0020-package-contents.md) | The npm package contains the built output, and only that | Accepted, rationale qualified by [0028](0028-private-package.md) | A `files` allowlist and a `prepack` build make a packed tarball hold `dist/` and the licence files only. |
| [0021](0021-dashboard-server-parameter.md) | A link cannot choose the server a dashboard is loaded from | Accepted | In Solr mode the `server` parameter of a link is honoured only for a relative path, the configured servers, or `allowed_dashboard_servers`. |
| [0022](0022-github-actions-ci.md) | Continuous integration on GitHub Actions | Accepted | One workflow builds and tests on Node.js 22, 24 and 26; CodeQL runs separately; live suites stay manual. |
| [0023](0023-docker-image.md) | The Docker image: how it is built and what it reads | Accepted, partly superseded by [0026](0026-remove-war-build.md) (the `WEB-INF` note) | The nginx image that implements 0003: base images, start-up, the environment variables, run-time name resolution, health routes. |
| [0024](0024-render-document-data-and-markdown-safely.md) | Render document data and markdown safely | Accepted | Every place that wrote document, schema or dashboard text into the page as HTML now escapes it or sanitises it, checked by a hostile-data browser run. |
| [0025](0025-service-tests-on-recorded-responses.md) | Service tests run on recorded responses, behind a scrub check | Accepted | Service specs use responses recorded from Fusion 5.9.16; a check fails the build if a fixture holds a host, cookie, token or id. |
| [0026](0026-remove-war-build.md) | Remove the WAR build and other unused build files | Accepted | The Ant, Maven and Jetty files, the servlet descriptor, old jars and logos are removed; the version lives only in `package.json`. |
| [0027](0027-dashboard-save-and-delete-safety.md) | Saving and deleting a dashboard cannot overwrite or delete the wrong one | Accepted | Saving over an existing title asks first and shows the stored owner; dashboard ids are encoded the same way for save, load and delete; Solr deletes and loads no longer build queries from the raw title. |
| [0028](0028-private-package.md) | The package is private: Banana is built from source or from the Docker image | Accepted | `package.json` is marked private so that nothing is published to npm from this repository. |
| [0029](0029-content-security-policy-without-unsafe-eval.md) | A content security policy without unsafe-inline and unsafe-eval | Accepted, partly superseded by [0033](0033-shipped-library-advisories.md) (the jQuery details) | Banana runs under `script-src 'self'` using AngularJS `ng-csp`; the image's default policy drops both keywords. |
| [0030](0030-panel-and-service-regressions.md) | Restoring what the unreleased development line broke in panels and services | Accepted | Hits styles, heatmap row count and filters, log axis, collection list, relative time ranges and a dashboard-switch race are put right. |
| [0031](0031-unreleased-panel-features.md) | Taking over the panel features of an unreleased development branch | Accepted | Box plot, ticker "ignore time picker", terms custom-query filters, sunburst labels, force and sankey limits and tag cloud stop words, each off by default. |
| [0032](0032-angularjs-1-0-8-stays.md) | AngularJS 1.0.8 stays, and what that leaves exposed | Accepted | No framework upgrade; lists the advisories, what is closed, and what remains, including that Fusion-served Banana has no content policy. |
| [0033](0033-shipped-library-advisories.md) | Advisories in the shipped browser libraries | Accepted | jQuery, Underscore and Moment.js are upgraded; the libraries that stay old are listed with the reason the advisories are not reachable. |
| [0034](0034-differences-inherited-from-the-development-line.md) | Differences from 1.6.30 that came with the development line, and why the build stays on webpack | Accepted | Accepts the query panel operator, the terms bar arrangement, the heatmap defaults and shading, the Home switch and the removed scripted sample dashboard, and, in an addendum, six presentation and export differences (icon links, the Bettermap coordinate hint, the full text search export query, sunburst sizing, the Internet Explorer adapter and theme CSS), and records that the ES-module build is deferred. |

Records 0001 and 0002 were never written: the numbering starts at 0003.

## Adding a record

Use the next free number and the file name `NNNN-short-title.md`. Give it `Date:` and `Status:` lines and the sections
Context, Options considered, Decision and Consequences, and write it so that someone who has never seen the project
can follow it. When a later record changes part of an earlier one, add a dated note to the earlier record and update
its status here. If a decision changes a default, add it to [../defaults.md](../defaults.md).
