# 21. A link cannot choose the server a dashboard is loaded from

Date: 2026-11-06

Status: Accepted

## Context

When Banana runs against Solr directly (`USE_FUSION` is false), a saved dashboard is opened with a link such as `#/dashboard/solr/My%20dashboard?server=/solr/`. In 1.6.30, `elasticsearch_load` in `src/app/services/dashboard.js` built the request from that `server` parameter, whatever it contained: `server + banana_index + '/select?...'`. AngularJS 1.0.8 merges the query-string parameters of the page address into `$routeParams`, so anybody could send a link with `?server=https://attacker.example/`. Banana then fetched a dashboard from the attacker's server and loaded it, and the dashboard JSON is trusted data: it controls panels, queries and some of what is rendered. One click was enough, and the link looked like an ordinary Banana link.

With Fusion (`USE_FUSION` true) the parameter was computed and then discarded, because the request goes to the blob API (`SYSTEM_BANANA_BLOB_API`). Fusion mode was not affected and is unchanged.

The same line had a second defect: `$routeParams.server + config.banana_index || config.solr + config.banana_index`. The `+` binds tighter than `||`, and a non-empty string is never falsy, so when the parameter was absent the code requested `undefined` followed by the index name instead of falling back to the configured server.

Banana itself writes `server=` into links in two places: the redirect after saving a dashboard, and the "load" links in the dashboard list. Both use `banana_server` when it is set, and otherwise the data server recorded in the dashboard (`solr.server`, which defaults to `solr`).

## Options considered

- **Keep accepting any server.** Rejected: it is the vulnerability.
- **Ignore the parameter altogether and always load from the configured server.** Rejected: it would break every shared link that names a legitimate second server, and links written by earlier Banana versions with `banana_server` set.
- **Accept only the server in `banana_server` or `solr`.** Rejected as the whole rule: people who keep dashboards on a second, known server (a different host, a CORS-enabled server) need a way to say so.
- **Compare origins instead of whole values for the allowlist.** Rejected: the parameter is a base path (for example `/solr/`), and a different path on a trusted origin can be a different application. Exact values are simpler to reason about.
- **Confirm the link by loading the dashboard and checking its own `solr.server`.** Rejected: that requires fetching from the untrusted server first.

## Decision

In Solr mode `elasticsearch_load` uses the `server` parameter only when it is one of:

1. **A same-origin relative path.** The value, as AngularJS hands it over (already URL-decoded), starts with exactly one `/`, the next character is not `/` or `\`, and the value contains no backslash, space or control character (code 0x00 to 0x20, or 0x7f) anywhere. So `/solr/` and `/other/solr/` are accepted; `//host/`, `/\host`, `https://host/`, `https:host`, `HTTPS://host/`, `javascript:...`, a path that does not start with `/`, and values with a tab or newline (which browsers delete before parsing, turning `/<tab>/host` into `//host`) are not. A percent sign that is still present after decoding is left as it is by Banana, but most web servers decode it again, so such a value names whatever the double-decoded path names on the same origin.
   The characters `?`, `#`, `&` and `;` are also refused, because the value is joined to `banana_index + '/select?...'` without encoding: a value such as `/solr/c/select?q=*:*&fl=dashboard:[value v=...]#` (typed, or decoded from `%3F`, `%26` and `%23`) would write the whole query and, with `#`, drop the part Banana appends, which would let a link choose the JSON that is loaded as the dashboard. A trailing slash is not required, because the configured `solr` value need not have one either.
2. **The server Banana writes into its own links:** equal to `banana_server` or, when that is not set, to `solr` in `config.js`.
3. **A listed server:** equal, as a whole string, to an entry of the new `allowed_dashboard_servers` array in `config.js`.

Any other value is ignored. Banana loads the dashboard from the configured server (`banana_server`, or `solr`) and shows a warning that names the ignored value, with the value HTML-escaped because alert text is rendered as HTML, and that points at `allowed_dashboard_servers`. When the parameter is absent, the configured server is used; this fixes the `undefined` request.

`allowed_dashboard_servers` is a new optional setting. Its default is an empty array in `config.js`, `config.solr.js` and the defaults in `src/app/components/settings.js`, and it only matters when `USE_FUSION` is false. No other default changes. An entry must be written exactly as it appears in the link, for example `"http://solr.example.com:8983/solr/"`.

## Consequences

- Links that point at another server no longer load from it unless that server is `banana_server`, `solr`, a relative path or listed in `allowed_dashboard_servers`. This is a deliberate change from 1.6.30.
- It also affects links that Banana itself wrote. With `banana_server` unset (its 1.6.30 default, since the key was ignored), every Solr-mode link 1.6.30 wrote carries the dashboard's stored `solr.server`. If that value is an absolute URL that differs from `solr` in `config.js`, the link now falls back to the configured server with a warning. Banana's own redirect after saving a dashboard hits this, because a save writes to the dashboard's `solr.server` and then reopens it through such a link. So do the shipped guided, syslog and bettermap dashboards, whose `solr.server` is `http://localhost:8983/solr/`, under the Solr preset. The remedies are any one of: add that server to `allowed_dashboard_servers`; set `banana_server` to it; or change those dashboards' `solr.server` to the configured server. Relative servers, the shipped defaults, and links produced with `banana_server` set keep working.
- An accepted relative path can reach any path on the page's own origin, for example another Solr collection or handler. That is acceptable: the request goes to the same origin and carries the same credentials as every other request Banana makes, so a link gains nothing that the page could not already do. Through the `server` parameter, a link can no longer set the query string or leave the origin. The dashboard id in the link is still joined into the Solr query without encoding, as in 1.6.30; this decision does not change that, and it is left to the change that handles dashboard ids.
- A dashboard that is not found on the configured server shows the existing "could not find dashboard" error, as before.
- The check applies to loading only. Saving and deleting already use the configured server and the dashboard's own settings, not the link.
- A listed server is trusted completely: its dashboards load into the page of whoever follows the link. List only servers that you control.
- Fusion mode behaves as in 1.6.30: the parameter is not used, and no warning is shown.
