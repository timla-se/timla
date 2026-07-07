# Issue #21: Apply the Timla design system to the web app

**Based on:** main

## Summary

Wire Designsystem v1.0 (`design/`, merged in PR #24) into the frontend:
Timla color tokens as CSS custom properties + Tailwind theme, self-hosted
Hanken Grotesk + IBM Plex Mono with a `<Mono>` convention, logo/favicon
assets, fixed status color roles, Swedish klartext time formatting, and a
restyle of Layout, OrgGate, Staff and StaffDetail. Accent plumbing is fixed
upstream in `@swedev/ui` 0.3.0 (`~/repos/ui`, our own library): `action`
follows `<Theme accentColor>` instead of hardcoded blue, DatePicker follows
accent tokens. Brand values (ochre/skog/tegel/warm gray) land as Radix
scale-token overrides in one Timla CSS file — this gives #8/#9 the right
tokens from the start.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-07 (two rounds)
**Feedback:** Round 1 (Timla-only approach): fuller scale-token coverage, `formatIsoDate` for API `YYYY-MM-DD` dates (UTC-parse pitfall), StaffDetail `arkiverad` badge warning→neutral, broader leftover-grep, scope corrections. Round 2 (after pivoting the accent fix upstream into @swedev/ui): Callout must be widened to tolerate `undefined` color (build-breaker), rdp vars must be set on `.rdp-root` not the wrapper, `panelBackground="solid"` needed on Theme, Pagination gray leak fixed opportunistically, Storybook verification broadened to all semantic wrappers; cross-repo publish sequencing confirmed sensible.

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [research.md](research.md) - Designsystem v1.0 spec digest (exact hex/px values)

## Related Issues

- #8 UI: week schedule view — builds on these tokens (calendar rules in research.md)
- #9 UI: shift editor — same
- #3 Auth and organization onboarding — auth screens designed in the same package
- #22 / #23 — landing page and motif from the same design package, out of scope here
