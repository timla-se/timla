# Plan: Issue #42 — StaffDetail: desired shifts/week, manager note, exception kind + provenance

## Goal

Bring the manager-side availability editor (`frontend/src/pages/StaffDetail.tsx`
over `/data/availability`) in line with the availability v2 model shipped in
#40 (backend) and #41 (phone). Concretely:

- **Exception rows** gain the **Kan inte / Kan extra** kind toggle, a
  free-text reason (`note`), and an **optional time range** — matching the
  phone's "Avvikelser i perioden" rows. Manager writes already stamp
  `source='manager'` server-side (#40); this issue makes the manager UI able
  to *produce* wish-kind and annotated exceptions.
- **Recurring blocks stay fully editable here** — this is intentionally the
  *only* place a standing hard "no" (e.g. "aldrig söndagar") is entered; the
  phone renders them read-only. The editor already supports this; the copy
  should now say so.
- **New per-staff fields** from #40 surfaced here with view + edit:
  `desired_shifts_per_week` and `availability_note`.
- **Provenance:** show which exceptions were entered by staff vs manager
  (the `source` field #40's `_interval_json` already emits).
- **Seed** (`scripts/seed.py`): a couple of "Kan extra" exceptions, notes,
  provenance stamps and a desired-shifts value so demo data exercises every
  new field.

No backend changes: everything this issue needs is already served and
documented (`docs/api.md` was updated in #40). Scope is
frontend + seed script.

## Approach

Verified against the working tree (post-#40/#41 `main`):

- `app/routes/data_availability.py` — `create_exception` accepts
  `kind` (`wish`|`block`, default `block`) + `note` (≤500, normalized), stamps
  `source='manager'`; `_interval_json` emits `kind`, `note`, `source` on every
  row; `_document` puts dated rows of both kinds under `exceptions`.
- `app/routes/data_staff.py` — `staff_json` emits `desired_shifts_per_week`
  (int|null) and `availability_note` (str|null); POST/PATCH accept both
  (`desired_shifts_per_week` strict int 0–50 or null, `availability_note`
  ≤1000 chars, whitespace-only → null).
- The recurring PUT keeps prior provenance for rows that round-trip verbatim
  and stamps new rows `'manager'` — StaffDetail's whole-document save
  (always both keys) is therefore already provenance-correct; don't change it.

So the work is: (1) catch the frontend contract types up to the v2 responses
(#40's plan explicitly deferred `Staff` and `ExceptionInterval` to this
issue), (2) rework StaffDetail's exception section to the phone's v2
vocabulary (kind toggle, reason, optional times, provenance badge),
(3) add a per-staff "Önskemål" section (desired shifts + note) saved via
`PATCH /data/staff/:id`, and (4) enrich the seed.

UI language and patterns follow the shipped phone (`SvarView.tsx`
`ExceptionRow`): red "Kan inte" / green "Kan extra" inline toggle pair (not
`SegmentedControl` — it can't do per-item semantic colors), whole-day default
with a "Vissa tider" disclosure for the time inputs, `Orsak (valfritt)` for
the note. StaffDetail keeps its Radix/@swedev/ui component style (it is the
authenticated desktop app, not the standalone phone page), so reuse the
*interaction model*, not the phone's raw-Tailwind markup.

Key design decisions (rationale under Design Decisions below):

1. **Existing exception rows are display + delete, not edit-in-place.** The
   API has no exception PATCH; the phone fakes edits as remove+add inside a
   single batched save, but StaffDetail's exceptions mutate immediately per
   action. Managers change an exception by deleting and re-adding.
2. **Provenance badge only for `source === 'staff'`** ("Ifyllt av
   personalen"). In the manager UI the manager is the default actor;
   `null` (pre-#40 rows) shows no badge, per #40's "unknown → no badge".
3. **Per-staff fields get their own save**, separate from the availability
   PUT — they live on `/data/staff`, a different resource, and coupling the
   two saves would turn one failed request into a half-saved UI.

## Steps

### Phase 1 — Contract types + API client

`frontend/src/types.ts`:

1. `Staff` gains `desired_shifts_per_week: number | null` and
   `availability_note: string | null` (the server already emits both; the
   deferred type update from #40's plan).
2. `ExceptionInterval` gains `kind: 'wish' | 'block'`, `note: string | null`,
   `source: 'staff' | 'manager' | null` — mirroring `SvarException`.
3. `RecurringInterval` gains optional additive metadata the server now emits:
   `kind?: 'wish' | 'block'`, `source?: 'staff' | 'manager' | null`,
   `note?: string | null` (same comment as `SvarRecurring`: the PUT only
   needs the three load-bearing fields, `toRows` keeps stripping to them).

`frontend/src/api.ts`:

4. `StaffPayload` gains `desired_shifts_per_week?: number | null` and
   `availability_note?: string | null` (backend PATCH already accepts them).
5. `addException`'s payload type gains `kind?: 'wish' | 'block'` and
   `note?: string`.

### Phase 2 — StaffDetail: exceptions v2 (display)

`frontend/src/pages/StaffDetail.tsx`, the "Undantag" section (currently
lines 184–209):

1. Retitle: "Undantag (datum personen inte kan)" → **"Avvikelser"** with a
   short hint ("Enstaka datum — kan inte, eller kan extra."), matching the
   phone's unified vocabulary now that exceptions can be positive.
2. Each existing row shows, in addition to date + time badge:
   - **kind**: `Badge semantic="danger" text="Kan inte"` for `block`,
     `Badge semantic="success" text="Kan extra"` for `wish` (colors match
     the phone's red/green mapping);
   - **note**, when non-null, as muted text;
   - **provenance**: a neutral badge "Ifyllt av personalen" when
     `exc.source === 'staff'`; nothing for `'manager'` or `null`.
   - Delete button unchanged. (Design decision 1: no in-place editing.)
3. The summary section ("Sammanfattning") is left as-is — it summarizes the
   recurring layers only, which is still correct.

### Phase 3 — StaffDetail: add-exception form v2

Extend the add form (currently date + two time fields + hint):

1. **Kind toggle**: local state `newExceptionKind: 'wish' | 'block'`,
   default `'block'`. Render as the phone's inline pair (two buttons,
   red active for "Kan inte", green active for "Kan extra") — per the
   phone's comment, `SegmentedControl` can't do per-item semantic colors.
2. **Reason field**: `newExceptionNote` string state; a
   `TextField.Root` with `placeholder="Orsak (valfritt)"` and
   `maxLength={500}` (server cap).
3. **Optional time range**: replace the always-visible `00:00–00:00` inputs
   with the phone's model — whole day by default, a "Vissa tider"
   disclosure (`showTimes` state) revealing the two time inputs plus a
   "Hela dagen" reset. Keep `timeToMinutes(value, true)` end-of-day
   semantics; drop the "(00:00–00:00 = hela dagen)" hint, superseded by the
   explicit affordance.
4. `createException.mutationFn` sends
   `{on_date, start_minute, end_minute, kind, ...(note.trim() ? {note: note.trim()} : {})}`;
   `onSuccess` resets all the new state (kind → `'block'`, note → `''`,
   times → whole day, disclosure closed). Validation before submit reuses
   the page's existing NaN-aware guard (see the comment at
   `StaffDetail.tsx:140` — a cleared time input parses to `NaN`, which
   passes `>=` comparisons): reject `NaN` start/end *and* `start >= end`
   with the friendly message instead of surfacing the API's.

### Phase 4 — StaffDetail: per-staff fields (view + edit)

New section between the recurring patterns and Avvikelser, e.g. heading
**"Önskemål"**:

1. **Önskat antal pass / vecka**: numeric input (`TextField.Root`
   `inputMode="numeric"`, empty = null). The input stores a *string* — add
   an explicit parse helper mirroring `Staff.tsx`'s `parseMaxHours` pattern
   but stricter (the server demands a strict int 0–50 or null,
   `data_staff.py:46`): trimmed empty → `null`; anything non-integer
   (decimals, commas, NaN) or outside 0–50 → friendly validation error;
   valid integer string → number. The phone's 0–7 stepper cap is a
   phone-only affordance — the manager may set any stored value.
2. **Anteckning om tillgänglighet** (`availability_note`): a textarea
   (`maxLength={1000}`), described as shared with the phone's "Något chefen
   bör veta?" field — visible and editable from both sides.
3. State seeded from the `staff` row (already fetched via `listStaff(true)`),
   with its own dirty flag and its own save button calling
   `updateStaff(staffId, { desired_shifts_per_week, availability_note })`
   (`availability_note`: `text.trim() || null`; the server normalizes too).
   `updateStaff` must be added to the page's `../api` import (currently
   only availability functions are imported, `StaffDetail.tsx:8`).
   On success invalidate `['staff']` so both this page and `Staff.tsx`
   (same `['staff', true]` key) refresh. Reuse the page's existing
   save-button pattern (disabled until dirty, "Sparar…", error `Callout`).
   Follow StaffDetail's existing dirty-guard convention: only sync local
   state from a refetch while the section is clean — and additionally
   key/reset the section state on `staff.id`, so navigating between staff
   pages can never briefly show (or save) the previous person's values.

### Phase 5 — Copy: recurring blocks as the manager's escape hatch

Update the "Kan inte jobba" `PatternSection` hint (currently
"återkommande, per vecka") to say this is manager-owned, e.g.
"återkommande, per vecka — kan bara ändras här, inte via personalens länk".
Small, but it encodes the intentional asymmetry from the issue.

### Phase 6 — Seed data (`scripts/seed.py`)

In `seed_staff` (and a new helper if it reads better):

1. Stamp provenance on existing inserts: recurring wishes → `source='staff'`
   (they represent worker answers), Sunday hard blocks → `source='manager'`
   (the escape-hatch story), the dated vacation block → `source='staff'`
   plus `note='Semester'`.
2. Add a couple of **"Kan extra" exceptions** (`kind='wish'`,
   `on_date` inside the seeded two-week window so they're visible on the
   phone): e.g. one whole-day with `note='Kan hoppa in om det behövs'`
   (`source='staff'`) and one time-ranged (e.g. 16:00–22:00) entered by the
   manager (`source='manager'`) so the phone's "Inlagt av chefen" badge and
   StaffDetail's "Ifyllt av personalen" badge both have demo data.
3. Set `desired_shifts_per_week` for a few staff (e.g. 3–4) and an
   `availability_note` for at least one (e.g. Emma:
   'Pluggar — helst inte vardagar före 15'), via the `INSERT INTO staff`
   columns.
4. Keep the script idempotent (it already wipes and recreates the org) and
   keep the docstring's bullet list accurate.

### Phase 7 — Verification

1. `cd frontend && npm run lint && npm run typecheck && npm run build`.
2. Backend suite untouched but run it anyway, **against the migrated local
   Postgres** (compose exposes it on host port 5433; the DB-backed tests
   silently *skip* when no database is reachable, so a green run without a
   DB proves nothing — check the skip count):
   `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla pytest app`.
   seed.py has no tests, but CI smoke-runs it — so also run
   `DATABASE_URL=... python scripts/seed.py` against the same db and check
   the printed summary.
3. Run the verify recipe (`.claude/skills/verify/SKILL.md`):
   - StaffDetail: add a "Kan extra" exception with a reason and a time
     range → row shows green badge + note; delete works.
   - Set desired shifts + note → save → reload → values persist; open the
     staff member's `/svar` link → the phone shows the same stepper value
     and note text (shared fields round-trip).
   - Phone: add an exception as the worker → StaffDetail shows
     "Ifyllt av personalen".
   - Recurring blocks: still editable in StaffDetail, read-only on the phone.
4. Branch `issue/42-staffdetail-v2` off `main`; PR body ends with
   `Closes #42`.

## Risks

- **No frontend test framework** (no vitest; CI = eslint, tsc, vite build) —
  behavior is verified manually via the verify recipe. Keep logic thin and
  lean on the typechecker.
- **No in-place exception editing** could surprise a manager wanting to fix
  a typo in a reason — delete + re-add is the flow (decision 1). If this
  grates in practice it's a small follow-up (phone-style remove+add batch),
  not a blocker.
- **Shared `availability_note` is last-write-wins** between phone and
  manager. Accepted: it's a single free-text field by design (#40), and the
  per-key PUT semantics already prevent *cross-field* clobbering. The dirty
  guard keeps a refetch from eating unsaved edits.
- **`desired_shifts_per_week` ranges differ by surface** (phone stepper caps
  at 7, manager input allows 0–50, server validates 0–50). Intentional per
  #41's comment ("a stored value > 7 renders as-is and only steps down");
  document nothing, just don't cap the manager input at 7.
- **Seed dates must stay inside the schedule window** (`schedule.from`–`to`
  is the phone's exception date-picker range) — anchor the new exceptions to
  `week_monday(...)` arithmetic like the existing vacation block, not fixed
  dates.
- **Query-cache coupling**: the staff fields live in the `['staff', true]`
  list query shared with `Staff.tsx`; invalidating `['staff']` after PATCH
  keeps both consistent (same pattern `Staff.tsx` already uses).

## Test Plan

- **Static gates**: `npm run lint`, `npm run typecheck`, `npm run build`
  in `frontend/` — the type changes in Phase 1 must not break `SvarView.tsx`
  or `Staff.tsx` (additive optional fields on `RecurringInterval`; new
  required fields on `ExceptionInterval` only affect StaffDetail, its sole
  consumer — verify with grep before finalizing).
- **Backend suite**: `pytest app` green (no backend changes expected; this
  catches accidental ones).
- **Seed smoke**: `python scripts/seed.py` runs clean twice in a row
  (idempotency), prints the same staff/shift counts, and a psql spot-check
  shows rows with `kind='wish' AND on_date IS NOT NULL`, non-null `note`,
  both `source` values, and staff rows with `desired_shifts_per_week`/
  `availability_note` set.
- **Manual end-to-end** (verify recipe): the four flows listed in Phase 7
  step 3, plus a backward-compat pass — a pre-existing exception (null
  `source`, null `note`) renders without badges and deletes cleanly.

## Triage Info

| Field | Value |
|-------|-------|
| **Blocked by** | None — #40 (prerequisite, "Depends on #40") is CLOSED (merged as PR #45); #41 also merged (PR #46) |
| **Blocks** | Nothing known |
| **Related issues** | #40 (data model, closed), #41 (phone v2, closed), #6 (manager UI, closed), #4 (`/data/availability`, closed), #11 (future suggest-schedule — non-blocking future consumer of `desired_shifts_per_week`) |
| **Conflicts with other plans** | None — every other `agent-docs/issue/*` plan belongs to a closed issue; working tree is on `main` with no modifications beyond this plan's own untracked docs folder |
| **Scope** | 3 frontend files + 1 seed script; no backend, no migration, no API changes |
| **Risk** | Low (additive UI over an already-shipped contract; no schema or API surface changes) |
| **Safe for junior** | Yes — the phone (`SvarView.tsx` `ExceptionRow`) is a working reference implementation of every new interaction |

## Design Decisions

1. **Existing exception rows: display + delete, no in-place edit.** The API
   deliberately has no exception PATCH; the phone's "edit" is remove+add
   batched into one save, but StaffDetail's exception mutations fire
   immediately (create/delete per action), so in-place editing would either
   spam writes or require rebuilding the section around a batched save.
   Delete + re-add covers the manager's need at MVP scope.
2. **Provenance badge only for staff-entered rows** ("Ifyllt av personalen",
   `source === 'staff'`). Mirrors the phone, which badges only the *other*
   actor ("Inlagt av chefen"); badging the default actor is noise. `null`
   (pre-#40 rows) shows nothing, per #40's "unknown → no badge".
3. **Per-staff fields save via `PATCH /data/staff/:id`, separately from the
   availability PUT.** They are staff-resource fields (that's where #40 put
   them for the manager surface); piggybacking them onto the availability
   save would cross resource boundaries and make partial failures ambiguous.
   The phone differs (its PUT carries them) because the phone has exactly
   one save action — StaffDetail already has per-section saves.
4. **Keep StaffDetail's PUT sending both `wishes` and `blocks`.** The
   manager surface owns both recurring layers; per-kind omission is a
   phone-side need. #40's verbatim-row rule means an untouched staff-entered
   wish row keeps `source='staff'` through a manager save, so no provenance
   damage.
5. **The manager's desired-shifts input is a plain 0–50 numeric field, not
   the phone's 0–7 stepper.** The server bound is 0–50; the phone's cap is a
   deliberate phone-only affordance (#41 comment), and the manager may need
   to represent arrangements the stepper can't.
6. **Kind toggle is an inline button pair, not `SegmentedControl`** —
   carried over from the phone's documented reason: the control can't do
   per-item semantic colors (red "Kan inte" / green "Kan extra"), and the
   two surfaces should read identically.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/types.ts` | Modify | `Staff` + `desired_shifts_per_week`/`availability_note`; `ExceptionInterval` + `kind`/`note`/`source`; `RecurringInterval` + optional metadata (deferred from #40) |
| `frontend/src/api.ts` | Modify | `StaffPayload` + the two staff fields; `addException` payload + `kind?`/`note?` |
| `frontend/src/pages/StaffDetail.tsx` | Modify | Avvikelser section v2 (kind badges, note, provenance, richer add form), new Önskemål section (desired shifts + note, PATCH save), escape-hatch copy on recurring blocks |
| `scripts/seed.py` | Modify | Provenance stamps, "Kan extra" exceptions with notes, desired-shifts values, an availability note |
