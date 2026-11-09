# 32. AngularJS 1.0.8 stays, and what that leaves exposed

Date: 2026-11-07

Status: Accepted

<!-- This ADR is committed to the repository. It is written for an outside reader. -->

## Context

Banana is built on AngularJS 1.0.8 (2013), with `angular-sanitize` 1.0.8, AngularStrap 0.7.5, Bootstrap 2.3.2 and
jQuery UI 1.10.3 around it. AngularJS reached the end of its long-term support in December 2021, and nothing after 1.8.3
will be released. Scanners (retire.js and the OSV database, both run against the vendored sources and the built
`dist/`) list the following advisories for the 1.0.x line. The 1.0.8 files are older than most of the fixes, so a scanner
reports every advisory for a range that includes them, whether or not the vulnerable feature exists in 1.0.8.

| Advisory | Summary | Present and reachable in Banana? |
|---|---|---|
| Expression sandbox escapes (several, 1.0.x to 1.5; no CVE on the 1.0.x line, and not listed by the scanners) | An attacker who can put an AngularJS expression (`{{ ... }}`, or an attribute such as `ng-click`) into a template can leave the sandbox and run script | Yes, by design of 1.0.8. The route is a template that contains attacker-controlled text and is then compiled. See below. |
| `ng-bind-html-unsafe` (a 1.0.x directive, removed in 1.2) | Inserts a string as HTML with no sanitising | Mostly closed. The document viewer, the full-text search body and details, the table's hyperlink columns and details, and the alert box are bound with `ng-bind-html` (sanitized) after the values are escaped; only the table's image cell keeps `ng-bind-html-unsafe`, and it is safe by construction (the address is checked, escaped for the attribute and shown as text unless it is `http`, `https` or `data:image`). See [ADR 0024](0024-render-document-data-and-markdown-safely.md). |
| GHSA-r5fx-8r73-v86c, GHSA-prc3-vjfx-vhm9, GHSA-mhp6-pxh8-r675 and the `usemap`, SVG and image-source sanitiser bypasses | `$sanitize` lets some attributes or elements through | Partly: `$sanitize` (the `ng-bind-html` binding and the text panel's HTML mode) is the sanitiser of 1.0.8, which is older and weaker than the one these advisories describe; its output should not be treated as safe against a determined author. |
| GHSA-28hp-fgcr-2r4h (JSONP) | `$http.jsonp` is vulnerable to cross-site scripting through its callback handling | The one `$http.jsonp` call opens a dashboard from a GitHub gist, to a fixed host. Where the Docker image's content security policy is in force, it blocks the script the call would load unless the host is allowed; where no policy is sent (Banana served by Fusion), it does not. |
| GHSA-89mq-4x47-5v83 (prototype pollution in `merge`) | `angular.merge` | Not present: 1.0.8 has no `angular.merge`. |
| GHSA-2qqx-w9hr-q5gx (`$resource`), GHSA-qwqh-hm9m-p5hr (`input type=url`), GHSA-2vrf-hf26-jrp5 (`angular.copy`) | Regular-expression denial of service | `$resource` and `type=url` inputs are not used. `angular.copy` is used on dashboards; the advisory concerns a cyclic or very large crafted object, which a dashboard author can already cause by other means. A browser tab hang is the effect. |
| GHSA-5cp4-xmrw-59wf (jqLite DOM manipulation) | XSS through jqLite when untrusted HTML is passed to it | Banana loads jQuery, so AngularJS uses jQuery, not jqLite, for DOM work. |
| End of life | No further fixes | Yes. |

## Options considered

1. **Upgrade AngularJS to 1.8.3 (the last release).** Rejected. The directive Banana's templates use for HTML
   (`ng-bind-html-unsafe`) was removed in 1.2, the `success` and `error` methods that the services call on `$http` promises were
   removed in 1.6, and a dozen smaller behaviour changes between 1.0 and 1.8 would each have to be found in the 30 panel templates and
   the services. The 1.8 line is itself end of life with advisories of its own. A framework upgrade is also outside what
   this project has taken on.
2. **Move to a different framework.** Rejected: that is a rewrite, not a maintenance step.
3. **Patch 1.0.8 in place.** Rejected: a forked framework file is something every future maintainer has to carry, and the scanners would still name 1.0.8.
4. **Keep 1.0.8, remove the means by which untrusted data reaches it, and say plainly what remains.** Chosen.

## Decision

AngularJS 1.0.8, `angular-sanitize` 1.0.8 and AngularStrap 0.7.5 stay. The following reduce the exposure, and each has its own record:

- Expression text is not taken from dashboards: `{{ ... }}` in a saved dashboard is no longer run as JavaScript, only the form
  `{{ARGS.name}}` is replaced, and by an escaped value ([ADR 18](0018-dashboard-parameters-without-code-execution.md)).
- AngularJS runs in its `ng-csp` mode, so the application works under `script-src 'self'` with no `unsafe-eval` and no
  `unsafe-inline` ([ADR 29](0029-content-security-policy-without-unsafe-eval.md)). **That policy is a header that the
  server sends, and only the Docker image sends it.** Where it is sent, it stops inline script and `javascript:` URLs, so markup that gets
  into the page through `ng-bind-html-unsafe` cannot run script; it does not stop markup that changes what a page looks like,
  nor an AngularJS expression written into the page (the compiler still reads `{{ ... }}` in markup, only its way of
  building functions has changed). **When Banana is served by Fusion 5.9.16 (the primary target), no content security policy is
  sent** (the gateway's responses for `/admin/banana/` carry `X-Frame-Options` and other headers but no
  `Content-Security-Policy`, as recorded when the hosting was tested), and none of this protection applies. In that mode the first residual below
  runs script, not just markup.
- Browser libraries other than the framework that carry advisories are brought to fixed versions where that keeps the
  application working ([ADR 33](0033-shipped-library-advisories.md)).

## Consequences

What stays exposed, and is the known residual of this decision:

- **Stored data in HTML positions.** Closed as far as [ADR 0024](0024-render-document-data-and-markdown-safely.md) and its
  hostile-data check reach: document, schema and dashboard values are escaped or sanitized before they are written as HTML, and
  the one remaining `ng-bind-html-unsafe` (the table's image cell) builds its markup from a checked, escaped address. The
  residuals that ADR lists remain (for example CSS that attribute bindings can add, Solr-mode field lists, popovers, and what
  a real Fusion sends that the stand-in responses do not). **Served by Fusion, no content security policy is sent** (only the
  Docker image sends one), so a sink that the check missed would run script in the page with the viewer's Fusion session.
- **The tooltip path.** AngularStrap's `bs-tooltip` passes its value to Bootstrap's tooltip with `html: true`
  (`src/vendor/angular/angular-strap.js`, the tooltip directive). The values that reach it from documents and dashboards (the
  facet values in the table and full-text search micropanels, the query text in the query panel) are escaped with the `noXml`
  filter before they are given to the tooltip, and the chart tooltips escape what they write ([ADR 0024](0024-render-document-data-and-markdown-safely.md)).
  The tooltip receives text only; a new `bs-tooltip` that is given data must do the same.
- **Expressions in markup.** A string containing `{{ ... }}` that reaches the DOM before a compile, for example a
  text or help message that is compiled, would be evaluated by 1.0.8's expression parser, whose sandbox is known to be escapable.
  Under the image's content security policy, an expression that escapes the sandbox can still read and change the page's data (the
  dashboard in memory, the logged-in user's session through relative requests) but cannot load or run new script. Served by
  Fusion, with no policy, it can also load script.
- **`$sanitize` is weak.** The text panel's HTML mode and every `ng-bind-html` binding rely on it. Treat dashboards that use
  HTML mode as written by someone you trust.
- **No further fixes for the framework.** A newly published AngularJS advisory will not get a patched 1.0.8.
- A deployment that cannot accept these residuals should limit who can save dashboards and write to the displayed collections
  (see the hosting documentation), and, where it can, should serve Banana from the image (or add the same header in front of Fusion) so that the content security policy is in force.

A move to a maintained framework remains the only complete answer and is a larger project than this record.
