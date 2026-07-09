# Implementation Progress: Issue #9

**Started:** 2026-07-09
**Last updated:** 2026-07-09
**Status:** Completed

## Completed Steps

- [x] Phase 1, Step 1: Extend `types.ts` — `ConflictItem`, `ConflictResult`, `ShiftWriteResult`
- [x] Phase 1, Step 2: Extend `api.ts` — shift mutations + `computeConflicts`; `ApiError` carries the 409 conflict payload
- [x] Phase 1, Step 3: Add `localInstant(isoDate, minute, tz)` to `time.ts` (DST-safe inverse of `wallClock`) — verified byte-for-byte against `app/weeks.py:local_instant` across summer/winter, autumn fold, spring gap, and end-of-day 1440
- [x] Phase 2, Step 4: Create `ShiftModal.tsx` — create/edit modal with live conflict feedback, force-save, delete
- [x] Phase 3, Step 5: Wire into `Schedule.tsx` — header button, bar click, row click, empty-state CTA, cache invalidation
- [x] Phase 4, Step 6: Static checks — `precommit` (lint + typecheck + build) green; `pytest` 91 passed
- [x] Phase 4, Step 7: End-to-end verification via the `verify` skill (browser-driven against seeded Demo Bistro)

## Current Work

Done. All phases implemented and verified. Changes live on branch
`issue/9-ui-shift-editor-conflicts` (no commit — invoked without `--commit`).

## Notes

- Backend is already complete (#4 CRUD + #5 conflict engine); this is frontend-only.
- 409 body shape confirmed from `app/api_utils.py:api_error_response` +
  `app/routes/data_shifts.py:_enforce_conflicts`: `{error: 'conflict',
  message, conflicts: [...], warnings: [...]}`.
- `localInstant` mirrors `app/weeks.py:local_instant` fold semantics
  (fold=0 → first occurrence on autumn fall-back); verified byte-for-byte
  across summer/winter, autumn fold, spring gap, and end-of-day 1440.

### End-to-end results (browser drive, 2026-W28 seeded)

- Schedule renders on the new bundle; shift bars are edit buttons; "Nytt pass"
  present; overnight shift renders as "18:00–24:00 →".
- Create from header defaults to today; empty-week CTA "Skapa första passet"
  defaults to the week's Monday; the old "(#9)" empty-state text is gone.
- Live conflict check fires debounced: an overlapping shift shows
  "Krockar med ett annat pass" (double_booking klartext).
- 409 → "Passet krockar" + "Spara ändå"; force-save succeeds and the grid
  refreshes in place (React Query `['shifts']` prefix invalidation).
- Edit is prefilled and passes the shift's own id — no self double-booking.
- Overnight 18:00–02:00 shows "Passet slutar nästa dag."; the write-time
  check surfaced a hard `insufficient_rest` (Decision 6) with Swedish detail
  "(4 h vila, minst 11 h)" while `outside_wishes` stayed a soft warning.
- Delete opens a ConfirmModal; confirming removes the bar and refreshes.
- Console clean except the expected Clerk dev-keys warning.
- Note: the eslint `eqeqeq` rule required `!== undefined` over `!= null`
  (the optional conflict-detail fields are `number | undefined`, never null).
