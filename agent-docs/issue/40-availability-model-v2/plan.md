# Plan: Issue #40 — Availability data model: full wish/block × recurring/dated matrix + non-destructive PUT

## Goal

Make the availability data model maximally flexible — hard "block" and soft
"wish", each either recurring (weekday) or dated (`on_date`) — as the
backend foundation for the availability v2 redesign
(`design/Timla App - Tillgänglighet länk v2.dc.html`). Concretely:

- The only new legal combination, a **dated wish** ("Kan extra"), becomes
  storable and behaves sensibly everywhere it is read.
- Both availability PUTs become **non-destructive per kind**: an omitted
  `wishes`/`blocks` key leaves that kind's recurring layer untouched, an
  explicit `[]` clears it. This is what lets the v2 phone send only
  `wishes` without wiping manager-set recurring blocks.
- Exception writes accept `kind` (`wish`|`block`) and an optional `note`.
- Every availability write stamps **provenance** (`source`:
  `'staff'`|`'manager'`) so the UIs can later show "Inlagt av {chef}".
- Two new per-staff parameters are stored: `desired_shifts_per_week` and
  `availability_note`.

Backend-only: no visible behavior change to the shipped #13 phone surface
until the frontend issues (#41, #42) land. Every current client payload must
keep working identically.

## Approach

One hand-written migration (`0003`, chained on `0002`, `op.execute` SQL per
the no-autogenerate convention) plus surgical route changes in the two
availability write surfaces, the conflict engine's wish gate, and the staff
roster endpoints. The issue body was verified against the code and holds up,
with one correction: accepting `note` on exception writes (scope item 3)
requires a **new `note` column on `availability_interval`** — the current
schema (`migrations/versions/0001_core_schema.py:75-91`) has no such column,
so migration 0003 adds it alongside `source`.

Key semantic decisions (details under Design decisions in the Risks
section's companion notes below):

1. **Per-kind presence semantics** on both PUTs: key absent → untouched, key
   present (incl. `[]`) → replace that kind's recurring rows. Implemented as
   a None-sentinel in validation plus `AND kind = ANY(%s)` on the DELETE.
2. **`outside_wishes` gates on recurring wishes only** (`app/conflicts.py`):
   a lone dated "Kan extra" must not start emitting warnings on every other
   day; it still *widens* coverage on its own date.
3. **Dated wishes are never double-listed**: the document read puts them in
   `exceptions` only (fix the `wishes` filter in
   `app/routes/data_availability.py:_document` to require `on_date IS NULL`),
   so `intervalsToRanges` (`frontend/src/pages/SvarView.tsx:95-96`, which
   maps the `wishes` list by `weekday`) never sees a weekday-less row.
4. **The new staff fields get API plumbing in this issue**, not just
   columns: #41 and #42 scope themselves to frontend files only and both
   consume these fields, so `/data/staff` and the `/svar` surface must
   read/write them here. This is the "mirrors the `staff.max_hours_per_week`
   per-staff-parameter pattern" reading — `max_hours_per_week` is a column
   *plus* an `EDITABLE_FIELDS` entry plus `staff_json` output.

## Steps

### Phase 1 — Migration `0003_availability_v2.py`

New file `migrations/versions/0003_availability_v2.py`, `revision = '0003'`,
`down_revision = '0002'` (current head; verified `migrations/versions/`
contains only 0001 and 0002). Hand-written SQL via `op.execute`, docstring
carrying the design notes (2×2 matrix, provenance nullable = unknown, no
backfill).

`upgrade()`:

```sql
ALTER TABLE availability_interval
    DROP CONSTRAINT availability_wish_is_recurring;
ALTER TABLE availability_interval
    ADD COLUMN source text CHECK (source IN ('staff', 'manager')),
    ADD COLUMN note text CHECK (char_length(note) <= 500);
ALTER TABLE staff
    ADD COLUMN desired_shifts_per_week smallint
        CHECK (desired_shifts_per_week BETWEEN 0 AND 50),
    ADD COLUMN availability_note text
        CHECK (char_length(availability_note) <= 1000);
```

- `source` and the staff columns are nullable, **no backfill**: existing
  rows are genuinely unknown → the UI renders no badge (per issue).
- The `note`/`availability_note` DB-level length CHECKs are belt-and-braces
  behind the API caps — `note` is writable from the unauthenticated `/svar`
  surface, so a DB bound is cheap insurance.
- 0–50 for `desired_shifts_per_week` is a sanity bound (well above any real
  week), NULL = unspecified.

`downgrade()` (must restore 0002's exact shape):

```sql
DELETE FROM availability_interval WHERE kind = 'wish' AND on_date IS NOT NULL;
ALTER TABLE availability_interval
    ADD CONSTRAINT availability_wish_is_recurring
        CHECK (kind = 'block' OR on_date IS NULL);
ALTER TABLE availability_interval DROP COLUMN source, DROP COLUMN note;
ALTER TABLE staff
    DROP COLUMN desired_shifts_per_week, DROP COLUMN availability_note;
```

The `DELETE` before re-adding the CHECK is required — dated wishes written
under 0003 would otherwise make the constraint fail to validate. Data-lossy
downgrade; documented in the migration docstring.

### Phase 2 — Public surface: `app/routes/svar.py`

1. **None-sentinel validation** in `_validate` (currently lines 197–205,
   defaults to `[]`):

   ```python
   wishes = _validate_recurring(body['wishes'], 'wishes') if 'wishes' in body else None
   blocks = _validate_recurring(body['blocks'], 'blocks') if 'blocks' in body else None
   ```

   An explicit JSON `null` fails `_validate_recurring`'s `isinstance(items,
   list)` check → 400, which is correct (null is not "absent", and no
   current client sends it).

2. **Per-kind recurring replace** in `put_availability` (currently lines
   151–163: `DELETE ... WHERE staff_id = %s AND on_date IS NULL` + blanket
   re-insert). Replace with:

   ```python
   submitted = [(k, v) for k, v in (('wish', wishes), ('block', blocks)) if v is not None]
   if submitted:
       cur.execute(
           """DELETE FROM availability_interval
              WHERE staff_id = %s AND on_date IS NULL AND kind = ANY(%s)""",
           (staff['id'], [k for k, _ in submitted]),
       )
       # re-insert loop over `submitted` instead of the current hardcoded pair
   ```

   Insert statements gain `source` stamped `'staff'`. Update the step-1
   comment block (lines 142–150): the whole-replace contract is now
   *per submitted kind*; the "client submits the COMPLETE desired recurring
   state" invariant applies to each kind the client chooses to send.

3. **Exception writes accept `kind` + `note`** in `_validate_add_exceptions`
   (lines 225–246) and the insert (lines 176–182):
   - allowed keys become `{'on_date', 'start_minute', 'end_minute', 'kind', 'note'}`;
   - `kind` optional, default `'block'`, must be `'wish'` or `'block'` → 400
     otherwise;
   - `note` optional, must be `str`, `len(note) <= 500` (public-surface cap
     per issue), empty/whitespace-only normalized to `NULL` (one rule for
     all free-text fields in this issue — see also `availability_note`);
   - insert becomes
     `INSERT ... (org_id, staff_id, kind, on_date, start_minute, end_minute, note, source) VALUES (%s, %s, %s, %s, %s, %s, %s, 'staff')`
     (drop the hardcoded `'block'` at line 180).

4. **New per-staff keys on the PUT**, same presence semantics (needed by
   #41's stepper + note field; #41 touches only frontend files):
   - `_validate`'s allowlist (line 198) gains `desired_shifts_per_week` and
     `availability_note`;
   - `desired_shifts_per_week`: `None` or strict int 0–50 (reuse
     `is_strict_int`; reject bools);
   - `availability_note`: `None` or `str` ≤ 1000 chars; empty/whitespace-only
     normalized to `NULL`, same rule on `/data/staff` (Phase 5);
   - when present, `UPDATE staff SET ... WHERE id = %s` inside the same
     transaction. Explicit `null` clears (unlike the list keys, null is
     meaningful here: "unspecified").

5. **`_context` exposes the new staff fields** (lines 111–123): the `staff`
   object gains `desired_shifts_per_week` and `availability_note` so the v2
   phone can seed its state from `GET /svar/:token/data`.

### Phase 3 — Manager surface: `app/routes/data_availability.py`

1. **Mirror the per-kind PUT** in `replace_availability` (lines 106–137):
   same None-sentinel (`body['wishes'] if 'wishes' in body else None` +
   `_validate_pattern` only when present), same `AND kind = ANY(%s)` DELETE,
   inserts stamp `source = 'manager'`. Current StaffDetail always sends both
   keys → behavior unchanged for the shipped client.

2. **`create_exception`** (lines 140–168): accept optional `kind`
   (`wish`|`block`, default `'block'`) and `note` (≤ 500, same normalization
   as Phase 2), stamp `source = 'manager'` (drop the hardcoded `'block'` at
   line 163).

3. **`_interval_json`** (lines 20–31): emit `'source': row['source']`
   (null allowed — frontend checks `=== 'manager'` later) and
   `'note': row['note']` unconditionally. Additive keys; existing frontend
   ignores them.

4. **Fix the document wishes filter** in `_document` (line 46):

   ```python
   'wishes': [... if r['kind'] == 'wish' and r['on_date'] is None],
   ```

   A dated wish then lands **only** in `exceptions` (line 48 already takes
   every `on_date IS NOT NULL` row regardless of kind). No-op for all data
   that can exist before this migration.

5. **Leave `_expansion` alone** (lines 52–71). Its existing `'source'` key
   means expansion-origin (`'recurring'`/`'exception'`), which now collides
   in name with provenance — renaming it is a breaking change out of scope
   here; document the overload in a comment. Dated wishes already expand
   correctly (`dated_hit = r['on_date'] == day` is kind-agnostic).

### Phase 4 — Conflict engine gate: `app/conflicts.py`

In `_check_availability` (lines 134–146), gate the warning on **recurring**
wishes while keeping coverage computed from **all** wishes:

```python
if any(w['weekday'] is not None for w in wishes) \
        and not _covered(entry, _expanded(wishes, entry, tz)):
```

- `_expanded` (line 127–131) already matches dated rows via
  `r['on_date'] == day`, so a dated wish widens coverage on its date with no
  further change.
- A staff member with *only* dated wishes stays all-neutral (no warnings
  anywhere) — conscious product decision from the issue.
- Blocks are checked first and independently (lines 139–143), so a same-date
  block still beats a dated wish — no change needed, but tested.
- Update the module docstring (lines 11–13): "only emitted for staff who
  have **recurring** wishes registered".

### Phase 5 — Staff parameters on the roster API: `app/routes/data_staff.py`

- `EDITABLE_FIELDS` (line 11) gains `'desired_shifts_per_week'` and
  `'availability_note'` — the PATCH loop (lines 82–85) then handles them for
  free; add both to the `create_staff` INSERT (lines 62–67).
- `staff_json` (lines 14–24) emits both (int/None and str/None).
- `_validate` (lines 27–41): `desired_shifts_per_week` must be `None` or a
  strict int 0–50 (use `is_strict_int` from `api_utils`, not `is_number` —
  no floats, reject bools); `availability_note` must be `None` or `str`
  ≤ 1000, empty/whitespace-only normalized to `NULL` (same rule as the
  `/svar` surface).
- The engine deliberately ignores `desired_shifts_per_week`
  (`app/conflicts.py` untouched beyond Phase 4); a future suggest-schedule
  (#11) reads it.

### Phase 6 — Contract docs: `docs/api.md`

The API contract doc describes exactly the behaviors this issue changes and
must move with them (availability section, lines ~38–52; staff JSON line 34;
`outside_wishes` line ~90):

- Staff JSON shape gains `desired_shifts_per_week`, `availability_note`;
  POST/PATCH `/data/staff` accept them.
- Availability layers: wishes are no longer "recurring weekly" only —
  document the 2×2 matrix and that dated rows of either kind live in
  `exceptions`.
- PUT semantics: "Replaces `wishes` + `blocks` patterns" becomes per-kind
  presence semantics (omitted key untouched, `[]` clears); same for the
  `/svar` PUT section.
- Exceptions POST body gains `kind?` + `note?`; interval JSON gains
  `source` (provenance) + `note` — note the distinction from the expansion's
  existing `source: recurring|exception` key.
- `outside_wishes`: "only for staff who have **recurring** wishes".

### Phase 7 — Tests

See Test Plan. Ordering within the PR: migration first, then routes, then
tests — but land as one squash-merged PR (repo policy).

### Phase 8 — Verification and close-out

1. Local CI gates:
   - `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla alembic upgrade head`
   - downgrade round-trip once: `alembic downgrade 0002` → `upgrade head`
   - `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla .venv/bin/pytest app`
   - `npm run precommit` (frontend untouched, but CI runs it)
2. Branch `issue/40-availability-model-v2` off `main`, PR body ends with
   `Closes #40`.

## Risks

- **Downgrade is data-lossy** (deletes dated wishes). Acceptable and
  documented in the migration docstring; there is no non-lossy way to
  re-satisfy the CHECK.
- **Provenance re-stamp on recurring resubmit.** The phone's save submits
  the complete recurring state for a kind it sends, so a manager-entered
  recurring *wish* resubmitted by the worker becomes `source='staff'`.
  Accepted: per the design decision the phone owns the soft layer, and
  recurring blocks (the rows managers actually own) survive untouched
  because v2 omits the `blocks` key. Recorded here so it isn't rediscovered
  as a bug.
- **`source` name overload**: `_expansion`'s per-interval `source`
  (recurring/exception) vs the new provenance column. Left as-is (renaming
  the expansion key breaks its contract); comment added. A follow-up may
  rename to `origin` alongside a frontend sweep.
- **Public-surface growth**: `/svar` PUT gains `kind`, `note`,
  `desired_shifts_per_week`, `availability_note`. All strictly validated and
  length-capped, plus DB CHECKs behind them; no new resource access (still
  scoped to the one token-resolved staff row).
- **Backward compatibility** is load-bearing: v1 clients (current
  `SvarView.tsx`, `StaffDetail.tsx`) always send both `wishes` and `blocks`
  → per-kind replace degrades to exactly today's whole-replace. New response
  keys are additive. Explicitly tested (old-payload test).
- **Frontend TypeScript contract types drift on purpose**:
  `frontend/src/types.ts` (`AvailabilityDocument`, `SvarPutBody`,
  `SvarException`, `Staff`) and `frontend/src/api.ts` keep modeling the v1
  shapes in this issue — runtime stays compatible because the new response
  keys are additive and ignored. #41 (`SvarPutBody`/`SvarException`/svar
  context) and #42 (`Staff`, `ExceptionInterval`) own the type updates
  alongside the UI that uses them. Do **not** update them here; it would be
  dead code in a backend-only PR.
- **`test_schema.py::test_wish_cannot_be_dated` will fail** once the CHECK
  is dropped — it must be inverted in the same PR (see Test Plan), otherwise
  CI is red mid-review.

## Test Plan

All backend (`pytest app`), DB-backed tests skip without a database as
usual.

`app/tests/test_schema.py`:
- **Replace** `test_wish_cannot_be_dated` (lines 78–86) with
  `test_dated_wish_is_allowed` (INSERT kind='wish' + on_date succeeds).
- `source` CHECK rejects values outside `('staff','manager')`; NULL allowed.
- `desired_shifts_per_week` CHECK rejects 51/-1; NULL allowed.

`app/tests/test_svar.py` (patterns: module fixtures `org`/`client`,
`_mk_staff`, `_add_exception` — extend `_add_exception` with
`kind='block'`/`note=None` params):
- **Omitted key preserves**: seed a recurring block via SQL, PUT only
  `{'wishes': [...]}` → block survives, wishes replaced. The wipe this issue
  fixes.
- **Empty list clears**: PUT `{'blocks': []}` → recurring blocks gone,
  wishes (seeded) untouched.
- **Old payload unchanged**: v1-shaped body (both keys + add/remove
  exceptions, no new fields) behaves exactly as
  `test_put_recurring_full_replace` expects today.
- **Presence edge cases**: `{}` body → 200 no-op (nothing deleted, context
  returned); explicit `wishes: null` / `blocks: null` → 400. Same pair of
  cases on the manager PUT in `test_api_data.py`.
- **Dated wish round-trip**: `add_exceptions` with `kind='wish'`,
  `note='Kan extra'` → appears in `availability.exceptions` with kind/note,
  and **not** in `availability.wishes` (double-listing guard).
- **Validation 400s**: `kind='maybe'`, `note` of 501 chars,
  `desired_shifts_per_week` of `3.5`/`True`/`51`, `availability_note` of
  1001 chars.
- **Staff params round-trip + presence semantics**: PUT sets both, readback
  via `GET /svar/:token/data`; a second PUT omitting them preserves;
  explicit `null` clears.
- **Provenance**: rows written through this surface come back with
  `source == 'staff'`.

`app/tests/test_conflicts.py` (patterns: `client`/`make_staff` fixtures,
`check()` helper; write availability via the manager API or direct SQL for
the dated wish):
- **Dated wish widens coverage, warns nowhere else**: recurring wish
  Mon 09–17 + dated wish on a Tuesday → Tuesday shift inside the dated
  window: no warning; Wednesday shift: `outside_wishes`. (Extends
  `test_wishes_warn_softly_and_only_when_wishes_exist`, line 126.)
- **Recurring-only gate holds**: staff with *only* a dated wish → shifts on
  other days produce **no** `outside_wishes` (all-neutral), shift inside the
  dated window also silent.
- **Block beats dated wish**: same date carries both a dated wish and a
  dated block → shift there yields `blocked`.

`app/tests/test_api_data.py` (pattern: `make_staff` + client fixtures):
- Manager PUT per-kind semantics (omit/empty mirror of the svar tests,
  including `{}` no-op and explicit-`null` → 400).
- `POST .../exceptions` with `kind='wish'` + `note` → 201, `_interval_json`
  echoes `kind`/`note`/`source='manager'`; document lists it under
  `exceptions` only.
- `/data/staff` create + PATCH accept and emit `desired_shifts_per_week` /
  `availability_note`; PATCH validation 400s.

Manual: run the verify recipe (`.claude/skills/verify/SKILL.md`) once and
click through the existing phone + StaffDetail flows to confirm zero visible
change (the backward-compat claim).

## Triage Info

| Field | Value |
|-------|-------|
| **Blocked by** | None — #40 is the foundation; #41/#42 depend on it, not vice versa |
| **Blocks** | #41 (SvarView v2), #42 (StaffDetail v2); the phone-UI issue resolves #37/#38 |
| **Related issues** | #13 (shipped svar surface), #6 (manager UI), #5 (conflict engine), #4 (`/data/availability`), #37/#38 (designed out by v2), #11 (future consumer of `desired_shifts_per_week`) |
| **Conflicts with other plans** | None — working tree is on `main` (only this plan's untracked docs added); PRs #39 (issue #7) and #43 (issue #9) have already merged, so the anticipated `test_svar.py` collision no longer exists. All other `agent-docs/issue/*` plans belong to closed issues |
| **Scope** | 1 new migration + 4 backend modules + 4 test modules |
| **Risk** | Medium (schema migration + semantics change on a public surface, fully backward compatible and heavily tested) |
| **Safe for junior** | Yes, with this plan — every change is anchored to file/line and the compat contract is spelled out |

## Design Decisions

1. **New staff fields get API plumbing here, not just columns.** The issue
   says "storage only", but #41/#42 scope themselves to frontend files (plus
   `scripts/seed.py` in #42) and consume these fields; "mirrors the
   `max_hours_per_week` pattern" already means column + `EDITABLE_FIELDS` +
   JSON output. Chosen: columns + `/data/staff` + `/svar` read/write in #40;
   the engine still ignores them, and seed-data changes stay in #42.
2. **`note` requires a new `availability_interval.note` column** — the
   issue's migration bullet lists only the CHECK drop and `source`, but
   scope item 3 (accept `note`) is impossible without it. Corrected in
   Phase 1.
3. **Presence semantics via `'key' in body`, explicit `null` → 400** for the
   list keys (a null list is a client bug, not "leave untouched"), while
   `null` on the scalar staff fields means "clear".
4. **Warning gate = any recurring wish; coverage = all wishes.** Keeps a
   lone "Kan extra" from turning every other day into a warning, while still
   letting it silence a warning on its own date for staff with recurring
   wishes.
5. **Downgrade deletes dated wishes** rather than leaving an invalid CHECK
   or a NOT VALID constraint — hand-written migrations stay honest about
   loss.
6. **`_expansion`'s `source` key keeps its old meaning** (expansion origin);
   provenance is only on `_interval_json`. Naming overload documented, not
   fixed, in this issue.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `migrations/versions/0003_availability_v2.py` | Create | Drop wish-recurring CHECK; add `source`, `note` to `availability_interval`; add `desired_shifts_per_week`, `availability_note` to `staff` |
| `app/routes/svar.py` | Modify | None-sentinel `_validate`, per-kind DELETE, exception `kind`/`note`, staff params on PUT + context, stamp `source='staff'` |
| `app/routes/data_availability.py` | Modify | Mirror per-kind PUT, exception `kind`/`note`, `_document` wishes filter fix, `_interval_json` emits `source`/`note`, stamp `source='manager'` |
| `app/conflicts.py` | Modify | Gate `outside_wishes` on recurring wishes only |
| `app/routes/data_staff.py` | Modify | Expose `desired_shifts_per_week` + `availability_note` (validate, edit, emit) |
| `app/tests/test_schema.py` | Modify | Invert dated-wish test; new CHECK tests |
| `app/tests/test_svar.py` | Modify | Per-kind PUT, dated wish, validation caps, staff params, provenance |
| `app/tests/test_conflicts.py` | Modify | Dated-wish coverage/gating, block-beats-wish |
| `app/tests/test_api_data.py` | Modify | Manager-surface mirrors + staff fields |
| `docs/api.md` | Modify | Contract doc: 2×2 model, per-kind PUT semantics, exception `kind`/`note`, `source` provenance, staff fields, recurring-wish gate |
