# /data API reference

Manager-scoped primitives (see [primitives.md](primitives.md) for the
`/data` / `/compute` / `/action` convention). JSON in, JSON out.

**Auth (interim):** until issue #3 lands, callers identify their
organization with the `X-Timla-Org: <uuid>` header. #3 replaces this with
the authenticated principal; paths and payloads stay the same. The
share-link endpoints (`/link/:token/*`, issue #13) will be the only
unauthenticated surface.

**Errors:** `{ "error": "<machine-code>", "message": "<human text>" }`
with a matching HTTP status. Common codes: `missing_org` (401),
`unknown_org`/`unknown_staff`/`not_found` (404), `invalid`,
`unknown_field`, `invalid_period`, `missing_period`, `invalid_json` (400).

**Periods:** `?period=2026-W28` (ISO week, Monday start, org timezone) or
`?from=2026-07-06&to=2026-07-12` (dates, `to` inclusive). A shift belongs
to the period in which it **starts**.

## Staff

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/staff` | Active staff. `?include_archived=1` for all. |
| POST | `/data/staff` | `{name, phone?, email?, role?, max_hours_per_week?}` → 201 |
| PATCH | `/data/staff/:id` | Any subset of the above, plus `archived: bool` |
| DELETE | `/data/staff/:id` | Archives (soft) — history survives; unarchive via PATCH |

Staff JSON: `{id, name, phone, email, role, max_hours_per_week, share_token, archived}`.
The effective max hours/week for scheduling is the stricter of the org
rule and the staff member's own value.

## Availability

Two layers: **wishes** (preferred working times, recurring weekly) and
**hard blocks** (cannot work: recurring weekly + dated exceptions).
Recurring entries are `{weekday: 1-7 (ISO, 1=Monday), start_minute,
end_minute}` — wall-clock minutes in the org timezone, `0 <= start < end
<= 1440`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/availability/:staff` | The document: `{wishes, blocks, exceptions}` |
| GET | `/data/availability/:staff?period=…` | Read-only expansion: concrete UTC intervals per date, `source: recurring \| exception` |
| PUT | `/data/availability/:staff` | Replaces `wishes` + `blocks` patterns. Never touches dated exceptions. |
| POST | `/data/availability/:staff/exceptions` | `{on_date, start_minute?=0, end_minute?=1440}` → 201 |
| DELETE | `/data/availability/:staff/exceptions/:id` | |

## Shifts

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/shifts?period=…` | Period required. Ordered by start. |
| POST | `/data/shifts` | `{staff_id?, starts_at, ends_at, note?}` — timestamps ISO 8601 **with timezone offset**; `staff_id: null` = open shift → 201 |
| PATCH | `/data/shifts/:id` | Any subset; `staff_id: null` unassigns |
| DELETE | `/data/shifts/:id` | |

Conflict enforcement (`?force=true` override) arrives with
`/compute/conflicts` in issue #5 — until then writes are unchecked.

## Rules

| Method | Path | Notes |
|--------|------|-------|
| GET | `/data/rules` | `{max_hours_per_week, min_rest_hours}` — nulls until set |
| PUT | `/data/rules` | Full replace (missing field → null) |
