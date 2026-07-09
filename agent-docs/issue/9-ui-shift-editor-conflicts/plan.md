# Implementation Plan: UI: shift editor with live conflict warnings

## Summary

Make the Arbetsschema week view (issue #8) editable: a "Nytt pass" /
"Redigera pass" modal (TimlaModal pattern) for creating, editing,
reassigning and deleting shifts, with live conflict feedback from
`POST /compute/conflicts` shown inline while the manager types —
before saving. Saves go through the existing `/data/shifts` endpoints;
a hard-conflict 409 keeps the modal open and offers "Spara ändå"
(`?force=true`). **The backend is already complete** (issues #4 and #5
shipped CRUD + the conflict engine + enforcement), so this is frontend
work only: an API-client layer, a DST-safe wall-clock→instant helper,
one new modal component, and wiring in `Schedule.tsx`.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None — #8 (week view) and #5 (`/compute/conflicts`) are both closed and merged |
| **Blocks** | Nothing hard. #10 (publish) and #11 (auto-schedule) land beside it on the same page and become far more useful once schedules can be built |
| **Related issues** | #8 (base view this edits), #5 (conflict engine + 409/force contract), #10 (Publicera button shares the header slot), #11 (suggest-schedule fills open shifts), #27 (bar color key), #7 (availability editor shares `time.ts` helpers) |
| **Scope** | ~5 frontend files: 1 new component, 4 modified (`api.ts`, `types.ts`, `time.ts`, `Schedule.tsx`). **No backend changes, no migrations** |
| **Risk** | Medium |
| **Complexity** | Medium — the wall-clock→UTC-instant conversion (DST) and the debounced live-check lifecycle are the tricky parts; the form itself is routine |
| **Safe for junior** | No — timezone math and the 409/force save flow need care |
| **Conflict risk** | Low — all existing plan folders (3, 6, 8, 13, 21, 32) belong to closed issues; no other open plans touch these files |

### Triage Notes

- No `agent-docs/github/project.json` exists, so no project-board fields
  (status/release/sprint) were available; no release-branch alignment was
  needed (`main` is the base).
- The issue's done-criterion — "a manager can build next week's schedule
  for a ~10-person team without leaving the week view, and conflicts are
  visibly flagged" — is satisfied by a modal editor: the modal overlays
  the week view, and the view refreshes in place after each save.
- Drag-to-create / drag-to-resize on the timeline is **out of scope**
  (see Design Decision 1); nothing in the issue text requires it.

## Analysis

### What already exists (nothing to build server-side)

- **`POST /data/shifts`** and **`PATCH /data/shifts/<id>`**
  (`app/routes/data_shifts.py`) validate staff assignment (active staff
  in org, or `null` for an open shift), run the same conflict engine as
  the compute endpoint, and **reject hard conflicts with 409
  `{'error': 'conflict', conflicts: [...], warnings: [...]}` unless
  `?force=true`**. Success responses are `{shift, conflicts, warnings}`
  (201 on create). Note-only edits skip re-enforcement so force-created
  shifts stay editable.
- **`DELETE /data/shifts/<id>`** → 204.
- **`POST /compute/conflicts`** (`app/routes/compute_conflicts.py`) is
  pure and takes `{shifts: [{id?, staff_id?, starts_at, ends_at}]}`.
  Passing the shift's own `id` while editing makes the engine exclude
  the saved copy from double-booking/hours math
  (`app/conflicts.py:23-53`) — exactly what a live editor needs.
- **Conflict item shape** (`app/conflicts.py:_item`): `{type,
  shift_index, shift_id, staff_id, message, ...details}`. Hard types:
  `archived_staff`, `double_booking`, `blocked`, `max_hours`,
  `insufficient_rest`. Warning type: `outside_wishes`. Messages are
  English — the UI maps `type` to Swedish klartext (Decision 5).
- **`parse_instant`** (`app/api_utils.py`) requires ISO 8601 timestamps
  **with a timezone offset**. The frontend must therefore produce real
  instants from the org-timezone wall clock (Decision 4).
- **Week view** (`frontend/src/pages/Schedule.tsx`) already renders
  bars from `listShifts(period)` with `wallClock()` day-grouping, lane
  stacking, the coverage strip, and search dimming. Its empty state
  literally says "Passläggning kommer med schemaredigeraren (#9)".
- **UI kit**: `TimlaModal` + `FieldLabel`
  (`frontend/src/components/TimlaModal.tsx`), and `Button`, `Select`,
  `TextField`, `Callout`, `ConfirmModal` from `@swedev/ui` (usage
  patterns in `Staff.tsx` / `StaffDetail.tsx`, incl. `useMutation` +
  query invalidation).

### What's missing

1. `frontend/src/api.ts` has no shift mutations and no
   `computeConflicts`; its `ApiError` discards extra body keys, so the
   409's conflict list is currently unreachable.
2. `frontend/src/time.ts` has `wallClock(instant, tz)` but not its
   inverse — nothing converts "Tuesday 2026-07-14, minute 540, in
   Europe/Stockholm" into an ISO instant.
3. No editor UI, no entry points (the bars aren't clickable, there is
   no "Nytt pass" button).

### Key considerations

- **Overnight shifts**: the engine and the week view both support
  shifts that cross midnight (rendered "18:00–24:00 →", carry-in
  coverage on the next day). The editor must let a manager enter e.g.
  18:00–02:00; interpret end ≤ start as "ends next day" and say so in
  the UI (Decision 3).
- **DST**: `localInstant` must be correct across the Europe/Stockholm
  transitions; a naive `getTimezoneOffset()` approach silently breaks
  for managers travelling outside the org timezone (the same reason
  `wallClock` exists — see its doc comment).
- **Live-check lifecycle**: debounce, discard stale responses
  (out-of-order network), and only fire when the form parses to a
  valid proposal. Never block typing on a pending check.
- **Cache invalidation**: a shift moved to another day can also move to
  another ISO week (`starts_at` decides the period). Invalidate the
  whole `['shifts']` prefix, not just the current period.

## Implementation Steps

### Phase 1: API client, types and time helper

1. Extend `frontend/src/types.ts`
   - `ConflictItem` (`type`, `shift_index`, `shift_id`, `staff_id`,
     `message`, plus optional detail fields) and
     `ConflictResult { conflicts: ConflictItem[]; warnings: ConflictItem[] }`.
   - `ShiftWriteResult = { shift: Shift } & ConflictResult`.
   - Files to modify: `frontend/src/types.ts`
2. Extend `frontend/src/api.ts`
   - Give `ApiError` an `extra: Record<string, unknown>` (or a typed
     `conflicts`/`warnings` pair) populated from the remaining body
     keys, so a 409 carries its conflict list to the modal.
   - `createShift(payload, force?)` → `POST /data/shifts[?force=true]`
   - `updateShift(id, payload, force?)` → `PATCH /data/shifts/:id[?force=true]`
   - `deleteShift(id)` → `DELETE /data/shifts/:id`
   - `computeConflicts(shifts)` → `POST /compute/conflicts`
   - Files to modify: `frontend/src/api.ts`
3. Add `localInstant(isoDate: string, minute: number, timeZone: string): string`
   to `frontend/src/time.ts` — the inverse of `wallClock`, mirroring
   `app/weeks.py:local_instant` semantics
   - Implementation: start from a UTC guess
     (`Date.UTC(y, m-1, d, 0, minute)`), read it back through
     `wallClock`, and correct by the wall-clock difference (one
     repeat pass handles the DST-transition edge). Return
     `date.toISOString()`.
   - Minute may exceed 1440 (next-day ends): normalize date+minute
     before converting — keeps the overnight case in one code path.
   - **Fold policy — match the backend exactly**: `app/weeks.py`'s
     `local_instant` uses `zoneinfo` with the default `fold=0`, so an
     ambiguous autumn wall time (e.g. Europe/Stockholm 2026-10-25
     02:30, which occurs twice) resolves to the **first** occurrence
     (02:30 CEST → 00:30Z). Implement the correction pass so it lands
     on the earlier instant when both candidates match the wall clock,
     and document it. Spring-forward non-existent times resolve to the
     instant after the gap. Both cases get verification entries below.
   - Files to modify: `frontend/src/time.ts`

### Phase 2: ShiftModal component

4. Create `frontend/src/components/ShiftModal.tsx` — one modal for both
   create and edit, built on `TimlaModal` (icon square + footer band,
   same skin as the Personal modals)
   - Props: `open`, `onClose`, `period`, `tz`, `staff` (active only),
     `initial` (either `{ shift }` for edit or
     `{ isoDate, startMinute? }` presets for create).
   - Fields: **Personal** (`Select` — active staff sorted by name, plus
     an "Öppet pass" option mapping to `staff_id: null`), **Dag**
     (`Select` over the 7 days of the current week, klartext labels via
     `formatIsoDate`), **Tid** (start/end `TextField type="time"`,
     parsed with `timeToMinutes`), **Anteckning** (optional
     `TextField`).
   - Overnight: when the parsed end ≤ start, treat the end as
     next-day. Base the "Slutar nästa dag" hint on the **normalized**
     end (day offset + minute), not the raw comparison: end "00:00"
     parses to minute 1440 (`timeToMinutes(…, true)`, the established
     `time.ts` convention), so 18:00–00:00 doesn't satisfy `end ≤
     start` yet still ends on the next calendar day and must show the
     hint too.
   - Assignee options are the **active** staff plus, in edit mode, the
     shift's current assignee even when archived — rendered as a
     disabled-styled "{name} (arkiverad)" option that stays selected.
     Keeping it preserves note/time-only edits (the backend allows an
     unchanged archived `staff_id`); choosing anyone else is a normal
     reassignment. Archived staff are never offered for new shifts.
   - Client-side validity: both times parse (`!isNaN`), day chosen.
     Invalid forms disable Spara and pause live checking.
   - **Live conflict check**: `useEffect` over the parsed proposal,
     ~400 ms debounce, calls `computeConflicts([{ id: editingId,
     staff_id, starts_at, ends_at }])`; keep a request sequence number
     (or `AbortController`) and drop stale responses. Render results in
     a status area above the footer:
     - conflicts → red list (`Callout semantic="error"` or the
       stop-token styling), one row per item;
     - warnings → amber list (wait-token styling);
     - clean → a small "Inga konflikter" confirmation once a check has
       completed.
   - Swedish copy keyed on `type` (fallback to the server's English
     `message`): `double_booking` → "Krockar med ett annat pass",
     `blocked` → "Personen har markerat tiden som upptagen",
     `max_hours` → "Över maxtimmar för veckan", `insufficient_rest` →
     "För kort dygnsvila mot intilliggande pass", `archived_staff` →
     "Personen är arkiverad", `outside_wishes` → "Utanför önskade
     arbetstider". Include the server message's numbers where useful
     (hours/rest details).
   - **Save**: `useMutation` → `createShift`/`updateShift`. On success:
     invalidate the `['shifts']` prefix, close. On `ApiError` 409
     `code === 'conflict'`: stay open, show the returned conflicts, and
     switch the primary action to "Spara ändå" (destructive styling)
     which retries with `force = true`. Any edit to the form drops back
     to the normal Spara state.
   - **Delete** (edit mode only): "Ta bort pass" in the footer's left
     side via `ConfirmModal`, then `deleteShift` + invalidate + close.
     A 404 (someone else already deleted it) is treated as success:
     invalidate and close, no error surface.
   - Files to create: `frontend/src/components/ShiftModal.tsx`

### Phase 3: Wire into the week view

5. Update `frontend/src/pages/Schedule.tsx`
   - Modal state: `null | { mode: 'create', isoDate, startMinute? } |
     { mode: 'edit', shift }`.
   - Header: a primary `Button` "Nytt pass" (defaults to the week's
     Monday — or today when the current week is shown), placed in the
     header actions div next to the publication chip (the slot already
     reserved for #10/#11 buttons).
   - Shift bars become buttons: `onClick` opens edit mode. Keep the
     existing geometry/styling; add `cursor-pointer`, hover affordance
     and an `aria-label` ("Redigera pass, {name} {timeLabel}").
   - Day-row background click: open create mode prefilled with that
     day and the clicked hour (derive minute from `e.clientX` against
     the row's bounding rect — the inverse of `pct()` — rounded down
     to the hour). Bars call `stopPropagation`.
   - Empty state: replace the "kommer med #9" description with a
     "Skapa första passet" action button (the `action` prop already
     exists on `EmptyState`).
   - Pass the full staff list to the modal and let it filter to active
     assignees (plus the current archived assignee in edit mode, per
     Phase 2); the view continues rendering names on old shifts from
     the same list.
   - Files to modify: `frontend/src/pages/Schedule.tsx`

### Phase 4: Verification

6. Static checks: `npm run precommit` at the repo root (runs the same
   `lint` + `typecheck:frontend` + `build:frontend` as CI,
   `.github/workflows/ci.yml`); backend untouched but run `pytest`
   once to confirm nothing drifted.
7. End-to-end via the `verify` skill (seeded demo data) — scenarios in
   the checklist below, exercising create/edit/delete, live conflicts,
   the 409 → "Spara ändå" path, and an overnight shift.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/types.ts` | Modify | `ConflictItem`, `ConflictResult`, `ShiftWriteResult` |
| `frontend/src/api.ts` | Modify | Shift mutations + `computeConflicts`; `ApiError` carries the 409 conflict payload |
| `frontend/src/time.ts` | Modify | `localInstant(isoDate, minute, tz)` — DST-safe inverse of `wallClock` |
| `frontend/src/components/ShiftModal.tsx` | Create | Create/edit modal with debounced live conflict feedback, force-save and delete |
| `frontend/src/pages/Schedule.tsx` | Modify | Entry points (header button, bar click, row click, empty-state CTA), modal wiring, cache invalidation |

## Codebase Areas

List the primary directories/areas this plan touches (for conflict detection):
- `frontend/src/pages/` (Schedule.tsx)
- `frontend/src/components/` (new ShiftModal.tsx)
- `frontend/src/` (api.ts, types.ts, time.ts)

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. Modal editor, not drag-on-timeline
**Options:** A) TimlaModal form opened from clicks vs B) direct manipulation (drag-create/resize/move bars)
**Decision:** A
**Rationale:** The done-criterion only requires building a week's schedule without leaving the week view — a modal overlays the view and the grid updates in place. B is an order of magnitude more code (pointer capture, snapping, keyboard a11y, touch) for the same acceptance test, and no design file exists for it (the Arbetsschema design contains no editor). The click-to-prefill row interaction keeps most of B's speed. Drag can be a later issue.

### 2. Live checks send only the edited shift, with its `id`
**Options:** A) `computeConflicts` with the single proposed shift vs B) send the whole week's shifts each keystroke
**Decision:** A
**Rationale:** The engine loads all saved shifts, availability and rules server-side and, given the proposal's `id`, excludes the saved copy of the shift being edited — so a single-item call already detects double-bookings, max-hours and rest against everything saved. B adds payload and noise (irrelevant conflicts between untouched shifts) for zero extra signal, since the editor changes one shift at a time.

### 3. Overnight input: end ≤ start means "ends next day"
**Options:** A) end-time ≤ start-time rolls to the next day (with a visible hint) vs B) explicit "over midnight" toggle vs C) forbid overnight in the editor
**Decision:** A
**Rationale:** Matches how managers think ("kvällspass 18–02") and how the week view already renders it (bar to 24:00 with "→", carry-in coverage next day). C would regress data the engine and view support. B adds a control for something the times already express; the "Slutar nästa dag" hint gives the same clarity. End "00:00" follows the established minute-1440 convention in `time.ts`.

### 4. New `localInstant` helper in `time.ts` (Intl round-trip), no tz library
**Options:** A) hand-rolled inverse of `wallClock` via guess-and-correct against `Intl.DateTimeFormat` vs B) add a dependency (date-fns-tz / Temporal polyfill) vs C) let the backend accept naive local times
**Decision:** A
**Rationale:** C is off the table — `parse_instant` deliberately requires an offset, and availability-style wall-clock storage doesn't apply to shifts (they're stored as instants). B drags in a dependency for one function. A is ~10 lines reusing the already-proven `wallClock`, is exact across DST (one correction pass, mirroring `app/weeks.py` semantics), and keeps all timezone logic in the one documented module.

### 5. Swedish conflict copy mapped client-side from `type`
**Options:** A) map `type` → klartext Swedish in the frontend, falling back to the server `message` vs B) localize the backend messages
**Decision:** A
**Rationale:** The engine's English messages are shared API surface (tests, `/data/shifts` 409s, future consumers) — changing them is churn beyond this issue. The `type` enum is small and stable; the UI owns tone (Ton & röst klartext). Fallback to `message` keeps unknown future types visible instead of silent.

### 6. On 409, show server-returned conflicts and offer "Spara ändå"
**Options:** A) surface the 409 payload in the modal and re-submit with `?force=true` vs B) pre-check with compute and send `force=true` always once the user saw warnings
**Decision:** A
**Rationale:** The debounced live check can race a concurrent edit by another session; the write-time check is the authoritative one (it takes the per-staff advisory lock). B would silently force through conflicts the live check never showed. A keeps force an explicit, informed user action, exactly as the endpoint was designed (issue #5).

## Verification Checklist

- [ ] `npm run precommit` (root: lint + typecheck:frontend + build:frontend, mirrors CI) passes; `pytest` still green
- [ ] Create: "Nytt pass" from the header, from a day-row click (prefills day + hour) and from the empty-state CTA; new bar appears in the grid without a page reload
- [ ] Edit: clicking a bar opens the modal prefilled (staff, day, times, note); changing day/time/assignee saves and the bar moves; note-only edit on a force-saved shift still saves (no 409)
- [ ] Reassign: staff → "Öppet pass" and back; open bars keep the dashed red styling and coverage strip shows Lucka
- [ ] Delete: confirm dialog, bar disappears; a 404 (already deleted elsewhere) closes cleanly and refreshes
- [ ] Live conflicts: typing a time that double-books shows the red row within ~½ s without blocking input; fixing the time clears it; wishes-outside shows an amber warning but Spara stays enabled
- [ ] Editing an existing shift does **not** flag a double-booking against itself (`id` passed to compute)
- [ ] 409 path: two sessions racing (or a forced stale save) shows the returned conflicts and "Spara ändå" saves with `force=true`
- [ ] Overnight: 18:00–02:00 shows "Slutar nästa dag", renders as an 18:00–24:00 → bar with carry-in coverage after midnight; 18:00–00:00 (minute 1440) also shows the hint and saves as ending next-day 00:00
- [ ] DST fold: `localInstant('2026-10-25', 150, 'Europe/Stockholm')` (02:30 during fall-back) resolves to the **first** occurrence 00:30Z, matching `app/weeks.py`; spring-forward 2026-03-29 02:30 resolves to after the gap
- [ ] Week boundary: moving a shift to a day whose ISO week differs updates both weeks' views (prefix invalidation)
- [ ] Archived staff are never offered for new shifts; editing a shift whose assignee is archived shows "{name} (arkiverad)" preselected, and a note-only edit saves without unassigning or 409ing
- [ ] Timezone: with browser tz ≠ org tz (e.g. run browser in UTC), a shift created for "tisdag 09:00" lands on Tuesday 09:00 org time in the grid and in the DB
- [ ] Modal a11y: Escape closes, focus is trapped (Radix Dialog), bars are reachable/activatable by keyboard
