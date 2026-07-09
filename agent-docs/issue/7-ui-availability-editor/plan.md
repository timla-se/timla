# Implementation Plan: UI: availability editor

## Summary

Issue #7 asks for the staff-facing availability editor (opened from the
personal share link, no login, mobile-first, two tabs: wishes + hard blocks),
manager-side view/edit in the admin UI, and that the registered availability
is respected by conflict checking. Nearly all of this has already shipped
through other issues: the mobile editor landed with #13 (PR #33,
`frontend/src/pages/SvarView.tsx` + `app/routes/svar.py`), the manager-side
editor with #6 (PR #20, `frontend/src/pages/StaffDetail.tsx` over the #4
`/data/availability` endpoints), and the conflict engine (#5,
`app/conflicts.py`) already emits hard `blocked` conflicts and soft
`outside_wishes` warnings from that data — including dated exceptions.

What remains is to **close the loop and prove the "Done when"**: add one
explicit end-to-end acceptance test (availability registered *through the
share-link surface* produces `blocked`/`outside_wishes` from
`/compute/conflicts` and is enforced on the shift write path), refresh a
stale pre-#13 copy string in the manager UI, verify the whole flow manually
on a phone-sized viewport, and close the issue.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None (#2, #4, #5, #6, #13 all closed) |
| **Blocks** | None (— #9 consumes the same conflict engine but does not wait on this) |
| **Related issues** | #13 (share-link surface, delivered the editor), #6 (manager UI), #4 (`/data/availability`), #5 (conflict engine), #2 (data model), #9 (shift editor with live conflict warnings — surfaces conflicts in the editor UI), #11 (suggest-schedule consumes availability) |
| **Scope** | 2 files across backend tests + frontend pages |
| **Risk** | Low |
| **Complexity** | Low |
| **Safe for junior** | Yes |
| **Conflict risk** | Low — no other open plan dirs besides this one (all other `agent-docs/issue/*` plans belong to closed issues) |

### Triage Notes

- All prerequisites are closed: #2 (data model), #4 (`/data/availability`),
  #13 (share links). No open blocker.
- **Scope interpretation of the "Done when"**: "the result is respected by
  conflict checking in the shift editor" is satisfied at the engine level —
  `/compute/conflicts` (which the shift editor calls live) and the
  `/data/shifts` write path both run `check_conflicts`, which reads
  `availability_interval` (recurring rows by `weekday`, dated exceptions by
  `on_date`). The *live warning UI inside the shift editor* is explicitly
  issue #9's deliverable ("UI: shift editor with live conflict warnings",
  open) — #7 must not re-scope it. What #7 still owes is the proof that
  svar-registered data flows into that engine.
- Existing test coverage is strong on each half but never crosses them:
  `app/tests/test_svar.py` covers the share-link read/write surface,
  `app/tests/test_conflicts.py` covers the engine with fixture-written
  availability. No test writes availability via `PUT
  /svar/:token/availability` and then checks conflicts — that is exactly
  #7's acceptance criterion, so we add it.

## Analysis

Requirement-by-requirement inventory against the issue text:

| Issue #7 requirement | Status | Where |
|---|---|---|
| Staff-facing view from personal share link, no login, mobile-first | Done | `frontend/src/pages/SvarView.tsx`, `app/routes/svar.py` (#13/PR #33); `/svar/:token` is the only unauthenticated surface |
| Tab "When do you want to work?" — weekly wish pattern | Done | SvarView "Vill jobba" tab: tap days, presets + 06–22 `RangeSlider` |
| Tab "When can you absolutely not work?" — weekly blocks + specific dates (vacation) | Done | SvarView "Kan inte" tab + "Avvikelser i perioden" (dated whole-day blocks) |
| "Send" submits and shows a confirmation | Done | Sticky "Spara min tillgänglighet" → `PUT /svar/:token/availability` → `Confirmation` sheet |
| View always reflects what is registered; revisit and adjust | Done | `GET /svar/:token/data` seeds state; `onSuccess` reconciles ids/dirty sets so a second save in the same session is safe |
| Managers view/edit any staff member's availability in the admin UI | Done | `frontend/src/pages/StaffDetail.tsx` over `/data/availability` (#4, #6/PR #20) — wishes/blocks pattern rows + dated exceptions |
| Done when: link + phone → wishes and blocks registered, respected by conflict checking | Engine yes, proof missing | `app/conflicts.py` `_check_availability` + `_expanded` match both `weekday` and `on_date` rows; enforced by `/data/shifts` and reported by `/compute/conflicts`. No test crosses svar → conflicts |

Gaps found:

1. **Missing acceptance test** — nothing verifies the full chain
   `PUT /svar/:token/availability` → `POST /compute/conflicts` →
   `blocked`/`outside_wishes`, nor that the `/data/shifts` write path rejects
   a shift overlapping a svar-registered block. This is the issue's literal
   "Done when" and is cheap to add.
2. **Stale copy in `StaffDetail.tsx`** (lines 155–158): "När
   delningslänkarna (issue #13) finns fyller personalen i själva." — #13 has
   shipped; the copy should say staff normally answer via their personal
   link and that this view lets the manager see and adjust the same data.
3. No manual end-to-end verification of the phone flow has been recorded
   against the issue. The `verify` skill recipe covers this.

Non-gaps (deliberately out of scope, consistent with the MVP subset noted in
the SvarView header comment): "Önskat antal pass / vecka", free-text note,
"Kan extra" (dated positive availability), the "Inlagt av <chef>" provenance
badge, and split (multi-range) days — all schema-touching and deferred. The
mobile add-exception flow is whole-day only (vacation use case); the backend
and manager UI already support partial-day exceptions and SvarView already
*displays* partial-day rows correctly.

## Implementation Steps

### Phase 1: End-to-end acceptance test (backend)

1. Add `test_svar_availability_respected_by_conflicts` to
   `app/tests/test_svar.py`.
   - **Auth setup (test_svar's own fixtures are unauthenticated):**
     `/compute/*` and `/data/*` accept `X-Test-User` under `TESTING` only
     when a matching `org_user` row exists (`app/app.py` line ~128, same
     pattern as `app/tests/conftest.py`: insert
     `org_user (user_id, org_id)`, then set
     `client.environ_base['HTTP_X_TEST_USER'] = <user_id>` or pass the
     header per-request). Insert the `org_user` row for the module's svar
     org in the test's arrange step, and update the `test_svar.py` module
     docstring, which currently claims no client auth fixtures are needed.
   - Arrange: create a staff member with a share token (reuse the module's
     existing `org` fixture and `_mk_staff`).
   - **Date/time safety:** derive all dates from `date.today()` (never
     hardcode) so `add_exceptions` stays inside the public validator's
     ±window, and build shift instants from local wall-clock in the org
     timezone via `ZoneInfo('Europe/Stockholm')` / the `app/weeks.py`
     helpers — "Mon 09–17" must mean *local* Monday, or the availability
     match is off around UTC-offset and DST edges.
   - Act: `PUT /svar/<token>/availability` with a recurring wish
     (Mon 09:00–17:00 → `{weekday: 1, start_minute: 540, end_minute: 1020}`),
     a recurring block (Sunday whole day), and one dated `add_exceptions`
     vacation date (an upcoming weekday that is not Mon/Sun).
   - Assert via `POST /compute/conflicts`:
     - a shift overlapping the recurring Sunday block → `blocked` present
       in `conflicts` (do **not** assert `warnings` is empty: a blocked
       shift outside wishes also gets `outside_wishes`, by design)
     - a shift on the vacation date → `blocked` present (dated exception
       path; same caveat about warnings)
     - a shift on Monday inside 09–17 local → no conflicts **and** no
       warnings (the only case asserting clean warnings)
     - a shift on Tuesday (wishes exist, not covered) → no conflicts, soft
       `outside_wishes` warning
   - Assert enforcement: `POST /data/shifts` for the blocked time is
     rejected without `force` (mirrors
     `test_write_rejects_hard_conflicts_unless_forced` but with
     svar-registered availability).
   - Files to modify: `app/tests/test_svar.py`

### Phase 2: Manager-side copy refresh

1. Update the intro text in `StaffDetail.tsx` that still describes share
   links as future ("När delningslänkarna (issue #13) finns…").
   - New copy (Swedish, matching the app's tone): staff normally fill in
     their availability via their personal link (managed from the roster);
     this view shows the same data and lets the manager adjust it or fill it
     in for staff who prefer to phone it in.
   - Files to modify: `frontend/src/pages/StaffDetail.tsx`

### Phase 3: Manual end-to-end verification

1. Run the verify recipe (`.claude/skills/verify/SKILL.md`): Postgres up,
   migrations, seed, backend + frontend running.
2. Phone flow (mobile viewport): mint/copy a share link from the roster,
   open `/svar/:token`, register wishes (tap days + adjust a range), a
   weekly block, and a vacation date; save; confirm the confirmation sheet;
   reload the link and confirm the registered state is reflected and
   adjustable.
3. Manager flow: open the same person in `StaffDetail` and confirm the
   svar-registered rows appear and are editable; edit one and confirm the
   svar page reflects it after reload.
4. Conflict respect: covered by the Phase 1 backend test — `/compute/*` and
   `/data/*` require an authenticated manager (a real Clerk session in the
   browser), so don't hand-roll curl calls here; if a live check is wanted
   anyway, exercise it through the signed-in admin UI once #9 lands.
5. CI gates locally (exact commands):
   - `npm run precommit` (= `npm run lint` + `npm run typecheck:frontend` +
     `npm run build:frontend`)
   - `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla alembic upgrade head`
   - `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla .venv/bin/pytest app`

### Phase 4: Close-out

1. Branch + PR (squash-merge policy). PR body notes that the editor itself
   shipped with #13/#6 and this PR closes the remaining acceptance gap; ends
   with `Closes #7`.
2. Note in the PR body that *live* conflict warnings inside the shift editor
   UI are issue #9's deliverable and are not part of this close-out.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `app/tests/test_svar.py` | Modify | End-to-end acceptance test: svar-registered availability → `blocked`/`outside_wishes` via `/compute/conflicts`, enforced by `/data/shifts` |
| `frontend/src/pages/StaffDetail.tsx` | Modify | Refresh stale pre-#13 intro copy |

## Codebase Areas

List the primary directories/areas this plan touches (for conflict detection):
- `app/tests/`
- `frontend/src/pages/`

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. Treat #7 as gap-closure, not a rebuild
**Options:** (A) close the gaps in what #13/#6 delivered vs (B) build a new
availability editor per the original issue text.
**Decision:** A.
**Rationale:** The share-link editor delivered by #13 *is* issue #7's staff
UI — same two tabs, wishes/blocks/dated exceptions, save + confirmation,
state round-trip — built per `design/Timla App - Tillgänglighet länk.dc.html`
and already reviewed/tested (`test_svar.py`, 16 tests). Rebuilding would
duplicate a shipped, reviewed surface.

### 2. "Respected by conflict checking in the shift editor" = engine level
**Options:** (A) prove engine-level respect (`/compute/conflicts` +
`/data/shifts` enforcement) and leave the live-warning UI to #9 vs (B) pull
the shift-editor warning UI into #7.
**Decision:** A.
**Rationale:** Issue #9 ("UI: shift editor with live conflict warnings") is
a separate open MVP issue that owns exactly that UI; the current Schedule
page (#8) is read-only by design. #7's criterion is that the *data* staff
register is respected — the engine and write-path already do this; the test
makes it an explicit, regression-guarded contract that #9 then surfaces.

### 3. Keep dated exceptions whole-day in the mobile add flow
**Options:** (A) keep "Lägg till datum" whole-day only vs (B) add start/end
time inputs to the mobile exception flow.
**Decision:** A.
**Rationale:** The vacation use case in the issue is whole-day; the backend
and manager UI already support partial-day exceptions, and SvarView already
displays partial-day rows correctly. Adding time pickers grows the public
mobile surface without an MVP need — consistent with the deliberately
deferred subset documented in the SvarView header comment.

### 4. Acceptance test lives in `test_svar.py`
**Options:** `test_svar.py` vs `test_conflicts.py`.
**Decision:** `test_svar.py`.
**Rationale:** The test's point is the *svar surface feeding* the engine —
it starts at `PUT /svar/:token/availability`. `test_conflicts.py` already
covers the engine's semantics (incl. overnight/DST/dated blocks) with
fixture-written rows; duplicating engine cases there adds nothing.

## Verification Checklist

- [ ] A staff member with only their link and a phone-sized viewport can
      register wishes and blocks (incl. a vacation date) and sees a
      confirmation
- [ ] Reopening the link reflects the registered state and allows adjusting
- [ ] The manager sees and can edit the same availability in `StaffDetail`
- [ ] `POST /compute/conflicts` returns `blocked` for a shift overlapping a
      svar-registered recurring block and for one on a svar-registered
      vacation date
- [ ] `POST /compute/conflicts` returns an `outside_wishes` warning for a
      shift outside svar-registered wishes, and is fully clean (no
      conflicts, no warnings) inside them
- [ ] `POST /data/shifts` rejects a shift overlapping the block without
      `force`
- [ ] Stale #13-as-future copy in `StaffDetail.tsx` is gone
- [ ] CI green: eslint, tsc, vite build, alembic + pytest
