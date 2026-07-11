# Plan: Issue #11 — Staffing needs + /compute/suggest-schedule v0 (stretch)

## Goal

The first taste of "Timla builds the schedule for you", in three separable
pieces (per the refined demand model in the issue body):

1. **Staffing needs** become a first-class object: a step curve per day
   (intervals + headcount, e.g. 10–12: 1, 12–16: 2, 16–18: 1), stored the
   same way availability already is — recurring weekly pattern in
   wall-clock minutes (DST-safe, expansion via `app/weeks.py`) plus dated
   exceptions ("julafton: 0 hela dagen"). No coupling to shifts.
2. **Coverage** becomes pure derivation: `staffed(t) − needed(t)`. The #8
   heat-strip upgrades from its interim semantics (lucka = open shift) to
   the real thing: lucka = staffed < needed, tooltip "13:00 · 2 av 3", and
   a new "Öppet 10–20" chip derived from the needs curve's span.
   Open shifts (`staff_id NULL`) are re-decided: they stop meaning "här
   saknas folk" and are reinterpreted as **utannonserade pass** (posted
   slots someone can take), so there is a single source of truth for
   unmet need.
3. **Generator**: `POST /compute/suggest-schedule` — a **best-effort
   greedy v0** that tries to find a shift set whose staffing curve ≥ the
   needs curve. Hard blocks are absolute constraints, wishes are soft
   preferences it tries to maximize, org rules (max hours, rest) are
   always respected. It may leave genuinely-coverable gaps a human could
   solve by reshuffling — that is the v0 contract; gaps are reported
   honestly in `uncovered`, never guaranteed away. UI: an
   "Auto-schemalägg" button on the Schedule page fills the draft week,
   editable afterwards in the shift editor (#9).

**Done when:** suggested schedules have zero hard conflicts per
`/compute/conflicts` on seeded demo data, and the #8 strip reads coverage
against the needs curve.

## Approach

Follow the availability model everywhere — it already solved the same
shape of problem (recurring weekday pattern + dated exceptions, wall-clock
minutes, org-timezone expansion). One migration, a shared expansion module
`app/needs.py`, one new `/data` surface, one pure `/compute` endpoint
backed by a flat engine module (mirroring `conflicts.py` /
`compute_conflicts.py`), then two frontend increments in `Schedule.tsx`.
Raw psycopg3, hand-written SQL per repo convention. Tests land with each
phase, not at the end.

### Design decisions

1. **Storage: new `staffing_need` table**, org-level (no `staff_id`), in
   `migrations/versions/0006_staffing_needs.py` (current head is
   `0005_staff_hourly_wage`). Full spec, not just "like availability":

   ```sql
   CREATE TABLE staffing_need (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
       weekday smallint CHECK (weekday BETWEEN 1 AND 7),
       on_date date,
       start_minute smallint NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
       end_minute smallint NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
       headcount smallint NOT NULL CHECK (headcount >= 0 AND headcount <= 200),
       created_at timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT need_positive_span CHECK (end_minute > start_minute),
       CONSTRAINT need_recurring_xor_dated CHECK ((weekday IS NULL) <> (on_date IS NULL)),
       -- headcount 0 is the dated "closed that day" sentinel only,
       -- and only as a full-day row (a partial zero interval is
       -- meaningless — closed time is simply not covered by any row):
       CONSTRAINT need_recurring_headcount_positive CHECK (on_date IS NOT NULL OR headcount > 0),
       CONSTRAINT need_zero_is_full_day CHECK (headcount > 0 OR (start_minute = 0 AND end_minute = 1440))
   );
   CREATE INDEX staffing_need_org_weekday_idx ON staffing_need(org_id, weekday);
   CREATE INDEX staffing_need_org_date_idx ON staffing_need(org_id, on_date);
   ```

   Downgrade drops the table.

2. **Exception semantics: day-level override, not additive.** For
   availability, dated rows *add* to the recurring pattern. For needs
   that is wrong: "julafton: 0 hela dagen" must *replace* the normal
   curve for that date, not stack on it. Rule: **if a date has any dated
   rows, they replace the recurring pattern entirely for that date.**
   A fully-closed day is one dated row with `headcount = 0` spanning
   0–1440 (the only legitimate headcount-0 use; the DB CHECK above
   forbids recurring zeros). Deleting the last dated row for a date
   automatically restores the recurring curve — the override rule reads
   live rows, no extra state. Encoded in `app/needs.py` and documented
   in `docs/api.md`.

3. **API surface: `/data/staffing-needs`** (org-scoped, authenticated).
   Explicit contract — all bodies are JSON objects (`get_json_body()`
   rejects bare lists), unknown fields → 400 `unknown_field` per house
   style:
   - `GET /data/staffing-needs` →
     `{"recurring": [...], "exceptions": [...]}` where each row is
     `{id, start_minute, end_minute, headcount}` plus `weekday` or
     `on_date`.
   - `GET /data/staffing-needs?period=2026-W28` (or `from`/`to` via
     `resolve_period`) → read-only expansion:
     `{"from": ..., "to": ..., "configured": bool, "intervals": [
     {date, starts_at, ends_at, headcount, source: "recurring"|"exception"}]}`.
     `configured` is true iff the org has **any** `staffing_need` rows at
     all (not just in the window) — the frontend's fallback gate needs to
     distinguish "never configured" from "configured but closed/empty
     this week".
   - `PUT /data/staffing-needs` with `{"recurring": [{weekday,
     start_minute, end_minute, headcount}, ...]}` → replaces the whole
     recurring pattern atomically (single transaction; `[]` clears it);
     returns the document, 200. Whole-list replace is fine — there is
     exactly one writer surface, so #40-style presence semantics are
     unnecessary.
   - `POST /data/staffing-needs/exceptions` with `{on_date,
     start_minute?, end_minute?, headcount}` (minutes default 0/1440) →
     201 + row; `headcount: 0` is accepted only as a full-day row
     (validated in the route, mirroring the DB CHECK).
     `DELETE /data/staffing-needs/exceptions/<uuid:id>` → 204 / 404.
   Overlapping intervals within the same weekday (PUT payload) or same
   date (against existing dated rows) are rejected 400 — overlap has no
   meaning for a step curve (max or sum?), refusing is cheaper than
   deciding. Validation is application-level; the write surface is a
   single manager app, so racing writers are out of scope (noted in the
   route docstring).

4. **Coverage stays a frontend derivation, defined at event precision.**
   No `/compute/coverage` endpoint — the issue is explicit that coverage
   is derivation, not an object. `Schedule.tsx` fetches the week's needs
   expansion alongside shifts and derives, per rendered hour cell, the
   **worst point within that hour**: build the exact staffed(t) and
   needed(t) step functions from real minute boundaries (shifts and
   needs both start at arbitrary minutes), and mark the cell lucka if
   `staffed(t) < needed(t)` anywhere inside it — the current
   "any overlap counts as the whole hour" approximation would falsely
   mark covered. Tooltip shows the worst point: "13:00 · 2 av 3".
   `needed = 0` time (outside opening windows, including gaps between
   disjoint windows and closed days) is **neutral**, never "covered" —
   only hours with positive demand somewhere in them get the
   covered/lucka treatment; deficit-free demand → covered; positive
   margin renders as today's ok tint (a distinct overstaffing tint can
   wait). Rendering details:
   - The hour axis (`hourSpan`) derives from shifts **and**
     positive-headcount needs, and the grid renders when the week has
     needs even if `shifts.length === 0` — an empty week with unmet
     needs is the most important gap state and is currently hidden.
   - Shifts fetched for the week miss a previous-Sunday overnight shift
     that carries into Monday (`GET /data/shifts` returns shifts that
     *start* in the period); fetch with `from = monday − 1 day` and
     filter, so Monday coverage counts carry-ins.
   - "Öppet 10–20" chip = span of the day's positive-headcount intervals
     (headcount-0 sentinels excluded). Disjoint windows render as
     "Öppet 10–12, 14–18" rather than a false continuous span.
   - Transitional fallback: when `configured` is false the strip keeps
     today's interim semantics (lucka = open shift) so existing demos
     don't go blind; once any needs exist, needs are the only lucka
     source. A gate, not two parallel truths.

5. **Open shifts = utannonserade pass.** Keep the `staff_id NULL`
   representation and the dashed "Öppet pass" rendering, but they no
   longer drive the lucka color (once needs are configured) and they do
   **not** count into `staffed(t)` — an unassigned slot covers no one.
   No schema change; a semantics + rendering decision documented in
   `docs/api.md` and applied in the coverage derivation. Tying posted
   slots to share-link claiming (#13 surface) is out of scope here.

6. **Generator: flat engine module `app/suggest.py`** +
   `app/routes/compute_suggest.py` (pure, reads, never writes —
   `/compute` convention). `POST /compute/suggest-schedule` accepts
   `{"period": "2026-W28"}` **only** — one ISO week, no `from`/`to`
   ranges in v0 (a year-long range makes desired-shifts ranking,
   response size and runtime ill-defined). Greedy algorithm:
   - Load for the week: needs expansion (`app/needs.py`), non-archived
     staff, availability, org rules, and saved shifts in a ±8-day window
     (same window trick as `conflicts.py`).
   - Residual need curve = needs − already-saved **assigned** shifts
     (open shifts cover nothing).
   - Sweep each day's residual curve left to right; while some point has
     `missing > 0`, pick the best candidate for the earliest uncovered
     block (repeat for multi-headcount gaps): hard-filter staff who are
     blocked, double-booked (against saved **and already-accumulated
     proposed** shifts), or would break effective max hours
     (`_effective_max_hours` semantics) or min rest; rank the rest by
     (wish coverage of the interval, distance below
     `desired_shifts_per_week`, fewest assigned hours so far, and
     **`staff_id` as the final stable tiebreak** so output is
     deterministic). Extend the shift across contiguous need while the
     candidate stays legal, with a minimum shift length (default 120
     min, clamped to the need block if shorter) so the greedy doesn't
     emit confetti shifts. No candidate → mark uncovered **only up to
     the next event boundary** (the next need step, availability edge,
     or shift start/end) and resume the sweep there — advancing past the
     whole need block would skip later time a different candidate could
     cover.
   - **Belt-and-braces acceptance guarantee:** run the full
     `check_conflicts(conn, org, accumulated_proposals)` engine on the
     complete final set (it loads saved shifts as context itself). Any
     shift with a hard conflict is dropped and the remainder
     **revalidated iteratively** until clean (dropping one shift changes
     rest/max-hours context); then `uncovered` is **recomputed from the
     surviving set** so it is never stale. This should be a no-op; if it
     fires, it keeps the zero-hard-conflicts contract honest. Wish
     warnings are fine and pass through.
   - Response: `{shifts: [{staff_id, starts_at, ends_at}],
     uncovered: [{date, starts_at, ends_at, missing}], warnings: [...]}`
     — uncovered need reported honestly, never papered over with open
     shifts.

7. **UI apply flow: the client writes the suggestions, draft-gated.**
   The button (placeholder comment already at `Schedule.tsx:281`,
   "Auto-schemalägg (#11) lands here too") is always enabled but
   **confirmation-gated off draft**: on a draft (or unpublished) week it
   runs directly; on published/diverged/partial weeks it runs only after
   an explicit confirm dialog — the issue says "fills the **draft**
   week", and editing a published week is already possible elsewhere, so
   confirm-not-disable is consistent. It calls the compute
   endpoint, then POSTs each suggested shift through the existing
   `/data/shifts` create path — which re-runs enforcement server-side,
   so even a suggestion gone stale between compute and apply cannot
   write a hard conflict. Disabled while running; per-shift failures
   don't abort the batch and are counted separately ("8 pass skapade,
   1 avvisades"). Afterwards **refetch the week and derive remaining
   luckor from the persisted shifts** — the original suggest response is
   not authoritative after partial failure. No bulk-write endpoint
   in v0.

8. **Needs editing UI is out of scope** for this issue. The "Done when"
   criteria only require seeded needs + the strip + the generator. Seed
   needs via `scripts/seed.py`; file a follow-up issue for a needs
   editor when this lands. Note: open issue #27 (custom staff fields /
   schedule color key) will also touch `Schedule.tsx` — coordinate if
   worked concurrently, not a blocker.

### Sequencing note (from the issue)

The needs model + coverage upgrade (steps 1–4) can land as their own PR
before the generator (steps 5–7) if MVP time runs short — the issue
explicitly blesses that split, and the generator slipping to post-MVP
affects nothing else.

## Steps

1. **Migration + schema tests** —
   `migrations/versions/0006_staffing_needs.py` exactly per design
   decision 1 (`op.execute` SQL, autogenerate disabled); docstring
   records the day-level-override semantics and the headcount-0 rule.
   Extend `app/tests/test_schema.py` (table exists, CHECKs fire:
   recurring zero headcount, weekday/on_date XOR, span, upgrade/downgrade
   round-trip).

2. **`app/needs.py` + `/data` routes + API tests** — create the shared
   module up front (both the route and the generator need it): load
   rows, expand a date range to the resolved step curve applying the
   override rule, and report `configured`. Then
   `app/routes/data_staffing_needs.py` per the contract in design
   decision 3; register in `app/routes/__init__.py`. Tests (new
   `app/tests/test_staffing_needs.py`): document shape, PUT atomic
   replace + `[]` clear + rollback on invalid row, overlap rejection
   (payload-internal and against existing dated rows), headcount bounds,
   unknown fields, org isolation, exception create/delete incl. deleting
   the last exception restoring recurrence, expansion across a DST week,
   multiple dated rows overriding one date, `configured` flag semantics
   (no rows vs closed day).

3. **Seed data** — `scripts/seed.py`: a plausible weekly needs curve for
   the demo org (e.g. Mon–Fri 10–12: 1, 12–16: 2, 16–18: 1; Sat
   10–16: 2; Sun closed = no recurring rows) plus one dated headcount-0
   full-day exception. Idempotent like the rest of the script.

4. **Frontend: coverage against the needs curve** — `frontend/src/api.ts`
   gains `getStaffingNeeds(period)`; `types.ts` the needs types;
   `Schedule.tsx` implements design decisions 4–5: worst-point-per-hour
   derivation from exact minute boundaries, hour axis and grid presence
   driven by needs too, previous-day carry-in fetch, "Öppet …" chip,
   tooltip "13:00 · 2 av 3", open shifts excluded from staffed(t) and
   no longer forcing lucka when configured, zero-needs fallback, legend
   copy updated, loading/error states for the extra fetch.

5. **Generator engine + tests** — `app/suggest.py` per design decision 6.
   Unit-style tests against fixtures (new
   `app/tests/test_suggest_schedule.py`): meets the seeded-style curve
   when coverable, zero hard conflicts via `check_conflicts` on the
   result, respects blocks/max-hours/rest, honors multi-headcount gaps
   (allocates repeatedly while `missing > 1`), prefers wish-covered
   staff, deterministic under ties, honest `uncovered` when demand
   exceeds legal staff capacity, `uncovered` recomputed after a
   post-filter drop, no-staff / no-needs / already-covered weeks return
   empty suggestions, open shifts don't reduce residual need,
   partial-hour needs and shifts.

6. **Compute route + contract tests** —
   `app/routes/compute_suggest.py`: `POST /compute/suggest-schedule`,
   `{"period": "..."}` only (reject `from`/`to` and unknown fields, 400
   on malformed week), register blueprint. Tests: contract shape,
   purity (two identical calls, no DB delta), auth/org scoping.

7. **Frontend: "Auto-schemalägg" apply flow** — per design decision 7:
   draft-gating/confirm, sequential creates via the existing shift API
   helper, created/rejected summary, refetch-derived remaining luckor,
   busy state.

8. **Docs + end-to-end verification** — `docs/api.md`: new "Staffing
   needs" and "/compute/suggest-schedule" sections (incl. override rule,
   headcount-0 sentinel, `configured`), open-shift reinterpretation note
   under Shifts, coverage-derivation note. Full verify pass per the Test
   Plan.

## Risks

- **Greedy is best-effort** — it may leave luckor a human (or a real
  solver) could cover; that is the chosen v0 contract. Mitigated by
  honest `uncovered` reporting, seeded demo data curated to be fully
  coverable (the acceptance bar), and the issue's own framing ("no
  optimization sophistication yet").
- **Exception-override semantics** differ from availability's additive
  exceptions — the subtlest part of the model. Mitigated by tests that
  pin the override rule and an explicit docstring + api.md paragraph.
- **Coverage precision regressions** — moving `coverageFor` from
  hour-overlap counting to worst-point step functions touches the most
  visible UI on the page; DST weeks and midnight-crossing shifts are the
  traps. Reuse `weeks.py`-expanded UTC instants, keep the existing
  carry rendering, add a DST-week expansion test.
- **Open-shift semantics change** could surprise: an org relying on open
  shifts as "här saknas folk" loses that once it defines needs. Mitigated
  by the `configured` fallback and legend/docs updates; it's also exactly
  what the issue asks for (one source of truth).
- **Batch apply is N sequential POSTs** — non-atomic and slow-ish for a
  full week. Acceptable for v0 (server enforcement makes each write safe,
  partial results are reported and re-derived from persisted state);
  a bulk endpoint is a later optimization.
- **Stretch scope**: if time runs short, split after step 4 (needs +
  coverage PR) and let steps 5–7 follow — pre-approved by the issue.

## Test Plan

- `DATABASE_URL=... alembic upgrade head` then `pytest app/tests` green,
  including the new needs + suggest suites (contents per Steps 1, 2, 5,
  6 above).
- `python scripts/seed.py` (idempotent), then via the `verify` skill
  recipe (`.claude/skills/verify/SKILL.md`):
  - `GET /data/staffing-needs?period=<seeded week>` shows the seeded
    curve, `configured: true`, and the dated exception overriding its
    date.
  - Schedule page: heat strip shows lucka exactly where staffed <
    needed (including an empty week — grid visible, all-need luckor),
    tooltip "13:00 · 2 av 3", "Öppet …" chip matches the positive-need
    span; open shifts render dashed but neither count as staffed nor
    force lucka.
  - Click "Auto-schemalägg" on an empty draft week: shifts appear,
    `POST /compute/conflicts` over the resulting week returns zero hard
    conflicts (the issue's acceptance bar), summary reports created /
    rejected / remaining luckor.
  - Re-running suggest on the now-filled week suggests nothing (residual
    need is zero) — purity + idempotence of the applied result.
  - Button is gated on a published week (confirm required).
- CI: eslint, tsc, vite build, alembic + pytest all green.
