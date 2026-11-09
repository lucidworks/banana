# 0030. Restoring what the unreleased development line broke in panels and services

Date: 2026-11-06

Status: Accepted

## Context

The development line that this version continues contains changes that 1.6.30 users have never seen. Several of them
made panels or services behave worse than 1.6.30 on dashboards that 1.6.30 saved. Comparing each with 1.6.30 showed:

- **Hits panel.** The template only had the "total" style and the chart directive had been deleted, so a dashboard
  saved with the bar, pie or list style showed an empty panel. In 1.6.30 the template and the directive were present,
  but the series that they draw (`$scope.data`) was no longer filled: the code that filled it had been commented out
  when the multiple-metrics option was added. So 1.6.30 itself drew an empty chart for these styles, and the styles
  were hidden from the editor. They worked in the releases before that.
- **Heatmap.** Clicking a cell to filter is new in the development line (1.6.30 only sorted by a label). On a transposed
  heatmap the rows show the values of the column field, but the click filtered the row field with them. The two axis
  labels were swapped once for every row of data, so an odd number of rows left them swapped and an even number left
  them as they were. The default number of rows had also changed from 300 to 5.
- **Terms panel, log axis.** The transform and inverse transform of the log scale were commented out while the
  log-spaced ticks stayed, so the tick labels and the bar heights used different scales.
- **Collection list.** 1.6.30 asked CoreAdmin (`/admin/cores?action=STATUS`). The development line asks the Collections
  API (`/admin/collections?action=LIST`), which a standalone Solr does not have, so it showed an error alert there.
- **Time and filters, shared with 1.6.30 or introduced since.** A relative range sent `NOW-6HOUR`, where 1.6.30 sent
  `NOW/HOUR-6HOUR` (which lets Solr reuse its filter cache): this one is a regression of the development line. The
  next ones are faults that 1.6.30 has too: a second range filter on a field was refused as a duplicate, because the
  duplicate test ignored the bounds; a timespan in months gave `NOW-1undefined`; a time filter that holds no date
  objects (a dashboard saved with an absolute range, which stores ISO strings, or a dashboard file with a relative
  range such as `NOW/HOUR-1HOUR`) was read back with invalid dates, so a panel that reads the range before the time
  picker replaces it, such as the ticker, threw "Invalid time value"; and the Fusion dashboard list asked for with no
  query searched for the id `undefined`. The heatmap also cleared its loading flag before its answer arrived.
- **Dashboard switch (shared with 1.6.30).** When another dashboard was opened while the collection list of the previous one was loading, the
  answer was written into a dashboard that no longer existed and threw "Cannot set properties of undefined". The code is
  the same in 1.6.30.

## Options considered

Hits panel:

1. **Restore the template and directive only, as 1.6.30 had them.** Rejected: the chart would be empty, as it was in
   1.6.30, and the restored styles would still be useless.
2. **Restore them and fill the series from the hit count of each query.** Chosen. It is what the code did before the
   multiple-metrics option when the option to show a statistic instead of the count was off (which was the default),
   and it only adds content to styles that showed nothing. The series are matched to the panel's own query ids, which
   depend on the query mode, in the order of the requests.
3. **Leave the styles out and document that they are gone.** Rejected: it breaks dashboards that 1.6.30 loads.

Heatmap default row count:

1. **Keep 5.** Rejected: a heatmap created from the panel menu would show a fifth of the rows that it shows in 1.6.30.
2. **Restore 300.** Chosen. A heatmap that a dashboard saved keeps the row count it was saved with. The row and column
   field defaults (which name a sample data set in 1.6.30 and are empty now) are not changed here.

Transposed click:

1. **Swap the arguments in the chart code.** Rejected: that code also builds the tooltips, and the mapping belongs with
   the code that sets the filters.
2. **Map in `build_search`, from whether the data shown is transposed.** Chosen. The state is taken from the last time
   the data was laid out, not from the panel setting, because the editor changes the setting before the data is
   laid out again.

Collection list:

1. **Go back to CoreAdmin only.** Rejected: on SolrCloud it lists replica core names (`logs_shard1_replica_n1`), which
   are not collection names that a dashboard can query.
2. **Collections API first, CoreAdmin when it fails.** Chosen. The alert is shown only when both fail. On SolrCloud
   the list holds collection names, which differs from 1.6.30; on a standalone Solr it equals 1.6.30.
3. **Choose by a setting.** Rejected: it asks the person installing Banana something that the server can answer.

Duplicate filters:

1. **Compare the bounds of range filters.** Chosen. The development line's test compared type, field, query and
   value (1.6.30's compared only type, field and value, see the update at the end); two ranges are the same filter only
   when their bounds are equal too.
2. **Allow any number of range filters on a field.** Rejected: the same range twice has no use and fills the filter
   panel.

Time bounds without date objects:

1. **Fix the ticker.** Rejected: the histogram and other panels read the same range through the filter service.
2. **Work the date objects out of the stored bounds in the filter service when the saved ones are missing.** Chosen,
   so that every panel gets valid dates. An ISO date is read as it is, and Solr date math (`NOW`, `/HOUR`, `-1HOUR`,
   `%2B1DAY`, and so on) is worked out against the current time. The filter that is sent to Solr is not changed. Ranges
   that the time picker saved with date objects keep them.

Dashboard switch:

1. **Write the list into whatever is the current dashboard.** Rejected: it is the dashboard the list was not asked for.
2. **Ignore the answer when the dashboard that asked has been replaced.** Chosen. The new dashboard asks for its own
   list when it loads.

## Decision

The choices marked above. In addition:

- The restored pie label escapes the series name, and no longer carries the click attribute that the 1.6.30 label
  built from it: that attribute was never compiled, so it did nothing, and it put the name into markup.
- The font size selector of the Hits editor applies to the list style as well as to the total style, as in 1.6.30.
- A time range in months (`M`) sends `MONTH`.

## Consequences

- The time and filter fixes change behaviour that 1.6.30 has too: a second range is accepted, a months timespan sends
  `MONTH`, and the ticker no longer throws on a range without date objects.
- A dashboard saved with the Hits bar, pie or list style renders a chart or a list of the hit count of each query. A
  dashboard saved by 1.6.30 with one of these styles drew nothing; it now draws something. This is the only visible
  difference from 1.6.30 in these styles.
- The heatmap's filter-on-click is still a feature that 1.6.30 does not have. It now filters on the right fields in both
  orientations.
- On SolrCloud the collection list has collection names instead of core names. A dashboard that names a core still
  loads: the list is only used to offer choices in the dashboard settings.
- The restored Hits tooltip passes the query colour to `kbn.query_color_dot`, which writes it into markup. It relies on
  the escaping and colour normalisation that the safe-rendering change gives that function or its callers, and is not
  changed here. (Update, 2026-11-07: that change landed inside the function itself: `kbn.query_color_dot` passes the colour
  through `kbn.safeColor` and escapes it, so the Hits tooltip is covered, [ADR 0024](0024-render-document-data-and-markdown-safely.md).)
- The date objects worked out from Solr date math are only used to draw and to read the range back; they are not what is
  sent. They differ from what Solr would compute in some edge cases: adding a month or a year to a day that the target
  month lacks rolls over (31 January plus a month gives 2 March, where Solr gives 29 February), month and year additions
  drop the milliseconds, an ISO date with a time-zone offset or a date with no time is not read (the panel gets an invalid
  date; Solr refuses both in a filter as well), an ISO date with no `Z` is read as local time, `*` as a lower bound is read
  as now, and `/MILLI` and `MILLISECOND` are not understood. None of them changes the query.
- The unit tests check the code against the mock `$httpBackend` and a stand-in for the chart library. They do not show
  what a Solr, a Fusion or a browser draws. The CoreAdmin fallback was not run against a standalone Solr.
- The live smoke test no longer tolerates the ticker's "Invalid time value" error. It was changed without a live run, so
  a run against Fusion should confirm it. It avoids the collection-list race by waiting for the default dashboard to
  load, as before, and still does.

## Update, 2026-11-07: two filter differences from 1.6.30 that are kept

A later comparison of the filter service with 1.6.30 found two more behaviours that the development line changed and
that this record had not described. Both are kept, for the reasons below.

### "Either" filters on a dashboard that has no time filter

*What a 1.6.30 user sees.* A filter whose mandate is "either" (the filters of one group are joined with `OR` into a
single filter query) is now sent on every dashboard. 1.6.30 dropped these filters when the dashboard had no time filter:
its filter service returned before it added the "either" group, so on such a dashboard an "either" filter was listed in
the filter panel but never reached Solr. On a dashboard with a time filter 1.6.30 sent the group, as this version does.
A dashboard with no time filter that holds an "either" filter (for example one made from the `q` parameter of a link,
where a word without a `+` or `-` prefix becomes an "either" filter, or one set in the filter panel) therefore sends one
more filter query than before, and its panels can show fewer documents and different counts than they did in 1.6.30.
Dashboards without such filters, and every dashboard that has a time filter, send the same requests as before.

*Options considered.*

1. **Keep the group when there is no time filter (what the code does).** Chosen.
2. **Drop it again, as 1.6.30 did.** Rejected: restoring it would silently ignore a filter that the user set and can see
   in the filter panel, so the panels would show documents that the filter is meant to exclude. Nobody can have relied
   on that on purpose.

*Consequence.* This is a change of results, not of saved data: the dashboard file is the same, and a user who wants the
old results removes the "either" filter.

### The duplicate-filter test accepts more than 1.6.30 did

*What a 1.6.30 user sees.* A filter is refused as a duplicate only when an existing filter has the same type, field,
query, value, bounds and editing state. 1.6.30 compared the type, the field and the value only. A query-string filter
and a filter made by the table or full text search panels (a `field` filter, which carries a query and has no value)
have no value, so in 1.6.30 any second filter of the same type and field was refused: a second query-string filter, or
`host:b` after `host:a` from the table panel's "filter on this value". This version accepts them, because their queries
differ; the same query twice is still refused. The first version of this record said the old test "already compared" the
query; that was true of the development line's test, not of 1.6.30's.

*Options considered.* Keep the wider comparison (chosen: refusing a filter that differs from the existing ones only
hid a choice the user made), or go back to the three-field test (rejected: it is the cause of the second filter being
dropped without a message).

*Consequence.* A user may now see two filters where 1.6.30 showed one. Both are applied. This differs from 1.6.30 and
no saved dashboard changes.
