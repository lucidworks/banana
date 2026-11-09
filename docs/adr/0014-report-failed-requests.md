# 14. Report failed requests instead of treating them as success

Date: 2026-11-06

Status: Accepted

## Context

In 1.6.30 a failed HTTP request was turned into a success in two places.

- The global response interceptor in `app.js` handled a 401 (redirect to the login page) and, for every other status, returned nothing. A promise whose error handler returns a value resolves, so a 403, 404, 500 or a request that never got an answer (status 0) reached the caller as a success with no data. AngularJS 1.0.8 attaches `.success()` and `.error()` to the promise that the interceptors return, so the `.error()` handlers that show "Could not contact Solr", "Collection not found", "Could not retrieve collections" and similar messages could never run.
- `promiseThen` in the Solr client (`solr-angular-client.js`) returned `response.data` from its error branch, which also resolves. The save and delete code in `dashboard.js` and `dashLoader.js` had "Save failed" and "Dashboard Not Deleted" branches that were therefore unreachable.

The visible results: a save that the server refused showed "Dashboard Saved", and the dashboard was missing or old on the next load. A delete that failed showed "Dashboard Deleted" and removed the dashboard from the list. A panel whose query failed kept its spinner for ever, or threw an error in the browser console that only a developer would see. The same happens in every hosting mode.

The code that was written for the failure case (the `.error()` handlers, the "Save failed" alert, the panel `error` field that the dashboard template shows above the panel) was already there. It was never reached.

## Options considered

1. **Fix only the save and delete paths** (check the HTTP status in `dashboard.js`). Rejected: the interceptor would still hide every other failure, and each caller would need its own copy of the check.
2. **Reject in the interceptor only.** Rejected: the Solr client would still resolve its own failures, and its callers (save, delete, every panel query) would still see a success with a response body that is not a result.
3. **Make `promiseThen` resolve with an object that marks the failure, and have callers test for it.** Rejected: it keeps the "an error is a value" convention that caused the problem, and every caller that does not test would keep treating errors as results.
4. **Reject at both points, and give every caller a failure handler.** Chosen.

## Decision

- The response interceptor is now `components/http-errors.js`. A 401 still sends the browser to the login page with the same return address, and the promise still resolves with no value (the page is leaving). Every other error is returned as `$q.reject(response)`. It uses the AngularJS 1.0.8 `responseInterceptors` list, as before. The `console.log` for a 404 is dropped.
- `promiseThen` in the Solr client calls the error callback it was given (with the response body, as before) and then rejects with the HTTP response, so a caller that waits on the promise learns about the failure. The Elasticsearch client in `src/vendor/elasticjs` has the same function. Only the `derivequeries` panel uses it; that panel was written for Elasticsearch and is not in the list of panels Banana offers, so both are left alone.
- `request_error(response)` on the dashboard controller turns a rejected response into text for a panel: the message in a Solr JSON error body when there is one (what panels showed for a Solr error before), "Could not contact the server" for status 0, otherwise "The request failed (HTTP status N)"; with no status at all it says only "The request failed", rather than quoting a raw script error.
- Every place that waits on a request from the Solr client, `$http` or `$q.all` now has a failure handler. Call sites checked (a rejection with no handler is silent in AngularJS 1.0.8, and a panel without one keeps its spinner):
  - Panels that run a search and have a `.then` on it now clear their loading state and set `panel.error`: bar, bettermap, docviewer, facet, force, fullTextSearch, graph (both requests), heatmap, histogram, hits, map, multiseries, rangeFacet, sankey, scatterplot, significantTerms, sunburst, table, tagcloud, template, terms, ticker and timeseries. Terms, significantTerms and graph also empty their data and redraw, as their own error branch for a Solr error body does. The export buttons of terms, table and fullTextSearch show the error in the panel.
  - `dashLoader.js` (the Save, Load and Share menu): saving already had "Save failed" and now reaches it; deleting shows "Dashboard Not Deleted" and keeps the dashboard in the list; the two dashboard-list requests show "Could not load the list of saved dashboards"; saving a gist now tests for a link rather than for "not undefined", because its error handler returns `false`.
  - The `dashcontrol` panel has the same save, delete, list and gist handlers.
  - `dashboard.js`: loading a dashboard from a file now reaches its "Could not load" alert; loading from Solr or the blob store reaches its `.error()` alert; saving, deleting and listing go through the callbacks above; the user-name lookup already had a failure handler that falls back to `guest`; the gist functions already return `false` on failure.
  - `kbnIndex.js`, `fields.js` and `solrSrv.js` already had `.error()` alerts, which now run. The `.then` callbacks in `kbnIndex.js` and `solrSrv.js` have no failure handler, which is right: nothing waits for them, and a failed request used to end in a `TypeError` on the missing data. `fields.map` has one, and it only logs the status and passes the rejection on. It used to raise a second alert holding the response object; because the page shows only the newest alert, that would have hidden the useful "Collection not found" message, so it raises none.
  - `lucidworksSrv.getFields` (Fusion mode) logs a failed field-list request and counts that list as empty. If both the static and the dynamic field requests fail (for example for a user who may not read the schema), the field list is empty and no alert is shown, as in 1.6.30. Without this, the rejected request would have reached the sort that follows with no data and raised a "TypeError" alert.
  - `getDashboardList` has no handler of its own; its two callers do.
  - Left unchanged because a failure needs no action: the unique-key lookup in the document viewer, and the field-list requests in graph, which only fill an optional list.

## Alert text and escaping

The page shows an alert's text as HTML (`ng-bind-html-unsafe` in `index.html`; since [ADR 0024](0024-render-document-data-and-markdown-safely.md) it is `ng-bind-html`, which sanitizes it, and the escaping described here stays as the first layer). Several alerts that never appeared in 1.6.30 now do, and some quote a value that an outsider can influence: the file name from `#/dashboard/file/<name>`, the dashboard name from `#/dashboard/solr/<name>` or `#/dashboard/temp/<name>` (AngularJS decodes the path before it hands over the route value, so `%3Cimg...%3E` arrives as markup), and the Solr address that is read from a dashboard definition. Left as they were, a crafted link to a missing dashboard would have run script in the page as the person who opened it, in every hosting mode. That is a reflected cross-site scripting hole that 1.6.30 did not have, because the alert was unreachable.

Every request-, address- or dashboard-derived value that these alerts insert is therefore escaped with `kbn.escapeHtml` (new; it escapes `&`, `<`, `>`, `"` and `'`): the file name and the dashboard name in `dashboard.js`, the Solr address (and the numeric status) in the `dashboard.js`, `fields.js`, `solrSrv.js` and `kbnIndex.js` alerts. The messages that were already shown in 1.6.30 are untouched. Panel errors are shown with `{{ }}` and are escaped by AngularJS. Alerts are still rendered as HTML; changing that is a separate decision. New alerts that quote a request or address value must use the helper.

## Consequences

- This is a bug fix: it makes the code that was written for failures run. It restores the behaviour the messages describe. Nothing about a successful request changes, and 401 behaves as in 1.6.30.
- What a person sees differs from 1.6.30 only when something fails. A refused save says "Save failed". A refused delete says "Dashboard Not Deleted" and the dashboard stays in the list. A panel whose query fails stops its spinner and shows the reason in the red banner above the panel. The alerts that were never visible ("Could not contact Solr at ...", "Collection not found at ...", "Could not retrieve collections from Solr", "Could not find dashboard named ...") now appear when their condition happens.
- A dashboard that did not load used to leave a blank page with nothing said; it now says why. A deployment whose Fusion or Solr is not reachable from the browser (for example a cross-origin request blocked by CORS, which AngularJS reports as status 0) now shows the "Could not contact" text, which is the first thing an operator needs to see.
- Code that is added later and waits on a request must give a failure handler. An unhandled rejection is still silent in AngularJS 1.0.8.
- In Fusion mode a user who may not list collections now sees "Could not retrieve collections from Solr (error status = N)" on every dashboard refresh. It also says "Solr" although the server is Fusion. The wording is 1.6.30's own and was never visible; whether it is acceptable for such a user is something to confirm in a run against a real Fusion with a non-admin account.
- The specs in `test/unit/failedRequestsSpec.js` run the real `dashboard` service, the `dashLoader` controller and a table of panels (bar, facet, force, graph, heatmap, hits, map, multiseries, rangeFacet, sankey, scatterplot, significantTerms, sunburst, tagcloud, terms, timeseries) against the mock `$httpBackend`, for a 403, 404, 500 and status 0, in both the blob-store and the Solr save paths, and check that a 401 still redirects. They show how the code reacts to those answers; they do not show what a Fusion gateway answers. That needs a run against a real Fusion.
