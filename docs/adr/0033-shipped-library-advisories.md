# 33. Advisories in the shipped browser libraries

Date: 2026-11-07

Status: Accepted

<!-- This ADR is committed to the repository. It is written for an outside reader. -->

## Context

Everything in `dist/` that is not Banana's own code is a third-party library: the vendored files listed in
`tools/vendor-licenses.json` and the two packages that webpack takes from `node_modules` (vis and x2js, with the older code
bundled inside vis). Before this change the libraries were scanned with retire.js (against `src/vendor`, `src/app/panels`
and the built `dist/`) and with the OSV database (every vendored library and npm package by name and version). The scan
found advisories in these libraries:

| Library (version found) | Advisories |
|---|---|
| jQuery 1.12.1 | CVE-2019-11358 (prototype pollution in `extend`), CVE-2020-11022 and CVE-2020-11023 (HTML handling in `.html()` and friends), `parseHTML` runs event-handler script (fixed in 2.2.0 and 3.0), end of life of the 1.x line |
| Underscore 1.5.1 | CVE-2021-23358 (code injection through `_.template`), unbounded recursion in `_.flatten` and `_.isEqual` (CVE-2026-27601) |
| Moment.js 2.1.0 | CVE-2016-4055, a later regular-expression denial of service, CVE-2017-18214, CVE-2022-24785 (Node.js path traversal). CVE-2022-31129 applies from 2.18.0 to 2.29.3, so not to 2.1.0 |
| AngularJS 1.0.8 | many; see [ADR 32](0032-angularjs-1-0-8-stays.md) |
| Bootstrap 2.3.2 | CVE-2016-10735, CVE-2018-14040, CVE-2018-14042, CVE-2018-20676, CVE-2018-20677, CVE-2024-6485 (cross-site scripting through `data-*` attributes and plugin options) |
| jQuery UI 1.10.3 | CVE-2021-41182, CVE-2021-41183, CVE-2021-41184, CVE-2022-31160, CVE-2016-7103 |
| Showdown (a 2010-era copy, no version stated) | tabnabbing from links (fixed in 1.9.1), and three advisories with no fixed release at all: table header ids, metadata titles, and a nested regular expression in the link parser (CVE-2024-1899); all affect every version through 2.1.0 |
| d3-color 1.x inside d3 5.7.0 (`src/vendor/d3v5.js`, force panel) | GHSA-36jr-mh4h-2g58 (regular-expression denial of service in the colour parser, fixed in 3.1.0) |
| Moment.js 2.19.1 inside vis 4.21.0 | CVE-2017-18214, CVE-2022-24785, CVE-2022-31129 |

No advisory was found for d3 3.4.13, the other modules of d3 5.7.0 (`d3-array`, `d3-force`, `d3-shape` and so on), Flot 0.8.1 and its plugins, FileSaver,
Modernizr 2.6.1, AngularStrap 0.7.5, bootstrap-datepicker, elastic.js, jVectorMap 1.2.2, Leaflet (an unreleased `0.6-dev` snapshot,
which a scanner cannot match to a published version, so a missed advisory is possible), x2js 3.4.5, or core-js,
Hammer.JS and keycharm inside vis, or the css-loader and style-loader runtime code that webpack puts in the bundle. The full table with identifiers is in the scan log kept with the project's
review material; the ones the project acts on are below.

## Options considered

For each library, upgrading to a fixed version was the first choice. It was taken where the application, its tests and a
run of the built page (every panel, with and without the content security policy) work afterwards without a change in behaviour.
Where an upgrade would change what the application does, or where no fixed version exists, the advisory is analysed and recorded.

## Decision

### Upgraded

- **jQuery 1.12.1 to 3.7.1.** Fixes every advisory above; the scanners report none for 3.7.1. AngularJS 1.0.8 uses jQuery
  when it is loaded before it (`angular.element` is then jQuery, which a unit test checks), and it uses only calls that jQuery 3 still
  has. What changed for Banana: jQuery 3.5 no longer rewrites self-closing tags such as `<div/>` when it builds HTML (Banana's own templates and scripts have none outside a comment; the vendored datepicker and Bootstrap have a few, such as `<i class="..."/>`, which the HTML parser reads the same way in either version), and the old `load`, `unload` and `error` event
  shortcuts are gone (the `.error(` calls in the services are `$http` promise methods, not jQuery). The vendored jQuery UI 1.10.3, Flot 0.8.1
  and its plugins, Bootstrap 2.3.2, AngularStrap, the datepicker and timepicker, and the angular-dragdrop directives load and work
  on it (all 28 panels render, with and without the policy). The content security policy record ([ADR 29](0029-content-security-policy-without-unsafe-eval.md)) lists two things
  in jQuery 1.12.1: the `onfocusin` and `onsubmit` support probes and the `Function("return " + text)` fallback of `jQuery.parseJSON`.
  jQuery 3.7.1 contains neither (`jQuery.parseJSON` is only a deprecated alias of `JSON.parse`, and no call in Banana used it), so the policy has one probe
  source less to accept (Leaflet's `ontouchstart` check remains).

  **One behaviour did change, and is repaired in Banana.** jQuery 1.x let `$('#')` return an empty set; jQuery 3 throws a
  syntax error for it. Bootstrap 2's plugins call `$()` with a link's `href` to find their target, and the New, Load and Save
  menus in the navigation bar have `href="#"`. With the throw, those menus never opened, the browser followed the link, and the open dashboard was replaced by the
  default one, losing unsaved changes. `src/app/components/extend-jquery.js` therefore makes `$('#')` return an empty set again, as
  jQuery 1.x did. The change is made where jQuery parses a selector, so `$('#', context)` and `.find('#')` also return an empty
  set now, where jQuery 1.12.1 threw; no Bootstrap or Banana call uses those forms. Every other selector goes to jQuery's own parser,
  and the vendored Bootstrap is not edited. The smoke check now clicks through the three
  navigation menus, a panel's header menu, a collapse, the panel editor's modal and its tabs, and fails if a menu does not open, a page
  error is raised, or the route changes.
- **Underscore 1.5.1 to 1.13.8.** Fixes both advisories. The `_.template` injection was not reachable in Banana, which no
  longer calls `_.template` ([ADR 18](0018-dashboard-parameters-without-code-execution.md)); it is upgraded because the
  recursion advisory concerns functions Banana calls (`_.isEqual`, `_.flatten`), and because the replacement is a drop-in for the
  functions in use (checked by the unit tests and by a spec that calls the ones the panels use). The UMD build is vendored,
  with its licence header copied to the top of the file so that the build output keeps it. `_.template` still builds code with
  `new Function`, as before, and still is not called.
- **Moment.js 2.1.0 to 2.31.0.** Fixes every advisory above and the one published for 2.30. Moment 2.31 still accepts the
  older argument order of `add` and `subtract` but reports it as deprecated, so the calls in the time picker and the index
  helper now give the number first (`subtract(2, 'hours')`); a unit test makes any use of the deprecated order fail.
  Strings that are not ISO 8601 or RFC 2822 are still handed to `Date` as in 2.1.0.

### Kept, with the reachable-path analysis

- **AngularJS 1.0.8** and what that leaves: [ADR 32](0032-angularjs-1-0-8-stays.md).
- **Bootstrap 2.3.2.** There is no fixed Bootstrap 2 release (the fixes are in 3.4.0 and later, which change the markup and
  the grid, so a move is a rewrite of every template). Each advisory needs attacker text in a particular attribute that
  a Bootstrap plugin reads as a selector or as HTML:
  `data-target`, `data-viewport`, `data-container` and the `affix` and `scrollspy` targets, `data-loading-text`: none of these
  attributes appear in Banana's templates (checked by search), so no stored data can reach them.
  `data-parent` appears twice (the facet and full-text search panels), each with a fixed value in the template (`#facetAccordion` and `#myAccordion`).
  The popovers (`bs-popover`) have `html: true`; their content is Banana's own templates, which do show values from Solr
  through AngularJS bindings, so the question of what the bindings emit is the one in ADR 32, not a Bootstrap fault.
  The tooltips are different: AngularStrap's `bs-tooltip` hands its value to Bootstrap's tooltip as HTML. The values that
  reach it from documents and dashboards (the micropanels of the table and full-text search panels, and the query panel) are
  escaped before they are given to it, and so are the typeahead suggestions, which Bootstrap also writes as HTML
  ([ADR 0024](0024-render-document-data-and-markdown-safely.md)). With no content security policy, as when Banana is served by
  Fusion, a sink that the check in that ADR missed would still run script.
- **jQuery UI 1.10.3** is a custom build (core, widget, mouse, position, draggable, droppable, resizable, selectable, sortable)
  used for dragging panels. Four of the five advisories belong to the datepicker, dialog and checkboxradio widgets, which this
  file does not contain. The fifth, CVE-2021-41184, is the `of` option of `.position()` given untrusted text: Banana never calls
  `.position()` and its drag and drop code passes no `of` option, so it is not reachable. Replacing the file means producing a
  new custom build; that is left until another change needs it.
- **Showdown (old copy).** The markdown converter is the original 2007-2010 port. Of its four advisories, the table header
  id, metadata title and tabnabbing ones concern features it does not have (no tables, no metadata block, no `target="_blank"`),
  and they are not reachable. The regular-expression denial of service in link parsing is a real risk to the viewer's browser
  tab if a text panel's markdown is crafted; it has no fixed version to upgrade to (the advisory covers every release through
  2.1.0), and an upgrade would change the output of every existing markdown panel (a new converter formats lists, code blocks and
  line breaks differently) and its API. Text for the converter comes from a dashboard's text panel or the panel help text, so the
  author of a dashboard, not a visitor, supplies it; the text has `<`, `>` and `&` replaced before conversion, so it
  cannot add HTML. The `javascript:` link form that markdown can still produce is refused only where the content security policy is sent (the Docker image); when Banana is served by Fusion, which sends none, such a link runs when it is clicked. It needs a dashboard author to write it, as the text panel's content is theirs.
- **d3-color 1.x inside d3 5.7.0** (used by the force panel through `d3.rgb`). The colour parser takes quadratic time on
  a very long number that follows `rgb(` or `hsl(` (a bare run of digits parses quickly), and the force panel's colour list is a
  dashboard setting. The fix is in d3-color 3.1, and no release of d3 5 carries it (d3 5.16 depends on d3-color 1), so the fix
  needs d3 7. That is a change of the whole of d3 (the force, Sankey, sunburst and other panels use it) and is not part of this change. The input is
  guarded instead: the panel's colour list is split, its spaces are removed, and an entry longer than 64 characters (the
  longest real colour is about 40) is replaced by grey before d3 sees it (`$scope.palette` in
  `src/app/panels/force/module.js`, covered by a unit test that gives it a 100,000-digit entry). The advisory remains in the library, and the
  scanners keep reporting it.
- **Moment.js 2.19.1 inside vis 4.21.0.** vis is the last release of the `vis` package (the project moved to separate packages
  with a different API), and the older moment is built into its bundle, so it cannot be replaced without changing vis. The graph
  panel draws a vis network: it adds nodes with `id`, `label` and `title`, and edges with `from` and `to`; none of these is
  converted to a date, which is the only way vis calls moment's string parser (the one the denial-of-service advisories
  concern). The path-traversal advisory needs Node.js's `require` of a locale file and does not apply to a browser bundle.
- **Libraries with no matching advisory** are not changed. Leaflet is the one where the scanners' silence means least,
  because the file is an unreleased snapshot; it is listed so that the next review looks at it.

## Consequences

- The shipped copies of jQuery, Underscore and Moment.js have no known advisory. Their upgrade keeps the behaviour users see: the
  unit tests, the 28-panel smoke checks with and without the strict policy, and the local live tests pass on the
  built page. jQuery 3 is the largest change, and the only one with a risk the tests may not cover: code in a dashboard or an
  operator's own panel that relies on jQuery 1.x behaviour (the removed `load` and `error` shortcuts, `andSelf`, `size`, or
  self-closing tags) needs a small edit.
- The libraries that stay are listed with the reason, so the next maintainer can check whether the reasoning still holds
  (for instance, whether a template has started to use `data-target` or `.position()`).
- A multi-valued date in the table and full-text search panels' date formatter shows differently: Moment 2.1.0 turned an
  array into garbage text, and 2.31.0 shows a plausible but wrong `YYYY-01-01 00:00:00`. Neither is a correct date.
- Running a scan again is cheap: retire.js on `dist/` and the OSV batch query on the versions in `tools/vendor-licenses.json`
  reproduce the table. Retire.js sees only libraries that keep a version banner after minification, so the vendored
  file list is the reference, not the scan of `dist/` alone.
- The jQuery and Underscore file names and line numbers quoted in ADR 29 describe the versions it was written against.
