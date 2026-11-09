# 0011. Licence, notice and third-party licence texts

Date: 2026-11-06

Status: Accepted. Partly superseded by [ADR 0015](0015-replace-files-without-a-stated-licence.md) (the three files with no stated licence were replaced) and by [ADR 0026](0026-remove-war-build.md) (the Maven and Ant files named in the metadata decision were removed). The npm package is no longer published, [ADR 0028](0028-private-package.md).

## Context

Banana is licensed under the Apache License 2.0, and it began as a fork of Kibana 3 (Elasticsearch BV, also Apache 2.0).
The repository did not meet the terms of the licences it relies on:

- `LICENSE.md` held a 14-line short notice, not the Apache License text that section 4(a) requires recipients to
  receive. GitHub's licence detector reads only the full text, so it reported no licence.
- `NOTICE.txt` credited build and test tools that are not distributed (Grunt, Bower, Karma, Protractor and others)
  and left out code that is distributed: Leaflet, jVectorMap, d3-tip, d3-cloud, the D3 5 modules, Font Awesome,
  normalize.css, animate.css, jQuery UI, xhr-xdr-adapter, vis.js and x2js. It also did not mention two kinds of code
  that sit inside other shipped files: the Bootswatch "Slate" theme that is compiled into `css/bootstrap.dark.min.css`,
  and the libraries that the prebuilt `vis.js` bundles (Hammer.JS, Moment.js, a Levenshtein routine, uuid code,
  core-js, Babel's runtime helpers, propagating-hammerjs, keycharm and emitter-component). Minification drops the
  notices of most of those, so nothing in `dist/` credited them.
- Several vendored files carry no licence text at all (D3 3.4.13, angular-dragdrop, d3-tip, d3-cloud, Font Awesome),
  or point at a licence file that was never copied (bootstrap-timepicker, Showdown). The Font Awesome font declares
  the SIL Open Font License 1.1 in its metadata, and that licence requires its text to accompany the font.
- The copyright statements disagreed (2013-2014, 2013-2016, 2017, and the build's own banner).
- `pom.xml`, `build.xml` and `mvn.template` began with the Apache Software Foundation's "Licensed to the ASF" header,
  which claims an association that does not exist, and the pom's issue tracker pointed at another project.

The build (see ADR 0009) already keeps the licence comments of vendored scripts, writes `THIRD-PARTY-LICENSES.txt`
and checks the comments against `tools/vendor-licenses.json`. That part did not need to change; the gaps were the
legal files themselves and the licence texts that some libraries never carried.

## Options considered

**Keep `LICENSE.md` and add `LICENSE`.** Two licence files next to each other can confuse detectors, and `LICENSE.md`
would keep saying less than the full text. Rejected: `LICENSE.md` is removed, and `LICENSE` is the only licence file.

**Name the notice `NOTICE.txt` or `NOTICE`.** The Apache convention, and what most tools look for, is `NOTICE`.
`NOTICE.txt` is renamed to `NOTICE`.

**Per-file licence headers on every source file.** Apache 2.0 does not require them, and adding one to roughly
170 first-party files would add noise to every future diff. Rejected. The Kibana-derived files are flagged as
modified by one statement in `NOTICE` (section 4(b) asks for prominent notice of changes, and Kibana 3 shipped no
`NOTICE` of its own, so there is nothing further to carry forward).

**Inline every third-party licence text in `THIRD-PARTY-LICENSES.txt`.** That file would repeat the same BSD text
for each of the D3 modules and could not sit next to the Font Awesome font as the OFL requires. Rejected in favour of
a `licenses/` directory of texts that the build copies into `dist/licenses/`, which `THIRD-PARTY-LICENSES.txt`
refers to by name.

**Leave the unattributable vendored files without a licence statement and say nothing.** Rejected: where an upstream
licence could be established it is now supplied; where it could not (see Consequences), `NOTICE` says so.

## Decision

- **Files.** `LICENSE` is the unmodified text of the Apache License 2.0 (sha-256
  `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, identical to
  https://www.apache.org/licenses/LICENSE-2.0.txt on 2026-11-06). `LICENSE.md` is removed. `NOTICE` replaces
  `NOTICE.txt`.
- **Copyright holder and years.** "Copyright 2013-2026 Lucidworks, Inc. and Banana contributors". The first commit of
  this repository is dated 2013-01-25, and the end year is the year of the most recent release work. The Kibana 3 line
  is "Copyright 2012-2013 Elasticsearch BV" as before. The project contact is the GitHub issue tracker; no email
  addresses are published.
- **What counts as shipped.** A component is listed in `NOTICE` when it ends up in `dist/`, as determined from the
  build output rather than from the dependency lists: the vendored scripts that `tools/vendor-licenses.json` marks as
  shipped, the npm packages named in `dist/THIRD-PARTY-LICENSES.txt` (vis, x2js, and the small css-loader and
  style-loader runtime helpers), the stylesheets, fonts and images copied from `src/css`, `src/font` and `src/img`, and
  code inside other shipped files: the Slate theme in `css/bootstrap.dark.min.css` (recognisable from its source,
  `src/vendor/bootstrap/less/bootswatch.dark.less`) and what the prebuilt `node_modules/vis/dist/vis.js` bundles
  (recognisable from the notices and version strings in that file). The latter are listed under `embedded` in
  `tools/vendor-licenses.json`.
  Build and test tools (webpack, Karma, Protractor and others), the AngularJS mocks, timezone-js, d3-drag and the
  minified copy of Leaflet are not distributed and are not listed.
- **Licence texts and their sources.** They are in `licenses/`, each from the project's own repository at the tag
  nearest the vendored version, or from the file's own header when that states the licence:

  | File | Source |
  | --- | --- |
  | `d3-3.4.13.txt` | `LICENSE` of github.com/d3/d3 at tag v3.4.13 |
  | `d3-5.x-modules.txt` | `LICENSE` of d3 v5.7.0, d3-array v1.2.1, d3-collection v1.0.4, d3-dispatch v1.0.5, d3-force v1.1.2, d3-path v1.0.5, d3-quadtree v1.0.5, d3-sankey v0.12.1, d3-shape v1.2.0 and d3-timer v1.0.9, each at its tag |
  | `d3-cloud.txt` | `LICENSE` of github.com/jasondavies/d3-cloud (default branch) |
  | `d3-tip.txt` | `LICENSE` of github.com/Caged/d3-tip (default branch) |
  | `leaflet.txt` | `LICENSE` of github.com/Leaflet/Leaflet at tag v0.6.4 (the vendored build calls itself 0.6-dev) |
  | `leaflet-markercluster.txt` | `MIT-LICENCE.txt` of github.com/Leaflet/Leaflet.markercluster at tag 0.2 |
  | `leaflet-label.txt` | `MIT-LICENCE.txt` of github.com/Leaflet/Leaflet.label (default branch; no tag matches the vendored 0.1.4-dev) |
  | `bootstrap-timepicker.txt` | `LICENSE` of github.com/jdewit/bootstrap-timepicker (default branch) |
  | `angular-dragdrop.txt` | `LICENSE` of github.com/codef0rmer/angular-dragdrop (default branch). The vendored copy is modified, as its own header says |
  | `showdown.txt` | `license.txt` of github.com/showdownjs/showdown at tag 0.4.0, the oldest tag that carries it. The vendored copy does not state its version, and the file header only says "BSD-style" |
  | `jvectormap.txt` | the standard MIT text, with the copyright line and the MIT statement from the file's own header (jVectorMap 1.2.2). The upstream project has since changed its licence, so the text from its current branch is not used |
  | `mit-fontawesome-css.txt` | the standard MIT text; the Font Awesome 3.2.1 README names the MIT License for the CSS and ships no separate file |
  | `fontawesome-OFL.txt` | the official SIL Open Font License 1.1 text from https://openfontlicense.org/documents/OFL.txt, unchanged, below a copyright line for the font ("Copyright (c) 2013, Dave Gandy": the font metadata names the designer and the year 2013). The five template copyright lines at the top of the official document are the only part replaced. Font Awesome 3.2.1 ships no licence file, but its README and the font metadata both name the OFL 1.1. The font files say "Version 3.2.0 2013"; 3.2.1 is the version of the CSS and of the release |
  | `bootswatch-slate.txt` | the copyright and licence statement from the README of github.com/thomaspark/bootswatch at tag v2.3.2 (Apache-2.0, Copyright 2012 Thomas Park); the Apache text itself is `LICENSE` |
  | `vis-bundled-code.txt` | one section for each component that vis.js bundles. The texts are the licence files of the upstream projects (Hammer.JS v2.0.7, Moment.js 2.19.1, node-uuid v1.4.7, core-js v2.5.1, babel v6.26.0, propagating-hammerjs v1.4.6, keycharm, component/emitter 1.3.0), or the notice that vis.js itself carries (Andrei Mackenzie's Levenshtein routine). Email addresses are left out of copyright lines. Hammer.JS also keeps its own header in the build output |

  Libraries whose own file already carries the full licence text (for example AngularJS, jQuery, Flot, Underscore,
  Moment, FileSaver, Bootstrap, xhr-xdr-adapter, normalize.css and animate.css) keep it: the build copies those
  comments into the output, and the check in `tools/check-dist.js` fails if any is lost.
- **Shipping.** The build copies `LICENSE`, `NOTICE` and `licenses/` into the root of `dist/`, and a copy of the OFL
  text to `dist/font/OFL.txt`, next to the font files. `tools/check-dist.js` compares each of those files byte for
  byte with its source and fails when one is missing or changed, and when `LICENSE` is not the Apache License text.
  For code inside other shipped files (the `embedded` entries of `tools/vendor-licenses.json`) it also fails when the
  file no longer contains the code (a marker text), when the licence text does not name the copyright holder, or
  when `THIRD-PARTY-LICENSES.txt` does not list the entry; so replacing vis or the theme prompts a review of the
  entry instead of leaving a stale credit. The existing check that vendored licence comments survive minification
  stays as it was. What the check cannot do is discover a component that is not listed anywhere: when a prebuilt
  bundle is upgraded, its notices have to be read again.
- **Metadata.** (Update, 2026-11-07: `pom.xml`, `build.xml` and `mvn.template` no longer exist, [ADR 0026](0026-remove-war-build.md).) `package.json` and `pom.xml` agree: licence `Apache-2.0`, repository, home page and issue tracker
  under github.com/lucidworks/banana. The npm package name is left as it is. The "Licensed to the Apache Software
  Foundation" headers in `pom.xml`, `build.xml` and `mvn.template` are replaced by the project's own copyright and
  licence statement.

## Consequences

- GitHub's detector can read `LICENSE` as Apache-2.0, and every distribution of `dist/` carries the licence, the
  notice and the third-party texts that its terms require.
- Superseded in part by ADR 0015: the three files described next have since been replaced.
- Three vendored items have no licence the project can name, and `NOTICE` says so for each. The Flot "stackpercent"
  plugin comes from github.com/skeleton9/flot.stackpercent, a repository without a licence file whose README says the
  plugin is based on Flot's MIT-licensed `jquery.flot.stack.js`; the plugin author's licence is unknown. The jVectorMap
  data for Japan and for the world with Antarctica have no source that could be traced. Whether those files may be
  distributed is a decision for the maintainers; this change does not remove them. The world, Europe and USA map data
  are identical to the files in Kibana 3.0.0, which distributed them under the Apache License 2.0, and are credited to
  Kibana 3. Replacing the plugin or sourcing the two data sets from a project with a stated licence would close the rest.
- `img/rotate.svg` was added by a contributor in 2014 and carries no notice; it is treated as contributed under the
  project's licence, and `NOTICE` invites a correction.
- The Showdown and angular-dragdrop texts come from upstream's current or later files rather than from the exact
  vendored revision, because those revisions are not tagged. The licences are the long-standing ones of those
  projects, but a maintainer who finds a difference should correct the text.
- A legal review of `LICENSE` and `NOTICE` is a separate, later step; the texts here are the best accurate reading of
  the sources named above, not legal advice.
- Adding a vendored library now means adding it to `tools/vendor-licenses.json` (as before), to `NOTICE`, and, when
  its file lacks the licence text, a file in `licenses/` that the entry names with `licenseText`.
