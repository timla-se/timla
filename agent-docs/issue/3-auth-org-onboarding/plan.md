# Implementation Plan: Auth and organization onboarding

## Summary

Replace the dev-interim `X-Timla-Org` header mechanism with real
authentication: Clerk-issued JWTs verified in Flask, mapping a bearer
token to a Clerk user. Organization membership is held in a new local
`org_user` join table — deliberately **not** Clerk Organizations (see
Design Decision 1). Managers sign up/sign in via Clerk's React
components styled to the `design/Timla Auth.dc.html` reference, and a
first-login onboarding screen creates the organization (name + timezone)
before any other endpoint is reachable. Multi-admin invites are out of
scope (tracked separately in #29).

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None |
| **Blocks** | #29 (invite a second manager — needs real user identities to invite against) and #26 (invite staff by e-mail — its body explicitly says "Depends on auth (#3)"); #12/#14 are sequencing-related, not hard blockers |
| **Related issues** | #12 (deployment / self-hosting trade-off, referenced directly by #3's body), #13 (share links — the only other unauthenticated surface), #14 (org settings `PATCH`, builds on the `GET /data/org` this issue also extends), #21 (merged — design tokens/shell the new auth screens reuse), #29 (multi-admin invite, explicit follow-up) |
| **Scope** | ~10 files backend, ~8 files frontend, 1 migration |
| **Risk** | High — touches the auth chokepoint every existing endpoint relies on, and changes how the test suite authenticates |
| **Complexity** | High |
| **Safe for junior** | No |
| **Conflict risk** | Low — other existing plans (#6, #8, #21) are for merged/closed issues; this touches some of the same files (`App.tsx`, `Layout.tsx`, `api.ts`) but no other issue is actively in progress |

### Triage Notes

- The interim mechanism is explicitly self-documenting and easy to find:
  `app/api_utils.py:54-73` (`current_org`), `frontend/src/components/OrgGate.tsx`,
  and `frontend/src/api.ts:3-15` (`ORG_KEY`/`getOrgId`/`setOrgId`/`clearOrgId`)
  all carry "#3 replaces/deletes this" comments. `docs/api.md`'s "Auth
  (interim)" section and `Layout.tsx:138-158`'s "Byt organisation" button
  + the account chip (`title="Konto — inloggning kommer med issue #3"`,
  line 185) also reference this issue directly and must be updated/removed.
- `GET /data/org` already exists (`app/routes/data_org.py`) — it predates
  this issue (added with the core data model). This issue adds
  `POST /data/org` to the same file for onboarding; #14 later adds `PATCH`.
- `design/Timla Auth.dc.html` is a generic multi-vertical SaaS template,
  not a literal Timla spec: its "Skapa konto" screen has a "Verksamhet:
  Frisör & salong" (business-type) dropdown, and its 3-step onboarding
  sidebar reads "Skapa konto → Lägg upp tjänster & tider → Dela din
  bokningslänk" — service/booking-link concepts that don't exist in
  Timla's staff-scheduling-only MVP (see CLAUDE.md). Treat it as a
  **visual reference only** (brand panel, typography, card layout, the
  BankID-button placeholder); the actual onboarding fields (org name +
  timezone) aren't depicted and need original layout within the same
  visual language. See Design Decision 3.
- A working reference implementation exists locally at `~/repos/openvera`
  (`app/auth.py`, `app/app.py:41-171`, `frontend/src/main.tsx`,
  `frontend/src/components/{SignInScreen,OnboardingScreen}.tsx`) and can
  be ported/trimmed rather than built from scratch. Notably, OpenVera
  itself does **not** couple its own company model to Clerk
  Organizations either (`OnboardingScreen.tsx`'s docstring: "no permanent
  link is recorded between the Clerk org and the OpenVera company — we
  keep them decoupled (Model B)") — independent precedent for Design
  Decision 1 below.
- CI (`.github/workflows/ci.yml`) has no Clerk secrets configured and
  must keep passing — the `TESTING`-mode synthetic-principal pattern
  (`X-Test-User` header) is required, not optional. CI's postgres runs on
  port 5432 (vs. 5433 locally via docker-compose) — no change needed,
  just noting it's a different port than the dev recipe in this repo's
  `CLAUDE.md`.
- **#26** ("Invite staff by e-mail") already exists, is open, and its body
  explicitly states "Depends on auth (#3)". Its scope (per-staff invites
  with roles, driven by the Personal-page design, e-mail delivery,
  revoke/resend) is broader than and adjacent to #29 (a second
  *manager*, no roles, no e-mail delivery) — the two should be
  cross-referenced when either is picked up so effort isn't duplicated,
  but neither is this issue's problem to resolve.
- Three existing test spots reference the interim header directly and
  must change (confirmed via `grep -rn "HTTP_X_TIMLA_ORG\|X-Timla-Org\|missing_org" app/`):
  `app/tests/test_health.py:18` (`test_unknown_api_path_is_json_404_not_spa`),
  `app/tests/test_api_data.py:19-20` (`test_staff_requires_org_header`),
  and `app/tests/test_api_data.py:54` (`test_org_isolation`, which opens a
  second org and sets the header manually rather than via fixtures). See
  Phase 3 step 8 for the concrete updates.

## Analysis

Every `/data`, `/compute`, `/action` route currently resolves its
organization via `current_org(conn)`, which trusts a client-supplied
`X-Timla-Org: <uuid>` header — anyone who knows or guesses an org id has
full read/write access. The fix has two symmetric halves that must land
together: the backend must start requiring a verified identity and
deriving the org from a database lookup instead of trusting the caller,
and the frontend must start sending that identity (a Clerk session
token) instead of a pasted UUID. Shipping only one half leaves either a
backend that 401s the still-unmodified frontend, or a frontend sending
tokens nothing verifies yet — so this stays one integrated change (see
existing Design Decision precedent in the issue-planning discussion:
kept as a single issue, not split).

The org-creation ("onboarding") step is a separate but tightly coupled
concern: a signed-in user with no org yet must be able to reach exactly
one endpoint (`POST /data/org`) while every other endpoint still 403s
for them. This means auth *enforcement* (is there a valid user?) and org
*resolution* (does this user have an org?) must be distinct checks —
enforcement happens once per request in `app.py`, resolution happens
inside `current_org` and is allowed to fail with a distinguishable error
code the frontend can key off.

## Implementation Steps

### Phase 1: Backend auth core

1. Add `PyJWT>=2.6` and `cryptography>=39.0` to `requirements.txt`
   (matches the versions already proven working in `~/repos/openvera/requirements.txt`).
2. Create `app/auth.py` — port `~/repos/openvera/app/auth.py`, trimmed to
   user tokens only:
   - Keep: `ClerkAuthError`, `ClerkUser` (drop the `org_id` field — Timla
     doesn't use Clerk org claims), `_derive_issuer_from_publishable_key`,
     the module-level `PyJWKClient`, `is_configured()`,
     `verify_clerk_token(token) -> ClerkUser`.
   - Drop: `_MACHINE_SUB_PREFIXES`, `verify_clerk_jwt` (the user/machine
     dispatcher), `_resolve_machine_principal`, the `require_auth`
     decorator (enforcement is hook-based here, see step 3), and the `o`/
     `org_id` claim parsing in `_claims_to_user`.
   - No Flask imports — keep it the "thin, pluggable" module the
     self-hosting note in #3 asks for.
3. `app/app.py` — add two `before_request` hooks right after `health()`
   (line 48-50) and before `import routes` (line 53) — exact position
   among the module's other `before_request`/`after_request` hooks
   doesn't matter functionally (Flask runs them in registration order
   regardless of where in the file they're defined), but this keeps
   related request-lifecycle code grouped:
   - `attach_user`: mirrors `openvera/app/app.py:41-58` minus all
     machine-principal branching. Parses `Authorization: Bearer <token>`,
     calls `auth.verify_clerk_token`, sets `g.user` (a `ClerkUser`) or
     `None` on any failure/absence. Always runs; never itself rejects.
   - `require_manager_auth`: default-deny for the `data`/`compute`/
     `action` prefixes (reuse `API_PREFIXES` at line 32, excluding `api`
     and `link`) — checked by prefix, so it fires for **any** path under
     those prefixes whether or not a route matches, including truly
     unknown ones (e.g. `/data/nonexistent`). This means unauthenticated
     requests to unknown `/data|/compute|/action` paths now get `401`
     instead of the current `404` — see Phase 3 step 8 for the test
     fallout. `/api/*` and `/link/*` are unaffected (link routes are
     #13's unauthenticated surface; `/api/health` stays public). In
     `app.config['TESTING']` mode, synthesize `g.user` from an
     `X-Test-User` header (a plain string standing in for a Clerk `sub`)
     when absent — mirrors openvera's `_attach_test_principal` but
     without the machine-principal branch. Otherwise, no `g.user` →
     `raise ApiError(401, 'unauthenticated', 'Authorization: Bearer <token> required')`
     (reuses the existing `ApiError`/`api_error_response` machinery in
     `api_utils.py`, not a hand-rolled response shape).
   - Fail-loud guard: if `not auth.is_configured()` and `IS_PROD`, raise
     at import time — mirrors the existing `SECRET_KEY` guard at
     `app.py:23-28`.
   - Dev setup note: local API testing against a real Clerk token (as
     opposed to `TESTING`-mode) needs `CLERK_PUBLISHABLE_KEY` set in the
     **backend's** environment too, alongside the frontend's
     `VITE_CLERK_PUBLISHABLE_KEY` (step 12) — document both in this
     issue's dev notes / `CLAUDE.md`'s Dev section so the two don't get
     configured out of sync.
4. `app/api_utils.py:54-73` — rewrite `current_org`'s **body only** (the
   signature stays `current_org(conn)`, so all 8 existing route modules
   keep working unmodified):
   ```python
   def current_org(conn):
       """Resolve the calling organization from the authenticated user."""
       with conn.cursor() as cur:
           cur.execute(
               'SELECT o.id, o.name, o.timezone FROM org_user ou '
               'JOIN organization o ON o.id = ou.org_id WHERE ou.user_id = %s',
               (g.user.sub,),
           )
           org = cur.fetchone()
       if org is None:
           raise ApiError(403, 'no_org', 'No organization linked to this account yet — onboard via POST /data/org')
       return org
   ```
   Add `from flask import g` to the imports; drop the `uuid` import (no
   longer parsing a header UUID) if nothing else in the file uses it —
   verify before removing.
5. `app/routes/data_org.py` — add `POST /data/org` next to the existing
   `GET`:
   ```python
   from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
   from flask import Blueprint, g, jsonify
   from api_utils import ApiError, current_org, get_json_body
   from db import get_db

   @bp.post('/data/org')
   def create_org():
       body = get_json_body()
       name = body.get('name')
       if not isinstance(name, str) or not name.strip():
           raise ApiError(400, 'invalid', 'name is required')
       name = name.strip()
       tz = body.get('timezone', 'Europe/Stockholm')
       if not isinstance(tz, str):
           raise ApiError(400, 'invalid', 'timezone must be a string')
       try:
           ZoneInfo(tz)
       except ZoneInfoNotFoundError:
           raise ApiError(400, 'invalid', 'timezone must be a valid IANA zone')
       with get_db() as conn:
           with conn.cursor() as cur:
               cur.execute(
                   'INSERT INTO organization (name, timezone) VALUES (%s, %s) RETURNING id, name, timezone',
                   (name, tz),
               )
               org = cur.fetchone()
               # ON CONFLICT DO NOTHING makes the "already onboarded" check
               # atomic — a check-then-insert has a race window where two
               # concurrent onboarding requests for the same user could both
               # pass the check and one hit a raw unique-violation 500.
               cur.execute(
                   'INSERT INTO org_user (user_id, org_id, email) VALUES (%s, %s, %s) '
                   'ON CONFLICT (user_id) DO NOTHING',
                   (g.user.sub, org['id'], g.user.email),
               )
               if cur.rowcount == 0:
                   conn.rollback()  # discard the orphaned `organization` row from above
                   raise ApiError(409, 'already_onboarded', 'This account already belongs to an organization')
           conn.commit()
       return jsonify({'id': str(org['id']), 'name': org['name'], 'timezone': org['timezone']}), 201
   ```
   Note this endpoint must be reachable *before* `current_org` would
   succeed — it doesn't call `current_org`, it works directly off
   `g.user`, so the "no org yet" 403 from other routes never blocks it.

### Phase 2: Migration

6. `migrations/versions/0002_org_user.py` — raw SQL via `op.execute`,
   matching `0001_core_schema.py`'s style:
   ```sql
   CREATE TABLE org_user (
       user_id text PRIMARY KEY,
       org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
       email text,
       created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX org_user_org_idx ON org_user(org_id);
   ```
   Down migration: `DROP TABLE org_user;`. `user_id` as primary key means
   one org per user for MVP (a user can't belong to two orgs) while still
   allowing multiple different users to reference the same `org_id` —
   the data model already supports multi-admin; #29 only needs to add the
   invite *flow*, not a schema change.

### Phase 3: Backend tests + seed

7. `app/tests/conftest.py`:
   - `org_id` fixture (lines 11-22): after inserting the organization,
     also insert an `org_user` row, e.g. `user_id=f'user_test_{org_id}'`,
     so `current_org` resolves for that synthetic user.
   - `client` fixture (lines 25-29): set `app.config['TESTING'] = True`
     and `c.environ_base['HTTP_X_TEST_USER'] = <that same user_id>`
     instead of `HTTP_X_TIMLA_ORG`.
8. New `app/tests/test_auth.py`:
   - Walk the registered routes (`app.url_map`) and, for each rule under
     `/data`, `/compute`, `/action`, build a concrete sample URL —
     substitute a syntactically valid UUID for any `<uuid:...>` (or
     similar) converter in the rule — then hit every non-`HEAD`/
     non-`OPTIONS` method the rule allows with no `X-Test-User`/bearer
     token and assert `401`. Without the UUID substitution, parameterized
     routes never match and the sweep would silently pass against
     routing 404s instead of proving auth enforcement.
   - `/api/health` stays reachable with no token.
   - Cross-org isolation: two orgs (two distinct synthetic users) — user
     A's client can't see org B's staff/shifts (`GET /data/staff`
     returns org A's data only, no matter what org B's id is).
   - Onboarding: `POST /data/org` with no prior membership → 201; a
     second call for the same user → 409 `already_onboarded`; any
     `/data/*` call for a user with no membership → 403 `no_org`.
   - Validation: `POST /data/org` with a non-string `name` (e.g. `123`)
     or non-string `timezone` → 400 `invalid`, not a 500.

   **Migrate existing tests that assumed the interim header** (found via
   `grep -rn "HTTP_X_TIMLA_ORG\|X-Timla-Org\|missing_org" app/`):
   - `app/tests/test_health.py:18`
     (`test_unknown_api_path_is_json_404_not_spa`): split the path list.
     `/api/nonexistent`, `/api`, `/link` keep their current 404
     `not_found` assertion (unaffected by the new hooks). `/data`,
     `/data/nonexistent`, `/compute/x`, `/action/x` now hit
     `require_manager_auth`'s default-deny *before* Flask resolves
     whether a route exists, so an unauthenticated request gets `401`
     `unauthenticated` instead of `404` — update those assertions
     accordingly (move them into `test_auth.py` if that reads more
     naturally than splitting this test in place).
   - `app/tests/test_api_data.py:19-20`
     (`test_staff_requires_org_header`): rename to
     `test_staff_requires_auth`; assert `401` / `'unauthenticated'`
     instead of `'missing_org'`.
   - `app/tests/test_api_data.py:54` (`test_org_isolation`): currently
     opens a second org and sets `HTTP_X_TIMLA_ORG` directly. Replace
     with also inserting an `org_user` row for a second synthetic user
     (e.g. `f'user_test_other_{other_org}'`) bound to that org, and set
     `HTTP_X_TEST_USER` to that id instead — otherwise `current_org` has
     no membership row to resolve and the test 403s instead of exercising
     isolation.
9. `scripts/seed.py`: add an optional `TIMLA_SEED_USER` env var — if set,
   insert/update an `org_user` row binding that Clerk user id to the
   seeded org, idempotently (matching the script's existing `DELETE ...
   WHERE name = %s` reset pattern at line 48), so a developer's real
   Clerk account can own the demo data locally.
10. `.github/workflows/ci.yml`: no changes expected — the `TESTING`-mode
    synthetic principal means CI never touches real Clerk keys.
    `requirements-dev.txt`'s `-r requirements.txt` picks up the new
    PyJWT/cryptography pins automatically; confirm this during
    implementation rather than assuming.

### Phase 4: Frontend — Clerk wiring

11. `frontend/package.json`: add `@clerk/react` (pin `^6.6.2`, the
    version proven in `~/repos/openvera/frontend/package.json`).
12. `frontend/.env.local` (already covered by the `.env.*` gitignore
    rule) — `VITE_CLERK_PUBLISHABLE_KEY=...`, developer-provided, not
    committed.
13. `frontend/src/main.tsx`: wrap the render tree in `<ClerkProvider
    publishableKey={...} afterSignOutUrl="/">`; add a bridge component
    (mirrors openvera's `ClerkAwareApiProvider`) that reads
    `useAuth().getToken` and registers it with `api.ts`'s new
    token-getter hook (step 14), and clears the React Query cache on
    sign-out (`useEffect` on `isSignedIn === false` → `queryClient.clear()`).
14. `frontend/src/api.ts`:
    - Delete `getOrgId`/`setOrgId`/`clearOrgId`, `ORG_KEY` (lines 3-15),
      and the `X-Timla-Org` header logic inside `request()` (lines 30-33).
    - Add a module-level token getter: `let getToken: () => Promise<string
      | null> = async () => null` plus `export function
      setTokenGetter(fn: typeof getToken)`, called once by the
      `main.tsx` bridge.
    - `request()` awaits `getToken()` and sets `Authorization: Bearer
      <token>` when a token is returned.
    - Add `export const createOrg = (payload: { name: string; timezone?:
      string }) => request<Org>('POST', '/data/org', payload)`.

### Phase 5: Frontend — screens and gating

15. New `frontend/src/components/SignInScreen.tsx` — Clerk's `<SignIn
    routing="hash" />` inside a shell styled per `design/Timla
    Auth.dc.html`'s "Logga in" screen (dark ink `#231d16` brand panel
    with the Timla lockup + tagline on the left, cream `#fdf8ee` form
    panel). Reuse the existing `Lockup` component
    (`frontend/src/components/Lockup.tsx`, already used by `OrgGate.tsx`)
    and whatever ink/paper/cream tokens PR #24/#25 established in
    `index.css` — don't hand-roll the raw hex values from the static
    mockup.
16. New `frontend/src/components/OnboardingGate.tsx` — replaces
    `OrgGate.tsx`'s structural role, and must not render `children`
    (the whole app) on anything other than a *confirmed* org. Handle all
    four states of `useQuery({ queryKey: ['org'], queryFn: getOrg })`
    explicitly (mirroring how `OrgGate.tsx` today only flips `ready` on
    success — see its `submit()` — not on faith):
    - `isLoading` → spinner (also wait on Clerk's `useAuth().isLoaded`
      first, so the token bridge from step 13 is registered before the
      first `getOrg()` fetch fires — otherwise the very first request
      races ahead with no `Authorization` header).
    - `isError && error instanceof ApiError && error.code === 'no_org'`
      → the create-organization form (name text field + timezone select
      defaulting to `Europe/Stockholm`) that calls `createOrg`, then
      invalidates the `['org']` query key on success. Styled per the
      "Skapa konto" screen's card layout and brand panel, but with org
      name + timezone fields instead of the mockup's
      name/email/password/Verksamhet fields (those belong to Clerk's own
      `<SignUp>` step, not this screen — see Design Decision 3).
    - `isError` (any other code, e.g. network failure) → an error state
      with a retry action — do **not** fall through to rendering
      `children`, which would show a broken app shell instead of a clear
      failure message.
    - `isSuccess` → renders `children`.
17. Delete `frontend/src/components/OrgGate.tsx`.
18. `frontend/src/App.tsx`: replace the `<OrgGate>` wrapper (lines 25,
    36) with Clerk's `<SignedOut>`/`<SignedIn>` control-flow components:
    `<SignedOut><SignInScreen /></SignedOut><SignedIn><OnboardingGate>
    <Routes>...</Routes></OnboardingGate></SignedIn>`.
19. `frontend/src/components/Layout.tsx`:
    - Replace the "Byt organisation" button (lines 138-158, currently
      calls `clearOrgId`) with Clerk sign-out — either
      `useClerk().signOut()` wired to the same button copy/confirm
      dialog, or Clerk's `<UserButton />` (which has its own built-in
      sign-out menu, potentially replacing the confirm dialog UX
      entirely — worth a quick look during implementation at what reads
      better in the existing sidebar).
    - Replace the topbar account chip (lines 184-189, `title="Konto —
      inloggning kommer med issue #3"`) with `<UserButton />` sized to
      fit the existing 40×40 slot.

### Phase 6: Docs cleanup

20. `docs/api.md`: replace the "Auth (interim)" section (lines 6-10)
    with the real description — `Authorization: Bearer <clerk-jwt>`
    required on all `/data`, `/compute`, `/action` routes; `403 no_org`
    before onboarding; document `POST /data/org` in the org section.
21. `docs/primitives.md`: re-read after implementation — its auth
    paragraph already states the real invariant ("require an
    authenticated manager"), likely no change needed.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `requirements.txt` | Modify | Add `PyJWT`, `cryptography` |
| `app/auth.py` | Create | Clerk JWT verification (ported/trimmed from openvera) |
| `app/app.py` | Modify | `attach_user` + `require_manager_auth` before_request hooks, prod config guard |
| `app/api_utils.py` | Modify | `current_org` resolves via `org_user` + `g.user.sub` instead of `X-Timla-Org` |
| `app/routes/data_org.py` | Modify | Add `POST /data/org` onboarding endpoint |
| `migrations/versions/0002_org_user.py` | Create | `org_user` table + index |
| `app/tests/conftest.py` | Modify | `TESTING`-mode synthetic user fixtures |
| `app/tests/test_auth.py` | Create | 401 sweep, cross-org isolation, onboarding flow |
| `scripts/seed.py` | Modify | Optional `TIMLA_SEED_USER` binding |
| `docs/api.md` | Modify | Replace interim auth section, document `POST /data/org` |
| `frontend/package.json` | Modify | Add `@clerk/react` |
| `package-lock.json` (repo root) | Modify (generated) | Workspace lockfile picks up `@clerk/react` — required or `npm ci` fails in CI |
| `frontend/src/main.tsx` | Modify | `ClerkProvider` + token bridge |
| `frontend/src/api.ts` | Modify | Bearer token instead of `X-Timla-Org`; `createOrg` |
| `frontend/src/components/SignInScreen.tsx` | Create | Clerk `<SignIn>` styled per design |
| `frontend/src/components/OnboardingGate.tsx` | Create | First-login org-creation gate |
| `frontend/src/components/OrgGate.tsx` | Delete | Superseded by Clerk auth + `OnboardingGate` |
| `frontend/src/App.tsx` | Modify | `<SignedIn>`/`<SignedOut>` gating |
| `frontend/src/components/Layout.tsx` | Modify | Sign-out control, `UserButton` account chip |

## Codebase Areas

- `app/` (auth core, api_utils, routes/data_org)
- `app/tests/`
- `migrations/versions/`
- `frontend/src/` (main.tsx, api.ts, components/, App.tsx)
- `docs/`

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise
> implementation proceeds with these.

### 1. Clerk Organizations vs. a local `org_user` table

**Options:** Use Clerk Organizations (an `o`/`org_id` JWT claim, Clerk's
hosted invite/role UI) vs. a local `org_user` join table (the token maps
to a user only; org membership lives in Timla's own database).
**Decision:** Local `org_user` table.
**Rationale:** #3's own wording specifies "one module mapping bearer
token → user" — org membership is deliberately kept out of the
verification layer so a self-hosted auth backend can be swapped in later
without also having to replicate Clerk's organization/invite/role model.
Clerk Organizations would buy free invite UI but couple that self-hosting
escape hatch to Clerk-specific concepts. `~/repos/openvera` — the direct
reference implementation this issue borrows from — independently reached
the same conclusion for its own company model ("Model B... decoupled").
Multi-admin support (which needs an invite flow regardless of this
choice) is deferred to #29.

### 2. Onboarding enforcement signal

**Options:** Let `current_org` fail the same way it does today for an
unrecognized org (404) vs. a distinct `no_org` 403 code.
**Decision:** Distinct `no_org` 403.
**Rationale:** The frontend needs to reliably distinguish "signed in but
not onboarded yet" (show the onboarding gate) from "resource not found
within your org" (404, used elsewhere, e.g. `require_staff`) or generic
auth failure (401). Overloading an existing code would make that
distinction unreliable.

### 3. Design mockup fidelity for onboarding

**Options:** Pixel-match `design/Timla Auth.dc.html` literally (including
its "Verksamhet" business-type dropdown and "Lägg upp tjänster & tider" /
"Dela din bokningslänk" onboarding copy) vs. treat it as palette/layout
reference only and design the actual org-creation fields fresh.
**Decision:** Reference only.
**Rationale:** The mockup is a generic multi-vertical SaaS template whose
literal fields don't match Timla's data model or MVP scope — org name +
timezone is what #3 actually needs; "services & times" and "booking link"
are customer-booking-module concepts explicitly out of scope per
`CLAUDE.md`. Following the visual language (brand panel, typography, card
chrome, BankID placeholder) while substituting real fields serves the
design system's intent without inheriting inapplicable copy.

## Verification Checklist

- [ ] Two separate orgs cannot see each other's data (cross-org isolation test)
- [ ] Every `/data`, `/compute`, `/action` endpoint rejects unauthenticated calls (401)
- [ ] `/api/health` remains reachable without a token
- [ ] CI passes with no Clerk keys configured (`app.config['TESTING']` synthetic-principal path)
- [ ] Fresh sign-up → onboarding → org created → app usable, driven end-to-end via `.claude/skills/verify/SKILL.md`'s recipe
- [ ] A second onboarding attempt for an already-onboarded user → 409 `already_onboarded`
- [ ] Any `/data`, `/compute`, `/action` call for a signed-in, not-yet-onboarded user → 403 `no_org`
- [ ] `IS_PROD` with no `CLERK_PUBLISHABLE_KEY` set → fails loudly at startup, mirroring the existing `SECRET_KEY` guard
- [ ] Sign-out clears the React Query cache (no stale previous-user data flash)
- [ ] `npm ci` succeeds in CI after the `@clerk/react` lockfile update
- [ ] The route-sweep test actually exercises parameterized (`<uuid:...>`) routes, not just fixed-path ones — confirm by temporarily breaking the auth hook and seeing the sweep fail on those routes too
