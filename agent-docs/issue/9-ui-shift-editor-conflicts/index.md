# Issue #9: UI: shift editor with live conflict warnings

**Based on:** main

## Summary

Make the Arbetsschema week view editable: a TimlaModal-based shift editor
(create, edit, reassign, delete) opened from a "Nytt pass" button, day-row
clicks and the shift bars themselves, with debounced live conflict feedback
from `POST /compute/conflicts` rendered inline before saving. Hard-conflict
409s from `/data/shifts` keep the modal open and offer "Spara ändå"
(`?force=true`). The backend (#4 CRUD, #5 conflict engine) is already
complete — this is frontend-only work across ~5 files, including a new
DST-safe `localInstant` helper in `time.ts`.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-09
**Feedback:** Codex confirmed the plan is clear, well-ordered and matches the code; applied all five suggestions: explicit DST fold policy (first occurrence, matching `app/weeks.py`), archived-assignee preservation in edit mode, next-day hint covering the end="00:00"/minute-1440 case, delete-404 treated as success, and CI-matching verification commands (`npm run precommit`).

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress (if exists)
- [research.md](research.md) - Research findings (if exists)

## Related Issues

- #8 - UI: week schedule view (closed) — the base view this makes editable
- #5 - API: /compute/conflicts (closed) — live-check + 409/force contract
- #10 - Publish schedule — shares the page-header action slot
- #11 - Staffing needs + suggest-schedule (stretch) — fills open shifts later
- #27 - Custom staff fields — supplies the bar color key later
- #7 - UI: availability editor — shares `time.ts` helpers
