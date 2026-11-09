# 0023. The Docker image: how it is built and what it reads

Date: 2026-11-06
Status: Accepted. Partly superseded by [ADR 0026](0026-remove-war-build.md): the `WEB-INF` note in the consequences no longer applies, because the source no longer has that directory.

## Context

The decision to host Banana outside Fusion as a same-origin proxy with per-user login is made in
`0003-standalone-hosting-same-origin-proxy.md`. It fixes what the container does: the routes, the Host,
Origin and Sec-Fetch-Site checks, the headers removed and added, the cookie and TLS handling, the runtime
configuration, the baseline security headers, the start-up check and the health routes. This record covers
what that decision leaves open and what building it turned up: the base images, the shape of the start-up,
the names of the settings, and a few places where nginx's behaviour decided the detail.

The image is the one implementation of that decision. It holds no Fusion credential. The decision's
"Not provided by this image" section applies unchanged: there is no setting for a shared API key, a Basic
login or a Trusted-HTTP front end, and the tests check that credential-looking variables do nothing.

## Options considered

1. **The stock nginx image with a template and `envsubst`.** Rejected. The configuration needs lists (allowed
   origins, alias hosts, headers to strip), typed rendering of `config.js` and a start that can refuse. A
   template substitutes text, and cannot check a value or stop the start.
2. **A small Node server instead of nginx.** Rejected. It would be one more thing to write and keep patched, and
   the proxying, static files, caching validators and logging nginx already does are what the decision relies on.
3. **Render `config.js` in nginx with a Lua or njs module.** Rejected. The stock images do not all carry the
   module, and the rendering is easier to read and test as a short shell script with `jq`.
4. **Resolve the Fusion name once, at start (a plain `proxy_pass` host).** Rejected. The decision says the name is
   re-resolved at run time so that a Fusion behind a load balancer whose address changes keeps working. nginx
   does that only with a variable in `proxy_pass` and a `resolver`.
5. **Run the optional upstream health check in a background loop.** Rejected. It would call Fusion every
   interval, whether or not anyone asked. FastCGI with nginx's cache calls it on demand, at most once per
   10 seconds.
6. **A Debian-based runtime.** Rejected. The Alpine variant of the unprivileged nginx image is about 60 MB and
   has `curl`, `xxd` and `sha256sum`, which is all that is needed besides `jq` and `fcgiwrap`.

## Decision

**Base images.** Both are pinned by tag and digest in the `Dockerfile`; change the two together.
- Build stage: `node:22.23.4-alpine3.24@sha256:0e1754758c2d...`. It runs `npm ci` and `npm run build`. It runs on
  the builder's own platform (`--platform=$BUILDPLATFORM`), because `dist/` is the same for every platform, so
  the build is not repeated under emulation for the second architecture.
- Runtime: `nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f...` (the digest of the multi-platform
  index). It already runs as user 101 and listens on 8080. `jq` and `fcgiwrap` are added from the Alpine release
  of that image (they are not pinned by version, so a rebuild picks up that release's security updates).
- The image builds for linux/amd64 and linux/arm64 (`docker buildx build --platform linux/amd64,linux/arm64`).

**Start-up.** The image replaces the base image's entrypoint with `banana-entrypoint`, a POSIX shell script. It
validates the environment, renders the configuration into `/run/banana` (the only path the container writes, meant to be a
small tmpfs; the image makes `/etc/nginx` and `/var/cache/nginx` owned by root, and `/tmp` stays world-writable as usual), makes the single unauthenticated `GET /api` check of Fusion, tests the web server configuration and
then runs nginx in the foreground as the main process. The web server configuration (`nginx.conf`, `checks.conf`)
is fixed and read-only; what depends on the environment is written as small files that it includes. The start
refuses with a one-line reason for each wrong setting. `BANANA_LIVE_DIGEST_KEY` is removed from the environment
before nginx starts, so it is in no process environment and in no file.

**Settings.** The variable names are:

| Variable | Default | Meaning |
|---|---|---|
| `FUSION_URL` | required | Fusion origin: scheme, host, optional port. No path. `http://` only with `BANANA_INSECURE_COOKIES=on`. |
| `BANANA_PUBLIC_ORIGIN` | required | The address people use. Other `Host` values get 421. |
| `BANANA_ALLOWED_ORIGINS` | none | More origins accepted as the container's own. |
| `BANANA_REDIRECT_HOSTS` | none | Alias host names (`host` or `host:port`); GET and HEAD are redirected to the public origin. |
| `BANANA_PRESET` | `fusion` | Only `fusion` is accepted. |
| `FUSION_LOGIN_URL` | `/auth/login` | Where the root page sends an expired session. |
| `BANANA_SETTING_<name>` | the preset's value | Sets one application setting, for the names `settings.js` lists. |
| `BANANA_ADMIN_MOUNT` | `off` | Also serve Banana at `/admin/banana/` with its own `config.js`. |
| `FUSION_PROXY_ADMIN_UI` | `on` | Forward `/admin/`. |
| `FUSION_TLS_VERIFY`, `FUSION_CA_FILE` | `on`, system CAs | Verification of Fusion's certificate. |
| `BANANA_INSECURE_COOKIES` | `off` | Development only: drop `Secure` from the session cookie, allow an `http://` Fusion URL. |
| `BANANA_HSTS` | `off` | Send `Strict-Transport-Security: max-age=31536000`. |
| `BANANA_CSP_MODE` | `enforce` | `report-only` sends the policy under the report-only header name. |
| `BANANA_CSP_{SCRIPT,STYLE,IMG,FONT,CONNECT}_SRC` | none | Sources appended to that directive. Plain host or scheme sources only: no quotes, so no keyword can be added. |
| `BANANA_STRIP_HEADERS` | none | Header names added to the built-in list of identity headers removed. |
| `BANANA_PREFLIGHT`, `BANANA_ACK_TRUSTED_REALMS` | `warn`, none | The start-up check's mode, and the acknowledged Trusted-HTTP realms. |
| `BANANA_HEALTH_UPSTREAM` | `off` | Serve `/healthz/upstream`. |
| `BANANA_LIVE_DIGEST_KEY` | unset | Test-only: see below. |

- **`BANANA_SETTING_<name>`.** The accepted names and their types come from the application's own
  `settings.js` and `config.js`, which the image build evaluates into `settings.json`. A name that is not listed
  stops the start, and a type is taken from the setting's default: booleans accept `true` or `false`,
  `panel_names` a comma-separated list or a JSON list of plain names, `allowed_dashboard_servers` a list of
  `http://` or `https://` URLs and paths that begin with a single `/` (no spaces, quotes or control characters), a setting whose default is a path must be
  a path that starts with a single `/` and holds only URL path characters, and every other value is a string
  without control characters. Each value is written to `config.js` as JSON with `<`, `>`, `&` and the two line
  separators escaped, so it cannot end the script. The login URL is set only through `FUSION_LOGIN_URL`. The
  list of settings therefore cannot drift from the application.
- **The Fusion preset is rendered in full** (all the values 1.6.30 ships), not left to the application's
  defaults, because the live tests read the served `config.js` and refuse to run unless it names the Fusion mode
  and the blob path.
- **`BANANA_PRESET=solr` is refused.** The decision leaves the Solr preset out, because the proxied routes and
  the trust model differ. The Solr preset stays a static file (`config.solr.js`) for a static host.
- **The mount.** `/admin/banana/config.js` is the preset with the login URL and session path at the 1.6.30
  defaults (`../login`, `/api/session`). A variable that sets `FUSION_SESSION_API` applies to the root page only.
- **Header names to strip** accept letters, digits, `-` and `_`. This is narrower than the HTTP token syntax, so
  that a name can be written into the web server configuration without quoting.
- **Origins and hosts** are host names or IPv4 addresses with an optional port. An IPv6 literal, a path, a user
  name and a trailing slash are refused.

**The application settings.** Two settings are added to the application, as the decision describes:
`FUSION_LOGIN_URL` (default `../login`) is what the 401 handler navigates to, and `FUSION_SESSION_API` (default
`/api/session`) is what the session lookup reads. Both defaults give the same behaviour as 1.6.30 (the
host-and-protocol form of the session URL and the root-relative form resolve to the same address).

**The order of the checks.** For every route except `/healthz`: a raw path with a backslash or control character
is refused with 400; then the Host check (308 or 421); then Origin (403); then Sec-Fetch-Site (403). They run
inside every route, before anything is served or forwarded. An alias redirect is built from the configured
public origin and the request's raw path and query. The 400 check is first so that a redirect never repeats an
unusual path. A request that nginx itself rejects while reading the request line (a control character) is answered
with 400 and the baseline headers through an internal error page; a named-location error page fails for those
requests.

**Responses the container generates.** Every one carries the baseline headers: the answers of the routes, the
refusals, and nginx's own errors (404 for a missing file, 413, 502 and 504 for an unreachable Fusion, the early 400
and 414). The error pages are plain text. Fusion's own answers keep Fusion's headers. The headers are an include,
because nginx drops the headers of an enclosing level in a block that sets any: every route lists its includes, and
the refusals inside the checks include the set themselves.

**Run-time name resolution.** nginx resolves the Fusion name through its own `resolver`, taken from
`/etc/resolv.conf` at start, with a 30 second cache. That resolver does not read `/etc/hosts`, so an entry added
with `extra_hosts` or `--add-host` is not used for the Fusion name: the Fusion URL must use a DNS name that the
resolver answers, and, over https, that the certificate carries (nginx matches the certificate against host names
only, so an IP address fails verification). The start-up check goes through the system resolver and curl, so it can
succeed where the proxied routes fail with 502. The image therefore refuses to start when `FUSION_URL` is an https
URL with an IP address and `FUSION_TLS_VERIFY=on`; with verification off nothing is matched, and an `http://` URL
has no certificate. The check does not apply search domains either, so use the full name.

**`/healthz/upstream`.** When on, it is a FastCGI script run by `fcgiwrap` as the same unprivileged user,
behind an nginx cache of 10 seconds with a lock, so a flood of requests makes at most one call to Fusion per
interval. It prints the check's result as JSON (`ok`, the version, the Trusted-HTTP realm names) with 200, or 503
with a reason. It logs each answer. It reads only `/run/banana/probe.env`, which holds the Fusion URL and the TLS
settings, and no secret.

**The digest header.** The image emits `X-Banana-Upstream-Digest` only when `BANANA_LIVE_DIGEST_KEY` is set: the
HMAC-SHA-256 of the normalized Fusion origin (lower case, default port dropped, no trailing slash) under the key
given as 64 hexadecimal characters, on every response including refusals and proxied answers. A malformed key
stops the start. The key is never logged or written. The live-test launcher gains an option to run the image in
place of its test proxy: `BANANA_LIVE_IMAGE` names the image. It passes the Fusion URL and the key by variable
name, picks a free loopback port and gives the image that address as its public origin, with the mount and the
development switch on. The guard is not changed.

**Other choices.**
- The access log line is the time, the peer address, the method, the normalized path without the query string,
  the status and the duration. The path is the one nginx matched, so `/` is logged as `/index.html`.
- `BANANA_HSTS=on` sends `max-age=31536000` without `includeSubDomains` on every response. Fusion's own
  `Strict-Transport-Security` header is always removed from forwarded answers, whatever this setting is.
- A percent-encoded control character (`%00`) in the path is not refused by the container: only the raw form is,
  as decided. It reaches Fusion as sent, and Fusion's decoding rules apply.
- The health check in the image is `GET /healthz` on the loopback address. It never calls Fusion.
- `compose.yaml` is an example for a first try on one machine: plain http on `localhost`, so it turns the
  development switch on by default, with a comment saying a real deployment turns it off. It also drops all
  capabilities, makes the root file system read-only and mounts the tmpfs.
- The tests of the image (`test/node/image`) skip when Docker or the image is missing, as the tests of the test
  proxy do. `npm run test:image` builds `banana-hosting:dev` and runs them.

## Consequences

- **What was checked on the shared Fusion.** The live smoke test (every panel type, save, reopen and delete
  through Banana's own screens, with independent confirmation and teardown) passes through this image with the
  mount on. Login and logout only, run again and saved as logs: a visit to `/` while logged out went to
  `/auth/login?return=/%23/dashboard` and, after login, landed on `/#/dashboard` (page, hash and return path kept);
  the same login started from `/admin/banana/` went to `/auth/login?return=/admin/login` and ended on
  `/admin/login`; and with the development switch off the session cookie reached the client with `Secure`
  (attribute names recorded, no values). These settle, for the version tested, the question the decision marked
  unverified about the login page honouring a return path. The refusal of a foreign `Origin` and a foreign `Host`
  on the shared Fusion was seen once and is not recorded; the stand-in tests cover both.
- **Not checked live.** HTTPS in front of the container with a real certificate; a Fusion with a Trusted-HTTP
  realm; SSO realms; the 15 second query limit; the container's behaviour when its name resolution changes;
  tile loading under the content policy.
- A name that is only in `/etc/hosts` does not work as the Fusion URL (see above). That is a difference from a
  static `proxy_pass`, and it is what makes the run-time re-resolution work.
- The runtime layer adds `jq` and `fcgiwrap` from the Alpine release, unpinned by package version. A rebuild may
  pick up newer builds of them. Pin by building from a recorded base-image digest and rebuilding on security
  notices; the digests in the `Dockerfile` are what to update.
- The image is about 67 MB for each architecture.
- The image is for Fusion only (`BANANA_PRESET=solr` is refused), and it is built from the `Dockerfile` in this repository.
  It is not published to any registry; whoever needs it builds it ([docs/hosting-docker.md](../hosting-docker.md)).
- The continuous-integration workflow does not build the image, so the image tests run only on a developer's
  machine (`npm run test:image`). A change to `docker/`, the `Dockerfile` or `.dockerignore` is not checked
  by CI.
- `lucidworksSrv.fusionHost` (the page's protocol and host) is removed. Its only use was to build the session
  URL, which is now read from `FUSION_SESSION_API`; nothing else in the application or tests used it.
- `WEB-INF` (a servlet descriptor for Java hosting) is left out of the web root: a static web server does not
  need it. The 1.6.30 build output has it, so this is a difference from that build's file list only.
  Update, 2026-11-07: the webpack build no longer produces a `WEB-INF` directory at all ([ADR 0026](0026-remove-war-build.md)),
  so nothing is left out; the `Dockerfile` keeps a harmless `rm -rf dist/WEB-INF` as a guard, and a test checks that
  the image has no such path.
- The build context is an allowlist (`.dockerignore`): only what the build reads, with nested dot-files and
  editor or temporary files removed at any depth, so a developer's local files cannot reach the build or the
  image.
- `/healthz/upstream` starts a second process in the container (`fcgiwrap`) only when it is on. The container
  stops when nginx stops; it does not restart `fcgiwrap`, so a failed one shows as 502 on that route only.
