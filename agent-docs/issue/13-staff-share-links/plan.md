# Implementation Plan: Staff share-links — personal tokenized views (/svar)

## Summary

Build the staff-facing, login-free mobile page a worker opens from the
personal link their manager texts them. One long unguessable token (already
minted by `POST /action/staff/:id/regenerate-link`) is the credential; it
resolves token → staff → org. The page — per `design/Timla App -
Tillgänglighet länk.dc.html` — lets the worker report **when they want to
work** and **when they can't**, and shows their **published shifts**.
Submitting replaces their whole availability document (last write wins) and
shows a confirmation. The worker-facing URL is Swedish (`/svar/:token`,
matching the existing `/schema` route); the underlying data endpoints are
the only unauthenticated API surface. **MVP ships on the existing schema —
no migration**; design extras (desired-shifts/week, note, exception
provenance, "Kan extra" dated wishes) are deferred. Folds in #7.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None hard. Reads existing publications for the schedule section (seed already publishes the current week), so it is **not** blocked by #10's publish action. |
| **Blocks / absorbs** | #7 (availability editor) — folded in per the user; closes as delivered-by-#13 (Design Decision 6) |
| **Related issues** | #7 (availability editor — folded in), #10 (publish action + staff schedule read — schedule read delivered here, publish action stays separate), #6 (staff management — owns the copy-link URL that must change), #2/#4 (data model + `/data/availability` — done, reused), #3 (auth — established the sole unauthenticated surface), #11 (auto-schedule — inherits the deferred `desired_shifts_per_week`), #26/#29 (invites — unrelated) |
| **Scope** | ~5 backend files, ~6 frontend, **0 migrations**, 4 docs |
| **Risk** | High — first **unauthenticated public surface**; token handling, rate limiting, no-enumeration all security-sensitive. Mitigated by deferring all schema changes (additive-only). |
| **Complexity** | High |
| **Safe for junior** | No |
| **Conflict risk** | Low — no active competing plans (#3 merged) |

### Triage Notes

- **Token minting already exists** (`app/routes/action_staff.py`):
  `staff.share_token` (UNIQUE, `secrets.token_urlsafe(24)` ≈ 192 bits) and
  the regenerate-link action. #13 builds only the **consuming** surface +
  the view. Regeneration already invalidates the old token (UPDATE).
- **Auth is already primed for it**: `require_manager_auth`
  (`app/app.py`) only default-denies `data`/`compute`/`action` prefixes, so
  a new `/svar` surface is unauthenticated with no extra work.
- **The new design is the full staff mobile experience** — it contains the
  availability editor (#7's content) *and* the published-schedule read
  (#10's staff-facing content) in one screen. See Design Decision 6 on
  scope.
- **The manager UI already builds the share URL** as
  `${location.origin}/link/${token}` (`frontend/src/pages/Staff.tsx:25`,
  `shareUrl`). That path collides with the JSON-API prefix and must change
  to `/svar/:token` (Design Decision 1).
- **The design introduces elements not in the data model** — a 3-bucket
  time grid (Design Decision 2, kept), plus "Önskat antal pass/vecka", a
  free-text note, exception provenance, and "Kan extra" dated wishes. The
  latter four are **deferred** (Deferred section) so #13 ships on the
  existing schema with no migration. The design is a reference, not
  authoritative (user's call).
- **`/link` is referenced but unimplemented** in 10 spots (full inventory in
  Phase 5 step 13). All move to `/svar`, with a `/link/:token` → `/svar/
  :token` compat redirect.

## Analysis

The worker has no account. The token in the URL is the whole identity: the
backend resolves it to exactly one `staff` row (and thus one org), and every
read/write is scoped to that staff member. This is the only place in Timla
where an unauthenticated caller can touch data, so it must be tight: generic
404 on a bad/rotated token (no enumeration signal), rate limiting to make
guessing impractical, and no path from the token to anything but that one
worker's own availability and published shifts.

Two shapes have to coexist. The **manager** already edits the same
availability via the authenticated `/data/availability/:staff` endpoints,
which model arbitrary wall-clock intervals and keep dated exceptions in a
separate sub-resource. The **worker** gets a deliberately simpler tool: a
7-day × 3-bucket grid plus a flat list of dated exceptions, submitted as one
whole-document replace. Reconciling the simple editor with the richer model
(and with data the manager may have entered) is the core of this issue —
Design Decisions 2 and 3.

The schedule section is a read of whatever is already published
(`publication.shifts` jsonb, filtered to this staff member for the current
week). It does not depend on #10's publish *action* existing — it shows
whatever publications exist, and the seed publishes the current week.

## Implementation Steps

### Phase 1: Backend — the `/svar` surface

1. **New blueprint `app/routes/svar.py`** (unauthenticated). A shared
   resolver `_staff_by_token(conn, token) -> (staff, org)` that looks up
   `share_token`, returns a **generic 404** (`{'error':'not_found'}`) when
   missing or the staff is archived — no distinction that would leak whether
   a token exists.
   - `GET /svar/<token>/data` → context JSON (see payload below).
   - `PUT /svar/<token>/availability` → whole-document replace (Design
     Decision 3), transactional, last-write-wins, rate-limited.
   Register in `app/routes/__init__.py`.

2. **Context payload** (`GET /svar/<token>/data`). MVP scope — no new model
   fields (see "Deferred" below):
   ```json
   {
     "staff": { "first_name": "Ada", "name": "Ada Ohlsson" },
     "org": { "name": "Strandkiosken", "initials": "SK", "timezone": "Europe/Stockholm" },
     "availability": { "wishes": [...], "blocks": [...],
        "exceptions": [ {"id","on_date","start_minute","end_minute"} ] },
     "schedule": {
       "from": "2026-07-06", "to": "2026-08-02",
       "shifts": [ {"date","starts_at","ends_at"} ],
       "shift_count": 12, "hours": 66.0
     }
   }
   ```
   - `org.timezone` is **required** in the payload (review M1): shift
     `starts_at`/`ends_at` are UTC in `publication.shifts`, and the frontend's
     `wallClock(iso, tz)` needs the org tz to render local times / group by
     local date. `staff.first_name` is derived server-side as
     `name.split()[0]` (there is no `first_name` column — review M1).
   - **`schedule` is horizon-agnostic (do NOT bake in weeks).** Return the
     worker's **upcoming published shifts over a forward window** — a flat,
     date-grouped `shifts` list from today out to a horizon (e.g. today ..
     today+4 weeks), with `from`/`to` bounds and totals. The frontend groups
     by local date; it does **not** think in ISO weeks. Rationale: the
     week-by-week framing lives only in the `publication` model + the manager
     week-view lens — the platform must support longer planning periods, and
     #13 only *reads* schedules so it should be period-neutral and survive
     whatever publication model #10 lands on (see #10, biased toward
     arbitrary from/to periods).
   - **Implementation note:** `publication` is currently keyed by single ISO
     week, so today the server gathers this window by reading each week's
     publication that overlaps [from, to) and unioning this staff member's
     shifts. When #10 generalizes publications to arbitrary periods, this
     endpoint's *contract is unchanged* — only the internal gather changes.
     Do not surface week strings/labels in the payload.
   - `wishes`/`blocks` are recurring 3-bucket intervals; `exceptions` are
     **dated blocks only** (schema forbids dated wishes). Reuse the existing
     `_document()` shape from `data_availability.py`.

3. **`PUT /svar/<token>/availability`** — recurring is whole-replaced, dated
   exceptions are an explicit **add/remove delta** (review H1):
   ```json
   { "wishes":[{weekday,start_minute,end_minute}],
     "blocks":[{weekday,start_minute,end_minute}],
     "add_exceptions":[{on_date,start_minute,end_minute}],
     "remove_exception_ids":["<uuid>", ...] }
   ```
   **Why not a blind whole-replace (review H1):** deleting *all* dated rows
   would (a) wipe a manager-entered exception added while the worker's page
   was stale, and (b) destroy historical exceptions — both violating the
   issue's promise that "staff only remove a manager exception by explicitly
   deleting it" (and there is no `updated_at` to detect staleness without the
   deferred migration). So in one transaction: **delete + re-insert the
   recurring rows** (wishes/blocks — fully represented by the grid) but for
   dated rows **only delete ids in `remove_exception_ids`** (verify each
   belongs to this staff → else 400) and **insert `add_exceptions`**;
   everything else is untouched. Recurring is still last-write-wins; dated
   exceptions are never silently lost.
   **Recurring passthrough (review H2, ties to Design Decision 2):** the
   worker grid only owns bucket-aligned recurring rows. On PUT, delete only
   recurring rows whose `(start,end)` exactly equals a bucket range and
   re-insert the grid's cells; **leave non-bucket recurring rows (e.g. a
   manager's 09:00–17:00 or a 22:00–06:00 night block) untouched** — never
   expand them to 06:00–22:00 or delete intervals the grid can't show.
   **Hardened validation for a public write surface (codex #7):** reject
   unknown top-level fields; cap list sizes (wishes/blocks <= 21,
   add_exceptions <= 60, remove_exception_ids <= 200); each new `on_date`
   within a sane window (today-1y .. +2y — applies only to *added*
   exceptions, review M3); reuse the bucket-range + `is_strict_int` checks.
   The resolver takes `SELECT ... FOR UPDATE` on the staff row so two
   concurrent PUTs on one token can't interleave (review L4). No `source`
   field, so nothing to forge (dissolves codex #2). Return the refreshed
   context. Deliberately different from the manager PUT — Design Decision 3.

4. **Rate limiting** (`app/ratelimit.py`, in-memory). **Key primarily by
   client IP, not by token (codex #1):** a per-token key gives every guess a
   fresh bucket, defeating enumeration protection. Use an **IP-wide**
   sliding window over *all* `/svar/*` requests including unknown/malformed
   tokens (e.g. 30 req/min/IP), optionally plus a secondary per-(IP,token)
   window for hot valid links. Real IP via the existing ProxyFix.
   `429 {'error':'rate_limited'}`, via a `before_request` scoped to `/svar/`.
   No new dependency (Design Decision 7). **Prune expired keys on each hit
   (review L3)** so the dict can't grow unbounded under spray traffic. The
   limiter trusts `X-Forwarded-For` via `ProxyFix(x_for=1)`, i.e. it assumes
   exactly one fronting proxy hop — document this next to it (a deployment
   with no proxy would let clients spoof the header to rotate keys); this
   matches the app's existing ProxyFix assumption.

5. **Routing, headers, and retiring `/link`**. `app/app.py`:
   - **Do not** add `svar` to `API_PREFIXES`. The bare browser path
     `/svar/<token>` falls through the SPA fallback and serves `index.html`
     (like `/schema`). Explicit routes `/svar/<token>/data` and
     `/svar/<token>/availability` match before the `<path:path>` catch-all,
     so they return JSON. No content negotiation.
   - **`/svar/*` + `/link/*` response headers via an `after_request`
     (codex #5, review L1/L7)** — not per-handler, so it also covers
     `ApiError` 404s, the served page, and the `/link` redirect (whose
     `Location` carries the token): `Cache-Control: no-store`,
     `Referrer-Policy: no-referrer` (keep the in-URL token out of outbound
     Referer), `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`,
     and `X-Frame-Options: DENY` (a one-tap "Spara" surface is a classic
     clickjacking target; nothing app-wide sets frame options today).
   - **No CSRF mechanism needed (review):** the PUT carries no cookie
     credential (the token is the credential, in the URL path) and no CORS is
     enabled, so a cross-site JSON PUT can't be forged with the victim's
     authority. State this explicitly rather than adding a token.
   - **Retire `link` concretely (codex #8):** dropping `link` from
     `API_PREFIXES` alone would make `/link/*` fall into the SPA. Add an
     explicit `GET /link/<token>` -> **301 to `/svar/<token>`** so any link
     already sent keeps working, then remove `'link'` from `API_PREFIXES`.
     Update `test_health.py:20` (asserts `/link` is a JSON 404): bare `/link`
     (no token) now falls to the SPA — assert that deliberately (review L1).

5b. **Vite dev proxy (codex #4)** — `frontend/vite.config.ts`. Do **not**
   add a blanket `/svar` proxy: it would proxy the browser page
   `/svar/:token` to Flask and break Vite's SPA serving. Add a **regex**
   proxy for only the JSON sub-paths (e.g. `^/svar/[^/]+/(data|availability)$`)
   and replace the existing `/link` proxy line (10).

### Phase 2: (no migration)

6. **No schema change.** MVP #13 ships on the existing `staff` /
   `availability_interval` tables. Everything the design adds beyond them —
   `desired_shifts_per_week`, `availability_note`, exception provenance
   (`source` + "Inlagt av chefen" badge), and dated wishes ("Kan extra") — is
   **deferred** (see the Deferred section). This keeps an already-risky
   unauthenticated surface additive-only.

### Phase 3: Backend tests

7. `app/tests/test_svar.py` (skip-if-no-DB, like the others):
   - Resolver: valid token → 200 context; unknown token → 404 `not_found`;
     archived staff's token → 404; **no bearer needed** (unauthenticated).
   - Context shape: names, org initials, availability (wishes/blocks/dated
     blocks), and the current-week schedule (count + hours) read from a
     seeded/inserted publication.
   - Context shape: `org.timezone` present; `first_name` derived; `schedule`
     is a flat date-grouped list over a forward `from`/`to` window (no week
     strings), unioning published shifts from every publication overlapping
     the window.
   - PUT recurring: a second PUT overwrites the grid (last-write-wins); a
     **non-bucket recurring row (e.g. 09:00–17:00, 22:00–06:00) is preserved**
     across a worker save, not expanded/deleted (review H2).
   - PUT exceptions (delta, review H1): `add_exceptions` inserts;
     `remove_exception_ids` deletes only those; **an exception the worker
     never saw (added concurrently, not in the payload) survives**; a
     partial-day (minute-scoped) exception kept by the worker retains its
     minutes (review M5); a `remove_exception_id` for another staff → 400.
   - Validation: unknown field / oversized list / out-of-window added
     `on_date` → 400.
   - Routing: bare `/svar/<token>` returns HTML (the SPA), `/svar/<token>/
     data` returns JSON (review L6); `/svar/*` responses carry the security
     headers incl. the 404 path; bare `/link` (no token) → SPA.
   - `/link/<token>` → 301 to `/svar/<token>` with `Cache-Control: no-store`.
   - Regenerated token kills the old one (old token → 404).
   - Rate limit: burst past the window → 429, even across distinct tokens.
   - Cross-org: a token only ever returns its own staff/org's data.
   - Regression: the sweep in `test_auth.py` still holds (all
     `/data|/compute|/action` reject unauth); `/svar/*` is exempt.

### Phase 4: Frontend — the login-free view

8. **Public bootstrap outside Clerk (codex #3).** `frontend/src/main.tsx`
   currently (a) **throws** without `VITE_CLERK_PUBLISHABLE_KEY` (line 24)
   and (b) mounts `ClerkProvider` around the whole app (line 58). Branch **in
   `main.tsx`, before mounting Clerk**: if `location.pathname` starts with
   `/svar/`, render a bare `<SvarView>` tree (Router + Theme + QueryClient,
   **no** ClerkProvider) and move the `PUBLISHABLE_KEY` throw *inside* the
   non-svar branch, so the token page needs no Clerk key and never
   initializes Clerk (no clerk-js CDN fetch → the real privacy/Referer win).
   **Precise claim (review M4):** `@clerk/react` is statically imported at
   module top, so its *code* still ships in the single bundle and is not
   *executed* for `/svar` — this avoids mounting Clerk and the network/key
   dependency, but is not "zero auth JS in the bundle." If a hard
   no-auth-code requirement emerges, `React.lazy` the two branches; not
   needed for MVP. `App.tsx` stays the authed app.

9. **`frontend/src/svarApi.ts`** — anonymous, token-scoped calls using plain
   `fetch` (no bearer, no `getToken`): `getSvarContext(token)`,
   `putSvarAvailability(token, doc)`. Reuses the `ApiError` shape.

10. **`frontend/src/pages/SvarView.tsx`** — port the design, MVP subset:
    context header (lockup, "Säker länk" badge, "Hej {firstName}!", workplace
    card), tab switcher (Vill jobba / Kan inte), the two 3-bucket grids, the
    dated-exceptions list (add/remove; **"Kan inte" only** — no "Kan extra"
    toggle, no "Inlagt av chefen" badge), the published-schedule section, the
    sticky "Spara min tillgänglighet" footer, and the confirmation
    bottom-sheet. **Omit** the "Önskat antal pass / vecka" stepper and the
    note textarea (deferred). Mobile-first, full-viewport, cream background.
    Pre-populate from context; map buckets↔intervals (Design Decision 2:
    exact-match read, non-bucket rows carried through untouched); keep each
    exception's original `id` + minutes (a partial-day manager exception must
    re-emit unchanged, review M5) and default worker-added exceptions to
    full-day (0–1440); submit recurring grid + `add_exceptions` +
    `remove_exception_ids` (review H1). Render shift times via `wallClock(iso,
    org.timezone)`. The schedule section renders the flat `shifts` list
    grouped by local date with day headers over the returned `from`/`to`
    window — **not** a week grid — or an empty state. Loading + error +
    "token not found" states.

11. **Bucket helpers** (in `svarApi.ts` or a small `buckets.ts`): the three
    ranges as constants, `bucketsToIntervals`, and `intervalsToBuckets`
    (exact-match) that also returns the non-bucket recurring rows to carry
    through on submit.

12. **`frontend/src/pages/Staff.tsx:25`** — change `shareUrl` from
    `/link/${token}` to `/svar/${token}`.

### Phase 5: Docs

13. **Stale `/link` inventory (complete — codex #6).** All 10 references
    move to `/svar`: `docs/primitives.md:25`, `docs/api.md:11` + `:98`,
    `CLAUDE.md:20`, `README.md:35`, `scripts/seed.py:192` (example link
    print), `app/routes/action_staff.py:3` (comment), `app/tests/
    test_health.py:20` (the `/link` JSON-404 assertion → redirect),
    `frontend/vite.config.ts:10` (proxy), `frontend/src/pages/Staff.tsx:25`
    (shareUrl). Document `GET /svar/:token/data` + `PUT /svar/:token/
    availability` as the only unauthenticated API.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `app/routes/svar.py` | Create | The unauthenticated `/svar` GET/PUT surface + token resolver + `/link` compat redirect |
| `app/ratelimit.py` | Create | In-memory IP-keyed sliding-window limiter for `/svar/*` |
| `app/routes/__init__.py` | Modify | Register the svar blueprint |
| `app/app.py` | Modify | Retire `link` from `API_PREFIXES`; `/svar/*` after_request headers; bare `/svar/:token` → SPA |
| `scripts/seed.py` | Modify | Update the example-link print `/link` → `/svar` |
| `app/tests/test_svar.py` | Create | Resolver, context, whole-doc PUT, rate limit, cross-org |
| `app/tests/test_health.py` | Modify | `/link` now 301-redirects (not JSON 404) |
| `frontend/src/main.tsx` | Modify | Branch `/svar/*` to a bootstrap **outside** ClerkProvider (codex #3) |
| `frontend/src/App.tsx` | Modify | Stays the authed app; `SvarView` reached via the main.tsx branch |
| `frontend/src/svarApi.ts` | Create | Anonymous token-scoped API + bucket↔interval helpers |
| `frontend/src/types.ts` | Modify | `SvarContext` type |
| `frontend/src/pages/SvarView.tsx` | Create | The staff mobile page (design port, MVP subset) |
| `frontend/src/pages/Staff.tsx` | Modify | Share URL → `/svar/:token` |
| `frontend/vite.config.ts` | Modify | Regex proxy for `/svar/:token/(data\|availability)`; drop `/link` |
| `docs/primitives.md`, `docs/api.md`, `CLAUDE.md`, `README.md` | Modify | `/link` → `/svar`; document the surface |

## Deferred (design elements not in MVP #13)

The design file is a reference, not authoritative (user's call). These are
stored data / logic with no MVP consumer or a schema conflict; each is a
cheap follow-up once the surface exists, and none locks anything in:

- **`desired_shifts_per_week`** — no consumer until auto-scheduling (#11,
  stretch); lands naturally there.
- **`availability_note`** — needs a manager-side surface; nice escape-hatch,
  but the structured grids are the core "register availability."
- **Exception provenance** (`availability_interval.source`) + the "Inlagt av
  chefen" badge — the load-bearing preservation works via the add/remove
  delta (Design Decision 3); only the badge needs the column. Deferring it
  also removes the "don't trust client `source`" attack surface entirely.
- **"Kan extra" dated wishes** — forbidden by the current
  `availability_wish_is_recurring` CHECK, and dated positive-availability
  needs deliberate conflict-engine work (#9/#11). MVP dated exceptions are
  blocks-only ("Kan inte").
- **Per-exception reason text** (design shows "Semester", "Läkarbesök
  (halvdag)") — a distinct free-text field from `availability_note`, not in
  the model (review L5). Deferred with the note; MVP exception cards show
  the date/time only, no subtitle.

Consequence: **#13 needs no migration** and touches no existing table
definition.

## Codebase Areas

- `app/routes/` (new unauthenticated surface)
- `app/` (app.py routing, rate limiting) — no `migrations/` change
- `app/tests/`
- `frontend/src/` (App routing, new view, api)
- `docs/`

## Design Decisions

> Non-trivial choices. Feedback welcome; otherwise implementation proceeds
> with these.

### 1. `/svar` naming and the browser-vs-JSON split
**Options:** (A) one Swedish prefix — bare `/svar/:token` serves the SPA,
`/svar/:token/data` + `/svar/:token/availability` serve JSON (explicit
routes beat the SPA catch-all); (B) Swedish SPA path + a separate English
JSON prefix.
**Decision:** A.
**Rationale:** The worker-facing URL should be Swedish and human-readable
(it lands in an SMS), consistent with the existing `/schema` route; "svar"
("your response") over "anmäl" (reads as reporting-someone-in). Keeping the
JSON under the same `/svar` prefix avoids inventing a second name for one
concept. It does put Swedish in a few API paths, a minor exception to the
otherwise-English API — but this is a deliberately separate unauthenticated
surface, not part of the `/data|/compute|/action` primitives (which stay
English). `/link` is retired everywhere.

### 2. Per-day time range (SUPERSEDED — was: 3-bucket grid)
**Superseded 2026-07-08 by explicit user decision** ("Ta bort buckets och byt
datamodell"). The worker view is now **day-first with one arbitrary time range
per weekday**: tap a day = whole day (00:00–24:00), "Vissa tider" opens a
start/end control (native time inputs) to narrow it. No fixed buckets. The
recurring intervals stored are `{weekday, start_minute, end_minute}` with
`0 <= start < end <= 1440` — the same general model the manager PUT already
uses, so there is no worker/manager data-model split anymore.
**Accepted limitation:** one range per weekday in this view; a weekday with
multiple stored intervals (manager-set split) collapses to its bounding span
on load and persists as that span on save. Split intervals stay a manager-UI
concern. (Deferred: multi-range days.)

*Original rationale (obsolete, kept for history):* buckets were chosen for
one-tap mobile friction and cross-staff comparability, with an exact-match
read + non-bucket passthrough (review H2) to avoid data loss. The user judged
the fixed buckets too opinionated (no nights, café ≠ nightclub) and preferred
"click the day, then fiddle a control for precision".

### 3. Recurring full whole-replace + exception add/remove delta
**Options:** (A) literal whole-document replace (delete all recurring +
dated, re-insert from payload); (B) recurring whole-replace, but dated
exceptions as an explicit add/remove delta (`add_exceptions` +
`remove_exception_ids`).
**Decision:** B (revised from A after review H1). *Updated 2026-07-08:* with
buckets gone (DD2 superseded), the recurring half is now a **full** replace of
all recurring wish/block rows (identical to the manager PUT), not the earlier
bucket-only replace-with-passthrough — the worker page is seeded from every
recurring row, so re-submitting the shown week round-trips it. The H2 data-loss
concern that motivated passthrough no longer applies (no non-bucket rows the
worker can't see/edit). Exception handling is unchanged: an explicit delta.
**Rationale:** A reads the issue's "replaces the whole document" literally
but breaks its very next clause — "staff only remove a manager exception by
explicitly deleting it" — in two concrete ways: a manager exception added
while the worker's page was stale gets wiped, and historical exceptions are
destroyed on every save (with no `updated_at` to detect staleness without
the deferred migration). B keeps last-write-wins where it's safe (the
recurring grid, fully shown to the worker) and makes exception changes
explicit deltas, so untouched dated rows — including concurrent manager
additions and history — always survive. Still no `source` column, so nothing
to forge (dissolves codex #2); provenance/badge deferred. Deliberately
different from the manager's `/data/availability` PUT (recurring-only +
separate exceptions sub-resource).

### 4. Design-only additions → deferred
**Decision:** Defer `desired_shifts_per_week`, `availability_note`,
exception provenance/badge, and "Kan extra" dated wishes. See the **Deferred**
section for the per-item rationale.
**Rationale (summary):** Each is either stored data with no MVP consumer, a
field needing a separate manager surface, or a schema-constraint conflict.
Deferring them means **#13 needs no migration** and stays additive — the
right posture for the first unauthenticated public surface. All are cheap,
non-locking follow-ups (perWeek lands with #11).

### 5. Manager name in the UI
**Decision:** Deferred with the provenance badge (Decision 4). If/when the
badge is added, use generic Swedish copy ("Inlagt av chefen") rather than a
per-manager display name — there is no manager display name in the model.

### 6. Scope vs #7 and #10
**Decision:** #13 delivers the whole `/svar` page — the availability editor
(**#7's staff-facing scope, folded in per the user**) and the
published-schedule read (#10's staff-facing scope). #7 is closed as
delivered-by-#13; #10 keeps only the manager publish **action**.
**Rationale:** The design is one cohesive screen; splitting it across issues
would force a half-built page. The schedule read needs no new backend (reads
existing publications). Confirmed by the user.

### 7. Rate limiting
**Options:** (A) hand-rolled in-memory sliding-window on `/svar/*` (no new
dependency); (B) `flask-limiter` with a memory backend.
**Decision:** A, **keyed by IP not token** (codex #1).
**Rationale:** Fits the repo's dependency-light style; the issue says an
in-memory counter is enough for MVP. Keying by token would give each guessed
token its own bucket — useless against enumeration; key by client IP over
all `/svar/*` (including unknown tokens). It resets on restart and is
per-worker — acceptable, because the 192-bit token is the real defense and
this is only a guessing throttle, not a security boundary.

## Verification Checklist

- [ ] A worker with only their link + a phone can register wishes and blocks and submit (design flow, mobile)
- [ ] The submitted availability is respected by `/compute/conflicts` (feeds the shift editor #9)
- [ ] Bad/rotated token → generic 404 (no enumeration); a regenerated link kills the old one
- [ ] `/svar/*` is reachable unauthenticated; **all** `/data|/compute|/action` still reject unauthenticated calls
- [ ] Recurring grid is last-write-wins; a **non-bucket recurring row (09:00–17:00, 22:00–06:00) survives a worker save unchanged** — not expanded or deleted (H2)
- [ ] Exceptions are a delta: a kept exception survives, a removed one is dropped, and an exception the worker never saw (concurrent manager add) is **not** wiped (H1)
- [ ] A partial-day (minute-scoped) exception kept by the worker retains its minutes; a new worker exception defaults to full-day
- [ ] Rate limiting is IP-keyed and returns 429 past the window even across distinct (guessed) tokens; the limiter dict prunes expired keys
- [ ] Cross-org isolation: a token exposes only its own staff/org; concurrent double-PUT can't interleave (FOR UPDATE)
- [ ] `/svar/*` + the `/link` redirect carry `no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `nosniff`, `X-Frame-Options: DENY` (incl. the 404 and the served page)
- [ ] The `/svar/:token` page bootstraps **without** mounting Clerk / requiring the Clerk key (no clerk-js fetch on the public link)
- [ ] The bare `/svar/:token` URL serves the SPA (not a JSON 404); `/svar/:token/data` returns JSON; Vite dev proxy routes only the JSON sub-paths
- [ ] `/link/:token` 301-redirects to `/svar/:token`; bare `/link` → SPA
- [ ] Manager "Kopiera delningslänk" produces a `/svar/:token` URL that opens the view
- [ ] The schedule section is horizon-agnostic: a flat date-grouped list of the worker's upcoming published shifts over a forward window (no ISO-week strings in payload or UI), times rendered in `org.timezone`, with count + hours; unions across every overlapping publication
- [ ] No schema migration in this issue; CI green with no Clerk keys
