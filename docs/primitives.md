# API primitives: /data, /compute, /action

Timla's API is a small set of composable primitives, split into three
families by what they do. Both the web UI and any future agent interface
consume the same primitives — there are no UI-specific endpoints. The
value of the split is that consumers can combine primitives freely, and
that each family carries a guarantee:

| Family | Guarantee | Examples |
|--------|-----------|----------|
| `/data/` | Plain reads and writes of stored state | `GET /data/staff`, `PUT /data/availability/:staff` |
| `/compute/` | Pure computation — **no side effects**. May read stored state for context, never writes | `POST /compute/conflicts`, `POST /compute/suggest-schedule` |
| `/action/` | Does something in the world: state transitions, notifications, token generation | `POST /action/publish`, `POST /action/staff/:id/regenerate-link` |

## Conventions

- JSON in, JSON out. Errors use a consistent shape:
  `{ "error": "<machine-readable-code>", "message": "<human text>" }`
- Period parameters are ISO dates (`?period=2026-W28` for ISO weeks,
  `?from=2026-07-06&to=2026-07-12` for ranges).
- Weeks are ISO 8601 (Monday start), evaluated in the organization's
  timezone. Timestamps are stored in UTC.
- All `/data`, `/compute` and `/action` routes require an authenticated
  manager and are scoped to their organization. The only unauthenticated
  surface is `/link/:token/*` — personal share-link views, where the token
  itself identifies one staff member (see issue #13).

## Why "pure" allows reads

`/compute/` endpoints may read the database — a conflict check must see
already-saved shifts in adjacent weeks to catch rest-time violations that
span a week boundary. The guarantee is *no side effects*: calling a
`/compute/` endpoint any number of times never changes state.

## Example: composing primitives

"Lisa is sick tomorrow, find a replacement" decomposes into:

1. `GET /data/shifts?from=<tomorrow>&to=<tomorrow>` — Lisa's shifts
2. `GET /data/availability/<each staff>?period=<tomorrow>` — who is free
3. `POST /compute/conflicts` — verify a candidate can take the shift
4. `PATCH /data/shifts/:id` — reassign

The same decomposition works whether the caller is the week-view UI, a
CLI script, or a conversational agent.
