# Security notes for running Banana outside Fusion

This page is for the person who runs the Banana container ([hosting-docker.md](hosting-docker.md)) in front of a Fusion
5.9 system. It says what the container does about identity, what you take on if you build more around it, a role that
gives Banana's users only what Banana needs, what that role still allows, and what to know about dashboards that other
people saved. The full reasoning, with the code each statement rests on, is in
[ADR 0003](adr/0003-standalone-hosting-same-origin-proxy.md).

Statements are marked **verified** when they were run against a Fusion 5.9.16 system, and **inferred** when they follow
from Fusion's code or Solr's behaviour and were not tried.

## Identity model and the shared-key warning

**Each person logs in with their own Fusion account, and nothing else is supported.** The container holds no Fusion
credential. It adds no `Authorization` header, no API key and no identity header to anything it forwards, it never
writes a session cookie of its own, and it has no setting that would make it do so. Everything Fusion enforces for a
user (roles, blob permission, collection access) applies to that person, and Fusion's audit log and the dashboards'
owner field name the person who acted.

Why only this: if the container held a credential, every error in the container would be a privilege problem in Fusion.
A shared account's authority is what every visitor gets, and the checks that decide who may use it would be Banana's,
not Fusion's.

**Do not build a shared key or an injected login around the container.** The image does not provide this, has no
setting for it, and the project does not test or support it. A front end that adds a Fusion API key, an HTTP Basic login
or an identity header to the requests it passes on **is building that mode**, whether or not the image changes. The
container forwards what it receives. What goes wrong:

- **The shared account's session reaches every visitor.** When Fusion authenticates a Basic login it answers with its
  session cookie, and the container passes that cookie to the browser. The visitor then holds a working session for the
  shared account against Fusion directly, with no gate and no path limit. Any restriction in the front end is moot for
  anyone who opens the browser's developer tools. (API-key requests do not get the cookie, but a key carries no user
  name, so saved dashboards carry no author.)
- **Anyone who can reach the front end acts as the shared account.** Saving a dashboard replaces any blob of the same
  id after a confirmation, with no history (every user of a shared account is the same owner, so the confirmation cannot tell
  them apart); deleting removes the blob. The account's blob permission covers every blob it can name, not only
  dashboards ([residuals](#what-the-role-still-allows)).
- **Switching modes on the same name is dangerous.** Cookies are bound to the host name. Browsers that visited a
  deployment with a shared account still hold its cookie, and a per-user container forwards it, so those visitors stay
  the shared account without a login. Use a new host name, or end the shared account's sessions in Fusion, before
  switching.
- **A header-based front end has its own traps.** A stale session cookie outranks a trusted header, so after one person
  signs out of the front end and another signs in, the second can act as the first until the session expires; and a
  Fusion Trusted-HTTP realm trusts a header value as well as an address.
- **Opening `/api/solr/` to a shared credential opens Solr's write handlers** (for example delete by query) that Banana
  never uses (inferred, as in ADR 0003; not tried).

If you build it anyway, apply at the front end: drop every upstream `Set-Cookie`; send `_cookie=false` on the upstream
query; strip the client's `Authorization`, `x-api-key`, `apiKey` and `Cookie` before adding your own; refuse cross-site
requests for every method; allow only the paths and methods Banana uses; and put real authentication in front, not a
network position. ADR 0003 ("Not provided by this image") has the details. None of this has been tested here.

### Trusted-HTTP realms

If your Fusion has an enabled Trusted-HTTP realm, add that realm's identity header name and its groups header name to
`BANANA_STRIP_HEADERS`. The container removes `X-Remote-User`, `X-Forwarded-User`, `Remote-User`, `X-Remote-Groups`,
`X-Forwarded-Groups`, `X-Auth-Request-User`, `X-Auth-Request-Email` and `X-Auth-Request-Groups` from every request, plus
the forwarded-address headers, but it cannot see the names your realm uses. Without them, a visitor who sends the
realm's identity header can act as that user. The start-up check logs each enabled Trusted-HTTP realm by name; with
`BANANA_PREFLIGHT=strict` it refuses to start until you name each one in `BANANA_ACK_TRUSTED_REALMS`. The check is a
snapshot taken at start: restart the container after any change to the realms.

### Who can reach the container

The container adds no privilege, so what a person can do through it is what Fusion lets that caller do. That holds only
for people who could already reach Fusion's API. Fusion serves several endpoints without a session (password login at
`/api/session`, `GET /api` with the version and the realm names, the login page, the admin UI's scripts and styles),
and the container makes them reachable by everyone who can reach the container. Deploy it only where everyone who can
reach it may already reach Fusion, or put a network or authentication gate in front. `FUSION_PROXY_ADMIN_UI=off` narrows
the surface to the API and the login page.

## Least-privilege role

**When this applies.** With the container's per-user login, each person acts with their own Fusion roles and the role
below is not needed. It is for an operator who builds a shared identity in front of Banana, which this image does not
provide ([above](#identity-model-and-the-shared-key-warning)), or who wants to give a group of Fusion users a role that
carries only what Banana needs instead of one of Fusion's shipped roles. Whoever holds the role is trusted with what
[the role still allows](#what-the-role-still-allows), and that is more than dashboards.

The list below was run on a Fusion 5.9.16 system, as a non-admin user who held only this role and logged in through the
container. **Verified on Fusion 5.9.16:** listing collections and fields, running queries, listing, loading, saving and
deleting dashboards, and rendering the stream, graph and document viewer panels. One line was never exercised, and is
marked below.

Permissions, as the gateway stores them (method and path glob, relative to the gateway's `/api`):

```json
[
  {"methods": ["GET"],  "path": "/collections"},
  {"methods": ["GET"],  "path": "/collections/*/schema/*"},
  {"methods": ["POST"], "path": "/query-pipelines/*/collections/*/select"},
  {"methods": ["GET"],  "path": "/query-pipelines/*/collections/*/schema/uniquekey"},
  {"methods": ["POST"], "path": "/solr/*/select"},
  {"methods": ["GET"],  "path": "/solr/*/stream"},
  {"methods": ["GET"],  "path": "/solr/*/graph"},
  {"methods": ["GET"],  "path": "/solr/*/schema/uniquekey"},
  {"methods": ["GET", "PUT", "DELETE"], "path": "/blobs/**"}
]
```

An administrator creates it with the gateway's role API, for example `POST /api/roles` with the body
`{"name": "banana-users", "desc": "...", "permissions": [ ...the list... ], "uiPermissions": []}`, and gives the role to
users (`roleNames`). Give those users this role and no other. The role was created and tried on a test system under a
name of the tester's choice; use a name that fits your site.

What each group of lines is for:

| Lines | Needed for |
|---|---|
| `/collections` and `/collections/*/schema/*` | The collection list, and the field lists of a collection. Always. |
| `/query-pipelines/*/collections/*/select` | Queries of dashboards on the pipeline route (Banana's default, `solr` set to `/api/query-pipelines/...`). |
| `/query-pipelines/*/collections/*/schema/uniquekey` | The document viewer's key lookup on the pipeline route. **Not verified:** no check exercised this line. |
| `/solr/*/select` | Queries of dashboards that use the direct route (`solr` set to `/api/solr/`). |
| `/solr/*/stream` and `/solr/*/graph` | The stream-expression panels (time series, significant terms, graph), which work only on the direct route. |
| `/solr/*/schema/uniquekey` | The document viewer panel on the direct route. |
| `/blobs/**` | Listing, loading, saving and deleting dashboards. |

Querying, listing, loading and saving worked with the six lines other than `stream`, `graph` and `schema/uniquekey`
(the first run of the check). Three lines were added because the first run failed without them: the `stream` and
`graph` lines (without them the time series, significant terms and graph panels showed "The request failed (HTTP status
403)") and the `schema/uniquekey` line on the direct route (without it, the document viewer's lookup was refused).
**If your dashboards do not use the stream, graph or document viewer panels, drop `/solr/*/stream`, `/solr/*/graph` and
`/solr/*/schema/uniquekey`. Dropping `stream` and `graph` is also the safer choice, see below.** If no dashboard uses
the direct route (`/api/solr/`), the four `/solr/` lines can go; if none uses the pipeline route, the two
`/query-pipelines/` lines can. Dropping lines you need makes the matching calls fail with a 403. What you see differs: the stream, graph and
time series panels show an error in the panel; without the `uniquekey` line the document viewer fails with only a
403 in the browser's console; without `/blobs/**` a save shows "Save failed". Stream panels on the pipeline route fail for every user, administrators included; Fusion answers
500 on that route.

The narrow globs (a single `*` and the exact `/collections` form) worked as written; the shipped roles' wider
`/collections/**` and `/query-pipelines/**` forms were not needed.

### What the role still allows

Fusion decides a request from the method and the path only; the query string is not part of the decision, and `*`
matches one path segment. Everything in this list follows from that rule and from how Fusion and Solr behave. **It is
inferred; none of it was tried**, because trying it would write to a shared system.

- **`/blobs/**` (`GET`, `PUT`, `DELETE`) lets the role read, create (inferred), overwrite and delete blobs of any type by id.** The
  permission cannot be narrowed to Banana's dashboards (the type is in the query string). Fusion's blob store holds more
  than dashboards, including code that Fusion runs: index and query stage plugins, JavaScript stage files and JDBC
  drivers. **A user with this role can therefore change code that Fusion's pipelines execute.** An overwrite replaces the
  blob with no history. What was tried: a second save of an own dashboard replaced it, and a delete of an own dashboard
  succeeded. Whether the blob service itself checks the type on a create, an overwrite or a delete was not tried, and no
  blob of another kind was touched. This is the strongest reason to keep users of a Banana role apart from anyone who
  manages pipelines or other blobs, and not to give the role to people you do not trust.
- **`GET /solr/*/stream` and `GET /solr/*/graph` may be write paths into any collection.** Solr's streaming handler
  accepts expressions for any collection the gateway can reach, and Solr has stream decorators that update, delete and
  commit documents. What was checked: in the code of Solr 9.4.1 the graph handler's stream factory registers the update, delete and
  commit streams. Fusion 5.9.16 ships Solr 9.6.1, which was not checked. Treat these two read-looking lines as possible write access to every
  collection. Drop them when the stream and graph panels are not used.
- **Queries and schema reads on any collection.** The select lines are not limited to the collections a dashboard uses,
  and `/collections/*/schema/*` also allows reading a collection's whole schema (read only). The collection list is
  readable. Fusion's data-level permissions, if you use them, are separate.
- **What the role does not match:** `/solr/*` matches one path segment, so `/solr/<collection>/update` is not matched;
  nor are collection or app writes, nor the pipeline route's `stream` and `graph`.
- The user can log in and out; sessions are not governed by roles.

## Stored dashboards

A dashboard is content written by whoever could save it, and read by whoever opens it. Anyone with blob write
permission can save a dashboard, or overwrite one, that other users open later, and what the dashboard contains runs in
the viewer's browser with the viewer's Fusion rights. Treat a stored dashboard as you would a page from its author.

- **Values from documents and dashboards are shown as text, with the limits below.** Alert text is sanitized when it
  is shown, and the titles, ids and links that the save, delete, default and share messages quote are escaped
  ([ADR 0014](adr/0014-report-failed-requests.md), [ADR 0024](adr/0024-render-document-data-and-markdown-safely.md)).
  The document viewer, table and full-text search panels, the table's hyperlink and image columns, the markdown text
  panel, chart labels and tooltips, and the suggestions in the editors' typeahead lists escape what documents and
  dashboards supply; the two kinds of highlighting that Solr or a panel adds are kept, and markdown links and images keep
  only `http`, `https` and `mailto` (images also `data:image`) or an address without a scheme. This is checked by unit
  specs and by `npm run test:hostile`, which loads every panel with payloads in every string a document, the schema or a
  dashboard can supply. It is not a proof: the residuals in ADR 0024 (for example Solr-mode field lists, popovers,
  hover paths the check cannot trigger, and the CSS that attribute values such as a panel height can add) are not
  covered, and a stub is not a real Fusion. Panels such as the text and template panels also exist to show markup their
  author wrote. The text panel's HTML mode passes it through AngularJS 1.0.8's sanitizer, which is older and weaker than
  current ones ([ADR 32](adr/0032-angularjs-1-0-8-stays.md)), so treat a dashboard with HTML-mode panels as written by someone you
  trust. A dashboard also stores the Solr address its panels query. Chart colours are checked: only a colour name, or hex,
  `rgb()`, `rgba()`, `hsl()` or `hsla()` with plain numbers is written into a tooltip.
  Someone who can write a blob or documents can still change what a viewer sees; treat blob write and index write as
  rights to put content in front of other users.
- The address-bar parameters that choose a server or fill a template no longer run code
  ([ADR 0018](adr/0018-dashboard-parameters-without-code-execution.md),
  [ADR 0021](adr/0021-dashboard-server-parameter.md)). That is all they settle: a link can still open any stored
  dashboard by its id (the id is encoded the same way for load, save and delete, and no query is built from the raw
  title: [ADR 0027](adr/0027-dashboard-save-and-delete-safety.md)).
- The content policy the container sends ([hosting-docker.md](hosting-docker.md#security-headers)) limits fetch and XHR
  requests, frames and form targets to the container and `api.github.com`. It does not limit navigation
  (`window.location`, `window.open`), and `img-src` also allows the map tile hosts, so script can still send data out
  through them. Its `script-src` has neither `'unsafe-inline'` nor `'unsafe-eval'`
([ADR 0029](adr/0029-content-security-policy-without-unsafe-eval.md)), so markup saved in a dashboard cannot run an
inline script or an inline event handler under it. Script loaded from the container's own origin is still allowed.
- A dashboard's stored Solr address can point at another path on the same origin; the browser then sends that
  dashboard's queries there with the viewer's rights. Another host is blocked by the policy.
- Saving a dashboard under a title that already exists replaces it, after a confirmation that names the user who saved the
  stored one ([ADR 0027](adr/0027-dashboard-save-and-delete-safety.md)). Titles are blob ids, there is no history, and the
  confirmation is only in Banana: a script, `curl` or Fusion's own blob screen overwrites without asking. Export
  dashboards you care about (Banana's Save to file) and restrict who may write blobs.
- The app has historically hidden most failed requests. Recent versions report them in the panel or the Save and Load
  screens ([ADR 0014](adr/0014-report-failed-requests.md)), but do not rely on that to notice a refused request from
  the container: look at the container's log.

Give blob write only to people you would trust to run script as your other users, until you have checked how your
build renders dashboards.

## Long queries and the circuit breaker

Fusion's gateway wraps its routes in a circuit breaker with a time limit. In the 5.9.16 gateway configuration the
routes for the query service (`/api/query*/**`, which includes the `/api/query-pipelines/...` calls Banana makes by
default) are tied to a breaker called `query`, whose time limit is **15 seconds**; every other route has the default
limit, one hour. The container's own read timeout is 60 seconds, deliberately above the gateway's, so the gateway is
the one that ends a slow query.

For a dashboard this means a query that takes longer than 15 seconds on the pipeline route is cut off by Fusion, for
example a facet or range query over a very large time span. The panel then shows an error instead of data (or, in an
older build, stays on its spinner). Narrow the time range, lower the facet limits, or ask your Fusion administrator to
raise the limit or add a timeout to the pipeline.

What was **not** observed: the status and body the browser gets at the limit. No slow query was run, because testing
it would need a deliberately slow query on a shared system. The configuration also carries failure-rate and slow-call
settings for the breakers (calls slower than 10 seconds are counted); how those apply to the `query` breaker under
repeated slow queries was not checked, so treat a burst of slow dashboards as something that can make Fusion refuse
queries for a short time (inferred). The direct `/api/solr/` route was not found among the routes that name the `query`
breaker in that configuration; its limit was not checked live.

## Inside Fusion

Banana inside Fusion is served at `/admin/banana/`, by Fusion, on the same origin as its admin UI; this page's role
and container notes do not apply there, and Fusion's own roles decide who may use it. To check changes to Banana in that
layout without installing anything into a Fusion, serve the built `dist/` under `/admin/banana/` behind the container's
`BANANA_ADMIN_MOUNT=on` mount, in front of a Fusion you may use that way. That is an imitation and does not reproduce
Fusion's own web server headers or the admin UI around the page
([ADR 0004](adr/0004-inside-fusion-mode-verified-by-imitation.md)). Do not install a development build into a
production Fusion's admin UI.

## Reporting a vulnerability

Report it privately, as [SECURITY.md](../SECURITY.md) describes (GitHub private vulnerability reporting), and do not
describe it in a public issue or pull request. Banana is maintained by volunteers on a best-effort basis, with no
guaranteed response or fix time. SECURITY.md lists no e-mail address today; a project contact will be added there when
the maintainers have chosen one.
