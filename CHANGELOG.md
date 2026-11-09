# Changelog

This file lists what changed for people who use or host Banana. The version of the current code is the one in
`package.json`. Reasons for each deliberate change are in the decision records under [docs/adr](docs/adr).

The current section has no version number in its heading on purpose: a test (`test/node/single-version.test.js`) fails
when a second copy of the `package.json` version appears in a Markdown file. Whoever cuts a release and adds a versioned
heading must adapt that test (or the heading form) in the same change.

## Unreleased: this version

This version builds on 1.6.30, the release that Fusion 5.9 ships, and also carries changes from a development line that
was never released (listed under "Added" and "Changes that can affect existing setups", and describing today's behaviour).
The default configuration is still the Lucidworks Fusion one (`USE_FUSION: true`,
`/api/query-pipelines/_system/collections/`, `/api/blobs`).

### Changes that can affect existing setups

* **Saving a dashboard asks before it replaces one.** Saving under a title that already exists shows who saved the stored
  dashboard and asks you to confirm; before, it replaced the stored dashboard without a word. A title that Fusion's blob
  path cannot carry (for example one containing `%`, `;`, `\` or an empty path segment) is refused with a message instead
  of being saved under a different name. In Fusion mode saving also records the logged-in user as the owner. In plain Solr mode a delete
  no longer builds its query from the title as typed, so a crafted title cannot delete every saved dashboard.
* **The `server` address in a link is restricted.** A link such as `#/dashboard/solr/<name>?server=...` loads a dashboard
  from that server only when the value is a relative path (for example `/solr/`), equals `banana_server` or `solr` in
  `config.js`, or is listed in the new `allowed_dashboard_servers` setting. Any other value is ignored with a warning.
* **`{{ ... }}` in a dashboard is no longer run as JavaScript.** Only the form `{{ARGS.name}}`, which inserts the URL
  parameter `name`, is substituted, and the value is kept exactly as given. Dashboards that put other expressions inside
  braces will now show them as text.
* **Stream-expression panels are read-only.** (These panels are new; see "Added".) The graph, significant terms and time series panels build their expressions
  from quoted values and a fixed set of read functions, apply the dashboard's filters and time range, and explain when the
  server refuses the request (a Fusion query pipeline refuses `stream` and `graph` unless it is configured to allow them).
* **Values from documents, the schema and dashboards are shown as text.** Wherever the hostile-data check
  (`npm run test:hostile`) reaches, field values, field and collection names, facet terms, titles, ids, chart labels and
  tooltips, axis labels and the suggestions in the editors are escaped before they reach the page, where 1.6.30 inserted
  many of them as HTML. A document or dashboard whose text contains HTML now shows that HTML as text (in the document
  viewer, the full text search body, the table's details and hyperlink columns, alerts and the typeahead lists). Highlight
  markup that Solr or a panel adds, and links in alerts, still work.
  * **Markdown links and images in the text panel** keep only `http`, `https` and `mailto` addresses (images also
    embedded `data:image` ones) and relative links. A link with another scheme, such as `javascript:`, loses its address and
    keeps its text.
  * **Chart colours are checked.** A colour from a query, or a field value used as a colour, is written into a chart
    tooltip only if, as the browser parses it, it is a colour name or `rgb()`, `rgba()`, `hsl()` or `hsla()` with plain numbers;
    anything else (a value with `var()`, `env()`, `calc()`, quotes or a comment that holds quotes) is dropped. Valid names, hex
    numbers and `rgb()` work as before. A field value used as a chart colour ("use field values as colours") no longer accepts the
    slash form such as `rgb(0 0 0 / 50%)`.
  * Not covered, and still as in 1.6.30: style and class values that panel settings write through attribute bindings (for
    example a panel height) can add CSS; and what the check cannot reach (Solr-mode field lists, popovers, hover paths it
    cannot trigger, anything a real Fusion sends that the stand-in responses do not). The decision record
    ([ADR 0024](docs/adr/0024-render-document-data-and-markdown-safely.md)) lists them.
* **Failed requests are reported.** A request that fails (403, 404, 500, no answer) now shows an alert or an error on the
  panel instead of looking like a success. A save or delete that the server refused no longer says "Dashboard Saved" or
  "Dashboard Deleted".
* **Presentation and export differences from the unreleased development line.** None changes a saved dashboard.
  * Icons in panel headers, rows and the dashboard menu are links with titles. Styled tooltips still show, using the
    title text ("Configure Row" instead of "Configure row"); a few icons and menu entries now also show the browser's
    own title tooltip. Panel-header and row icons take the theme's link colour (light `#08c` instead of `#333`, dark
    `#fff` instead of `#c8c8c8`), the row icons have slightly different sizes, and the heatmap's transpose icon looks
    different. A few icons still have no `href`, so the keyboard cannot reach them.
  * The Bettermap "Coordinate Field" hint now says latitude, then longitude, which is how the panel has always read the
    field (1.6.30's hint said the opposite).
  * The full text search panel's file export (CSV, XML, JSON) now applies the panel's custom query, as the panel's own
    search does. With no custom query the export is unchanged.
  * The sunburst panel sizes its container from the panel or row height, and no longer writes debug output to the
    console.
  * `index.html` loads a cross-domain request adapter that only acts in Internet Explorer 8 and 9 (this version cannot
    run there, so it is inert), a changed compatibility meta tag, and the graph panel's stylesheet.
  * Themes: panel padding is 11px instead of 10px, the light theme's panel background and both themes' row backgrounds
    are lighter, and the dark theme draws axis labels with a stroke.
  * The query panel keeps 70px instead of 45px on the right of the last query's text, so a long query is not typed
    under the search, add and clear icons.
* **Panels from the unreleased development line differ from 1.6.30.**
  * The Hits panel draws its bar, pie and list styles again, so a dashboard saved with one of them no longer shows an
    empty panel. 1.6.30 itself drew these three styles empty (it never filled the chart's series). The charts show the
    hit count of each query. The "total" style shows the same values and labels, but its layout differs: the metrics are
    spread across the width of the panel instead of sitting next to each other, the values are bold, the line spacing
    follows the font's normal height, and the settings now offer a "List Format" choice (Horizontal or Vertical) for
    every style, which for "total" sets whether the metrics are side by side or stacked.
  * A heatmap saved by 1.6.30 still loads, and a saved colour such as `green` still renders. A new heatmap's default row
    count is 300 again. What changed: the shading is one continuous scale from lighter to darker than the chosen colour
    (1.6.30 used 11 fixed steps), so the same counts can get a slightly different shade, and the colour menu offers
    `lime` (labelled Greens) in place of `green`; and clicking a cell now adds two "must" filters, one for the row value
    and one for the column value (1.6.30 only sorted the labels). On a transposed heatmap each filter now goes to the
    field whose values the row or column shows, and the axis labels are swapped once.
  * Every heatmap is drawn differently from 1.6.30: its cells are sized to fill the panel (1.6.30 drew 15px squares),
    and it has a colour legend, axis titles with the field names, grid lines and tick marks; the labels are 12px text
    instead of 9pt Consolas in grey, and a label longer than 10 characters is cut to 10 and ends in `...` (1.6.30 cut
    row labels at 8 characters and column labels at 6). The colour menu's entries are labelled "Blues", "Reds", "Grays",
    "Greens" and "Browns". The heatmap's styles apply only inside heatmap panels.
  * The terms panel gained a bar arrangement. Its "Log axis" option draws a logarithmic scale again: the ticks and the
    values use the same scale.
  * The query panel gained an OR/AND "Mode".
* **Solr mode lists collections through `/admin/collections?action=LIST` first**, as the unreleased development line does,
  where 1.6.30 asked `/admin/cores?action=STATUS`. If that request fails, as it does on a standalone (non-SolrCloud) Solr,
  Banana asks `/admin/cores?action=STATUS` and lists the cores, so the alert "Could not retrieve collections from Solr"
  appears only when both fail. On SolrCloud the list now holds collection names, where 1.6.30 listed core names.
* **Node.js is needed to build, and the WAR build is gone.** The Ant, Maven and WAR files, the Jetty context file and the old
  Jetty jars are removed. Banana is built with webpack (`npm ci`, then `npm run build`) into `dist/`, which is plain static
  files. The build needs Node.js 22.18 or later, 24.11 or later, or 26 or later; Node.js 8 is no longer used.
* **Banana is no longer published to npm.** `package.json` is marked private. The `banana-fusion` package already on npm
  stays at 1.6.30. Build from source or use the Docker image.
* **Two map files and one plugin were replaced.** The Japan and world (with Antarctica) maps are regenerated from public
  domain Natural Earth data, and the percent-stacking chart plugin was rewritten, because the originals had no stated
  licence. The maps and the percent-stacked charts may look slightly different.

### Changed

* **"Either" filters are applied on dashboards that have no time filter.** A filter with the mandate "either" (for
  example a word in the `q` parameter of a link that has no `+` or `-`) is sent to Solr on every dashboard. 1.6.30
  dropped these filters when the dashboard had no time filter, so a dashboard of that kind now returns different results
  (fewer documents) than it did in 1.6.30. Dashboards with a time filter are unchanged. The reason, and the option that
  was rejected, are in [ADR 30](docs/adr/0030-panel-and-service-regressions.md).
* **The duplicate-filter test accepts more.** A second query-string filter, or a second filter on the same field from
  the table or full text search panels (for example `host:b` after `host:a`), is added. 1.6.30 refused both because it
  compared only the filter's type, field and value, and these filters have no value. The same filter twice is still
  refused.

### Added

* **A Docker image** that serves Banana with an unprivileged nginx and forwards `/api/`, `/auth/` and `/admin/` to one
  Fusion instance on the same origin. People log in with their own Fusion accounts; the container holds no Fusion
  credential. Guides: [docs/hosting-docker.md](docs/hosting-docker.md) and [docs/security.md](docs/security.md).
* **A Solr preset**, `config.solr.js`, for running against a plain Solr server: copy it over `config.js`. It
  reproduces the earlier plain-Solr settings. It was smoke-tested once on a local Solr 9.11; see the README.
* **New panels**: sankey and force (enabled in `config.js`), which send ordinary `facet.pivot` queries, and significant
  terms, time series and graph, which send Solr streaming expressions (see the stream note above).
* **Dashboard settings** have a "Home" switch.
* **A box plot panel** (`boxplot`, enabled in `config.js` and `config.solr.js`): one box per value of the first facet
  pivot field, drawn from the numbers of the second.
* **Ticker: "Ignore Time Picker".** Off by default. When on, the panel compares the last day, week, month or year with the
  one before it, whatever the time picker says.
* **Terms: custom query as filters.** A new setting, "Add the custom query's filters when a term is clicked", off by
  default. When on and the panel's custom query has `&fq=...` parts, selecting a term adds those filter queries to the
  filters too (always as required, also when the term is excluded).
* **Sunburst labels** (off by default) with the settings "Bold labels" and "Label rings". **Force and Sankey** have a
  "Node Limit" (no limit by default), Sankey a "Label Limit" (no limit by default), and Force's "Mute Category 2" is now
  "Mute Remaining Categories" (a dashboard saved with the old setting keeps its choice). The tag cloud has "Custom Stop
  Words".
* **Licence files.** `LICENSE` replaces `LICENSE.md` and is the full Apache License 2.0 text, `NOTICE` replaces `NOTICE.txt`
  and lists the third-party components that Banana ships, and the built `dist/` keeps the licence comments of the vendored libraries and carries
  `THIRD-PARTY-LICENSES.txt`.
* **Continuous integration** on GitHub Actions (builds and tests on Node.js 22, 24 and 26, plus code scanning), a
  rewritten `package-lock.json` that uses only the public npm registry, and a headless Karma and Jasmine unit test suite.
* A security policy (`SECURITY.md`). `CONTRIBUTING.md` was rewritten for the new build.
* **Banana runs under a content security policy without `unsafe-eval`** (it uses AngularJS's `ng-csp` mode), so it can be
  served with `script-src 'self'`. Expression evaluation may be somewhat slower in this mode. See
  [ADR 29](docs/adr/0029-content-security-policy-without-unsafe-eval.md).
* **The Docker image's default policy drops `'unsafe-inline'` and `'unsafe-eval'`** from `script-src`. Opening a dashboard
  from a GitHub gist needs `api.github.com` in `script-src`, which the image keeps.
* The share-link box still selects its text on click.
* **Updated browser libraries that had known security advisories:** jQuery (1.12.1 to 3.7.1), Underscore (1.5.1 to
  1.13.8) and Moment.js (2.1.0 to 2.31.0). Dashboards, panels and saved data behave as before. The libraries that stay
  on old versions (AngularJS 1.0.8, Bootstrap 2.3.2, jQuery UI 1.10.3, Showdown and the copy of Moment.js inside vis), and
  why that is acceptable, are in [ADR 32](docs/adr/0032-angularjs-1-0-8-stays.md) and
  [ADR 33](docs/adr/0033-shipped-library-advisories.md).

### Fixed

* The ticker panel reads its counts from the time field it requested. Before, a change to or removal of the dashboard's
  time filter while a request was running made the panel look under the wrong field and throw an error in the console.
  A response that has no counts for the requested field, or a Solr error in the response, now leaves the panel without
  counts for that refresh instead of keeping the previous refresh's counts, with no console error. When the response
  has no counts (or fewer than two ranges) and "Ignore Time Picker" is on, the panel also shows that Solr did not return
  two ranges; for a Solr error body it shows Solr's message instead. A query whose response has no counts is left out
  of the panel. When the request itself fails, the panel still shows the error next to the previous counts.
* The saved-dashboard list no longer drops the first character of an id that contains `/` (the Delete button on such a
  row used to name a different dashboard), and the Solr-mode load query still puts the id into the query text,
  but the id is now escaped and URL-encoded first, so it cannot add parameters or change the query.
* In Fusion mode a title containing `?` or `#` is saved, loaded and deleted under the same id.
* A second range filter on a field that already has one is accepted when its bounds differ. 1.6.30 refused it as a
  duplicate; an exact repeat is still refused.
* A relative time range is rounded to its unit again (`NOW/HOUR-6HOUR` to `NOW/HOUR+1HOUR`, as 1.6.30 sent), which lets
  Solr reuse its filter cache. A range in months no longer produces `NOW-1undefined` (1.6.30 had that fault).
* A time range that holds no date objects, as in a dashboard saved with an absolute range or a dashboard file with
  `NOW/HOUR-1HOUR`, no longer makes the ticker panel fail with "Invalid time value" (1.6.30 had that fault).
* Selecting a term, or a custom query filter, that is already among the filters no longer adds it again when its text
  needs URL-encoding (a query, a value with a space, a number).
* The Force panel draws every pivot level it asks Solr for (a third pivot field used to be dropped), and a level without
  a facet limit of its own gets 10 instead of `NaN`.
* The tag cloud's "Stop Words" option can find the built-in list of stop words (1.6.30 had that fault).
* A heatmap hides its loading spinner when its answer arrives, not before (1.6.30 had that fault).
* Opening another dashboard while the collection list of the previous one is still loading no longer logs "Cannot set
  properties of undefined (setting 'core_list')" (1.6.30 had that fault).
* The dashboard list asked for with no query lists every dashboard instead of searching for the id `undefined` (1.6.30
  had that fault).

## 1.6.30 (April 2021)

* The access logs, combined logs and service logs dashboards no longer link to the Metrics dashboard that 1.6.29 removed.
* `package.json` pins Node.js 8.1.4 as the engine used to build Banana.

## 1.6.29 (December 2020)

* The Metrics dashboard file (`lucidworks-metrics.json`) was removed.

## 1.6.28 (December 2020)

* The default dashboard no longer links to the Metrics dashboard.

## 1.6.27 (September 2020)

Versions 1.6.25 and 1.6.26 were intermediate npm releases made from the same change that is described here.

* Banana calls Fusion at `/api/...` instead of `/api/apollo/...`. This is the fix for Fusion 5.2 and later, where the
  `/api/apollo` prefix no longer exists. The defaults in `config.js`, the dashboards that ship with Banana and the
  placeholder in the dashboard settings dialog changed accordingly.
* The 401 handler that sends the browser to the login page was reworded to refer to the Fusion API, with no change in
  behaviour.
* The README told people to build with Node.js 8.1.4 and `grunt build`.
