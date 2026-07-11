# Issue #11: Staffing needs + /compute/suggest-schedule v0 (stretch)

**Based on:** main

## Summary

First slice of "Timla builds the schedule for you": an org-level staffing
needs step curve (recurring weekday pattern + day-override dated
exceptions, wall-clock minutes like availability; new `staffing_need`
table, migration `0006`, `/data/staffing-needs`), true coverage in the #8
heat strip (`staffed − needed`, tooltip "13:00 · 2 av 3", "Öppet" chip
from the needs span; open shifts reinterpreted as utannonserade pass), and
a best-effort greedy pure `POST /compute/suggest-schedule` (single ISO
week) whose suggestions the draft-gated "Auto-schemalägg" button writes
through the existing enforced `/data/shifts` path. Acceptance: zero hard
conflicts per `/compute/conflicts` on seeded demo data. Splittable after
the needs+coverage half if MVP time runs short.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | High |

No blockers: all referenced issues (#2, #8, #9, #13, #40) are closed, and
no other open issue has a plan touching these files. Open #27 (schedule
color key) also touches `Schedule.tsx` — coordination point, not a
blocker. Stretch-goal framing means the generator half may slip post-MVP
without affecting anything else.

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-11
**Feedback:** Two codex passes. First pass: precise worst-point coverage
semantics, `configured` flag for the fallback gate, explicit best-effort
generator contract with iterative post-filter revalidation + recomputed
`uncovered`, single-ISO-week input, draft-gated apply, fully spelled-out
schema/API contracts, `app/needs.py` up front, interleaved tests, risk
raised to High — all applied. Second pass: full-day-only headcount-0
sentinel CHECK, needed=0 time is neutral (never "covered"),
event-boundary advance on no-candidate, confirm-not-disable gating —
applied. Skipped: removing template-mandated progress/research links and
the claim that the `verify` skill is unavailable (it exists).

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
