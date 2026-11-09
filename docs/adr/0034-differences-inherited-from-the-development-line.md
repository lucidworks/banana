# 34. Differences from 1.6.30 that came with the development line, and why the build stays on webpack

Date: 2026-11-07

Status: Accepted

<!-- This ADR is committed to the repository. It is written for an outside reader. -->

## Context

This version continues a development line that forked from the 1.6.x releases at 1.6.23 and never shipped. The
release that Fusion 5.9 ships is 1.6.30, so a user of this version is most likely upgrading from 1.6.30 and has never
seen what that line changed. Most of those changes were either put right (see
[ADR 0030](0030-panel-and-service-regressions.md) and [ADR 0031](0031-unreleased-panel-features.md)) or were recorded
when they were made.

Eleven differences from 1.6.30 had no record: five found first, and six more presentation and export differences found
later and recorded in the addendum at the end. They are listed in [../defaults.md](../defaults.md), section 7, and each
was compared with 1.6.30. None changes a dashboard that 1.6.30 saved, except where this record says so. This record
accepts all eleven (a twelfth, the Hits panel's layout, is in the second addendum at the end), so that every difference
that [../defaults.md](../defaults.md) and the changelog list now has a decision record behind it. It also records one
build decision that a later maintainer is likely to ask about.

## Options considered

For each of the first five differences the options were the same two, and the reason for the choice differs only in
detail. The addendum's six differences had the same two options and are decided there.

1. **Revert it to 1.6.30.** Rejected for all five. The operator, the bar arrangement and the Home switch are options
   whose default reproduces 1.6.30; the removed sample dashboard could never be loaded; only the heatmap's empty field
   defaults are limited to new heatmaps; saved heatmaps get the new shading, the redrawn chart and the colour menu
   entry for a saved `green` described in section 3. Reverting would remove features and clean-ups that are already
   in the code, in order to restore behaviour that almost nothing depends on.
   The operator and the bar arrangement have unit tests.
2. **Accept it and record it.** Chosen, with the details below.

For the build, the options were:

1. **Convert the application to ES modules and build with Vite or esbuild.** Considered and deferred, not rejected for
   good. Every application module is written as AMD (`define([...], function (...) {})`), and panels are loaded by
   computed module ids; a conversion rewrites every module and the way panels are found
   ([ADR 0009](0009-webpack-build.md)). Doing that just before the first public release would put the whole
   application at risk and give users nothing they can see.
2. **Keep webpack 5 with the AMD modules.** Chosen.

## Decision

### 1. The query panel's `operator` ("Mode"), default `OR`

*What a 1.6.30 user sees.* The query panel's settings now have a "Mode" choice, `OR` or `AND`. 1.6.30 had no such
choice: when a dashboard had several queries it joined them with `OR` (its `getORquery`). The default, and the value of
a dashboard saved by 1.6.30, is `OR`, so the same dashboard sends the same query. Choosing `AND` joins the queries of
the dashboard with `AND`. A dashboard with no query panel uses `OR`; the operator is forgotten when another dashboard
loads, so one dashboard's choice cannot leak into the next.

*Why it is kept.* It is an opt-in feature whose default reproduces 1.6.30. Reverting it would remove a way to narrow
results without a replacement.

### 2. Terms panel `bar_chart_arrangement`, default `vertical`

*What a 1.6.30 user sees.* The terms panel's bar style has a new setting, `vertical` or `horizontal`. `vertical` is how
1.6.30 drew the bars and is the default, including for a saved dashboard that has no such key. `horizontal` is new and
only appears if someone chooses it.

*Why it is kept.* A new option whose default is the old drawing.

### 3. Heatmap defaults and look

*What a 1.6.30 user sees.*

- A heatmap that a dashboard saved keeps its row and column fields. A heatmap created from the panel menu starts with
  both fields empty, where 1.6.30 filled them with `start_station_name` and `gender`, the field names of a bicycle-share
  sample data set. A new heatmap therefore has no fields set and shows no cells until the user chooses them, instead of
  querying two fields that most collections do not have. Only new heatmaps are affected.
- The panel no longer has the internal `editor_size` setting, and the "invalid rows number" alert is gone. Both belonged
  to a check of the row count that was removed; a saved dashboard that still has `editor_size` loads without effect.
  The row count itself is unchanged (300 by default, see [ADR 0030](0030-panel-and-service-regressions.md)).
- The shading is one continuous scale. The cell colour is the chosen colour lightened or darkened by a number between
  about -3 and 3, using d3's `hsl(...).darker(k)`. 1.6.30 used 11 fixed steps. For the same counts a saved heatmap
  can therefore show a slightly different shade.
- The colour menu offers `lime` (labelled "Greens") where 1.6.30 offered `green`. A dashboard that saved `green` still
  renders it; the menu has no entry for it, so it shows no selection until another colour is chosen. The other entries
  are now labelled "Blues", "Reds", "Grays" and "Browns" where 1.6.30 listed the bare names `gray`, `blue`, `red`,
  `green` and `brown`, in that order; the saved values are the same.
- The chart is drawn differently, for every heatmap, saved or new. Besides the cells and the row and column labels, this
  version draws a colour legend under the chart (a gradient bar from the lowest to the highest count, with eleven tick
  marks and a rounded count under each), the name of the row field and of the column field as axis titles, dotted grid
  lines between the cells, and short tick marks between the labels and the cells. 1.6.30 had none of these. The cells
  are sized to fill the panel: the chart takes the panel's width and the row height, and each cell is that space divided
  among the columns and rows. 1.6.30 drew every cell 15px square, so its chart was as large as the number of rows and
  columns made it, and a heatmap with few rows or columns now has larger cells and one with many has thinner ones. The
  labels are 12px text in the page font, where 1.6.30 drew them in 9pt Consolas (or Courier) in grey (`#aaa`); in the
  dark theme they also take the axis-label stroke described in section 11. A label longer than 10 characters is cut to
  10 and ends in `...`; 1.6.30 cut row labels at 8 characters and column labels at 6, and ended them in `..`. The
  heatmap's stylesheet is a file of its own that applies only inside a heatmap panel: its rules are all prefixed with
  the panel's `heatmap-panel` class, so they do not restyle the axes of other panels on the same dashboard (1.6.30 also
  wrote its heatmap styles into the page, and a few of them, such as the selection colour, were not limited to the
  heatmap). Among the first five differences, the shading and this redraw are the visible ones for saved dashboards; the
  addendum records presentation differences that apply to every dashboard.

*Why it is kept.* The empty defaults avoid pointing a new panel at the fields of a sample data set. The removed check
had no effect on a heatmap that works. The continuous scale is simpler and shows a gradual change that the 11 steps hid,
and the shade difference is small; restoring the steps would mean writing back code whose only purpose is to match a
colour exactly. The legend, axis titles, grid and tick marks make the chart readable without hovering (the legend says
what the shades mean and the titles say which field is on which axis), and the larger label font and longer labels are
easier to read; none of it changes a query, a filter or a saved setting, and a saved dashboard draws the same cells in
the same places. Reverting the drawing would mean writing back the old labels and deleting the legend for no gain a user
would ask for. The `lime` entry is a CSS colour name that d3 can lighten and darken, and a saved `green` is still a
valid CSS colour and is passed through.

### 4. Dashboard `home: true` and the "Home" switch

*What a 1.6.30 user sees.* The dashboard settings have a "Home" switch. 1.6.30 always showed the Home button in the
navigation bar. The default is on, so a dashboard that does not mention the setting, including every dashboard saved by
1.6.30, still shows it; turning the switch off hides the button.

*Why it is kept.* The default reproduces 1.6.30.

### 5. The sample dashboard `logstash.js` is removed

*What a 1.6.30 user sees.* The `dashboards` folder no longer contains `logstash.js`. It was a scripted dashboard, a
JavaScript file that built a dashboard when it was opened. 1.6.30's code could not load scripted dashboards
([ADR 0018](0018-dashboard-parameters-without-code-execution.md): the route that loaded them does not exist, and this
version does not bring it back), and nothing in Banana referenced the file, so nobody could have opened it.

*Why it is kept.* It was dead, and it would have been a sample of exactly the code-running dashboards that are no
longer supported. JSON dashboards, the only form Banana loads, are unchanged.

### The build stays on webpack for this release

`npm run build` keeps webpack 5 with the AMD modules ([ADR 0009](0009-webpack-build.md)). Converting to ES modules and
Vite or esbuild is deferred: it is a rewrite of the build and of every module just before the first public release, with
no gain that a user would see. It can be taken up later as a change of its own, with the dashboards, the smoke check and
the hostile-content check as the safety net.

## Consequences

- [../defaults.md](../defaults.md), section 7, now points here, and every difference from 1.6.30 that it and the
  changelog list has a record: the ones in section 6 have their own, and these twelve are covered above and in the
  two addenda below.
- A user upgrading from 1.6.30 who has saved heatmaps may see a slightly different shade for the same counts, and a
  redrawn chart (legend, axis titles, grid, ticks, label font and length). Apart from the addendum's presentation
  differences, nothing else in this record changes what a saved dashboard shows.
- A new heatmap starts empty and needs its two fields set. That is a change in the panel menu's result, not in saved
  dashboards.
- A reader who wants the original sample dashboard can read it in the 1.6.30 source; it cannot be loaded by this
  version.
- The deferral of the ES-module build costs nothing now. It keeps the AMD modules and the webpack
  configuration as the single place where the bundle is described, and leaves the conversion for someone with time to
  verify every panel after it.

## Addendum, 2026-11-07: six further differences from 1.6.30

After the decision above was written, a second comparison with 1.6.30 found six more differences that the same
development line brought and that had no record. Each is a presentation difference or an export fix. None changes a
default setting or the shape of a saved dashboard. The options were the same two: revert to 1.6.30, or accept and
record. All six are accepted; reverting would discard working code and, in two cases, would restore something that was
wrong in 1.6.30. The comparison was made against 1.6.30 file by file.

### 6. Panel, row and menu icons are links with titles

*What a 1.6.30 user sees.* The icons in a panel's header and the row controls are now links (`<a title alt href="">`)
where 1.6.30 used plain `<i>` elements. The dashboard menu was already made of links in 1.6.30; there the change only
added `href`, `title` and `alt`.

Tooltips. Where an icon carries both a styled tooltip (`bs-tooltip`) and the new `title` on the same element, Bootstrap
2.3.2 moves the `title` into `data-original-title` and blanks it (`src/vendor/bootstrap/bootstrap.js:1302-1306`), so the
browser's own tooltip is suppressed and the styled one shows the title text: the Inspect icon still says "Inspect", and
Configure Row now says "Configure Row" where 1.6.30 said "Configure row". Where the styled tooltip sits on an outer
element and the `title` on the inner link, both appear: the dashboard menu's Save and Configure icons
(`src/app/partials/dashLoader.html:100-101` and `:154-155`) show the styled tooltip and also the browser's own
("Configuration" under the cog), and the panel export icon (`src/app/directives/kibanaPanel.js:56-58`) shows "Export"
and also a native "Save". Menu entries that gained a title and have no styled tooltip
(`src/app/partials/dashLoader.html:16`, `:18`, `:109`, `:114`, `:119` and the export entries at
`src/app/directives/kibanaPanel.js:66-68`) now show a native tooltip that 1.6.30 did not have. The transpose tooltip
reads "Transpose rows and columns" where 1.6.30 said "Transpose Rows and Columns".

Keyboard. A link needs an `href` to be focusable. The collapsed row's Expand icon
(`src/app/partials/dashboard.html:13`), the menu's Clear Browser Default entry (`src/app/partials/dashLoader.html:119`,
whose new title says "Clear Cache") and the heatmap transpose link (`src/app/directives/kibanaPanel.js:44`) have none,
so the keyboard cannot reach them. The Hide row and Row full icons (`src/app/partials/dashboard.html:19` and `:27`) can
be focused but have no title.

Appearance. The panel-header and row icons now take the theme's link colour: `#08c` in the light theme where 1.6.30 drew
them `#333`, and `#fff` in the dark theme where 1.6.30 drew them `#c8c8c8`. The dashboard menu's icons keep their
colour. The row icons carry the `small` class: on an expanded row they lose the rule `.row-open i { font-size: 10pt }`
and are about 14.7px where 1.6.30 drew them at 13.3px; on a collapsed row (Configure Row and Expand row) they are about
11.9px where 1.6.30 drew them at 14px. The heatmap's transpose button uses the `icon-repeat` icon where 1.6.30 drew a
`rotate-icon` span, so its glyph differs, and its show condition is written differently (`panel.transpose_show !=
undefined && !transpose_show` instead of `panel.transpose_show`). For the values the interface sets, the button appears
in the same circumstances: the heatmap is the only panel that defines `transpose_show`, and it sets `true` in both
versions. A dashboard edited by hand to `transpose_show: false` now shows the button.

*Why it is kept.* The links give most controls a keyboard focus and a title, and the tooltips still work. The colour and
size differences are small and affect only how the icons look.

### 7. Bettermap: the coordinate hint now says latitude, then longitude

*What a 1.6.30 user sees.* In the Bettermap panel's settings the hint for "Coordinate Field" reads "Coordinates latitude
and longitude field". 1.6.30's hint said "geoJSON array! Long,Lat NOT Lat,Long", which was the opposite of what the code
did. The message shown when no field is chosen ("Please select a field that contains geo point in [lat, lon] format")
and the comment at the top of the module changed in the same way. Both 1.6.30 and this version read the field the same
way: the value is split at the comma and passed to `new L.LatLng(latlon[0], latlon[1])`, so latitude comes first, and
the spatial filter the panel builds is also latitude then longitude. The panel therefore draws the same points as
before; only the wording changed. The panel also now emits a render event when its settings editor is closed. The
misspelling "longititude" in the hint is corrected in this version (the template text only).

*Why it is kept.* The new wording is correct and the old wording would send people to store their coordinates in the
wrong order. The code was not changed, so there is nothing to restore.

### 8. Full text search: file export applies the custom query

*What a 1.6.30 user sees.* The full text search panel can export its results to a file (CSV, XML or JSON). When the
panel has a custom query, the export now adds it to the export request, as the panel's own search already did in
1.6.30. With no custom query, which is the default, the export is the same as in 1.6.30. With a custom query set, the
export request and the exported rows can differ from 1.6.30: they now match what the panel shows.

*Why it is kept.* An export that ignores the query the panel displays is a bug, and it was fixed in the development
line. Anyone who sets a custom query and exports gets the rows they see.

### 9. Sunburst container sizing and removed debug logging

*What a 1.6.30 user sees.* The sunburst panel's container gets a `min-height` from the panel height, or the row height
if the panel has none, and the element id `sunburst` is gone; the SVG is sized with attributes. The panel's debug
logging to the browser console and its debug flag were removed. A sunburst can therefore take a slightly different
amount of space. The development line described the change as a fix for a sunburst rendering problem in Firefox; that
reason was not verified here. The directive also dropped `terminal: true`, which has no visible effect.

*Why it is kept.* The new sizing is the development line's own fix for a rendering problem, and the debug output was
noise. Nothing in Banana refers to the old element id.

### 10. Internet Explorer 8 and 9 cross-domain adapter and the compatibility meta tag

*What a 1.6.30 user sees.* `index.html` loads `vendor/xhr-xdr-adapter.js`, a script that lets requests to another domain
work in Internet Explorer 8 and 9 through `XDomainRequest`. It returns at once unless `window.XDomainRequest` exists, so
it is inert in every browser that can run this version: the build is ES2015 with no transpile step ([ADR
0009](0009-webpack-build.md)), so Internet Explorer 8 and 9 cannot run it at all. The page's `X-UA-Compatible` meta tag
changed from `IE=edge,chrome=1` to `IE=9; IE=8; IE=7; IE=EDGE; chrome=1`; it has no effect in the supported browsers.
`index.html` also links `css/vis.css`, the graph panel's stylesheet, whose selectors are all `.vis-*`, so it affects
nothing else.

*Why it is kept.* It came with the development line and is harmless. Removing the adapter and the meta tag would change
nothing a user can see. The adapter's licence is recorded in [ADR 0011](0011-licence-and-notices.md).

### 11. Theme CSS: padding and background shades

*What a 1.6.30 user sees.* In both the dark and the light theme, panel padding is 11px where 1.6.30 had 10px. In the
light theme the panel background is a lighter shade (1.5% darker than the page, where 1.6.30 used 5%), and in both
themes the row background is 1.5% darker than the page, where 1.6.30 used 3%. The dark theme also draws axis labels
with the text colour as their stroke. Every dashboard looks very slightly different; no layout or behaviour changes.

The query panel's list of queries also keeps more room on the right: `.last-query` has `padding-right: 70px` where
1.6.30 had `45px` (`src/app/panels/query/query.css`). The last query's input box ends with the search, add and clear
icons; the text inside it now stops 25px further from the right edge, so a long query is no longer typed under them.

*Why it is kept.* The differences are small and cosmetic, and reproducing the old shades would mean regenerating the
minified theme files for no gain a user would notice. The wider padding keeps the icons from covering the text, and the
box itself keeps its size.

### Consequences of the addendum

- A reader comparing this version with 1.6.30 now finds every difference in [../defaults.md](../defaults.md),
  section 7, the changelog and this record.
- The only difference that can change data is the file export of a full text search panel that has a custom query. The
  other five change appearance, wording or keyboard access.
- Reverting any of them later is a code change, and none of them touches a saved dashboard, so it can be done without a
  migration.

## Addendum, 2026-11-07 (second): the Hits panel's "total" layout

A review of the whole `src` tree against 1.6.30 found one more difference with no record. Sections 3 and 11 above were
extended for the heatmap redraw and the query panel's padding, which were found at the same time. The options were the
same two (revert, or accept and record), and the difference is accepted.

### 12. Hits panel: the "total" style is laid out differently

*What a 1.6.30 user sees.* The Hits panel's default "total" style shows one block per metric: the value above its label.
1.6.30 placed the blocks next to each other (`display: inline-block` with 10px of space on their right) and applied the
panel's font size to each block. This version puts the blocks in a flex container that spreads them across the whole
width of the panel (`justify-content: space-between`, wrapping when they do not fit), with the font size on the
container, and draws the values in bold (the labels keep their size of 10pt). A panel with several metrics therefore
looks more spread out than before, and a panel with one metric still starts at the left edge. The panel's settings now
show a "List Format" choice (Horizontal or Vertical) for every style; before, the choice did not exist in the editor (it
was commented out). For the "total" style it sets the direction of the container, so Vertical stacks the blocks one
under the other. The default is Horizontal. Opening the panel writes a `flex-direction` entry into the panel's `style`
setting, so a saved dashboard gains one extra key. The values, the labels and the font size are unchanged; the line
height changed: 1.6.30's lines inherited the theme's fixed height (20px in the light theme, 21px in the dark), while the
container now sets `line-height: normal`, so the lines follow the font size. At the default 10pt each line is about 16px
high instead of 20px, so a default panel's metrics sit about a fifth closer together (a block of value and label is
about 32px high instead of 40px); above about 13pt the value lines are taller than in 1.6.30 (about 39px at 24pt), while
the label line stays about 16px. The bar,
pie and list styles are described in [ADR 0030](0030-panel-and-service-regressions.md).

*Why it is kept.* The layout is only a matter of presentation. Putting the blocks back as inline blocks would remove
the Vertical layout that the new setting offers, and the extra `style` key is ignored by 1.6.30 if a dashboard is
loaded there again.
