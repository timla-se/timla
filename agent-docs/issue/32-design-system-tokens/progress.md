# Implementation Progress: Issue #32

**Started:** 2026-07-09
**Last updated:** 2026-07-09
**Status:** Completed (PR 1 scope: Phases 1–3)

## Completed Steps

- [x] Phase 1.1: index.css — status tints (`ok/stop/wait-soft/line/strong`, color-mix), warm neutrals (`warm-line`, `warm-line-strong`, `chip`, `band`, `paper-warm`, `warm-caption`), sidebar (`ink-raised`, `ink-raised-2`, `sidebar-muted`, `sidebar-faint`), coverage ramp (`cover-outside/gap/thin/two/ok`); `.btn-ink:hover` onto token
- [x] Phase 1.2: index.css — type scale (`--text-10/11/13/15/19/22/30`, font-size only — no line-height pair, so identical behavior to the `text-[Npx]` values replaced) + radius (`--radius-10/14/20`)
- [x] Phase 2.1–2.6: sweep — ~365 mechanical className replacements (auditable mapping script) + hand edits for style objects/const maps/SVG fills (SvarView TINT/CalCell/Legend/Stats, Schedule NEUTRAL_TINT/OPEN_TINT/COVERAGE/legend/gradient/open-fill, Layout+Lockup SVG `var()` fills, Avatar PALETTE → CSS vars, TimlaModal border)
- [x] Phase 2.7: `grep -rE '#[0-9a-fA-F]{3,8}' frontend/src --include='*.ts*'` → zero hits
- [x] Phase 3.1: eslint `no-restricted-syntax` guardrail (raw hex in any string/template; numeric `-[Npx]` arbitrary values in className) — verified firing on a scratch violation (2 flagged), clean otherwise
- [x] Phase 3.2: survivor pass — 9 flagged survivors converted; census down from ~330 to ~20, all genuine one-offs (shadows, grid templates, ch-widths, `var()` refs, `tracking-[.14em]`)
- [x] Verification: backend 91 pass; frontend lint + typecheck + build + precommit green; visual pass on `/svar` (mobile, full page — identical) and the sign-in screen

## Current Work

Complete for PR 1. Phases 4–5 (SegmentedControl/RangeSlider → `@swedev/ui`
0.5.0 + consumption) follow as their own PRs per plan DD5 — Phase 4 lives in
`~/repos/ui` and needs per-action approval for commit/push/publish.

## Notes

- Snapping judgment calls beyond the plan's table: `#b98a2e` (avatar gold) →
  `ochre-deep` (closer than the plan's wait-strong absorption); `#eeddb8` →
  new `wait-line`; `#f6e2b6` → new `wait-soft`; `#e0d4bd` → `sidebar-muted`;
  `#d8c8a6` → `warm-sand` (text) / `warm-border-strong` (borders);
  `text-[var(--gray-11)]` → `text-warm-gray`; overlay `rgb(35_29_22/0.42)` →
  `bg-ink/40`; `border-[1.5px]` → `border-2`.
- Type-token deviation from plan: no `--text-N--line-height` pairs — the
  arbitrary values being replaced set font-size only, so pairing line-heights
  would have changed rendering.
- Visual pass COMPLETE (updated): solved the Clerk automation gap via
  Clerk's dev-instance test account (`dev+clerk_test@timla.se`, verification
  code 424242, Turnstile passes with a click in a real browser) + an SQL
  org_user binding to the seeded org. Recipe recorded in
  `.claude/skills/verify/SKILL.md`. Verified live on this branch: Personal
  (sidebar/stat cards/chip tabs/band header/avatars), Arbetsschema (coverage
  heat ramp, legend, today column, shift bars), Ny medarbetare modal
  (rounded-20 panel, etikett labels, weekday chips, band footer), full-page
  `/svar` mobile, sign-in screen. All pixel-equivalent.
- Open-shift fill `rgb(232 183 165 / 0.35)` → `color-mix(in srgb,
  var(--color-cover-gap) 35%, transparent)`.
