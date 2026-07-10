# Issue #42: StaffDetail: desired shifts/week, manager note, exception kind + provenance

**Based on:** main

## Summary

Brings the manager-side availability editor (StaffDetail) in line with the
availability v2 model from #40/#41: exception rows get the Kan inte / Kan
extra kind toggle, a free-text reason and an optional time range; the new
per-staff fields (`desired_shifts_per_week`, `availability_note`) become
viewable and editable; staff-entered exceptions get a provenance badge; and
the seed script exercises all the new fields. Frontend + seed only — the
backend contract shipped in #40.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Low |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-10
**Feedback:** Codex confirmed scope, ordering and file paths; applied its refinements — NaN-aware time validation and strict-int parsing for desired shifts, `updateStaff` import callout, per-staff state keyed on `staff.id`, DB-skip warning in verification, and #11 added to related issues.

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
