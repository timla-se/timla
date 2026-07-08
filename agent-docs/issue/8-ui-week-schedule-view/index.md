# Issue #8: UI: week schedule view

**Based on:** main

## Summary

Read-only Arbetsschema week view per `design/Timla App - Arbetsschema
Strandkiosken.dc.html`: weekday rows × horizontal hour axis, shift bars in
a neutral tint behind a `colorKey` abstraction (the real key — org-defined
custom fields like Erfarenhet — is #27), per-hour coverage heat-strip,
week navigation on a deep-linkable `/schema/:week` route, and a
Publicerad/Utkast chip backed by a new `GET /data/publications` read
endpoint. Editing (#9), publish action
(#10) and auto-scheduling (#11) are out of scope; the Kalender design file
is the booking calendar (post-MVP) and stays untouched.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-07 (color-key decision revised twice per user: first to a fixed experience column, then to org-defined custom fields — split out as #27; #8 ships neutral-first with a colorKey hook)
**Feedback:** Codex approved the scope split and file paths. Applied: explicit org-timezone rule for all wall-clock math (API returns instants — new `wallClock` helper), publications route takes required `period` (not `resolve_period`) with 400-tests, overnight bars use effective end 1440, coverage semantics for open shifts spelled out, search state cleared on route change, error states + unknown-staff fallback, horizontal overflow guard, `docs/api.md` added, verification steps for open/archived states (seed lacks them), and triage notes corrected (design wording wins over issue body; opening hours covered by no issue yet).

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [research.md](research.md) - Design digest (Arbetsschema + Kalender, exact values)

## Related Issues

- #27 Custom staff fields — supplies the schedule color key (Erfarenhet/Nivå) later
- #9 UI: shift editor — builds directly on this view
- #10 Publish schedule — action lands next to this view's status chip
- #11 Auto-schemalägg — the mock's secondary button belongs there
- #14 Org settings — opening hours would upgrade the coverage strip & stat chip
- #21 Design system (merged) — tokens/shell this builds on
