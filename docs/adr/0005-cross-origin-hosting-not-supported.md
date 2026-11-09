# 0005. Hosting Banana on a different origin from Fusion is not supported

Date: 2026-11-05
Status: Accepted
Accepted: 2026-11-06

## Context

Banana can be placed on a different origin from Fusion: a static site on one host name that calls the Fusion API on another. It is the simplest thing to try, and it does not work with Fusion 5.9.16 without changes to Fusion and to Banana.

What the runtime does:
- **The gateway refuses a foreign origin.** Requests that carry an `Origin` header other than the Fusion host go through Spring's cross-origin processing and are rejected unless the origin is configured as allowed. Requests with no `Origin`, or the literal `null`, skip the check (`gw:src/main/java/com/lucidworks/cloud/gateway/security/GatewayConfiguration.java:159-178`). Live, on a running 5.9.16 system: a foreign `Origin` got 403 on GET, POST and preflight alike, with no `access-control-allow-*` header, and 200 when `Origin` equalled the Fusion origin. A browser sends `Origin` on a cross-origin XHR or `fetch` call, on a module script, and on a POST, PUT or DELETE. A classic `<script src>` or `<img>` request in no-cors mode sends none.
- **Cross-origin access is configuration only.** The allowed origins, methods, headers, credentials flag and max age come from Fusion's gateway configuration and have no default (`gw:src/main/java/com/lucidworks/cloud/gateway/security/GatewayConfiguration.java:122-156`, `gw:src/main/java/com/lucidworks/cloud/gateway/config/CorsConfig.java:10-20`). Nothing Banana ships can set them.
- **The session cookie does not travel.** It is named `id`, has path `/`, is HttpOnly, carries no `Domain` (so it is bound to the Fusion host only), and is `SameSite=Lax` by default; it is marked `Secure` under https (`gw:src/main/java/com/lucidworks/cloud/gateway/security/filter/JWTCookieFilter.java:96-105`, `gw:src/main/java/com/lucidworks/cloud/gateway/config/SecurityConfig.java:160-163`). A page on another host name cannot read it, and the browser does not send it on a cross-site request that is not a top-level GET. Live: it arrived `Secure; HttpOnly; SameSite=Lax`.
- **Banana sends no credentials.** It never sets `withCredentials` and never adds an `Authorization` or API-key header (`src/app/app.js:88-90`), and it builds its session lookup from its own page's origin (`src/app/services/lucidworksSrv.js:14-15`).
- **Saved dashboards assume the same origin.** Each one stores a relative `solr.server` (`src/app/services/dashboard.js:54-58`, `rel:src/app/dashboards/default.json:671`), which would resolve against the wrong host.
- **The app would hide the failures.** Every non-401 error is swallowed (`src/app/app.js:88-119`), so a cross-origin failure shows up as blank panels with no message. (Update, 2026-11-07: this was true when this record was written and is no longer true. Failed requests are now reported in the panel or in an alert, [ADR 0014](0014-report-failed-requests.md), and a request that never gets an answer says "Could not contact the server". The rest of this record is unchanged, and `withCredentials` and API-key headers are still not used anywhere in `src/app`. The `path:line` references here are to the code at the time of writing.)

## Options considered

1. **Configure Fusion's allowed origins, methods and headers, and make Banana send credentials.** Rejected as a supported mode. It needs a gateway configuration change on every Fusion that Banana is to be used with, which an application cannot ask of its users, plus Banana code that does not exist (credentialed requests, configurable absolute API addresses, a login flow that ends on the right origin). The `SameSite=Lax` cookie would still not be sent on cross-site POST, PUT or DELETE, so it would also need `SameSite=None` on the cookie, which is a security-relevant Fusion setting and is read from the gateway configuration. Every saved dashboard would need its relative `solr.server` rewritten.
2. **Pass an API key from the browser.** Rejected. It puts a Fusion credential in a page served to every visitor, and the cookie-less identity it gives has no username (Live: `x-api-key` sessions have none).
3. **Do not support cross-origin hosting; use a same-origin proxy.** Accepted (ADR 0003).

## Decision

Hosting Banana on a different origin from Fusion is a non-goal. It is not supported, tested or documented as a mode, and no code or configuration in this repository is written for it.

For an operator who insists on it anyway, the following all have to be done by that operator, and none is guaranteed to be enough:
- On the Fusion gateway: set the allowed origins to include Banana's origin, and set the allowed methods and headers for GET, POST, PUT, DELETE, `Content-Type` and any others the requests carry, with credentials allowed if the cookie is to be used. These are `security.cors.*` settings (`gw:src/main/java/com/lucidworks/cloud/gateway/security/GatewayConfiguration.java:122-156`).
- On the cookie: make it travel to the cross-site API, which means `SameSite=None` and `Secure` and thus https on both ends; this is a gateway setting read from the security configuration (`gw:src/main/java/com/lucidworks/cloud/gateway/config/SecurityConfig.java:160-163`).
- In Banana: make requests credentialed (`withCredentials`), give the app an absolute API address and a login address that ends on its own origin, and rewrite the relative `solr.server` in every saved dashboard. None of these settings exist today.

## Consequences

- Users who want Banana outside Fusion run the container described in ADR 0003, where the browser sees one origin.
- Documentation says plainly that a separate origin does not work and why, and points to the container.
- Anyone who finds a cross-origin failure (403 from Fusion, blank panels) is told that the cause is the origin, not a Banana defect.
- If a future Fusion line gives cross-origin access safe defaults or documented settings, this decision can be reopened.
