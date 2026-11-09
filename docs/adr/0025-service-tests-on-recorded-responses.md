# 25. Service tests run on recorded responses, behind a scrub check

Date: 2026-11-07

Status: Accepted

## Context

Banana's services (`solrSrv`, `querySrv`, `filterSrv`, `kbnIndex`, `fields`, `lucidworksSrv`, and the dashboard calls that save, load, list and delete) are the code that talks to Fusion or Solr. They were loaded by the unit tests but not exercised, and the specs that did exist ran on data written by the same person who wrote the code. Such a test shows that the code does what its author expected; it cannot show what a Fusion 5.9 gateway answers. The two differ in practice: the gateway answers a missing collection with a 404 in its own error shape, a blob save with an empty 200, a blob delete with a 204 and no body, and a query on a field the collection does not have with a 400 whose body carries a nested trace.

Responses recorded from a live system carry identifying data by default (host names in URLs and in sample documents, session and user ids, user names, trace ids, the names of other people's collections and blobs on a shared instance). The repository is public, so recorded data must be scrubbed before it is committed, and the scrub must be a check that fails the build, not a habit.

Two facts about the environment shape the design:

- No standalone Solr was available. What can be recorded is what a Fusion 5.9 gateway returns, including Solr response shapes served through its Solr proxy.
- The Fusion instance used for recording is shared. Recording may read, and may create and delete only dashboard blobs under ids of the form `banana-it-<run>-<n>` that the same run created (see the record on the guarded live-test client).

## Options considered

1. **Hand-written fixtures.** Cheap and needs no instance. Rejected as the only source: it repeats the problem described above. It is still used where nothing can be recorded, and those fixtures say so (see Decision).
2. **Record in a browser (a HAR file) while using Banana.** Gives realistic traffic. Rejected: a HAR holds cookies, authorization headers and every response of the page, including the admin application's own calls, so more has to be removed than kept, and a browser session is not bound by the guard that limits writes on the shared instance.
3. **Record through the guarded Node client and scrub in a second step.** Chosen. Every request passes the same rule table as the live tests, so reads are limited to its allowlist and the only write is the one dashboard blob that the run creates and removes. The recorder keeps the method, path and query (never the host), the status, the content type and the body, and drops every other header, cookies among them, before anything is written.
4. **Commit the raw recordings and rely on review to catch what is in them.** Rejected: a reviewer cannot see a UUID or a host in 100 KB of JSON reliably.
5. **A scrub that only replaces known values.** Rejected on its own: it cannot find what it was not told about. The scrub replaces, and a separate check (below) fails on what is still there, using rules that need no knowledge of the recording environment.

## Decision

### Fixtures

- `test/fixtures/fusion-5.9.16/` holds the responses of a Fusion 5.9.16 gateway and `test/fixtures/solr-shapes/` holds Solr response shapes. Each file is one response with a `source`:
  - `recorded`: the answer of the gateway to the request in `recordedRequest`.
  - `recorded-solr`: a Solr response shape recorded through Fusion's Solr proxy (`/api/solr/<collection>/...`). It is what Fusion returns, not what a standalone Solr returns.
  - `derived`: built from a documented Solr shape or from a recorded response, with a `note` that says how. Nothing in a derived fixture was observed on a server. The Solr dashboard documents (title and dashboard fields in the `banana-int` collection), the collections list, the Luke output, the update acknowledgement and the Solr error body are derived, and so is the range facet that `kbnIndex` reads (a recorded response with the field renamed and the empty days dropped, which is what `facet.mincount=1` does).
- `tools/fixtures/record.js` records and `tools/fixtures/scrub.js` turns the raw recording into the files above and derives the rest, so the whole directory can be produced again. The two `GET` queries that Banana sends to `select` are recorded as the form `POST` with the same parameters, because the guarded client has no `GET select`; each such fixture says so in its `note`. The specs compare the parameters Banana builds with the recorded request's, so the recording would not match if Banana asked for something different.
- The scrub replaces the host of every URL (also percent-encoded or scheme-relative), every dotted host name with a port and every hyphenated single-label name with a port, and every stand-alone IPv4 address with `localhost` or `127.0.0.1` (a version number such as `v11.0.20.1` is left alone, and the check then flags it for a person to decide), every UUID (session, user and role ids among them) and every `userId`, `createdBy` and `sessionId` value with an all-zero placeholder, trace and request ids with fixed text, the user name with `fixture-user`, and the run id of the recorded dashboard with `000000000000`. The collection and blob lists keep only the entries whose names start with `banana-it`: the instance is shared, and the other names are not ours to publish. Response shapes are otherwise unchanged.
- Specs name the kind of evidence in their descriptions ("recorded from Fusion 5.9.16", "derived") and a spec that depends on a derived or Solr-proxy fixture says so, so that a green Solr-mode spec is not read as a statement about a standalone Solr.

### The scrub check

`tools/fixtures/check.js` runs in `npm run test:node` (`test/node/fixture-scrub.test.js`), so continuous integration runs it on every pull request and every push to `release` (the events `ci.yml` runs on), and it can be run on its own (`node tools/fixtures/check.js [dir]`). It fails when a fixture contains:

- a URL whose host is not `localhost` or `127.0.0.1` (also found after percent-decoding, once or twice, and as a scheme-relative `//host`), an IPv4 literal other than `127.0.0.1` and `0.0.0.0`, a dotted name with a port (`host.example:8983`, a Solr `node_name`) or a hyphenated single-label name with a port (`solr-headless:8983`), or a value under a key that names a host (`host`, `hostname`, `origin`, `referer`, `host_s`, `*_host`) that is not localhost (rule `host`);
- a cookie, set-cookie, authorization, proxy-authorization, x-api-key, apikey or x-lw-api-key header (as a key, as a `name` value, as the first element of a name and value pair, or as `Name:` anywhere in text), or a Bearer, Basic or Apikey credential (a letters-only Basic token is found when it is mixed-case base64; lower-case prose is not) (rule `header`);
- a `userId`, `user_id`, `createdBy`, `created_by`, `sessionId` or `session_id` (any case; a string, number or object) that is neither empty nor the placeholder, any `id` or `username` in a recorded `/api/session` or `/api/session/` exchange that is not the placeholder, or any UUID that is not the placeholder (rule `id`);
- with the environment of the recording set, the host of `FUSION_URL`, the value of `FUSION_USER` (as a whole token, so that it is not found inside a longer object name that starts with it), `FUSION_PASSWORD` or `FUSION_API_KEY` (rules `env-host`, `env-user`, `env-password`, `env-api-key`). The value of a `resourceType` field or parameter is fixed vocabulary of the blob API and is exempt from the user name rule, so that a user name that happens to equal a vocabulary word does not make the check unusable.

Without those variables (continuous integration) the first three groups still run and the check says, in its output and in the test's diagnostics, that the environment-specific rules were skipped. It does not pass quietly as if it had checked everything. `BANANA_REQUIRE_FIXTURE_ENV=1` turns a skip into a failure, for the machine that records. A finding names the file, the rule and the place in the file, never the value, so the log of a failed run does not repeat what leaked.

The check is tested for each rule on planted fixtures (written to a temporary directory by the tests), and the committed fixtures are required to say where they come from.

### Both modes

`test/unit/helpers/modes.js` applies the settings of the Fusion defaults or of the Solr preset around a spec and restores them afterwards. The specs for `dashboard`, `kbnIndex`, `fields`, `solrSrv`, `querySrv` and `filterSrv` run in both modes where the code differs between them (`querySrv` and `filterSrv` build the same text in both, and run in both to show it).

### Coverage

`npm run test:coverage` runs the same specs with `src/app/services` instrumented (`babel-plugin-istanbul`, applied before the annotation step in `test/webpack.test.config.js` only when `COVERAGE` is set, through `test/karma.coverage.conf.js` and `karma-coverage`). It prints a table with one row per file and writes `coverage/` (ignored by git). It enforces no threshold. `npm test` is unchanged: the instrumentation is off unless asked for.

### Defects found, and left as pending specs

Specs that state what the code is meant to do, but fail on the code as it is, are written as pending specs whose name starts with `KNOWN DEFECT`, and the code is not changed in this record:

- Loading a saved dashboard that does not exist, or when the server cannot be reached, does not show the "Could not find dashboard" or "Could not contact Solr" alert. The response transformer of the load also runs on error responses and throws on a body that is not a dashboard (an error body, or an empty one), so the error callback never runs. The same code is in the 1.6.30 release.
- In Solr mode, a title that no document has gives a 200 with no document, and the load fails on `docs[0]` instead of reporting that the dashboard was not found.
- With an API key the Fusion session has no `username`, so the service resolves to `undefined` instead of `guest`.

## Consequences

- **Residual of the user name rule.** `FUSION_USER` is matched as a whole token, so `<user>-x` and `x_<user>` pass (as do longer object names that start with it). This is deliberate: the recording user's name is an ordinary word and is also the start of the names of the test objects, and a substring rule would reject them. A user name embedded in a longer identifier is therefore not caught by this rule; the other rules, and review of a new recording's diff, are what is left. The rules that need no environment cannot know the user name at all.
- **Residual of the host rules.** Without the environment, these pass the check: a host with neither a scheme nor a port (single-label or dotted), in prose or under keys such as `server`, `serverHost` or `domain`; a single-label host with a port when its name has no hyphen (`solrhost:8983`; a hyphenated one such as `solr-headless:8983` is found, except names that start with `banana-it-`); an IPv6 literal outside a URL; a host in base64 or split across fields; and an e-mail domain. A URL that is percent-encoded once or twice is found, and a stray `%` does not stop the decoding. With the environment set, the environment host rule finds the recording host as plain text in any case, also inside a percent-encoded URL, but not when its own letters are percent-encoded or when it is base64-encoded. Header shapes that pass: a flat `rawHeaders` array with `Set-Cookie` anywhere but first, a HAR `cookies` array, and a quoted header key inside text that is not JSON. The recorder keeps no header except the content type, so none of these shapes is produced by `record.js`; the rules guard against fixtures added by hand.
- **More forms that pass the check without the environment.** Found by trying to get around it, and none is a form that Fusion 5.9.16 emits: a hyphenated host name with an underscore before the port (`my_solr-headless:8983`, a Compose-style `banana_wt-proxy-1:6764`), a hyphenated name that starts with a digit (`0-solr:8983`), a name with a trailing dot and a port, a port of one digit or of six, an HTML-entity-encoded URL, an IPv4 address written as one decimal integer, a header written as a `{key, value}` object (Postman style) or with a trailing space in its name, a Bearer token made only of letters, and several scheme-relative forms (a `//` host that has a single label and no port such as `//solr-headless/x`, that ends in a trailing dot, that carries user information, or that is followed directly by `;`, a backslash or `@`). The realistic forms (`solr-headless`, `zk-0`, `fusion-api-<pod hash>`, mixed or upper case, a name after a colon) are caught.
- **The check can flag things that are not hosts, and the scrubber can rewrite them.** A hyphenated word followed by a colon and digits looks like a host name with a port to the label-and-port rule: `UTC-05:00` and `GMT-08:00` (time-zone offsets), `status-code:200`, `x-request-id:12345`, `utf-8:12`, `sha-256:<hex>`, or a Jetty thread name such as `qtp1234-56:78`. The check fails closed on them, so a person looks, and the scrubber's replacement would change such a value: its label-and-port rule rewrites a `UTC-05:00` or `GMT-08:00` style offset to `localhost:00` (it keeps only names that start with `banana-it-`; an ISO offset such as `-05:00` has no letters before the hyphen and is left alone). The scrub runs before the check, so a recording that holds such a value is changed before the check sees it. None occurs in the committed fixtures; if a new recording holds one, compare the scrubbed fixture with the recording and restore the value by hand if it matters.
- Two defects noticed while writing the specs have no pending spec here: the dashboard list sorts by a `name` field that blob entries do not have, and a second range filter on the same field is refused as a duplicate. They are left to later work. Later change (see 0030): the second-range defect is fixed and tested.

- A change to how a service builds a request, reads a response or reports an error fails a spec named for the Fusion or Solr behaviour it touches. Eight deliberate changes to the services (a different resource type, an unencoded id, a different collection field, a different facet limit, a different type field, a different delete body, a different separator, a different default operator) were each caught by at least one new or existing spec.
- The recordings are of one Fusion 5.9.16 instance with one collection. They show the shapes that version returned for those requests, not every shape it can return. A different version or configuration needs a new recording (`tools/fixtures/record.js` and `tools/fixtures/scrub.js` with the guarded-client environment of the live tests) and a look at the diff.
- The Solr-mode specs show that the code reads and writes the Solr shapes it is documented to. They do not show how a real standalone Solr answers.
- The mock `$httpBackend` of AngularJS 1.0.8 matches a URL by string or pattern only, so the helper in `test/unit/helpers/fixtures.js` lets a spec read the request body and headers from the matched request instead of a matcher function.
- Recording needs the same environment as the live tests and a registry directory outside the work tree. The raw recording holds unscrubbed bodies and must stay outside the repository.
- The check costs a few milliseconds on each `npm run test:node`, and it makes adding a fixture by hand a step that must pass the same rules.
