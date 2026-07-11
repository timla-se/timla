# /data API reference

Manager-scoped primitives (see [primitives.md](primitives.md) for the
`/data` / `/compute` / `/action` convention). JSON in, JSON out.

**Auth:** every `/data`, `/compute` and `/action` request needs
`Authorization: Bearer <clerk-session-jwt>`. A signed-in user with no
organization yet gets `403 no_org` from every endpoint except
`POST /data/org` (onboarding, see the Org section) — that's the signal
the frontend uses to show the onboarding screen instead of the app. The
staff share-link surface (`/svar/:token` + `GET /svar/:token/data` +
`PUT /svar/:token/availability`, issue #13) is the only unauthenticated
one; `/link/:token` 301-redirects to it.

**Errors:** `{ "error": "<machine-code>", "message": "<human text>" }`
with a matching HTTP status. Common codes: `unauthenticated` (401),
`no_org` (403), `already_onboarded` (409), `unknown_staff`/`not_found`
(404), `invalid`, `unknown_field`, `invalid_period`, `missing_period`,
`invalid_json` (400).

**Periods:** `?period=2026-W28` (ISO week, Monday start, org timezone) or
`?from=2026-07-06&to=2026-07-12` (dates, `to` inclusive). A shift belongs
to the period in which it **starts**.

## Staff

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/staff` | Active staff. `?include_archived=1` for all. |
| POST | `/data/staff` | `{name, phone?, email?, role?, max_hours_per_week?, desired_shifts_per_week?, availability_note?, hourly_wage?}` → 201 |
| PATCH | `/data/staff/:id` | Any subset of the above, plus `archived: bool` |
| DELETE | `/data/staff/:id` | Archives (soft) — history survives; unarchive via PATCH |

Staff JSON: `{id, name, phone, email, role, max_hours_per_week,
desired_shifts_per_week, availability_note, hourly_wage, share_token,
archived}`. The effective max hours/week for scheduling is the stricter
of the org rule and the staff member's own value. `desired_shifts_per_week`
(integer 0–50, `null` = unspecified) is a soft target the scheduler ignores
today (a future suggest-schedule reads it); `availability_note` (≤1000
chars, trimmed, empty → `null`) is a free-text note to the manager.
`hourly_wage` (number 0–100000, kr/h, stored with 2 decimals) is `null`
when unset — labor cost never guesses a wage. It is manager-only data:
the public `/svar` surface neither exposes nor accepts it.

## Availability

A **2×2 matrix**: every interval is a **wish** (soft preference) or a hard
**block**, and either **recurring** (`weekday: 1-7`, ISO, 1=Monday) or
**dated** (`on_date`). Recurring wishes + blocks are the normal week; dated
rows of either kind ("Kan inte" / "Kan extra") are **exceptions**. Times are
wall-clock minutes in the org timezone, `0 <= start_minute < end_minute <=
1440`. Each interval also carries `source` (provenance: `staff` | `manager`
| `null` when unknown) and an optional `note` (≤500 chars).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/availability/:staff` | The document: `{wishes, blocks, exceptions}`. `wishes`/`blocks` are the recurring layers only; every dated row (either kind) is in `exceptions`. |
| GET | `/data/availability/:staff?period=…` | Read-only expansion: concrete UTC intervals per date, `source: recurring \| exception` (here `source` is the expansion **origin**, not the provenance column) |
| PUT | `/data/availability/:staff` | Replaces recurring patterns **per kind, by key presence**: an omitted `wishes`/`blocks` key leaves that kind untouched, `[]` clears it, explicit `null` → 400. Never touches dated exceptions. New/edited rows stamp `source=manager`; rows resubmitted verbatim keep their prior `source`. |
| POST | `/data/availability/:staff/exceptions` | `{on_date, kind?='block' (`wish`\|`block`), start_minute?=0, end_minute?=1440, note?}` → 201. Stamps `source=manager`. |
| DELETE | `/data/availability/:staff/exceptions/:id` | |

## Shifts

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/shifts?period=…` | Period required. Ordered by start. |
| POST | `/data/shifts` | `{staff_id?, starts_at, ends_at, note?}` — timestamps ISO 8601 **with timezone offset**; `staff_id: null` = open shift → 201 |
| PATCH | `/data/shifts/:id` | Any subset; `staff_id: null` unassigns |
| DELETE | `/data/shifts/:id` | |

Archived staff cannot be assigned shifts (400 `archived_staff`).

**Open shifts are utannonserade pass (issue #11):** `staff_id: null`
means a *posted* slot someone can take, not "här saknas folk". Once an
org has a staffing-needs curve, unmet need is derived as
`staffed(t) < needed(t)` — the single source of truth for gaps — and
open shifts neither count as staffed nor mark luckor. (Before any needs
exist, the schedule UI keeps the interim reading where an open shift
marks the gap.) Coverage itself is a **frontend derivation**, not an
object: the schedule fetches the week's needs expansion alongside the
shifts and compares the two step functions at exact minute boundaries.

**Conflict enforcement:** POST and PATCH run the conflict engine. Hard
conflicts reject the write with **409** `conflict` (body includes
`conflicts` and `warnings`); `?force=true` overrides — the manager has
the final word. Successful writes return
`{shift, conflicts, warnings}` so overrides and soft warnings are always
visible. A PATCH that changes neither staff nor times (e.g. note-only)
skips enforcement — it introduces no new conflict, and a force-created
shift must stay editable. Check+write is serialized per staff member
(advisory lock), so concurrent saves can't slip a double booking past
the check.

## Staffing needs

The org's demand curve (issue #11): how many people are needed when, as
a step curve per day. Org-level — no `staff_id`. Stored exactly like
availability: **recurring** rows (`weekday: 1-7`) plus **dated** rows
(`on_date`), in wall-clock minutes in the org timezone (DST-safe),
`0 <= start_minute < end_minute <= 1440`, `headcount` 0–200.

Two rules differ from availability:

- **Dated rows are a day-level OVERRIDE, not additive.** If a date has
  any dated rows, they replace the recurring pattern entirely for that
  date ("julafton: 0 hela dagen" must not stack on the normal curve).
  Deleting the last dated row for a date restores the recurring curve —
  the rule reads live rows, no extra state.
- **`headcount: 0` is the dated full-day "closed that day" sentinel
  only.** Recurring rows must have positive headcount, and a zero row
  must span 0–1440 (a partial zero interval is meaningless — closed
  time is simply not covered by any row). Both are DB CHECKs and route
  validations.

Overlapping intervals within one weekday (PUT payload) or one date
(against existing dated rows) are rejected 400 — overlap has no meaning
for a step curve.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/staffing-needs` | The document: `{recurring, exceptions}`; each row `{id, start_minute, end_minute, headcount}` plus `weekday` or `on_date`. |
| GET | `/data/staffing-needs?period=…` | Read-only expansion: `{from, to, configured, intervals: [{date, starts_at, ends_at, headcount, source: recurring \| exception}]}`. `configured` is true iff the org has **any** needs rows at all (not just in the window) — it distinguishes "never configured" from "configured but closed/empty this week". Zero-headcount sentinels are emitted so clients can tell "closed by exception" from "no data". |
| PUT | `/data/staffing-needs` | `{recurring: [{weekday, start_minute, end_minute, headcount}]}` replaces the whole recurring pattern atomically (`[]` clears it). Never touches dated exceptions. |
| POST | `/data/staffing-needs/exceptions` | `{on_date, start_minute?=0, end_minute?=1440, headcount}` → 201. `headcount: 0` only as a full-day row. |
| DELETE | `/data/staffing-needs/exceptions/:id` | |

## /compute/conflicts

`POST /compute/conflicts` with `{shifts: [{id?, staff_id?, starts_at,
ends_at}]}` (max 500) → `{conflicts, warnings}`. Pure — never writes.

- Proposed shifts **replace their saved counterparts** (matched by `id`),
  so checking an edit doesn't conflict with the shift's own saved state.
- Saved shifts in the same and adjacent weeks are read for context:
  max-hours totals and rest gaps count shifts outside the payload, and a
  rest violation can span a week boundary.
- Hard conflicts: `double_booking`, `blocked` (hard block overlap),
  `max_hours` (against the effective cap — stricter of org rule and
  per-staff), `insufficient_rest`, `archived_staff` (new shifts — no
  `id` — for archived staff, mirroring the write path's rejection).
- Soft warnings: `outside_wishes` — only for staff who have a **recurring**
  wish (a normal-week baseline); with none, all time is neutral. A dated
  wish ("Kan extra") only widens coverage on its own date, never triggers a
  warning by itself.
- Each item carries `shift_index` (payload position), `shift_id`,
  `staff_id`, `type`, `message` and type-specific details.

## /compute/suggest-schedule

`POST /compute/suggest-schedule` with `{period: "2026-W28"}` — **one ISO
week only**, no `from`/`to` ranges in v0 (unknown fields → 400
`unknown_field`, malformed week → 400 `invalid_period`). Pure — never
writes; the client applies suggestions through the normal enforced
`POST /data/shifts` path, so even a suggestion gone stale between
compute and apply cannot save a hard conflict.

Response:

```json
{
  "period": "2026-W28",
  "shifts": [{"staff_id", "starts_at", "ends_at"}],
  "uncovered": [{"date", "starts_at", "ends_at", "missing"}],
  "warnings": [ /* soft outside_wishes items from the conflict engine */ ]
}
```

- **Best-effort greedy v0.** Hard constraints (blocks, double booking,
  effective max hours, min rest) are absolute; wishes are soft
  preferences the ranking maximizes (then: furthest below
  `desired_shifts_per_week`, fewest assigned hours in the week, and
  `staff_id` as the final stable tiebreak — output is deterministic).
  It may leave genuinely-coverable gaps a human could solve by
  reshuffling; those are reported honestly in `uncovered`
  (constant-`missing` segments), never papered over with open shifts.
- Residual need = needs − saved **assigned** shifts; open shifts cover
  no one. Suggested shifts have a 120-minute minimum length, clamped to
  the need block when the demand itself is shorter.
- Belt and braces: the final set is validated with the full conflict
  engine; any hard-conflicted shift is dropped, the remainder
  revalidated iteratively, and `uncovered` recomputed from the
  surviving set — the zero-hard-conflicts contract holds even if the
  greedy misjudged.

## /compute/labor-cost

`POST /compute/labor-cost` with `{period: "2026-07"}` → monthly scheduled
hours × hourly wage. Pure — never writes. Unlike the ISO-**week** `period`
used elsewhere, this endpoint's `period` is an ISO **month** (`YYYY-MM`,
strictly zero-padded; anything else → 400 `invalid_period`; missing → 400
`missing_period`; extra body fields → 400 `unknown_field`).

Response:

```json
{
  "period": "2026-07",
  "staff": [{"staff_id", "name", "archived", "hours", "hourly_wage", "cost"}],
  "totals": {"hours", "cost", "uncosted_hours", "cost_complete"}
}
```

- **Month semantics mirror the week rule:** the month is evaluated in the
  org timezone and a shift belongs to the month in which it **starts** —
  an overnight shift starting 23:00 on the 31st counts its full length in
  that month. DST months sum true UTC durations.
- Sums **live shifts**, not publication snapshots — the report shows
  *scheduled* hours ("schemalagda timmar"), not worked or published time.
- Only **assigned** shifts count; open shifts (`staff_id: null`) are
  excluded. Archived staff with shifts in the period are included
  (flagged `archived: true`); staff without shifts in the period are
  omitted.
- Money math is decimal: per-row `cost` is `hours × hourly_wage` rounded
  to 2 decimals (half up), `null` when the wage is unset. `totals.cost`
  sums the **rounded row costs** (the table visibly adds up) over rows
  with a wage; `totals.uncosted_hours` is the hours on wage-less rows and
  `totals.cost_complete` is `false` when any such hours exist — the total
  is then a *known* cost, not the whole cost.
- **The current wage applies retroactively:** there is no wage history in
  MVP, so editing a wage changes every past month's computed cost and a
  mid-month raise applies to the whole month.

## Actions

| Method | Path | Notes |
|--------|------|-------|
| POST | `/action/staff/:id/regenerate-link` | Generates (first time) or regenerates the staff member's share-link token; the old link stops working. Returns the full staff object. 400 `archived_staff` for archived staff. The public `/svar/:token` surface consuming the token is issue #13. |
| POST | `/action/publish` | Freezes the period's live shifts into a `publication` snapshot that staff links read (#10). Body: `{period: "2026-W28"}` **or** `{from, to}` (ISO dates, `to` inclusive, ≤ 1 year); both forms at once → 400 `invalid_period`, unknown fields → 400 `unknown_field`. A shift belongs to the period where it **starts** (org timezone); open shifts are snapshotted too. Publishing an empty period is legal — it retracts staff-visible shifts for the range. Overlapped older publications are deleted/trimmed/split so the newest publish wins per date (trimmed fragments keep their original `published_at`). Returns `{from, to, published_at, shift_count}`. A raced concurrent publish → 409 `publish_conflict` (retry). |

## Rules

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/rules` | `{max_hours_per_week, min_rest_hours}` — nulls until set |
| PUT | `/data/rules` | Full replace (missing field → null) |

## Org

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/org` | `{id, name, timezone}` for the calling org. |
| POST | `/data/org` | Onboarding: `{name, timezone?}` → 201. Creates the org and links it to the calling user. `409 already_onboarded` if the user already has one. |
| PATCH | `/data/org` | Any subset of `{name, timezone}` (name trimmed, timezone a valid IANA zone); empty body → 400 `invalid`, unknown keys → 400 `unknown_field`. Returns the updated `{id, name, timezone}`. |

**Timezone changes reinterpret, never rebase.** All local-time semantics are
evaluated in the org's *current* timezone: availability wishes/blocks are
wall-clock minutes and simply mean new UTC instants after the change; shifts
are UTC instants, so a near-midnight shift can move to the adjacent local
date/ISO week in period queries; publication boundaries are local dates, so
the same shift move can change which publication covers it and flip its
`diverged` flag. No stored data is migrated or frozen on a timezone change
(policy from #10/#14).

## Publications

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/publications?period=…` | Period required — `?period=YYYY-Www` or `?from=…&to=…` (publications are date ranges since #10). Returns the **list** of publications overlapping the range ordered by start, each `{from, to, published_at, diverged}` (`to` inclusive); `[]` when nothing overlaps. `diverged` = the period's live shifts no longer match the snapshot (id-insensitive multiset; note edits count) and is a property of the publication, not of the requested range. Publishing is `POST /action/publish`. |

## Staff share-link (`/svar`) — the only unauthenticated surface

The worker opens `/svar/:token` (the token is `staff.share_token`, minted by
`POST /action/staff/:id/regenerate-link`). The bare path serves the SPA; the
JSON below is token-scoped and needs no `Authorization` header. All `/svar/*`
responses carry `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Robots-Tag: noindex`, `nosniff`, `X-Frame-Options: DENY`, and the surface
is IP rate-limited. A bad/rotated token → generic `404 not_found` (no
enumeration). `/link/:token` 301-redirects here.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/svar/:token/data` | View context: `{staff:{first_name, name, desired_shifts_per_week, availability_note}, org:{name,initials,timezone}, availability:{wishes,blocks,exceptions}, schedule:{from,to,shifts,shift_count,hours}}`. `schedule` is a flat, date-grouped list of the worker's upcoming published shifts over a forward window — no ISO-week strings. Reads the publication snapshots overlapping the window (#10): staff always see the last published state, never live edits. |
| PUT | `/svar/:token/availability` | Recurring layer **per-kind whole-replace by key presence** (same semantics as the manager PUT: omitted `wishes`/`blocks` key untouched, `[]` clears, explicit `null` → 400; arbitrary weekday ranges `{weekday 1-7, start_minute, end_minute}`, `0 <= start < end <= 1440`) + dated-exception **delta** + optional per-staff params: `{wishes?[], blocks?[], add_exceptions?[], remove_exception_ids?[], desired_shifts_per_week?, availability_note?}`. For a submitted kind the client sends the complete desired recurring state, so rows the mobile editor can't represent survive a save that didn't touch that weekday; omitting `blocks` lets the v2 phone leave manager-set recurring blocks intact. `add_exceptions` entries accept `{on_date, kind?='block' (wish\|block), start_minute?, end_minute?, note?}`; writes stamp `source=staff`, except recurring rows resubmitted verbatim, which keep their prior `source`. Exceptions are only added/removed as listed, never blindly wiped. |
