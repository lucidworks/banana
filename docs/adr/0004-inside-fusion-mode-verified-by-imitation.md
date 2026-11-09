# 0004. The inside-Fusion layout is verified by imitation

Date: 2026-11-05
Status: Accepted
Accepted: 2026-11-06

Depends on: ADR 0003, which defines the optional `/admin/banana/` mount this decision relies on. ADR 0003 was accepted on the same date as this record's acceptance, so this decision is in effect.

> Note, 2026-11-07: a `path:line` without an alias cites Banana as it was when this record was written, and the files have moved since. The login redirect now reads the setting `FUSION_LOGIN_URL` and the session lookup reads `FUSION_SESSION_API`; both default to the 1.6.30 values, which is what the `/admin/banana/` mount of the container relies on ([ADR 0023](0023-docker-image.md)).

## Context

Banana's home is inside Fusion. Fusion's admin UI links to it at `/admin/banana/index.html` (`fw:app/common/services/menu-service.js:192`), and Fusion 5.9.16 serves the 1.6.30 build of Banana at that path, behind the same gateway and on the same origin as the admin UI and the session cookie. In that layout the relative login redirect `../login` resolves to Fusion's own login (`rel:src/app/app.js:97-110`) and the session lookup finds the cookie (`rel:src/app/services/lucidworksSrv.js:14-15`). Every change to Banana has to keep that layout working.

The only faithful test of that layout is to build Banana into a Fusion admin UI and run it. That means rebuilding the admin UI of a real Fusion system (the admin UI ships Banana as an npm dependency pinned to a released version) and replacing it on a running system. The Fusion system available for testing is shared with other work, and replacing its admin UI would change something other people depend on. An isolated Fusion could be stood up for this, but that is a separate project with its own cost, and no such system exists for this one.

The container described in ADR 0003 offers an affordable approximation. It can serve the built output at `/admin/banana/`, with the rest of the Fusion URL space (`/api/`, `/auth/`, `/admin/`) proxied to a real Fusion over the same origin. This gives Banana the same path, the same relative login redirect, the same session lookup and the same cookie scope as inside Fusion.

## Options considered

1. **Rebuild and install the admin UI on the shared Fusion.** Rejected. It is destructive on a system other work depends on, and it needs access to change a running system's admin UI that is not available.
2. **Stand up a separate Fusion just for this.** Rejected for now. It is a large effort, it needs a Fusion licence and environment, and the part it would add over the imitation is small (see below). It remains the right choice if a Banana change ever touches something the imitation does not cover.
3. **Do not verify the layout.** Rejected. It is the layout most users run, and a change to the login redirect, the session lookup or the asset paths is exactly what could break it.
4. **Verify by imitation: serve the built output at `/admin/banana/` behind the container's proxy, in front of a real Fusion.** Accepted.

## Decision

The inside-Fusion layout is verified only by serving the built output under `/admin/banana/` behind the container's same-origin proxy (the optional mount in ADR 0003), against a real Fusion. That serves the same files under the same path, with the mount's own `config.js` leaving the login URL and session path at the 1.6.30 defaults, so the checks exercise the code a Fusion-hosted Banana runs. No change is installed into any Fusion's admin UI.

What the imitation checks: the asset paths and the `config.js` location under `/admin/banana/`; the relative login redirect from `/admin/banana/` to `/admin/login`; the return value and the page the user comes back to; the session lookup; the cookie scope; framing and headers on the proxied pages; saving, loading and deleting a dashboard; and that a dashboard saved one way opens the other way.

What it cannot check, and the accepted risk:
- Anything the real admin UI itself adds around the Banana page: its menu entry and the link target, the way it frames or links to Banana, and a future admin UI that changes how it hosts Banana.
- Headers and caching that Fusion's own web server applies to `/admin/banana/` files. The imitation sends the container's headers, not Fusion's (Fusion adds `X-Frame-Options: SAMEORIGIN` and no content policy, observed live).
- Behaviour of a Fusion version other than the one tested.

The residual is accepted for the following reason: the code that runs in the browser is the same in both layouts, the imitation reproduces the path, origin and cookie facts that decide whether it works, and what is left is the admin UI's own hosting, which Banana's changes do not touch. Where a change could touch it (the menu link target, a new asset path outside `app/`, a header the app depends on), the change records that this ADR's limit applies and a person who has a Fusion admin UI available checks it.

## Consequences

- Banana's tests for the inside-Fusion layout run against the container's `/admin/banana/` mount and need a real Fusion for the proxied parts.
- A change to the page's relative paths or its login redirect is checked in that layout every time.
- A release that is checked this way has been checked in an imitation, and release notes and documentation say so rather than claim a test inside Fusion.
- If a stand-alone Fusion with a replaceable admin UI becomes available, a single run in it removes the residual; this ADR is then amended rather than replaced.
