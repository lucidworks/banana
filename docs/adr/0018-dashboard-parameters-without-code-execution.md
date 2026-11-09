# 18. Dashboard parameters without code execution

Date: 2026-11-06

Status: Accepted

## Context

When Banana loads a dashboard by URL (from a file under `app/dashboards/`, from Solr, from the Fusion blob store, or from a temporary save) it passes the dashboard's JSON text through `renderTemplate` in `src/app/services/dashboard.js`. In 1.6.30 that function set underscore's interpolation pattern to `{{ ... }}`, compiled the text with `_.template`, and ran it with the URL parameters available as `ARGS`. The purpose was to let a dashboard use a URL parameter, for example `{{ARGS.index}}` in an index name.

Underscore builds a JavaScript function from the template, and each `{{ ... }}` is evaluated as a JavaScript expression. So `{{window.__pwned=1}}` anywhere in a stored dashboard ran as code in the page of every person who opened it. Stored dashboards are shared: anyone who can save a dashboard (or write to the Solr collection that holds them) decides what code every later viewer runs. Inside Fusion that code runs in the admin origin with the viewer's session; standalone it runs with whatever credentials the Banana origin holds. A template that was not valid JavaScript made the load throw and showed an empty dashboard.

A second problem: the substituted value was inserted into the JSON text as it was. A URL parameter containing a double quote could end the string it sat in and break the dashboard or change its structure, and a backslash escape such as `\n` in a value was decoded by the JSON parser.

Dashboards loaded from the browser's local storage, uploaded from a file or listed from a gist were never passed through `renderTemplate`, in 1.6.30 or now.

The `_.templateSettings` assignment was also global, so every other use of `_.template` in the page inherited the `{{ }}` pattern after the first dashboard load. No other code in `src/` (outside the vendored libraries) calls `_.template`, so nothing relied on this.

## Options considered

1. **Keep `_.template` and filter the expressions** (for example allow only `ARGS.name`). Rejected: a filter in front of a code generator is easy to get wrong, and the only documented use needs a lookup, not an expression.
2. **Evaluate the templates in a sandbox or a Web Worker.** Rejected: a lot of machinery for a feature that is a plain substitution in practice, and the AngularJS 1.0.8 code base has no sandbox to build on.
3. **Remove parameter substitution altogether.** Rejected: dashboards that take a URL parameter would stop working, which is a larger break than necessary.
4. **Replace only `{{ARGS.name}}` with the escaped parameter value.** Chosen.

## Decision

`renderTemplate` no longer uses `_.template` and no longer changes `_.templateSettings`. It replaces each placeholder of the form `{{ARGS.name}}` (optional spaces inside the braces; `name` is an identifier) with the URL parameter of that name, escaped as the inside of a JSON string, then parses the result as before. A placeholder written outside a string, for example `"span": {{ARGS.n}}`, gets the same escaped value. A value with no quote, backslash or control character passes through unchanged, which is how a number, `true`, `null` or another quote-free JSON value such as an array is passed, as in 1.6.30. A value with a quote or a backslash in that position makes the dashboard fail to load, so it cannot add keys (in 1.6.30, `4, "x": 1` there added the key `x`). A parameter that is not set gives an empty string, as it did in 1.6.30. Only the parameter's own value is read, so `{{ARGS.constructor}}` gives an empty string too. Everything else between double braces is left exactly as written.

## Consequences

This is a change from 1.6.30, made as a security fix.

- Dashboards that use `{{ARGS.name}}` keep working. A value is now kept exactly as given inside its string. In 1.6.30 a quote in a value broke the JSON or changed the dashboard's structure, and a backslash escape such as `\n` was decoded into the character it stands for.
- Arbitrary expressions in `{{ }}` no longer run: `{{ARGS.a || 'x'}}`, `{{ARGS.query.split(',')[0]}}`, `{{new Date().getFullYear()}}` and calls to any function. A dashboard author who used them will see the braces and the expression as literal text in the dashboard (in a title, a query or an index name, for example). The remedies are to edit the stored value, or to compute the value outside Banana and pass it as a URL parameter that a `{{ARGS.name}}` placeholder picks up.
- A dashboard with text that is not a valid expression now loads, with that text unchanged, instead of showing an empty dashboard.
- Banana has no scripted (JavaScript) dashboards; they were removed earlier. The unreleased development line had brought back a `#/dashboard/script/<file>` route (`script_load` in `dashboard.js`) and a sample script dashboard; 1.6.30 has neither, and they are gone again, so the route no longer exists. Panels that render stored text as HTML are a separate concern and are not changed here.
  Update, 2026-11-07: 1.6.30 did ship a sample script dashboard, `src/app/dashboards/logstash.js`, although its code could not load scripted dashboards; it is removed too ([ADR 0034](0034-differences-inherited-from-the-development-line.md)).
