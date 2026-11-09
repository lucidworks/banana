# 29. A content security policy without unsafe-inline and unsafe-eval

Date: 2026-11-07
Status: Accepted. The jQuery details are superseded by [ADR 0033](0033-shipped-library-advisories.md), which upgraded jQuery (see the update after the table of needs). This record supersedes the script policy of [ADR 0003](0003-standalone-hosting-same-origin-proxy.md).

<!-- This ADR is committed to the repository. It is written for an outside reader. -->

## Context

A strict content security policy is the one browser control that limits what script saved in a dashboard can do. The
policy this record is about is

```
script-src 'self'; object-src 'none'; frame-ancestors 'self'
```

It allows script only from the page's own origin. It has neither `'unsafe-inline'` (so no inline `<script>`, no inline
event handler attribute such as `onclick`, no `javascript:` URL) nor `'unsafe-eval'` (so no `new Function`, `eval`, or
`setTimeout` and `setInterval` called with a string). It sets no `style-src`, so inline styles are not restricted.

Banana did not run under it. Before this change, with that header on the built `dist/`, the page loaded and then
stopped: AngularJS 1.0.8 compiles every expression with `new Function`, so no panel rendered (0 of 27). The earlier
hosting decision ([ADR 0003](0003-standalone-hosting-same-origin-proxy.md)) therefore shipped a baseline policy that kept
both keywords, and recorded that tightening it needed this work.

What was found, by reading the sources and then by running the built page under the policy in Chromium with the
browser's violation reports recorded:

| Need | Where | Needed at run time? |
|---|---|---|
| Inline bootstrap script | The RequireJS-era `index.html` had `require(['app'], ...)` inline. Pull request 367 of the upstream project, by Ahmed Adel, proposed moving it into a file. | No longer present: the webpack build starts the application from `app/app.js` and `config-boot.js`, so `src/index.html` has no inline script. Nothing from that pull request needed to be applied. |
| Inline handler `onclick`/`onfocus` on the share-link input | `src/app/partials/dashLoaderShare.html` | Yes (select-on-click); replaced, see below |
| AngularJS expression compiler (`Function('s','k',code)` in `getterFn`) | `src/vendor/angular/angular.js:6721` | Yes, for every binding; removed by `ng-csp`, see below |
| `d3.csv.parse` builds a row function with `new Function` | `src/vendor/d3.js:1952`, called from the scatterplot panel and the template panel | Yes (scatterplot did not render); replaced, see below |
| jQuery tests `onfocusin`/`onsubmit` support by setting a handler attribute on a detached element | `src/vendor/jquery/jquery-1.12.1.js` (minified feature check) | Refused by the browser; the check gives the same answer as on a browser without the feature |
| Leaflet tests `ontouchstart` the same way | `src/app/panels/bettermap/leaflet/leaflet-src.js:555` | Refused; reached only where `ontouchstart` is not already in `document` (desktop Chrome and Firefox). A touch-capable Firefox desktop that Leaflet previously detected by this probe is no longer detected, so it uses mouse events. |
| `Function('return this')()` inside `try`, falling back to `window` | `node_modules/vis/dist/vis.js:34455` (vis's bundled copy of the webpack global shim; the graph panel) | Refused; the `catch` takes `window`, which is the intended result |
| `_.template` compiles with `new Function` | `src/vendor/underscore.js:1176` | Not used by Banana's code (no call in `src/app`) |
| `jQuery.parseJSON` falls back to `Function("return " + text)()` | `src/vendor/jquery/jquery-1.12.1.js` | Only where `JSON.parse` is missing (none of the supported browsers) |
| `d3v5` `objectConverter` (`new Function`, used by its CSV and TSV parsers) | `src/vendor/d3v5.js:5710`, in the force panel's chunk | Not reached: no panel calls a d3v5 CSV or TSV parser |
| core-js builds a `javascript:` iframe to get a clean `Object.create` | the graph panel's chunk | Not reached: the feature is present, so the fallback is never taken |
| `Function("h,f", ...)` in the HTML5 shiv | the modernizr bundle | Only in Internet Explorer 8 and earlier, which Banana does not support |
| Webpack runtime `Function("return this")()` | the `n.g` helper in the entry bundle | Not reached: `globalThis` exists, and the call is inside `try` |
| Source maps | `webpack.config.js:255` | The production build sets `devtool: false`; only `npm run dev` uses `eval-source-map`, and a development server is not run under this policy |
| `$http.jsonp` for opening a dashboard from a GitHub gist | `src/app/services/dashboard.js:856` | Loads a script from `https://api.github.com`: blocked by `script-src 'self'`. See Consequences. |

> Update, 2026-11-07: the table describes the files as they were when it was written, with jQuery 1.12.1 and Underscore
> 1.5.1. [ADR 0033](0033-shipped-library-advisories.md) replaced them. The two jQuery rows no longer apply: the vendored
> file is now `src/vendor/jquery/jquery-3.7.1.js`, which makes neither the `onfocusin` and `onsubmit` support probes nor
> the `Function("return " + text)` fallback (`jQuery.parseJSON` is now only an alias of `JSON.parse`). Of the probes
> that set a handler attribute, only Leaflet's `ontouchstart` check is left, so opening a dashboard with a Bettermap
> panel shows one inline-handler console error, not two. Underscore's string-compiling template is now at
> `src/vendor/underscore.js:956`, and is still not called. The other `path:line` references in the table were checked
> against the code on this date and hold. The measurements in the Decision (0 of 27 panels before; the live run with 28
> panel types and one or two probe errors) were taken with the earlier jQuery.

## Options considered

1. **Keep `'unsafe-eval'` and document it.** Rejected: it leaves the policy unable to stop injected script, and the
   remaining causes turned out to be removable.
2. **Upgrade AngularJS to a version with a policy-safe mode by default.** Rejected: a framework upgrade is out of scope
   and would change the behaviour of every template.
3. **Edit the vendored libraries to remove the probes (jQuery, Leaflet, vis).** Rejected: the files are minified or
   third party, each edit would have to be redone at every upgrade, and the probes are harmless. They are listed here
   and accepted by name in the checks instead.
4. **Hash or nonce the inline code.** Rejected: there is no inline code left to allow, and hashes do not apply to
   event handler attributes.
5. **Use `ng-csp`, replace the two inline/`new Function` uses in Banana's own code, and prove the result.** Chosen.

## Decision

- `<html ... ng-csp>` in `src/index.html`. In AngularJS 1.0.8 the `ngCsp` directive sets `$sniffer.csp`
  (`src/vendor/angular/angular.js:13206`, inside the directive declared at :13202), after which `$parse` builds closures that walk the path
  (`cspSafeGetterFn`, `angular.js:6613`) instead of calling `Function`. The directive's `compile` runs on the root
  element before any binding is parsed, so every expression is parsed in the safe mode. The AngularJS documentation
  for this mode says expressions evaluate up to 30% slower; that was not measured here, and the language accepted by expressions is unchanged (the parser itself is the same; only the getter
  for a dotted path differs). 1.0.8 has no other `ng-csp` effect. The page sets `ng-csp` on both `<html>` variants.
- The share-link input's `onclick="this.select()" onfocus="this.select()"` became a `select-on-focus` directive
  (`src/app/directives/selectOnFocus.js`) that binds the same two events to the same call. AngularJS 1.0.8 has no
  `ng-focus`, so a small directive is used, as for `ng-blur` (`src/app/directives/ngBlur.js`). Behaviour is unchanged.
- The two panels that parsed CSV with `d3.csv.parse` use `src/app/components/csv-rows.js`, which reads the rows with
  `d3.csv.parseRows` and builds the row objects directly. It returns what `d3.csv.parse` returns, including the row
  index passed to the mapping function and the dropping of rows the mapping returns `null` for (unit tests compare
  the two on quoted fields, embedded commas and quotes, and an empty input).
- The hosting image's baseline policy drops `'unsafe-inline'` and `'unsafe-eval'` from `script-src`; everything else in
  it is as before (`docker/banana-entrypoint`, the header test, and the hosting documents). The sources an operator
  can append (`BANANA_CSP_SCRIPT_SRC`) still go after `https://api.github.com`.
- Checks that keep it this way:
  - `test/node/content-policy-source.test.js` fails on an inline `<script>`, an inline event handler, a `javascript:`
    URL, a string-compiling call in Banana's own scripts, or the removal of `ng-csp`.
  - `node tools/smoke.js --csp` serves the built `dist/` with the strict header on all three base paths and requires
    every panel to render and the browser to report no policy violation other than the three probes in the table
    (the handler-attribute probes are matched by count: every handler attribute that jQuery or Leaflet sets on an element
    outside the page has to cause exactly one inline-handler violation, and a different count fails; the vis refusal is
    matched by its script, the graph panel's chunk. Two cases are not told apart,
    because the browser's report does not name the attribute: a probe that causes no violation at the same moment as a
    real inline handler does, and page script that sets a real handler under one of the probe attribute names
    (`onfocusin`, `onsubmit`, `onchange`, `ontouchstart`) on an element outside the page, which is counted as a probe). `test/node/content-policy-render.test.js` runs it as part
    of `npm run test:node` whenever `dist/` and a Chromium are present.
  - The live smoke test (`npm run test:live`) counts the inline-handler console errors of the two handler-attribute
    probes apart from other errors, accepts at most two in a session, and treats every other console error (except
    the existing aborted off-origin resources) as unexpected. It logs the `Content-Security-Policy` header of the page
    as the browser received it. It was run against a Fusion 5.9.16 instance through the hosting image built from the
    branch: the header read from the live response had `script-src 'self' https://api.github.com` and no
    `unsafe-inline` or `unsafe-eval`; all 28 panel types rendered, with 0 unexpected console errors and 1 probe
    error in the panel test (the other probe runs while the login page loads, before the test watches the console). Why
    two: a watched session loads the page once and then moves between dashboards without reloading, so with jQuery 3
    only Leaflet's probe fires, once, and only when a dashboard with a Bettermap panel has been opened. The second is
    room for one reload (a reload runs Leaflet's probe again if the reloaded dashboard has a Bettermap panel, and, with
    the earlier jQuery, jQuery's too). A session that reloads more often would hit a third probe error, and the test
    would fail rather than hide anything, so the cap errs on the strict side.

## Consequences

- Under the strict policy every panel renders and the dashboard can be saved, reopened and deleted. The browser console
  still shows a policy error from the handler-attribute probe in the table (two, from jQuery and Leaflet, with the jQuery that was current when this was written; one, from Leaflet, now). The vis refusal is reported to violation observers only and logs no console message. None of them changes what a panel does. A user or an
  operator watching violation reports (a `report-uri`, or the report-only mode) will see them; they can be recognised
  by the script that reports them.
- Opening a dashboard from a gist (`$http.jsonp` to `api.github.com`) needs `https://api.github.com` in `script-src`.
  The hosting image keeps it. An operator who serves exactly `script-src 'self'` loses that one feature; saving to a
  gist posts with XHR and is governed by `connect-src`, not `script-src`.
- Inline styles still work because no `style-src` is set. A policy that also restricts styles needs further work: the
  build injects `<style>` elements for several panels, AngularJS adds one for `ng-cloak`, and templates use `style`
  attributes.
- The image's stricter policy is a change from the baseline of [ADR 0003](0003-standalone-hosting-same-origin-proxy.md),
  which is superseded on this point. Any markup saved in a dashboard that relied on an inline handler (for example an
  `<img onerror=...>` in a text panel) no longer runs under the image's policy; that is the purpose of the change.
- Operators who serve Banana with their own policy can use the strict policy above, or any looser one.
- A new vendored library, or an upgrade of vis, jQuery or Leaflet, can add a new need for `'unsafe-eval'` or
  `'unsafe-inline'`. `node tools/smoke.js --csp` reports it as a violation that no probe explains.
