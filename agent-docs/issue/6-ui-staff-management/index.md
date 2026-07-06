# Issue #6: UI: staff management

**Based on:** main

## Summary

Manager-facing staff management: roster CRUD, share-link generation/copy/regeneration, and manager-side availability editing. First real frontend work — also establishes the frontend foundation (API client with interim org gate, app shell, shared form components) that #7–#10 and #14 reuse. Includes one small backend addition: `POST /action/staff/:id/regenerate-link`.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes (done-when's "working share link" fully demonstrable first when #13 ships the public link view) |
| **Risk** | Low |
| **Safe for junior** | Yes |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-06
**Feedback:** Codex review applied: added the missing Vite proxy step for /data//compute//action (would have blocked all browser E2E), made the availability save a single PUT of both arrays to avoid wiping the sibling section, specified the StaffDetail fetch strategy (list + find, no GET-by-id exists), @swedev/ui styles import, exact verify commands, token-uniqueness retry, and softened triage from "blocked by #13" to "acceptance depends on #13".

## Related Files

- [plan.md](plan.md) - Full implementation plan

## Related Issues

- #13 - Staff share-links (partial blocker: public `/link` view; regenerate endpoint moves here)
- #3 - Auth (replaces the dev org gate)
- #7 - Availability mobile view (reuses IntervalRow/minute helpers)
- #14 - Org settings (shares layout)
- #17 - Hourly wage (adds wage field to these forms later)
