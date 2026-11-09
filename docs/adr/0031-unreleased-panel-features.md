# 0031. Taking over the panel features of an unreleased development branch

Date: 2026-11-07

Status: Accepted

## Context

A development branch that was never released (`nsf-ticker-and-terms-panels`) holds twelve commits that add or change
features in several panels. They were written against an older code base (RequireJS, Grunt, an older set of panel
fixes), so they cannot be merged or cherry-picked: this record lists what was taken over by re-applying the change to
today's code, what was changed on the way, and what was left out.

The rule for every feature below is the same: a dashboard that 1.6.30 saved must draw and behave as it did, so each new
setting is off, empty or "no limit" by default.

### What the twelve commits did, and what became of each

| Commit (subject) | Author | Outcome |
| --- | --- | --- |
| Improve Terms panel: a custom query is added to the filters when a term is selected | Andrew Thanalertvisuti | Taken over, changed (see below) |
| Fixed a bug in `filterSrv.js` to correctly detect duplicate queries | Andrew Thanalertvisuti | Taken over, merged with the range-bounds fix that was already here |
| Fixed grunt build error by removing arrow functions in the Terms panel | Andrew Thanalertvisuti | Not needed: the code it fixes was rewritten without arrow functions, and the AngularJS 1.0.8 panels keep to ES5 |
| WIP: add an option to ignore the time picker in the Ticker panel | Andrew Thanalertvisuti | Taken over as one feature with the next five Ticker commits |
| Reformat code (two commits, `ticker/module.html`) | Andrew Thanalertvisuti | Dropped: whitespace only |
| Add description and options for selecting the trend interval | Andrew Thanalertvisuti | Taken over with the Ticker option |
| WIP: got Solr query working for getting trend data | Andrew Thanalertvisuti | Taken over with the Ticker option |
| Finished the Ignore Time Picker option for the Ticker panel | Andrew Thanalertvisuti | Taken over with the Ticker option |
| Change the way the Ticker panel calculates the trend | Andrew Thanalertvisuti | Taken over: the two ranges are no longer rounded to calendar days or weeks |
| Changes in multiple panels | Piotr Godek | Taken over in part: box plot, Sunburst labels, Force and Sankey limits, tag cloud stop words (see below); the heatmap and Hits parts dropped |
| Set DEBUG = false | not recorded | Dropped: it undoes a `DEBUG = true` that the "multiple panels" commit set in the Force and Sankey panels, and those were never switched on here |

## Options considered

**Merge or cherry-pick the branch.** Rejected: the branch pre-dates the build, the AngularJS 1.0.8 constraints and several
panel fixes, and its commit subjects carry internal ticket keys.

**Take every change as written.** Rejected: several would have altered how an existing dashboard draws or behaves
(listed below).

**Vendor the box plot library (`d3-box`) from the branch.** Rejected. The file is "taken from" a public gist and carries
no licence of its own. Its provenance cannot be established, and a vendored file needs a licence text that ships with
it. The box plot panel draws its boxes with a small amount of its own code on the D3 3.x primitives that Banana already
ships, so no library and no licence text were added.

**Vendor `underscore.string` for two helpers** (trimming, and cutting a label with "..."). Rejected: two short
functions are cheaper than a library and its licence entry.

## Decision

### Box plot panel (new)

The panel `boxplot` is new. It shows one box per value of the first facet-pivot field, from the numbers of the second:
quartiles, median, whiskers at 1.5 inter-quartile ranges, and the values beyond them as dots. It is added to
`panel_names` in `config.js` and `config.solr.js`; adding a new, optional panel to the list does not change any
existing dashboard, and 1.6.30's panels are all still listed.

Changes from the branch version: it uses the same query builder as the other panels (the branch called a function that
does not exist here); values that are not numbers, boxes without numbers and a missing pivot no longer throw; with
"unique values" off a value counts as often as it occurs, worked out from the counts and not by repeating the value
(a count in the millions would otherwise freeze the browser); a failed request, or fewer than two fields, is reported in
the panel; every name and number is written as text, never as markup, and hovering a box shows its figures in a native
tooltip; and the "number of nodes exceeds the limit" notice, which the branch copied into this panel without a limit to
exceed, is not there.

### Ticker: "Ignore Time Picker"

New setting `ignore_time_picker`, **off** by default. When it is on, the panel compares the last day, week, month or year
with the one before it (setting `trend_interval`, "Day to Day" by default) and ignores the time picker's range. Without
the setting the panel's request and its result are unchanged.

Changes from the branch version: it shows one trend for each selected query (the branch used the first query only, and
failed when that was deleted); both ranges come from one clock reading, so they meet exactly; an answer with no ranges,
or a failed request, is reported in the panel; and an earlier range with no hits shows "?" as it does without the option
(the branch showed the new count times 100). The list of intervals is not saved with the panel. The ranges are built by
Solr from a start and a gap, so for months and years they are as long as Solr's date math makes them.

### Terms: custom query as filters

The custom query is a 1.6.30 setting, and clicking a term in 1.6.30 adds only the term. So this is a new panel setting,
`custom_query_filters`, **off** by default ("Add the custom query's filters when a term is clicked"), and with it off a
click does exactly what it did in 1.6.30. With it on, and a custom query with `&fq=...` parts, selecting a term adds each
filter query to the filters as well, so that the other panels show the same documents as the chart did. A custom query
without `fq` parts adds nothing.

Changes from the branch version: each `fq` becomes its own filter (the branch joined them with `AND`, which changes the
meaning of a part that holds `OR`) and is decoded first the way the panel's own request is (a form-encoded body: `+` is a space, then percent-decoding), so
`&fq=price:[0+TO+100]` is stored as the text that the chart searched with, and one that was typed encoded is not encoded
twice; and the filters are always required, also when the term is excluded, because the exclusion applies to the term and not
to the custom query (the branch excluded the custom query as well). One limit: when a part holds an invalid percent
sequence (`a%20b%`), decoding that part fails and it is stored as typed, while the chart's own request decodes the valid
sequences, so for such a malformed custom query the stored filter and the chart's filter differ.

### Duplicate filters

A filter's query or value is stored URL-encoded, but the check for a duplicate compared the stored text with the new,
unencoded text, so a query filter, or a value that needs encoding such as `New York`, or a number, was never found to
be a duplicate and a second click added it again. The check now compares the stored text with the text as given and with
the same text encoded. The branch did this for the query only; it is done for the value too, since it is the same fault.
This sits next to the earlier change that also compares the range bounds (`from`, `to`): both conditions are in one
check, and a second range with other bounds is still accepted.

### Sunburst labels

New settings `labels` (**off**), `bold_labels` and `label_rings` (2). Labels are written as text on the slices of the
first rings, and they fade with the slices when the pointer is over one. Not taken over: the branch's change of the
chart's side margins and of the element's width, which moves existing charts, and its second layout pass.

### Force and Sankey

- Both get a `node_limit` (**0, meaning no limit**; the branch's default of 1000 would cut existing diagrams). When the
  limit stops the diagram, a notice says so. The flag lives on the scope, not in the panel, so it is not saved in the
  dashboard.
- Sankey gets a `label_limit` (**0, no limit**; the branch's 50 would shorten the labels of existing diagrams): longer
  labels are cut and end in "...".
- Force: "Mute Category 2" becomes "Mute Remaining Categories" (the second category and every one after it).
  A dashboard saved with the old setting keeps its choice. Force now draws every pivot level it asks Solr for, as Sankey
  already did, where it used to draw two and drop the rest (a dashboard with three pivot fields draws the third level
  now). A pivot level with no entry in the facet-limit list gets 10 where it used to send `NaN`.

### Tag cloud: custom stop words

New settings `customStopWords` (empty) and `customStopWordsLowercase` (on). The words are added to the built-in list
when "Stop Words" is checked. The built-in list file is now an AMD module that returns the list. 1.6.30 had the same
fault: its `stopWords.js` was a plain script that defined a global variable, loaded by RequireJS without a shim, so the
panel received `undefined` and checking "Stop Words" could not find the list. The current build has it too (the script
yields an empty module).

### Left out

- The heatmap and Hits parts of the "multiple panels" commit: replacing `const`, arrow functions and destructuring with
  ES5 and removing an unused import are not needed with the present build, and the Hits part is style-only.
- The two whitespace-only commits, the two work-in-progress markers, and the debug switch.

## Consequences

- The panel list has one more entry (`boxplot`); the build check, the smoke check (which now draws the box plot) and
  the live test dashboard cover it. The live dashboard's new box plot has not been run against a real Fusion.
- A saved Force dashboard that used the old setting name keeps working, and the next save writes the new name.
- A Force dashboard with three or more pivot fields draws more nodes than before. This is the change that most alters
  how an existing dashboard looks, and it makes the drawn data match what the panel already asks Solr for. A tag cloud
  dashboard saved by 1.6.30 with "Stop Words" checked also changes: 1.6.30 could not find the list and threw, and the
  panel now draws a filtered cloud (see the tag cloud section above).
- The Ticker's "Ignore Time Picker" ranges end at the moment the data is requested, so two requests a minute apart can
  show slightly different numbers. The panel needs no time filter with the option on: it uses the time filter's field if
  there is one, and the configured `timefield` otherwise.
- Month and year ranges are built by Solr from the start and the gap, one gap at a time, so a start day that a shorter
  month does not have (the 30th, 31st, or 29 February) moves the later boundaries: the second range can end a few days
  before the request time and a short third range holds the rest. Only the first two ranges are used, so the newest few
  days can be missing from "now" in those months. Day and week ranges are exact.
