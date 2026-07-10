# Issue #41: SvarView v2: positive-only normal week + unified exceptions (Kan inte / Kan extra)

**Based on:** main

## Summary

Rewrites the login-free `/svar/:token` availability editor to the v2
design: the "Vill jobba" / "Kan inte" tabs are replaced by a single
positive normal-week day list (soft wishes only), a unified "Avvikelser
i perioden" section handles both "Kan inte" (dated block) and "Kan
extra" (dated wish) with reason, optional time range and an "Inlagt av
chefen" badge, and new "Önskat antal pass / vecka" + note-to-manager
fields are added. Saves send only the keys the phone owns (never
`blocks`), relying on #40's per-key PUT so manager-set recurring blocks
survive and render read-only in the overview calendar. Frontend-only;
closes #37 and #38 as designed-out side effects.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Low–Medium |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-10
**Feedback:** Codex review (gpt-5.5, xhigh) found no blockers; applied: concrete remove+re-add save algorithm for edited exceptions (`editedFromId` union/de-dup), read-only `recurringBlocks` kept in state and refreshed on save, exception date input constrained to the period (`schedule.from`–`schedule.to`), stepper bounds user input without clamping stored values, `Stat` widened for the "–" case, branch creation moved before edits, and #42 flagged as a soft `types.ts` coordination point.

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
