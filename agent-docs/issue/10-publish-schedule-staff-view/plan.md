# Plan: Issue #10 — Publish schedule and read-only staff view

## Goal

Give schedules per-period states — `draft` (manager-only) → `published`
(staff-visible) — by landing the publish action on top of the snapshot
model that shipped in #2. When a manager publishes a period, the period's
live shifts are frozen into a `publication` snapshot; managers keep editing
live shifts freely; staff opening their personal share link (#13's `/svar`)
always read the latest snapshot and never see half-edited drafts.
Re-publishing overwrites the snapshot. The schedule week view shows the
publish state and an indicator when the draft has diverged from what staff
see.

This issue also settles the flagged open design decision: **the publication
period is generalized from a single ISO week to an arbitrary `from`/`to`
date range (Option B in the issue)**. Rationale and consequences in Design
Decisions below.

**Done when:** a staff member's link shows exactly the last published
snapshot of their shifts — including while the manager is mid-edit on the
same period — and nothing else.

## Approach

Everything week-locked in the stack today is the `publication` table itself
(`UNIQUE (org_id, week)`, `^\d{4}-W\d{2}$` CHECK) and its two consumers:
`GET /data/publications` (`app/routes/data_publications.py`) and the staff
schedule read (`_gather_schedule` in `app/routes/svar.py`, which enumerates
ISO weeks to hit the week key). `shift` is timestamp-based, reads already
accept `?from=&to=` (`resolve_period` in `app/api_utils.py`), and #13's
schedule contract is already flat and date-grouped with no ISO-week strings
— so generalizing the period model is contained.

The plan, in dependency order:

1. **Migration `0004`** reworks `publication` to `period_start`/`period_end`
   (local dates in the org timezone, end-exclusive in storage), backfills
   from the existing `week` strings, drops the week key, and enforces a
   **non-overlap invariant** per org with a gist exclusion constraint
   (`btree_gist`).
2. **`POST /action/publish`** (new module `app/routes/action_publish.py`)
   accepts `{period: "2026-W28"}` or `{from, to}` (to inclusive, mirroring
   the read-side convention), snapshots the period's live shifts (a shift
   belongs to the period where it **starts**, evaluated in the org
   timezone — same rule as weeks), and maintains the non-overlap invariant
   transactionally: overlapped older publications are deleted, trimmed, or
   split so the newest publish wins for every date it covers.
3. **`GET /data/publications`** starts accepting the `from`/`to` range form
   via `resolve_period` and returns the **list** of publications overlapping
   the range, each with a server-computed `diverged` flag (live shifts vs
   snapshot).
4. **Staff read** (`_gather_schedule`) swaps week-enumeration + `week =
   ANY(...)` for a plain period-overlap query. The `/svar/:token/data`
   schedule contract is unchanged.
5. **Frontend**: "Publicera schema" button in the week view's reserved
   header slot, the four-state badge (Utkast / Publicerad / Ändringar
   sedan publicering / Delvis publicerad), and query invalidation so the
   badge tracks edits. The MVP UI publishes the visible week; the API is
   range-general from day one.

Out of scope (per issue): notifications on publish; a team-wide link view;
a multi-week publishing UI (the week view stays the one viewing lens for
now — the API supports ranges so a period view can land later without
another migration).

## Steps

### Phase 1 — Migration `migrations/versions/0004_publication_period.py`

Hand-written SQL via `op.execute` (autogenerate is disabled), head after
`0003`:

1. `CREATE EXTENSION IF NOT EXISTS btree_gist;` (needed for the exclusion
   constraint mixing `=` on uuid with `&&` on daterange).
2. `ALTER TABLE publication ADD COLUMN period_start date, ADD COLUMN
   period_end date;`
3. Backfill from the week key: `period_start = to_date(week,
   'IYYY-"W"IW')` (the Monday of the ISO week), `period_end = period_start
   + 7`. `to_date` with `IYYY`/`IW` is the ISO week-date parse; the
   migration test in Phase 8 pins the Monday alignment.
4. `SET NOT NULL` on both; drop `publication_week_format` and
   `publication_one_per_week`; drop column `week`.
5. New constraints:
   - `CHECK (period_end > period_start)`
   - `CHECK (period_end - period_start <= 366)` — same one-year sanity cap
     as `resolve_period`, so a fat-fingered range can't snapshot the world.
   - `CONSTRAINT publication_no_overlap EXCLUDE USING gist (org_id WITH =,
     daterange(period_start, period_end) WITH &&)` — storage is
     end-exclusive, exactly `daterange`'s default `[)` bounds, so adjacent
     periods (`period_end = next.period_start`) do not conflict.
6. Index: `CREATE INDEX publication_org_start_idx ON publication(org_id,
   period_start);` (the gist exclusion index also serves overlap queries,
   but the btree keeps the common "publications for this org ordered by
   start" cheap).
7. `downgrade()` must be executable, not just documented as lossy:
   `DELETE` every row that is not a Monday-aligned 7-day period (they
   have no week-key representation; two sub-week fragments could even
   collide on the same week), then re-add `week NOT NULL` from
   `to_char(period_start, 'IYYY-"W"IW')`, restore the old CHECK + unique
   constraints, drop the new columns/constraints. Destructive-on-purpose;
   documented in the docstring (downgrade is a dev-only escape hatch).

### Phase 2 — Period parsing helper: `app/api_utils.py`

`resolve_period` reads `request.args`; the publish action needs the same
rules for a JSON body. Extract the parsing core into
`parse_period(mapping)` (takes any dict-like: `period` week shorthand or
`from`/`to` inclusive, same error codes/messages, same one-year cap,
returns local `[start, end)` dates) and have `resolve_period` delegate to
it with `request.args`. Precedence stays exactly as today — `period` wins
silently when both forms are supplied on the *query* side (no behavior
change; `test_api_data.py`'s period-validation tests stay green
untouched). The publish action is stricter on its *body*: supplying both
`period` and `from`/`to` is a 400 (`invalid_period`) — a write should not
guess. `parse_period` must also be robust to JSON-typed garbage that query
strings can't produce (numbers, lists, null → 400, never a 500).

### Phase 3 — Publish action: `app/routes/action_publish.py` (new) + shared domain module `app/publications.py` (new)

Routes are registered explicitly, not auto-discovered: add the blueprint
import + `app.register_blueprint(...)` to `app/routes/__init__.py`
(mirror `action_staff.py`).

The pieces shared between the action, the read route, and the staff link —
`publication_json(row)` (the inclusive-`to` serializer), live-shift
loading for a local-date window, snapshot serialization/filtering, and
divergence normalization — live in a new flat domain module
`app/publications.py` (OpenVera pattern, like `conflicts.py`/`weeks.py`),
so route modules never import each other.

1. `POST /action/publish`, manager-auth'd (default for `/action/` in
   `app/app.py`), body parsed with `parse_period` → local `[start, end)`;
   both period forms at once → 400; unknown body fields → 400.
2. Compute the UTC snapshot window with `weeks.local_instant(start, 0, tz)`
   / `local_instant(end, 0, tz)` (org timezone from `current_org`). Select
   live shifts with `starts_at >= lo AND starts_at < hi` — a shift belongs
   to the period where it **starts** (CLAUDE.md week semantics; overnight
   shifts at the period edge follow their start). DST-safe because
   `local_instant` owns wall-clock→UTC.
3. Snapshot shape (jsonb array, one object per shift):
   `{id, staff_id, starts_at, ends_at, note}` — ids/staff_id stringified
   (staff_id may be null for open shifts, which **are** included: the
   snapshot is a faithful record; the staff link filters to own shifts so
   open shifts stay invisible there), timestamps ISO-8601 UTC. This is a
   superset of what `_gather_schedule` and `test_svar._publish_shift`
   already consume (`staff_id`, `starts_at`, `ends_at`).
4. Transactionally maintain non-overlap (the exclusion constraint is the
   safety net, the action does the work):
   - Take a per-org advisory lock first: `SELECT
     pg_advisory_xact_lock(hashtextextended(%s, 0))` on the org id — the
     exact pattern `data_shifts.py` already uses per staff. `FOR UPDATE`
     alone can't serialize two *first* publishes of overlapping ranges
     (no rows exist to lock); without the advisory lock one of them dies
     on the exclusion constraint instead of winning cleanly.
   - `SELECT * FROM publication WHERE org_id = %s AND period_start < %s(end)
     AND period_end > %s(start) ORDER BY period_start FOR UPDATE`.
   - For each overlapped row: fully covered → `DELETE`; overlapping on one
     side → trim (`UPDATE` the clipped bound and filter its `shifts` jsonb
     to entries whose **local start date** still falls inside the trimmed
     range — reuse the same belongs-where-it-starts rule, in Python);
     straddling both sides → split into two trimmed rows (delete + two
     inserts). **Trimmed/split fragments keep their original
     `published_at`** — they are remnants of the old publish, not a new
     one.
   - `INSERT` the new snapshot row; `conn.commit()`. Map
     `psycopg.errors.ExclusionViolation` (backstop only) to a 409
     `ApiError` ("publish raced another publish — retry"), never a 500.
5. Response `200`: the new publication serialized as
   `{from, to, published_at, shift_count}` — `from`/`to` **inclusive** on
   the wire (matching the `?from=&to=` read convention;
   `publications.publication_json` owns the `period_end - 1 day`).
6. Publishing an empty period is allowed (snapshot `[]`) — it's how a
   manager retracts staff-visible shifts for a range ("this range is
   published and empty" ≠ "unpublished").

### Phase 4 — Read rework: `app/routes/data_publications.py`

1. Replace the week-only `?period=` handling with `resolve_period()` —
   both forms now work; update the module docstring (its "range form has no
   meaning here" note is exactly what this issue retires).
2. Return the **list** of publications overlapping `[start, end)`, ordered
   by `period_start`, each `{from, to, published_at, diverged}` (inclusive
   `to` via `publication_json`). Empty list when nothing overlaps —
   replaces the old single-object-or-`null` shape. Breaking change; the
   frontend is the only consumer and updates in the same PR (squash-merge
   keeps it atomic).
3. `diverged` per publication, computed via `app/publications.py`: load
   live shifts for the **whole span** of returned publications in one
   query (min `period_start` → max `period_end`, the same UTC-window
   rule as the publish action), bucket per publication in Python — not
   one query per row. Compare as a multiset of `(staff_id, starts_at,
   ends_at, note)` tuples against the snapshot, normalizing timestamps to
   UTC datetimes before comparing (snapshot stores ISO strings; psycopg
   returns aware datetimes) and treating a missing snapshot `note` key as
   `None` (rows migrated from the 0003 era predate `note` in the
   snapshot). Note edits count as divergence — the snapshot is the record
   of what was published. Shift `id` is deliberately excluded from the
   comparison so delete+recreate of an identical shift doesn't flag.
   Divergence is a property of the **publication**, not of the requested
   range: a two-week publication edited only in week 2 reads `diverged`
   from week 1's view too (see Design Decision 5 for why that's accepted).

### Phase 5 — Staff link read: `app/routes/svar.py`

In `_gather_schedule`, replace the ISO-week enumeration loop + `week =
ANY(%s)` with a single overlap query:

```sql
SELECT shifts FROM publication
WHERE org_id = %s AND period_start <= %s AND period_end > %s
```

(`to_date`, `today` as local dates in the org tz — bounds already computed
there). The per-shift window filter (`today <= local_date <= to_date`) and
the whole response contract stay exactly as-is — #13 built this
horizon-agnostically on purpose. Non-overlap means no dedupe is needed.
Drop the now-unused `iso_week_of`/`week_monday` imports if nothing else in
the module uses them. Update the module docstring's "Today publications are
week-keyed" note in `_gather_schedule`.

### Phase 6 — Seed script: `scripts/seed.py`

`publish_week` inserts `(org_id, week, shifts)` with `ON CONFLICT (org_id,
week)`. Rework to the new columns; `ON CONFLICT DO UPDATE` doesn't work
against an exclusion constraint, so keep idempotency by `DELETE FROM
publication WHERE org_id = %s AND period_start < %s AND period_end > %s`
then `INSERT` (same shape the action uses). Snapshot entries gain `note`
to match the new canonical shape.

### Phase 7 — Frontend

1. `frontend/src/types.ts`: `Publication` → `{from: string; to: string;
   published_at: string; diverged: boolean}`.
2. `frontend/src/api.ts`: `getPublication(period)` →
   `getPublications(period)` returning `Publication[]`; new
   `publishSchedule(body: {period: string})` → `POST /action/publish`
   (typed to also accept `{from, to}` for future callers).
3. `frontend/src/pages/Schedule.tsx`:
   - **Badge** (existing slot, lines ~251–261): derive week coverage from
     the returned list — the week's 7 days vs the union of `[from, to]`
     ranges. Four states: no coverage → "Utkast" (as today); fully covered,
     none diverged → green "Publicerad {date}" (latest `published_at`);
     fully covered, some `diverged` → amber "Ändringar sedan publicering";
     **partially covered → amber "Delvis publicerad"** (distinct wording —
     "changed since publish" would be a lie about days that were never
     published). Wait-tint, same pill pattern. Keep the derivation in a
     small pure helper next to `buildDays`; there is no frontend test
     runner today, so cover it with the manual matrix in the Test Plan
     (empty / partial / multi-fragment / full / diverged).
   - A publication-query **error** should not silently render "Utkast" —
     keep today's behavior of rendering no badge at all when the query
     hasn't succeeded (`publicationLoaded` guard already does this).
   - **Publish button**: "Publicera schema" `Button` in the reserved header
     slot (the `{/* "Publicera schema" (#10) ... */}` comment), wired to a
     `useMutation` calling `publishSchedule({period})` for the visible
     week; on success invalidate `['publication']`. Disabled while
     pending; on error show a `Callout` (same pattern as the fetch-error
     state) — the 409 publish-race backstop must surface as "försök igen",
     not vanish. Keep it simple otherwise: always enabled, label constant
     ("Publicera schema"), the badge carries the state.
   - Publishing while shifts are mid-edit needs no guard — the snapshot is
     whatever is saved, which is the model.
4. `frontend/src/components/ShiftModal.tsx`: `invalidate()` additionally
   invalidates `['publication']` so the divergence badge refreshes after
   create/edit/delete of shifts.
5. The staff page (`frontend/src/pages/SvarView.tsx` / `svarApi.ts`) needs
   **no changes** — the schedule contract is untouched.

### Phase 8 — Tests

Backend (pytest, live Postgres via existing fixtures):

- `app/tests/test_schema.py`: replace `test_publication_upsert_one_per_week`
  and the week-format param tests with: period CHECK (end > start, ≤366
  days), exclusion constraint rejects an overlapping insert for the same
  org, allows the same range for another org, allows **adjacent** ranges
  (end-exclusive), and a backfill-shape test if practical (insert via the
  new columns only — the `week` column is gone).
- New `app/tests/test_action_publish.py`:
  - 401 unauthenticated; 400s: missing/invalid period, `from > to`, range
    over one year, unknown body fields.
  - Snapshot correctness: only shifts **starting** inside the period (org
    tz) are captured; an overnight shift starting on the last day is in,
    one ending on the first day but starting before is out; open shifts
    (null staff_id) included; `note` captured.
  - Re-publish same range overwrites (old row gone, one row remains).
  - Partial re-publish: publish W28–W29, then W28 alone → W29 remainder
    trimmed with only W29 shifts; publish the middle of a 3-week range →
    split into two remainder rows; every date covered by exactly one row.
  - Trimmed/split fragments keep their original `published_at`.
  - Publishing an empty range yields `shifts: []` and staff see nothing.
  - Response shape: inclusive `to`, `shift_count`.
  - Body robustness: both period forms at once → 400; numeric/list/null
    period values → 400, never 500.
  - Concurrency: two connections publishing overlapping ranges — the
    advisory lock serializes them, last commit wins, no
    `ExclusionViolation` leaks as 500.
- `app/tests/test_api_data.py` publications section: list shape, both
  `?period=` and `?from=&to=` accepted, empty list when unpublished,
  org-scoping, `diverged` false right after publish → true after editing a
  live shift in the period → false again after re-publish; delete+recreate
  identical shift stays false.
- `app/tests/test_svar.py`: update `_publish_shift` to insert
  `period_start`/`period_end`; add a case where one publication spans
  multiple weeks and the link view shows shifts from across the span; keep
  the "staff read the snapshot, not live edits" end-to-end: publish, edit a
  live shift, assert `/svar/:token/data` still shows the published version.
- Migration backfill: CI and the test db only ever upgrade an empty
  database straight to head, which never exercises the backfill — verify
  it with an explicit stepwise sequence against a scratch database:
  `alembic upgrade 0003` → insert week-keyed publications (including a
  W01 year-boundary week) → `alembic upgrade head` → assert exact Monday
  `period_start`, `period_end = +7`, snapshot jsonb preserved. Land it as
  a small script or documented recipe run during Phase 9 verification
  (permanent CI wiring is #12-adjacent and out of scope); the in-suite
  `to_date('...', 'IYYY-"W"IW')` Monday-alignment assertion in
  `test_schema.py` pins the parsing rule permanently.

Frontend: `tsc` + `vite build` green (no test runner in the repo today).

### Phase 9 — Docs and verification

- `docs/api.md`: rewrite the `GET /data/publications` row (range form,
  list shape, `diverged`), add `POST /action/publish` under actions, touch
  the `/svar/:token/data` row's "#10 owns the publication-period model"
  note (now landed).
- `docs/primitives.md`: `POST /action/publish` is already the listed
  example — no change needed.
- Run the verify recipe (`.claude/skills/verify/SKILL.md`): migrate, seed,
  publish a week through the UI, edit a shift, confirm the amber badge,
  open the seeded staff share link and confirm the frozen snapshot,
  re-publish and confirm convergence.

## Risks

- **Trim/split logic is the subtlest code in the issue.** Invariant to
  test hard: after any publish, every local date is covered by at most one
  publication, and the covered shifts for any date equal the most recent
  publish that covered it. The gist exclusion constraint backstops bugs
  (they surface as 500s, not silent overlap).
- **Backfill correctness**: `to_date(week, 'IYYY-"W"IW')` must give the ISO
  Monday. Pinned by a test; data volume is MVP-small if it ever misbehaves.
- **`CREATE EXTENSION btree_gist`** needs privileges on the target
  database. Fine in the dev docker image (postgres superuser); flag it in
  the migration docstring for #12's deployment story.
- **Breaking read shape** (`GET /data/publications` object-or-null →
  list): only consumer is `Schedule.tsx`, updated in the same PR;
  squash-merge keeps deploys atomic.
- **Divergence comparison false positives/negatives**: timestamps must be
  normalized to UTC datetimes before comparing (snapshot = ISO strings,
  psycopg = aware datetimes); comparison excludes `id` and uses a multiset
  (duplicate identical shifts count).
- **Concurrent publishes** of overlapping ranges: serialized by the
  per-org advisory lock (`FOR UPDATE` alone cannot lock rows that don't
  exist yet); `ExclusionViolation` remains as backstop → mapped to a 409
  `ApiError`, surfaced as a retry in the UI.
- **Org timezone changes (#14)**: publication boundaries are local dates
  interpreted in the org's *current* timezone. If #14 later allows editing
  the timezone, a shift near midnight can move to a neighbouring local
  date, shifting which publication covers it and flipping `diverged`.
  Accepted for MVP — the entire stack (availability wall-clock minutes,
  week semantics) already reinterprets under the current org tz, and
  publication is deliberately consistent with that. Documented as an
  explicit consideration #14 must carry (freeze-or-rebase is #14's call);
  noted in Design Decision 9.
- **Plan-conflict risk with other open work**: low — no other open plan
  or PR touches `publication`, `svar.py`, or `Schedule.tsx` today, but
  #11 (auto-schedule) will later land in the same `Schedule.tsx` header
  slot.

## Test Plan

- `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla alembic
  upgrade head` from both empty and 0003-with-data states.
- Full backend suite: `pytest app/tests` — new `test_action_publish.py`,
  reworked publication tests in `test_schema.py`/`test_api_data.py`,
  updated `test_svar.py` fixtures, everything else untouched-green
  (`test_weeks.py`, `test_conflicts.py` guard the helpers this leans on).
- Frontend: `eslint`, `tsc`, `vite build`.
- End-to-end (verify skill): seed → open `/schema/<week>` → "Publicera
  schema" → badge "Publicerad {date}" → edit a shift → badge flips to
  "Ändringar sedan publicering" → staff link still shows the pre-edit
  snapshot → re-publish → link shows the edit, badge green again.
- Manual badge matrix (no frontend test runner): unpublished week →
  "Utkast"; fully published → green; published then edited → "Ändringar
  sedan publicering"; a week half-covered by a range publish → "Delvis
  publicerad"; a week covered by two adjacent fragments (after a partial
  re-publish) → still green when neither diverged.
- Migration backfill sequence (scratch db): `upgrade 0003` → insert
  week-keyed rows → `upgrade head` → assert Monday-aligned ranges and
  intact snapshots (Phase 8).
- Acceptance (issue's Done-when): with the manager mid-edit on a published
  period, the staff link shows exactly the last published snapshot of that
  worker's shifts and nothing else — covered by the end-to-end pass and
  the `test_svar.py` snapshot-isolation test.

## Triage Info

| Field | Value |
|-------|-------|
| **Issue type / milestone** | Feature · MVP (no labels, unassigned) |
| **Blocked by** | Nothing open. #2 (schema), #13 (share link + schedule read), #8 (week view) all closed and landed. |
| **Related issues** | #13 (staff read surface — contract deliberately unchanged), #8 (week view hosts the button/badge), #11 (auto-schedule — will share the `Schedule.tsx` header slot later), #12 (deployment — must account for the `btree_gist` extension), #14 (org settings — a future timezone edit reinterprets publication boundaries; policy is #14's to carry, see Risks) |
| **Scope** | 1 migration, ~7 backend files (2 new: `app/publications.py`, `app/routes/action_publish.py`; plus `app/routes/__init__.py` registration), ~5 frontend files, ~4 test files, 1 doc, 1 migration-verify recipe |
| **Conflict risk** | Low — no open plan or PR touches these files today |

## Design Decisions

1. **Period model = Option B (arbitrary `from`/`to` range), per the
   issue's stated bias.** The publication table was the only week-locked
   piece; shifts, reads, and availability are already range- or
   timestamp-based, and #13's schedule contract is horizon-agnostic. Week
   publishing remains expressible (`{period: "2026-W28"}` is accepted
   sugar), so the fallback Option A is a strict subset of what ships.
2. **Storage end-exclusive (`period_start`/`period_end` dates), wire
   inclusive `to`.** Storage matches `resolve_period`'s internal `[start,
   end)` and `daterange`'s default `[)`; the JSON API keeps the
   established inclusive-`to` convention from `?from=&to=`. One serializer
   (`publication_json`) owns the ±1 day so it can't drift.
3. **Non-overlap invariant maintained at publish time (delete/trim/split),
   enforced by a gist exclusion constraint** — rather than allowing
   overlaps and resolving "latest wins" at read time. Read-time resolution
   would complicate both consumers and makes shift *deletions* propagate
   subtly (a newer snapshot with no shifts for a date must mask older
   ones); write-time trimming keeps reads to a plain overlap query and
   makes retraction explicit. Snapshot semantics are preserved either way.
4. **Snapshot entry = `{id, staff_id, starts_at, ends_at, note}`, open
   shifts included.** Faithful record of the period at publish time;
   superset of what the staff read consumes today, so `_gather_schedule`
   keeps working. Staff names resolve from the live staff row, not the
   snapshot (name edits shouldn't require re-publish).
5. **`diverged` is computed server-side, per publication** in
   `GET /data/publications`, not by the frontend diffing shift lists — one
   place owns the comparison rules (UTC normalization, id-insensitive
   multiset, missing `note` = `None`), and any future consumer (period
   view, agent) gets it free. It is a property of the publication, not of
   the intersection with the requested range: a two-week publication
   edited only in week 2 shows amber from week 1's lens too. Accepted —
   the flag means "what staff see for this publication is stale", which
   is true, and range-scoped divergence would need per-request snapshot
   filtering for marginal UI gain. Revisit if/when a period view lands.
6. **`GET /data/publications` returns a list.** With range periods, a week
   can legitimately overlap multiple publications; object-or-null can't
   represent that. Single consumer updates in the same PR.
7. **MVP UI publishes the visible week only.** The issue keeps the week
   view as "one viewing lens"; a multi-week publish UI is future work the
   range-general API already supports.
8. **Publishing an empty period is legal** and distinct from unpublished —
   it's the retraction mechanism ("nothing scheduled for you this period"
   is information staff should see as published truth).
9. **Publication boundaries follow the org's current timezone.** Local
   dates are stored; UTC windows are derived at use time via
   `weeks.local_instant`. A future timezone edit (#14) reinterprets them —
   consistent with how availability and week semantics already behave.
   Freezing a `timezone` column per publication was rejected: it would
   make publications the only tz-pinned object in the system and still
   wouldn't stop live shifts from moving relative to old snapshots. #14
   owns the change-timezone policy; this issue documents the interaction.
10. **Concurrency = per-org advisory lock** (`pg_advisory_xact_lock`,
   same pattern as `data_shifts.py`), because `FOR UPDATE` can't
   serialize first-publishes over empty ranges; the gist exclusion
   constraint stays as the invariant's backstop (mapped to 409, not 500).

## Files Summary

| File | Change |
|------|--------|
| `migrations/versions/0004_publication_period.py` | **New** — period range columns, backfill, non-overlap exclusion constraint |
| `app/api_utils.py` | Extract `parse_period(mapping)` from `resolve_period` |
| `app/publications.py` | **New** — shared domain module: serializer, live-shift window, snapshot filter, divergence |
| `app/routes/action_publish.py` | **New** — `POST /action/publish`: advisory lock, snapshot + delete/trim/split |
| `app/routes/__init__.py` | Register the new blueprint |
| `app/routes/data_publications.py` | Range form, list response, `diverged` |
| `app/routes/svar.py` | `_gather_schedule`: overlap query replaces week enumeration |
| `scripts/seed.py` | `publish_week` → period columns, delete-then-insert idempotency |
| `frontend/src/types.ts` | `Publication` reshaped |
| `frontend/src/api.ts` | `getPublications`, `publishSchedule` |
| `frontend/src/pages/Schedule.tsx` | Publish button, four-state badge |
| `frontend/src/components/ShiftModal.tsx` | Invalidate `['publication']` on shift writes |
| `app/tests/test_action_publish.py` | **New** — action coverage incl. trim/split invariant |
| `app/tests/test_schema.py` | Publication constraint tests reworked |
| `app/tests/test_api_data.py` | Publications read: list shape, `diverged` |
| `app/tests/test_svar.py` | Fixture → period columns; multi-week span case |
| `docs/api.md` | Publications read + publish action contract |
