# Issue #17: Labor cost: hourly wage per staff + monthly hours/cost summary

**Based on:** main

## Summary

Adds `hourly_wage` to staff (migration 0005 + `/data/staff` field), a pure
`POST /compute/labor-cost { period: "YYYY-MM" }` endpoint that sums
scheduled hours × wage per staff and org total (month = org timezone, a
shift belongs to the month it starts in), and a `Rapporter` page at
`/rapporter` (month picker, hours + cost per staff, org total, labeled
"schemalagda timmar"). Staff without a wage show hours but no cost.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |

No blockers: referenced issues #6 (staff management UI) and #2 (core data
model / week rule) are both closed. No open plans touch the same files.
Risk is Medium because of money math (Decimal rounding contract) and the
wage field's proximity to the unauthenticated `/svar` surface (guarded by
tests). Two decisions are made in the plan and should be confirmed at PR
time: labor cost reads **live shifts** (not publication snapshots), and
the **current wage applies retroactively** (no wage history in MVP).
Related context: the "Rapporter" nav placeholder already exists in
`Layout.tsx`; the existing `test_staff_rejects_unknown_fields` test uses
`hourly_wage` as its unknown-field example and must be updated.

## Plan Review

**Status:** Reviewed

**Reviewed:** 2026-07-10

**Feedback:** Codex review tightened the money/rounding contract
(Decimal quantize, `cost_complete`, known-cost subtotal), surfaced the
live-vs-published ambiguity and retroactive-wage limitation as explicit
documented decisions, and added frontend details (org-timezone default
month, `pageLabel()`, sv-SE formatting, NaN-safe wage input) plus broader
input-validation test coverage. Suggestion to switch to publication
snapshots was not adopted (issue's MVP bullet says "from shifts"); noted
as a confirm-at-PR-time question instead.

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
