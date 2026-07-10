# Plan: Issue #17 — Labor cost: hourly wage per staff + monthly hours/cost summary

## Goal

Give managers a monthly labor-cost view: store an `hourly_wage` per staff
member, expose a pure `POST /compute/labor-cost { period }` endpoint that
sums scheduled hours × wage per staff and for the org, and add a simple
report page (month picker, hours + cost per staff, org total). Staff
without a wage show hours but no cost — never guess a wage. The report is
labeled "schemalagda timmar" since published time reporting doesn't exist
yet.

## Approach

Additive change in four layers, following existing patterns exactly:

1. **Schema** — migration `0005` adds `staff.hourly_wage numeric(8,2)`
   (nullable, `CHECK (hourly_wage >= 0)`). Nullable = "no wage set".
2. **Staff API** — `hourly_wage` becomes an editable field in
   `/data/staff` (same treatment as `max_hours_per_week`: numeric,
   validated, `float` in JSON, `null` allowed).
3. **Compute** — new `POST /compute/labor-cost` (pure, reads only),
   modeled on `compute_conflicts.py`. Month semantics mirror the week
   rule: the month is interpreted in the org timezone and a shift belongs
   to the month in which it **starts**. A new `month_bounds_utc(month, tz)`
   helper in `app/weeks.py` (analogous to `week_bounds_utc`) converts
   `"2026-07"` to UTC `[start, end)`; the SQL then filters
   `starts_at >= start AND starts_at < end` and sums true UTC durations
   (`ends_at - starts_at`), which makes DST months correct for free.
4. **Frontend** — wage field in the staff modal (Staff.tsx, next to
   `maxHours`), plus a new `Rapporter` page at `/rapporter` that activates
   the existing placeholder nav item in `Layout.tsx`.

### Design decisions

- **Live shifts, not publication snapshots.** The issue's MVP bullet says
  "scheduled hours (from shifts)"; its note that "published shifts are the
  honest proxy" is about scheduled-vs-*worked* honesty, and the issue's own
  prescribed mitigation is the "schemalagda timmar" label, not a different
  data source. Computing from the live `shift` table is simpler, matches
  `/data/shifts` semantics, and reflects what the manager currently sees in
  the schedule; publication snapshots (jsonb per period, republishable) would
  need dedupe/partial-month logic for little MVP gain. **Confirm with the
  product owner at PR time** — if snapshots are wanted instead, that's a
  contained change to the compute route's query only (plus tests), and the
  report label should then say published shifts.
- **Current wage applies retroactively.** There is one `hourly_wage` per
  staff, no history: editing a wage today changes every past month's
  computed cost, and a mid-month raise applies to the whole month. Accepted
  MVP limitation, stated in `docs/api.md`; wage effective-dating belongs to
  the post-MVP OpenVera salary-basis work the issue mentions.
- **Only assigned shifts count.** Unassigned shifts (`staff_id IS NULL`)
  have no wage and no person; they are excluded from the report entirely
  (documented in `docs/api.md`).
- **Archived staff are included** when they have shifts in the period —
  their cost was real. The row carries `archived: true` so the UI can
  mark it.
- **Rows = staff with shifts in the period.** Staff with zero scheduled
  hours are omitted (an all-active-staff listing adds noise, not
  information, in a cost report).
- **Money math in numeric/Decimal, never float — exact contract:**
  SQL returns hours as `numeric` (psycopg3 → `Decimal`). Per row:
  `cost = (unrounded_hours * hourly_wage).quantize('0.01',
  ROUND_HALF_UP)` or `null` when wage is unset; `hours` is quantized to
  2 decimals for the wire. `totals.cost` = sum of the **rounded row
  costs** (so the UI table visibly adds up) over rows that have a wage;
  `totals.hours` = sum of unrounded hours, then quantized;
  `totals.uncosted_hours` = quantized sum of hours on wage-less rows;
  `totals.cost_complete` = `uncosted_hours == 0`, so the UI can say
  "Känd kostnad, exklusive X h utan timlön" instead of overclaiming a
  complete total. Wire types are JSON numbers (`float(...)` applied only
  after quantization, consistent with `max_hours_per_week`).
- **POST with JSON body** `{ "period": "2026-07" }` per the issue text,
  matching the `/compute/conflicts` calling convention. Month format is
  strictly `YYYY-MM`; anything else → `400 invalid_period`.

## Steps

0. **Branch** — `git checkout -b issue/17-labor-cost` from up-to-date
   `main` (never implement on `main`; PRs are squash-merged).

1. **Migration `migrations/versions/0005_staff_hourly_wage.py`**
   (`revision '0005'`, `down_revision '0004'`, hand-written SQL via
   `op.execute`, autogenerate disabled):
   ```sql
   ALTER TABLE staff
       ADD COLUMN hourly_wage numeric(8,2) CHECK (hourly_wage >= 0);
   ```
   Downgrade drops the column. Docstring notes issue #17 and the
   "never guess a wage" rule (NULL = unset).

2. **`app/routes/data_staff.py`** — add `hourly_wage` to
   `EDITABLE_FIELDS`, to the INSERT column list in `create_staff`, to
   `staff_json` (`float(...)` when not `None`, like
   `max_hours_per_week`), and to `_validate`:
   `is_number(wage) and 0 <= wage <= 100000` (or `None`), error message
   `'hourly_wage must be a number between 0 and 100000 or null'`.

3. **Fix the now-stale unknown-field test** —
   `app/tests/test_api_data.py::test_staff_rejects_unknown_fields`
   currently uses `hourly_wage` as its example of an unknown field
   (line ~40); switch the example to something that stays unknown
   (e.g. `'shoe_size'`), then add staff-API coverage: create/patch with
   `hourly_wage` (including `0` and a >2-decimal value like `173.505`,
   which the `numeric(8,2)` column rounds — assert the stored value),
   round-trips in `staff_json`, `null` clears it, negative / over-cap /
   non-numeric / boolean → `400 invalid`.

4. **`app/weeks.py`** — add `month_bounds_utc(month, tz)`:
   parse `'YYYY-MM'` (strict zero-padded regex-or-equivalent;
   `ValueError` on garbage or month outside 01–12), return
   `(local_instant(date(y, m, 1), 0, tz),
   local_instant(first_of_next_month, 0, tz))`. Unit tests in
   `app/tests/test_weeks.py`: normal month, year rollover (`2026-12` →
   ends `2027-01-01`), DST months in `Europe/Stockholm` (2026-03 is an
   hour short, 2026-10 an hour long), invalid inputs raise
   (`'2026-7'`, `'2026-13'`, `'2026-07-01'`, `'garbage'`).

5. **New route `app/routes/compute_labor_cost.py`** —
   `POST /compute/labor-cost`, blueprint `compute_labor_cost`,
   modeled on `compute_conflicts.py`:
   - body must be exactly `{period}`; unknown fields → `400
     unknown_field`; missing → `400 missing_period`; non-string or bad
     format (JSON can carry numbers/lists/null — never let those 500) →
     `400 invalid_period` ("period must be an ISO month like '2026-07'").
   - `start, end = month_bounds_utc(period, org['timezone'])`, then:
     ```sql
     SELECT s.id, s.name, s.hourly_wage,
            (s.archived_at IS NOT NULL) AS archived,
            EXTRACT(EPOCH FROM SUM(sh.ends_at - sh.starts_at)) / 3600 AS hours
     FROM shift sh
     JOIN staff s ON s.id = sh.staff_id
     WHERE sh.org_id = %s AND sh.starts_at >= %s AND sh.starts_at < %s
     GROUP BY s.id
     ORDER BY s.name, s.id
     ```
     (`s.id` tiebreaker keeps ordering deterministic for duplicate names.)
   - Response:
     ```json
     {
       "period": "2026-07",
       "staff": [{"staff_id", "name", "archived", "hours",
                  "hourly_wage", "cost"}],
       "totals": {"hours", "cost", "uncosted_hours", "cost_complete"}
     }
     ```
     Rounding/totals exactly per the money-math design decision above
     (Decimal quantize ROUND_HALF_UP, totals sum rounded row costs,
     `cost: null` when wage unset).
   - Register in `app/routes/__init__.py` (import + `register_blueprint`,
     alphabetical with the other compute blueprint).

6. **Backend tests `app/tests/test_compute_labor_cost.py`** (reuse
   `conftest.py` client/fixtures; see `test_api_data.py` for the
   pattern): happy path with two staff; month-start boundary (shift
   starting 23:00 org-local on the last day of June belongs to June even
   though it ends in July — and its full duration counts); staff without
   wage → `cost: null`, hours still present, `totals.uncosted_hours`
   correct; unassigned shift excluded; archived staff with shifts
   included and flagged; staff with no shifts omitted; org isolation
   (another org's shifts invisible); `400`s for missing period, unknown
   fields, and invalid periods including non-string JSON types
   (`null`, `7`, `true`, `[]`, `{}`) and malformed strings (`'2026-7'`,
   `'2026-W28'`); rounding: wage `173.50` × 7.5 h = `1301.25` exactly,
   and totals equal the sum of rounded row costs; `cost_complete`
   false + `uncosted_hours` when a wage-less staff has hours; DST month
   total hours (October shift over the fall-back night sums the real 9h
   of a 23:00–07:00 wall-clock shift stored as UTC instants).

7. **`app/tests/test_schema.py`** — constraint test: negative
   `hourly_wage` insert raises `CheckViolation`; `NULL` accepted.

8. **Guard the public surface** — `/svar/:token/data` builds its JSON
   explicitly in `app/routes/svar.py` (no `s.*` spread into the
   response), so wage does not leak, and `PUT /svar/:token/availability`
   has an explicit field allowlist (svar.py ~line 224) so `hourly_wage`
   is already rejected as `unknown_field`. Add two assertions to
   `app/tests/test_svar.py`: `hourly_wage` absent from the GET payload,
   and a PUT containing `hourly_wage` → `400 unknown_field` — pinning
   both properties against regressions.

9. **`docs/api.md`** — add `hourly_wage` to the Staff section
   (POST/PATCH fields + Staff JSON + one sentence: null = unset, never
   guessed), and a new `## /compute/labor-cost` section after
   `## /compute/conflicts` documenting body, month semantics (org
   timezone, shift belongs to the month it starts in — and that this
   endpoint's `period` is an ISO **month**, unlike the ISO-week
   `period` elsewhere), response shape incl. `cost_complete`,
   assigned-shifts-only, archived inclusion, the current-wage-applies-
   retroactively limitation, and the "schemalagda timmar" caveat.

10. **Frontend API layer** — `frontend/src/types.ts`: add
    `hourly_wage: number | null` to `Staff`; new `LaborCostRow` /
    `LaborCostReport` interfaces. `frontend/src/api.ts`: add
    `hourly_wage?: number | null` to `StaffPayload`;
    `computeLaborCost = (period: string) =>
    request<LaborCostReport>('POST', '/compute/labor-cost', { period })`.

11. **Wage editing in staff management** — `frontend/src/pages/Staff.tsx`:
    add `hourlyWage` to `FormState` / `formFromStaff` / `payloadFromForm`
    (parse like `parseMaxHours`; empty string → `null`) and a
    "Timlön (kr/h)" `TextField` next to `Maxtimmar` in the shared modal
    fields component, so both "Ny medarbetare" and "Redigera" get it.
    Client-side parse must allow `0` but map NaN/Infinity/negative/
    over-cap input to a validation error (never send NaN —
    `JSON.stringify` turns it into `null` and would silently clear the
    wage).

12. **Report page `frontend/src/pages/Reports.tsx`** — route
    `/rapporter` in `frontend/src/App.tsx`; activate the `Rapporter`
    placeholder in `frontend/src/components/Layout.tsx` NAV
    (`to: '/rapporter'`) **and** add `/rapporter` → `'Rapporter'` to
    `pageLabel()` (Layout.tsx ~line 105) so the topbar breadcrumb isn't
    blank. Content: month picker (prev/next arrows + a native
    `<input type="month">` or equivalent, default = current month
    derived in the **org timezone** — same pattern as
    `ScheduleRedirect`, not the browser clock), React Query on
    `computeLaborCost(month)` with loading and error states (not just
    `EmptyState`), table with columns Namn / Schemalagda timmar /
    Timlön / Kostnad formatted with `Intl.NumberFormat('sv-SE')`
    (currency SEK for cost), archived staff marked, em dash + subtle
    "ingen timlön angiven" hint where wage is unset, footer row with org
    totals — shown as "Känd kostnad, exklusive X h utan timlön" when
    `cost_complete` is false — heading/label that says "schemalagda
    timmar" explicitly, `EmptyState` when the month has no shifts.

13. **`scripts/seed.py`** — extend the staff insert tuples with plausible
    hourly wages (the script deletes and recreates the demo org, so just
    add the column to the existing INSERT), deliberately leaving at
    least one staff member's wage `NULL` to demo the uncosted state.
    Run the script twice as the idempotency smoke test.

14. **Verify** — `alembic upgrade head` (+ `downgrade 0004` / `upgrade
    head` round-trip), `pytest app`, and in `frontend/`:
    `npm run typecheck && npm run lint && npm run build`. Then the
    `verify` skill: set a wage in the UI, schedule shifts, open
    `/rapporter`, check totals against hand-math including a
    month-boundary overnight shift.

## Risks

- **Wage leaking to the unauthenticated `/svar` surface** — mitigated by
  step 8's regression test; the svar payload is hand-built today.
- **Float artifacts in money math** — psycopg returns `numeric` as
  `Decimal`; keep arithmetic in SQL/Decimal and round once at the JSON
  edge. Test with a wage like 173.50 × 7.5 h.
- **`test_staff_rejects_unknown_fields` silently inverts** — it uses
  `hourly_wage` as its unknown-field example; if step 3 is skipped the
  suite fails confusingly right after step 2.
- **Month/period ambiguity** — `parse_period` elsewhere means ISO weeks;
  this endpoint's `period` is an ISO month. Kept separate on purpose
  (own error message, own helper) but worth a clear docs/api.md note so
  future endpoints don't cargo-cult the wrong parser.
- **Live shifts vs publication snapshots** — the issue can be read either
  way (MVP bullet says "from shifts", the note calls published shifts
  "the honest proxy"). Decision: live shifts + label (see design
  decisions); confirm with the product owner at PR time. If overturned,
  only the compute route's data source and tests change.
- **Retroactive wage edits change history** — accepted MVP limitation
  (documented); real fix is wage effective-dating in the post-MVP
  OpenVera work.
- **Scheduled ≠ worked** — product risk, not code: the report must keep
  the "schemalagda timmar" label prominent so it doesn't overclaim
  (explicit in the issue).

## Test Plan

- `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla alembic upgrade head`
  then `alembic downgrade 0004 && alembic upgrade head` (migration is
  reversible).
- `DATABASE_URL=... python -m pytest app` — new tests from steps 3, 4, 6,
  7, 8 plus the whole existing suite green.
- `cd frontend && npm run typecheck && npm run lint && npm run build`.
- `python scripts/seed.py` twice (idempotency) — report shows demo data
  with at least one uncosted staff row.
- Manual (`verify` skill): create staff with wage 173.50, one without;
  schedule shifts in the current month including one starting 23:00 on
  the last day of the previous month (must not count) and one starting
  23:00 on the last day of the current month (must count, full length);
  `/rapporter` shows per-staff hours/cost with sv-SE formatting, a dash
  for the wage-less staff, "Känd kostnad, exklusive X h utan timlön" in
  the footer; wage editable via staff modal round-trips (including
  clearing it); `GET /svar/:token/data` contains no `hourly_wage` and a
  PUT with `hourly_wage` is rejected.
