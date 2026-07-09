# Issue #7: UI: availability editor

**Based on:** main

## Summary

The staff-facing availability editor (mobile, no login, wishes + hard blocks
via the personal share link) and the manager-side editor already shipped
through issues #13 and #6; the conflict engine (#5) already respects the
registered data. This plan closes the remaining acceptance gap: an explicit
end-to-end test proving that availability registered through
`PUT /svar/:token/availability` produces `blocked` conflicts and
`outside_wishes` warnings from `/compute/conflicts` and is enforced on the
`/data/shifts` write path, plus a stale-copy fix in `StaffDetail.tsx` and a
manual phone-flow verification — then the issue can be closed.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Low |
| **Safe for junior** | Yes |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-09
**Feedback:** Codex confirmed scope and file paths; applied all five points — spelled out the org_user + X-Test-User auth setup for the new test, made test dates/instants derive from today + org-timezone wall-clock, relaxed warning assertions for blocked cases (blocked shifts may also warn `outside_wishes`), routed manual API verification through the backend test instead of unauthenticated curl, and replaced vague CI gates with the exact `npm run precommit` / alembic / pytest commands.

## Related Files

- [plan.md](plan.md) - Full implementation plan

## Related Issues

- #13 - Staff share-links (closed) — delivered the mobile editor surface
- #6 - UI: staff management (closed) — delivered the manager-side editor
- #4 - `/data` primitives for availability (closed)
- #5 - Conflict checking engine (closed) — respects wishes/blocks
- #9 - UI: shift editor with live conflict warnings (open) — surfaces the
  same engine in the editor UI; not a blocker for #7
