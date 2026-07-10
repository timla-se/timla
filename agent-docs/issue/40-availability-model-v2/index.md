# Issue #40: Availability data model: full wish/block × recurring/dated matrix + non-destructive PUT

**Based on:** main

## Summary

Backend foundation for the availability v2 redesign: legalize dated wishes
("Kan extra") by dropping the `availability_wish_is_recurring` CHECK, make
both availability PUTs non-destructive per kind (omitted key = untouched,
`[]` = clear), accept `kind` + `note` on exception writes, stamp
`source` provenance (`staff`/`manager`), gate `outside_wishes` on recurring
wishes only, and add `staff.desired_shifts_per_week` +
`staff.availability_note`. One migration (`0003`) + route changes; fully
backward compatible, no frontend changes (#41/#42 consume this later).

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-09
**Feedback:** Codex judged the plan clear, correctly ordered, and accurately
anchored (migration head, live issue/PR state verified); it asked for a
`docs/api.md` contract-doc phase, explicit `{}`-no-op / explicit-`null`-400
presence tests, a stated deferral of frontend type updates to #41/#42, and
consistent empty-string→NULL normalization — all applied.

## Related Files

- [plan.md](plan.md) - Full implementation plan
