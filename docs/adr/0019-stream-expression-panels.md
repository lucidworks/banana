# 19. Stream-expression panels build quoted, read-only expressions

Date: 2026-11-06

Status: Accepted

## Context

Three panels that are not in 1.6.30 send Solr streaming expressions: graph (to `/graph` and `/stream`), significantTerms and timeseries (to `/stream`). They built the expression by concatenating strings.

- The graph panel computed the dashboard's filter queries and never used them, so it ignored every filter, the time range included. The timeseries panel applied the time range only. significantTerms appended the filters as separate `fq=` text after the query, outside any quoting. Solr's `SignificantTermsStream` passes every named parameter on to the search request (`SignificantTermsStream.java:120-122` and `416-420` at 9.6.1), so one filter could take effect, but with several only the last survived, and nothing was quoted.
- All three put the dashboard's global parameters (for example `&wt=json&fq=...`) into the text after `expr=`, so those parameters became part of the expression, which Solr then read as a truncated or malformed one.
- Query text, filter values, field names and settings were inserted unquoted. A comma, a parenthesis or a quote in a query broke the expression. A dashboard author could also write a setting such as a field name that closed the function and added another one, for example an `update(...)` or `delete(...)` decorator. The browser of every viewer of a shared dashboard would then send it to a collection the viewer can reach. The timeseries panel also appended the query editor's free "custom" text after the expression, which could add a second `expr` parameter.
- The expression was not URL-encoded as a whole.

The Fusion 5.9.16 gateway routes `/api/query-pipelines/<pipeline>/collections/<collection>/stream` and `/graph` to the query service, and the `solr-query` stage of the default pipeline refuses them: the answer is HTTP 500 with "Request handler 'stream' not allowed. No custom request handlers are configured in the solr-query stage." The same expression sent to `/api/solr/<collection>/stream` is accepted. In the default configuration, therefore, these panels cannot work through a query pipeline, and before this change the user saw a generic failure or, for the graph panel, a script error.

## Options considered

1. **Escape only the query text.** Rejected: field names, collection names and numeric settings are also dashboard content, and a quote-only fix leaves the way open to add functions through them.
2. **Keep building the text by hand and filter it with a block list of write functions.** Rejected: a block list misses the next function. The panels use a handful of functions, so the allowed set is the safer thing to name.
3. **Send each filter as its own `fq` parameter.** Possible in principle: `SignificantTermsStream` and `TimeSeriesStream` pass named parameters on (`TimeSeriesStream.java:198-203` passes every named parameter except `zkHost`, `start`, `end` and `gap`). Rejected because a repeated named parameter is not reliably kept (with `significantTerms` only one survives), and because one quoted `q` that holds the query and every filter behaves the same for all three functions. The graph panel's root `search` could take `fq`, but one rule for all panels is simpler to check.
4. **Send the request to `/api/solr/...` when the pipeline route refuses it.** Rejected: a query pipeline is where Fusion applies its security and query rules. Sending the same request around it is a decision for the administrator, who can point the dashboard at a direct route, not something the browser should do on its own.
5. **Do not send the request at all when the server is a query pipeline, and show the message at once.** Rejected: the refusal comes from the pipeline's configuration (an administrator can allow custom request handlers in the `solr-query` stage), so a pipeline route is not always a failing one. Saying "not possible" up front would block a working setup.
6. **Quote every value, check names, allow a fixed set of functions, and explain a refusal when it happens.** Chosen.

## Decision

The three panels build their expression with the helpers in `components/streamExpression.js`.

**Quoting.** A string parameter value (the query, a field, the start, end and gap of a time series, the numeric settings) is written in double quotes. The behaviour of Solr's parser, read from its source (`StreamExpressionParser.java:126-133` at releases/solr/9.6.1; the same at 9.1.1, line 128, and in lucene-solr 8.11.2, line 131), decides what can be sent:

- The end of a quoted value is the next double quote that is not escaped, and a backslash escapes the character after it (the scanners `findNextClear` and `isBalanced`).
- After removing the quotes, the parser replaces every `\"` with `"`. It does not turn `\\` back into `\`, so a doubled backslash would arrive doubled.
- It also turns a backtick into a double quote (lines 135-145 at 9.6.1).
- It trims whitespace (characters up to U+0020) at both ends of the quoted value after removing the quotes (`StreamExpressionParser.java:119` at 9.6.1 and 9.1.1, line 123 in lucene-solr 8.11.2).
- It drops comment lines that start with `#` (lines 45-60), so line breaks in a value become spaces.

So `"` is written `\"` and nothing else is escaped: a value such as `foo\:bar` is sent unchanged. A value that cannot be sent exactly is refused, with the message "A value with ... cannot be sent in a streaming expression" in the panel and no request: a value with a backtick, a `"` preceded by an odd number of backslashes, or an odd number of backslashes at its end. Whitespace at both ends of a value is removed before these checks, as Solr would remove it, so `foo\ ` becomes `foo\` and is refused. After that trimming a value is sent exactly or refused. An empty query is sent as `*:*`. The unit tests check the written text and that removing the quotes and the `\"` escapes returns the original value. This was not run against Solr or Fusion from the browser when this record was written. (Update, 2026-11-07: the live smoke test now renders all three panels with data through Fusion 5.9.16's direct Solr route and shows the documented refusal on the pipeline route, [ADR 0012](0012-live-smoke-test.md). It has not been run against a standalone Solr.)

**Names and numbers.** A collection or field name is written unquoted and must match letters, digits, `_`, `.` and `-` (and not start with `.` or `-`); anything else makes the panel show "Invalid field name: ..." and send nothing. Whole numbers (size, rows, minimum term length) and decimals (document frequencies) must be numbers. The timeseries metric must be one of count, sum, avg, min and max, and the sort order of the graph panel is `asc` or `desc`.

**Allowed functions.** After an expression is built, it is checked: it must be one balanced expression, and every function name outside a quoted value must be one of `search`, `nodes`, `fetch`, `select`, `significantTerms`, `timeseries`, `count`, `sum`, `avg`, `min` and `max`. None of them writes. `update`, `commit`, `delete`, `daemon`, `executor`, `topic`, `jdbc` and the rest are refused with an error shown in the panel, and no request is made.

**Filters and time range.** `filterSrv.getSolrFqList()` returns the active filters as plain text, decoded (the filter service stores values URL-encoded because `getSolrFq` puts them in a URL), with the time range first. `querySrv.getOPQueryText()` returns the queries as plain text, joined with the dashboard's operator. significantTerms and graph fold the filters and the time range into `q` as `(query) AND (filter) AND ...`; a filter that only excludes, such as `-level:"debug"`, is written `(*:* -level:"debug")` so that it still selects documents. timeseries folds the filters other than the time range into `q` and passes the time range as `start`, `end` and `field`. In the graph panel the filters apply to the root documents that the search finds; whether `nodes` can filter later hops of the traversal was not verified, so those hops are not filtered. A dashboard with no time filter makes the timeseries panel say "A time filter is required" instead of sending `field=undefined`.

**What is no longer sent.** The dashboard's global parameters are not part of an expression and are not sent to the stream handlers. The "custom" text of the query editor is no longer appended by the timeseries panel. The whole expression is URL-encoded as the single value of `expr`.

**Fusion query pipelines.** The panel always sends the request. If it fails with HTTP status 500, which is what Fusion answered for a handler a pipeline does not allow, and the dashboard's Solr server is a query-pipeline route (the address contains `/query-pipelines/`), the panel's error is "This panel requires direct Solr access. Its dashboard sends requests through a query pipeline, and Fusion does not allow the stream and graph request handlers there unless the pipeline is set up for them. Set the dashboard's Solr server to a direct route such as /api/solr/ to use this panel. (The request failed (HTTP status 500))", with the usual description of the failure in the parentheses. A failed request on a direct route, any other status (a 403 or 404 does not mean the handler is refused), a status 0 (no answer) and an error that Solr reports in the body keep their usual text. Banana does not retry on a direct route.

**Graph panel after a failure.** Any failed graph request (or an expression that cannot be built) clears the last graph, stops the spinner, shows the message and draws nothing. The renderer returns before it creates a canvas when the panel has an error or when there is no graph in the answer. A graph with a single node or a single edge, or with none, is also handled.

## Consequences

- Queries and filters that contain commas, parentheses or quotes work. All three panels now apply the filters and the time range.
- A dashboard setting cannot make the browser send a write or background expression. A dashboard that stores a field or collection name outside the allowed characters shows an "Invalid ..." message in the panel; names in practical use are not affected. If a legitimate field name needs another character, the allowed set can be widened in one place.
- The live acceptance guard refuses any expression with a backslash or an apostrophe. Because a double quote in a filter value or a phrase in a query now appears escaped in the request, and an apostrophe appears unescaped (it is written as it is, and the guard refuses single quotes), a live run refuses these panels on a dashboard that has such filters or queries. It fails closed; live runs use stream panels without them.
- A value that cannot be sent exactly (see Quoting) is refused in the panel instead of being sent changed.
- A viewer of a dashboard that uses a query-pipeline server sees the "requires direct Solr access" text in these panels until an administrator allows the stream and graph handlers in the pipeline or points the dashboard at `/api/solr/`. The Solr preset in the repository, whose server is a direct Solr route, is not affected.
- The panels did not exist in 1.6.30, so no 1.6.30 behaviour changes. The filter and query helpers were added next to the existing ones; `getSolrFq` and `getOPQuery` produce the same text as before and are covered by their existing tests.
- Not verified here: that Solr accepts the quoted form for every parameter, that `significantTerms` and `timeseries` apply the folded query as intended on a real index, and what the Fusion gateway answers for a pipeline that does allow the handlers. Those need a run against a real Solr and Fusion.
