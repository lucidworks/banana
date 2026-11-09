# Running Banana in Docker, in front of Fusion

This guide is for running Banana outside Fusion, as a container next to it. The container serves Banana's files and
forwards `/api/`, `/auth/` and `/admin/` to one Fusion instance, so the browser only ever talks to one origin. Every
person logs in with their own Fusion account. The container holds no Fusion credential and has no setting for one.

Read [security.md](security.md) before you put it in front of real users. The reasons for the design are in
[ADR 0003](adr/0003-standalone-hosting-same-origin-proxy.md) and [ADR 0023](adr/0023-docker-image.md). Hosting Banana on
a different origin from Fusion, without this container, does not work with Fusion 5.9 and is not supported
([ADR 0005](adr/0005-cross-origin-hosting-not-supported.md)).

In the examples the Fusion address is `https://fusion.example.com` and Banana's public address is
`https://banana.example.com`. Replace both.

The commands in this guide were run against a Fusion 5.9.16 system. Where something was not run, or not observed, the
text says so.

## Prerequisites

- **Fusion 5.9.x.** The container was tried against Fusion 5.9.16. It talks to Fusion's gateway, the same address as
  the admin UI, and nothing else. It does not need any change in Fusion.
- **A realm that takes a user name and password** (for example the built-in `native` realm). Single sign-on realms
  (SAML, OIDC, Kerberos) are not supported through the container: the login ends on Fusion's own address, the
  container never gets a session, and the person sees a login loop. Those users open Fusion at its own address.
- **People with their own Fusion accounts.** Each user needs permission to read the collections they chart and, to save
  and delete dashboards, permission on Fusion's blob store (`GET`, `PUT` and `DELETE` on `/blobs/**`). Fusion's shipped
  administrator and developer roles have it. For a narrower role, see [security.md](security.md#least-privilege-role).
  A person who lacks blob permission can use Banana, but a save fails.
- **A name that DNS resolves.** The Fusion address must use a DNS name, not an IP address, and not a name that exists
  only in a hosts file (see [Troubleshooting](#troubleshooting)).
- **Docker.** The image builds for `linux/amd64` and `linux/arm64`.
- **Audience.** Run the container only where everyone who can reach it may already reach Fusion's API. It makes
  Fusion's login page, `GET /api` and the other endpoints Fusion serves without a session reachable by everyone who can
  reach the container ([security.md](security.md#who-can-reach-the-container)).

## Build

```bash
docker build -t banana-hosting .
```

This runs `npm ci` and the production build in a Node image, and copies the result into an unprivileged nginx image.
Both base images are pinned by digest in the `Dockerfile`. For both architectures, from a builder that supports
multi-platform images:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/banana-hosting:latest . --push
```

Replace `registry.example.com/banana-hosting:latest` with a tag in a registry you can push to; `--push` needs one.

A multi-platform result cannot be loaded into the local image store with Docker's default driver: it needs `--push`, an
OCI output, or the containerd image store to keep the result.

A single platform can be built with `docker build --platform linux/amd64 -t banana-hosting .`. The multi-platform
command needs a builder that supports it (the containerd image store in Docker Desktop, or a `docker-container` builder);
with Docker's default driver it stops with "Multi-platform build is not supported for the docker driver". The
single-platform build was run; the multi-platform one was not, for that reason.

## Run

Trying it on your own machine, over plain HTTP on `localhost`:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -e FUSION_URL=https://fusion.example.com \
  -e BANANA_PUBLIC_ORIGIN=http://localhost:8080 \
  -e BANANA_INSECURE_COOKIES=on \
  banana-hosting
```

Open <http://localhost:8080>. The first start prints what it checked, and the Fusion version it found (abridged here):

```
banana: starting: Banana at http://localhost:8080, Fusion at https://fusion.example.com, preset fusion
banana: login page for expired sessions: /auth/login
banana: warning: BANANA_INSECURE_COOKIES=on: the session cookie loses its Secure flag. Development only
banana: Fusion 5.9.16 answered at https://fusion.example.com
```

For a real deployment, put a TLS-terminating proxy or load balancer in front of port 8080, set
`BANANA_PUBLIC_ORIGIN` to the `https` address people use, and leave `BANANA_INSECURE_COOKIES` unset
([TLS](#tls)):

```bash
docker run -d --name banana -p 127.0.0.1:8080:8080 \
  --read-only --tmpfs /run/banana:uid=101,gid=101,mode=0700,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e FUSION_URL=https://fusion.example.com \
  -e BANANA_PUBLIC_ORIGIN=https://banana.example.com \
  banana-hosting
```

The container refuses to start, with a one-line reason and a non-zero exit code, when a setting is wrong.

### Compose

`compose.yaml` is an example for a first try on one machine. It listens on `127.0.0.1:8080`, uses plain HTTP on
`localhost`, and therefore turns the development switch on by default.

```bash
FUSION_URL=https://fusion.example.com docker compose up --build
```

then open <http://localhost:8080>. Stop it with `docker compose down`. `FUSION_URL` is required; Compose stops with a
message when it is not set. For a real deployment set `BANANA_PUBLIC_ORIGIN` to your `https` address and
`BANANA_INSECURE_COOKIES=off`, and put the TLS-terminating proxy in front of the published port. The file also drops all
capabilities, makes the root file system read-only and mounts the small in-memory directory the container writes to.

## Settings

All settings are environment variables, read at start. Change one and restart the container.

| Variable | Default | Meaning |
|---|---|---|
| `FUSION_URL` | required | The Fusion origin: scheme, host and optional port, no path. `http://` is accepted only with `BANANA_INSECURE_COOKIES=on`. An `https` address that is an IP address is refused while `FUSION_TLS_VERIFY=on`. |
| `BANANA_PUBLIC_ORIGIN` | required | The address people open Banana at. Requests for any other `Host` get 421. |
| `BANANA_ALLOWED_ORIGINS` | none | More origins accepted as the container's own, comma separated (a second public name). |
| `BANANA_REDIRECT_HOSTS` | none | Alias host names, comma separated (`host` or `host:port`). A GET or HEAD for an alias is redirected to the public address. Never list the name a Host-rewriting front end sends: it loops. |
| `BANANA_PRESET` | `fusion` | Only `fusion` is accepted. The Solr preset is not offered by the container. |
| `FUSION_LOGIN_URL` | `/auth/login` | Where an expired session is sent to log in again. A path on the same address. |
| `BANANA_SETTING_<name>` | the preset's value | Sets one application setting by its name in `config.js`. A name that does not exist stops the start. See below. |
| `BANANA_ADMIN_MOUNT` | `off` | Also serve Banana at `/admin/banana/`, with Fusion's own layout and login redirect. Needs the admin route on. |
| `FUSION_PROXY_ADMIN_UI` | `on` | Forward `/admin/` to Fusion. With `off`, `/admin/` is 404, and the container refuses to start if `FUSION_LOGIN_URL` is a path under `/admin/`. |
| `FUSION_TLS_VERIFY` | `on` | Verify Fusion's certificate. `off` logs a warning at every start. |
| `FUSION_CA_FILE` | system CAs | Absolute path to a PEM file of trusted certificates, for a private certificate authority ([TLS](#tls)). |
| `BANANA_INSECURE_COOKIES` | `off` | Development only: drops `Secure` from the session cookie and allows an `http://` Fusion address. |
| `BANANA_HSTS` | `off` | Send `Strict-Transport-Security: max-age=31536000` on the container's own and forwarded responses. |
| `BANANA_CSP_MODE` | `enforce` | `report-only` sends the content policy under the report-only header name. |
| `BANANA_CSP_SCRIPT_SRC`, `_STYLE_SRC`, `_IMG_SRC`, `_FONT_SRC`, `_CONNECT_SRC` | none | Sources appended to that directive of the policy, comma or space separated. Host and scheme sources only: no quotes, so no keyword such as `unsafe-eval` can be added. |
| `BANANA_STRIP_HEADERS` | none | Header names, comma separated, added to the built-in list of identity headers that are removed from every request. It never replaces the list. |
| `BANANA_PREFLIGHT` | `warn` | `strict` makes a failed start-up check of Fusion, or an unacknowledged Trusted-HTTP realm, stop the start. |
| `BANANA_ACK_TRUSTED_REALMS` | none | Names of Trusted-HTTP realms whose header names you have put in `BANANA_STRIP_HEADERS`, comma separated. Matters only under `BANANA_PREFLIGHT=strict`. |
| `BANANA_HEALTH_UPSTREAM` | `off` | Serve `/healthz/upstream` ([Health checks](#health-checks)). |

`BANANA_LIVE_DIGEST_KEY` exists for the project's own tests. Leave it unset.

**`BANANA_SETTING_<name>`.** The accepted names are the settings Banana's `config.js` knows: `solr`, `solr_core`,
`timefield`, `banana_index`, `default_dashboard`, `panel_names`, `allowed_dashboard_servers`, `USE_FUSION`,
`USE_ADMIN_LUKE`, `USE_ADMIN_CORES`, the `FUSION_*` and `SYSTEM_BANANA_*` names, and `apollo*`. The container refuses a
name outside that list and prints the full list. Values are typed: booleans take `true` or `false`, `panel_names`
a comma-separated list, and a path setting must be a path that starts with a single `/`. The login address is set only
through `FUSION_LOGIN_URL`. Without any `BANANA_SETTING_*` the container serves the Fusion defaults.

## Login flow

1. A person opens `https://banana.example.com/`. Banana asks `GET /api/session`; with no session Fusion answers 401.
2. Banana navigates to the login address with a return value. At `/` that is
   `/auth/login?return=/%23/dashboard`. This was observed against Fusion 5.9.16 (the page title was "Fusion
   Auth").
3. Fusion's login page, served through the container, reads the realm list from `GET /api` and posts the user name and
   password to `/api/session?realmName=...`. Fusion answers 201 and sets its session cookie, named `id`.
4. The browser returns to the page it came from. The return path was recorded in the live test described in
   [ADR 0023](adr/0023-docker-image.md): login from `/` came back to `/#/dashboard`.
5. When the session lapses, the next request gets 401 and the cycle repeats. Unsaved changes to the open dashboard are
   lost, because the redirect is a full page load. The session cookie observed on 5.9.16 lived 1799 seconds.

Behind that: the session cookie is `HttpOnly` and `SameSite=Lax`, has no `Domain`, and is `Secure` when the request
reached Fusion over HTTPS. The container passes it through untouched and writes no cookie of its own. The one exception
is the development switch ([below](#the-development-switch)).

With `BANANA_ADMIN_MOUNT=on`, Banana is also served at `/admin/banana/`. A logged-out visit to it went to
`/auth/login?return=/admin/login` in the same run, which is where Fusion's own copy of Banana goes as well. That mount
is how the layout used inside Fusion is exercised, see [Inside Fusion](#inside-fusion).

## TLS

There are two connections.

**Browser to the container.** The container listens on plain HTTP, port 8080, and manages no certificates. Terminate
TLS in front of it (an ingress, a load balancer or a TLS-terminating proxy), and set `BANANA_PUBLIC_ORIGIN` to the
`https` address. The front end must pass the client's `Host` header on unchanged (in nginx, `proxy_set_header Host
$host`, not the default). A front end that sends an internal name such as `banana:8080` makes every request except
`/healthz` fail with 421; if you cannot preserve `Host`, list the name it sends in `BANANA_ALLOWED_ORIGINS` (not in
`BANANA_REDIRECT_HOSTS`). With `BANANA_PUBLIC_ORIGIN` on `https` and the development switch off, the session cookie
reaches the browser with `Secure`. Checked with a login sent to a container that had an `https` public origin: the cookie
came back as `id=...; Path=/; Max-Age=1799; Secure; HttpOnly; SameSite=Lax`. That run simulated the front end with
`curl` and did not use a real certificate, so a real TLS front end was not tried.

**Container to Fusion.** The connection is HTTPS and Fusion's certificate is verified by default
(`FUSION_TLS_VERIFY=on`). For a private certificate authority, mount a PEM file and name it:

```bash
docker run ... -v "$PWD/ca.pem:/certs/ca.pem:ro" -e FUSION_CA_FILE=/certs/ca.pem ...
```

The file must hold the whole chain of trust, **including the root certificate** that signs Fusion's certificate. A file
with only Fusion's certificate and its intermediates passes the start-up check but every proxied request fails with 502
(the log says `unable to get issuer certificate`). The start-up check and the proxy use different verifiers; the proxy's
is the stricter. `FUSION_TLS_VERIFY=off` stops all checking of Fusion's certificate: anyone who can intercept the
traffic between the container and Fusion can read the session cookies and passwords. Do not use it outside a trial.

`BANANA_HSTS=on` makes the container send `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`).
Fusion's own header of that name is always removed from forwarded answers, so it never pins the container's host to
Fusion's policy.

### The development switch

`BANANA_INSECURE_COOKIES=on` is for a container reached over plain HTTP, normally `http://localhost`. Fusion marks its
session cookie `Secure`, and a browser discards a `Secure` cookie from an `http` page, so a login would succeed and the
next request would be a 401: a loop between the login page and Banana. With the switch on the container removes
`Secure` from the cookie (and allows an `http://` Fusion address). That sends the person's session cookie in clear text
whenever the page is reached over HTTP. It logs a warning at every start, and a second one when the public origin is
`https`. **Do not use it on a network you do not control, and never for a deployment people reach over the network.**
`compose.yaml` turns it on for the localhost trial only.

## Security headers

Every response the container generates itself (static files, errors, `/healthz`, the 421 page) carries:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://api.github.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.osm.org http://*.tile.osm.org; font-src 'self' data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Answers forwarded from Fusion (`/api/`, `/auth/`, `/admin/`) keep Fusion's headers, except for
`Strict-Transport-Security`. Banana's files are sent with `Cache-Control: no-cache` and a validator, so a new build or a
changed setting is picked up on the next load.

Scripts are allowed only from the container's own origin (and `api.github.com`, for opening a dashboard from a gist):
the policy has neither `'unsafe-inline'` nor `'unsafe-eval'`, so an inline script, an inline event handler such as
`<img onerror=...>`, and code compiled from a string are refused. It does **not** limit navigation, or stop images being
requested from the allowed tile hosts ([security.md](security.md#stored-dashboards)). `style-src` still allows inline
styles. The browser console shows a refused attempt that Banana's Leaflet library makes on purpose and recovers from (a
feature check, on a dashboard with a Bettermap panel), and a violation report, with no console message, for a guarded
global lookup in the graph panel's library; none changes what a panel does.
[ADR 0029](adr/0029-content-security-policy-without-unsafe-eval.md) lists them.

If a panel or a map tile source is blocked by the policy, run the container with `BANANA_CSP_MODE=report-only`: the
browser then logs violations in its console instead of blocking, which shows what to add. Add sources with the
`BANANA_CSP_*_SRC` variables, for example `BANANA_CSP_IMG_SRC=https://tiles.example.com`, and return to `enforce`.
Report-only and an added image source were checked: the header came back as `Content-Security-Policy-Report-Only` with the
source appended to `img-src`. Tile loading for the Bettermap panel under the policy has not been tried live.

## Health checks

- `GET /healthz` answers `200 ok` from the container itself and never calls Fusion. It is exempt from the host check, so
  an orchestrator can probe it directly. The image's `HEALTHCHECK` uses it, and `docker inspect` reports `healthy`.
- `GET /healthz/upstream` is off unless `BANANA_HEALTH_UPSTREAM=on`. It asks Fusion `GET /api` and answers 200 with
  `{"ok":true,"version":"5.9.16","trustedHttpRealms":[]}`, or 503 with a reason. It is cached for 10 seconds, so a flood of
  requests makes at most one call to Fusion per interval. It is subject to the host check, so a monitor sends the public
  name as `Host`. Keep it off the public address: anyone who can reach it can trigger a check.

## Read-only and unprivileged operation

The container runs as user 101 and listens on port 8080. It writes only under `/run/banana` and needs no volume, so it
runs with a read-only root file system if `/run/banana` is a small tmpfs, as in the compose example above. The commands
above also drop all capabilities and set `no-new-privileges`. Checked in a running container started that way:
`id` printed `uid=101(nginx) gid=101(nginx)`, a write to `/etc` failed with "Read-only file system", and the container
reported `healthy`. Without the tmpfs a read-only container stops at start with `mkdir: can't create directory
'/run/banana/tmp/': Read-only file system`.

The container logs to standard output: the time, the peer address, the method, the path (without the query string), the
status and the time taken. The access log never records cookies, `Authorization` headers or query strings. The error log (also on standard error) is different: when a request to Fusion fails (Fusion unreachable, TLS failures, timeouts) nginx records the request line **with its query string**, which can include search text and stream expressions, and the
`Host` and `Referer` of the request (the referring address can itself carry a query string). Other headers and cookies are not logged. Fusion's audit log shows
the container's address, not the person's, for all Banana traffic; use the container's log to correlate.

## What the container does not do

- **It does not inject credentials.** There is no setting for a Fusion API key, a Basic login or a service account, and
  variables that look like one do nothing. Every request carries only what the browser sent. See
  [security.md](security.md#identity-model-and-the-shared-key-warning) for why, and what goes wrong if you build it
  around the container.
- **It has no Solr preset.** `BANANA_PRESET=solr` is refused. A Solr deployment uses the static `config.solr.js` with a
  static web server, as described in the README.
- **It does not terminate TLS, handle SSO realms, serve Banana at `/banana/`, or proxy** `/api-ws`, `/solr/`, `/oauth2/`
  and `/actuator/` (each is 404 from the container).
- **It does not change Fusion.** It stores nothing and has no state; two containers behind one Fusion share nothing but
  Fusion.

## Inside Fusion

Fusion serves Banana itself at `/admin/banana/`, on the same origin as its admin UI. Nothing in this guide changes that.
To exercise that layout without touching a Fusion installation, run the container with `BANANA_ADMIN_MOUNT=on`: it
serves the same built files at `/admin/banana/`, with the relative login redirect and session lookup unchanged, and
forwards the rest of the address space to Fusion. This is an imitation: it does not reproduce Fusion's own web server
headers or the admin UI's menu around the Banana page ([ADR 0004](adr/0004-inside-fusion-mode-verified-by-imitation.md)).
Do not install a development build into a production Fusion's admin UI.

## Troubleshooting

| What you see | Cause and remedy |
|---|---|
| The container exits at start with `error: ...` | The message names the setting. Each wrong value is refused: no `FUSION_URL` or `BANANA_PUBLIC_ORIGIN`, an `http://` Fusion address without the development switch, `BANANA_PRESET=solr`, `BANANA_ADMIN_MOUNT=on` with `FUSION_PROXY_ADMIN_UI=off`, `FUSION_LOGIN_URL` under `/admin/` with `FUSION_PROXY_ADMIN_UI=off`, an unreadable `FUSION_CA_FILE`, an unknown `BANANA_SETTING_<name>`. |
| `FUSION_URL names an IP address over https` | nginx checks the certificate against host names only, so an IP address would fail every proxied request with 502 while the start-up check, which uses a different client, could pass. Use a DNS name that the certificate carries. `FUSION_TLS_VERIFY=off` also lets it start, but stops all certificate checking. |
| The Fusion name is in a hosts file only (`--add-host`, `extra_hosts`) and requests fail with 502 | The proxy resolves the Fusion name through its own resolver, taken from `/etc/resolv.conf` at start, and it does not read `/etc/hosts`. The log says `could not be resolved (3: Host not found)`. Put the name in DNS. The start-up check goes through the system resolver, so it can pass where the proxy fails; in a trial against a Fusion that routes by host name it got a 404 instead. It does not apply DNS search domains either: use the full name. |
| Every request returns 421 | `Host` is not the public host. Either `BANANA_PUBLIC_ORIGIN` does not match the address in the browser, or a front end replaced `Host`. Preserve `Host`, or list the name the front end sends in `BANANA_ALLOWED_ORIGINS`. |
| A GET to the address gets 308, forever | A name listed in `BANANA_REDIRECT_HOSTS` is the name your front end sends. Move it to `BANANA_ALLOWED_ORIGINS`. |
| A save or search gets 403 from the container | The `Origin` is not the public origin (a second name not listed in `BANANA_ALLOWED_ORIGINS`), or a browser sent `Sec-Fetch-Site: cross-site` or `same-site` to `/api/` (a request made from another site). The app does not show most of these; see the container's log. |
| Login succeeds and Banana asks again | The browser discarded a `Secure` cookie: the page is on `http` and the development switch is off. Use `https`, or on `localhost` set `BANANA_INSECURE_COOKIES=on`. |
| Login loops on an SSO realm | SSO realms are not supported through the container. Use Fusion's own address. |
| 502 for every proxied request, start-up check passed | Compare the log at start. A `FUSION_CA_FILE` without the root certificate, an IP address, a hosts-file name, or Fusion down. The container's log has the nginx error for each failure. |
| `504` | Fusion did not answer within 60 seconds. Fusion's own query limit is shorter ([security.md](security.md#long-queries-and-the-circuit-breaker)). |
| `/admin/banana/` is 404 | The mount is off (the default). Open Banana at `/`, or set `BANANA_ADMIN_MOUNT=on`. The admin UI's "Dashboards" entry, reached through the container, opens that address. |
| Panels stay empty | Check the browser's network tab and the container's log. A Fusion that is down, a collection the user cannot read, and a refused request all show as empty panels or an error banner. |
| Container will not start read-only | Mount a tmpfs at `/run/banana`. |
