# Issue #32: Frontend: replace hardcoded hex + arbitrary Tailwind values with design-system tokens

**Based on:** main

## Summary

Replace the ~193 raw hex literals and ~330 arbitrary Tailwind `[…]` values in
`frontend/src` with design-system tokens: map the half that already have
`@theme` tokens, add a small set of `color-mix`-derived semantic tokens
(`ok-soft`, `stop-strong`, warm-line, chip/band, …) for the hand-tuned tints,
snap type/radius/spacing onto an agreed scale, and add an eslint guardrail
against regressions (PR 1). Then extract the recurring hand-rolled primitives
— `SegmentedControl` and `RangeSlider` (two-thumb, keyboard-accessible via
Radix) — into `@swedev/ui` (~/repos/ui) with Storybook stories, publish
0.5.0, and refactor `SvarView`/`Staff` to consume them (follow-up PRs). A
`Pills` primitive was considered and dropped: single consumer (the time-preset
chips), shortcut-button semantics — stays app-local per Design Decision 6.
Same look, sourced from tokens; not a redesign.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-09
**Feedback:** Codex found the plan clear with correct phase ordering; fixes applied: corrected hex census (~193 incl. `#fff` shorthand, updated per-file counts), added a consolidated token table with an explicit derivation policy (color-mix for status tints, canonical raw hex for warm neutrals), added a guardrail survivor pass covering `OnboardingGate`/`StaffDetail`, resolved the RangeSlider `minGap` unit ambiguity (value units, internal step conversion + vitest), and expanded the related open-issue list.

## Related Files

- [plan.md](plan.md) - Full implementation plan

## Related Issues

- #13 - Staff share-links (closed) — introduced the heaviest offenders (`SvarView.tsx`)
- #21 - Apply the Timla design system (closed) — created the token layer this maps onto
