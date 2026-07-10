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
| POST | `/data/staff` | `{name, phone?, email?, role?, max_hours_per_week?, desired_shifts_per_week?, availability_note?}` → 201 |
| PATCH | `/data/staff/:id` | Any subset of the above, plus `archived: bool` |
| DELETE | `/data/staff/:id` | Archives (soft) — history survives; unarchive via PATCH |

Staff JSON: `{id, name, phone, email, role, max_hours_per_week,
desired_shifts_per_week, availability_note, share_token, archived}`.
The effective max hours/week for scheduling is the stricter of the org
rule and the staff member's own value. `desired_shifts_per_week` (integer
0–50, `null` = unspecified) is a soft target the scheduler ignores today
(a future suggest-schedule reads it); `availability_note` (≤1000 chars,
trimmed, empty → `null`) is a free-text note to the manager.

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
| PUT | `/data/availability/:staff` | Replaces recurring patterns **per kind, by key presence**: an omitted `wishes`/`blocks` key leaves that kind untouched, `[]` clears it, explicit `null` → 400. Never touches dated exceptions. Writes stamp `source=manager`. |
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

## Actions

| Method | Path | Notes |
|--------|------|-------|
| POST | `/action/staff/:id/regenerate-link` | Generates (first time) or regenerates the staff member's share-link token; the old link stops working. Returns the full staff object. 400 `archived_staff` for archived staff. The public `/svar/:token` surface consuming the token is issue #13. |

## Rules

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/rules` | `{max_hours_per_week, min_rest_hours}` — nulls until set |
| PUT | `/data/rules` | Full replace (missing field → null) |

## Org

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/org` | `{id, name, timezone}` for the calling org. Editing is #14. |
| POST | `/data/org` | Onboarding: `{name, timezone?}` → 201. Creates the org and links it to the calling user. `409 already_onboarded` if the user already has one. |

## Publications

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/publications?period=…` | Period required (`YYYY-Www` only — not from/to). `{week, published_at}` or `null` when the week is unpublished. The publish action is #10. |

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
| GET | `/svar/:token/data` | View context: `{staff:{first_name, name, desired_shifts_per_week, availability_note}, org:{name,initials,timezone}, availability:{wishes,blocks,exceptions}, schedule:{from,to,shifts,shift_count,hours}}`. `schedule` is a flat, date-grouped list of the worker's upcoming published shifts over a forward window — no ISO-week strings (horizon-agnostic; #10 owns the publication-period model). |
| PUT | `/svar/:token/availability` | Recurring layer **per-kind whole-replace by key presence** (same semantics as the manager PUT: omitted `wishes`/`blocks` key untouched, `[]` clears, explicit `null` → 400; arbitrary weekday ranges `{weekday 1-7, start_minute, end_minute}`, `0 <= start < end <= 1440`) + dated-exception **delta** + optional per-staff params: `{wishes?[], blocks?[], add_exceptions?[], remove_exception_ids?[], desired_shifts_per_week?, availability_note?}`. For a submitted kind the client sends the complete desired recurring state, so rows the mobile editor can't represent survive a save that didn't touch that weekday; omitting `blocks` lets the v2 phone leave manager-set recurring blocks intact. `add_exceptions` entries accept `{on_date, kind?='block' (wish\|block), start_minute?, end_minute?, note?}`; writes stamp `source=staff`. Exceptions are only added/removed as listed, never blindly wiped. |
