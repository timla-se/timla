# Implementation Plan: Frontend: replace hardcoded hex + arbitrary Tailwind values with design-system tokens

## Summary

Two-part design-system cleanup. **Part A (this repo):** eliminate the ~193 raw
hex literals (6-digit + `#fff`-style shorthand) and collapse the ~330
arbitrary Tailwind `[…]` values in
`frontend/src` onto tokens — mapping roughly half of the hexes to `@theme`
tokens that already exist in `frontend/src/index.css`, adding a small set of
new `color-mix`-derived semantic tokens for the hand-tuned tints (following the
existing `--amber-a1…a7` precedent), and snapping type/radius/spacing onto an
agreed scale. Add an eslint guardrail so new raw hex / pixel-arbitrary values
in `className` fail lint. **Part B (`~/repos/ui` + this repo):** extract the
recurring hand-rolled primitives (segmented control, preset pill group,
dual-handle range slider) into `@swedev/ui` with Storybook stories, publish,
and refactor the app to consume them — so the tokens live inside components,
not at every call site. Part B lands as its own follow-up PR(s) after the
token groundwork.

Same look, sourced from tokens — this is not a redesign.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None (#13 staff share-links and #21 design system are both closed/merged) |
| **Blocks** | Nothing hard; all open UI-heavy issues (#7, #9, #10, #14, #17, #22, #26, #27, #29) benefit from landing after this so new code starts token-clean |
| **Related issues** | #13 (introduced the heaviest offenders in `/svar`), #21 (created the token layer this maps onto) |
| **Scope** | ~14 files in `frontend/src` + `eslint.config.js` in this repo; **plus** `~/repos/ui` (3 new component folders + barrel exports in `src/components/index.ts` — `src/index.ts` re-exports it — + version bump) published as `@swedev/ui` 0.5.0; no backend changes |
| **Risk** | Medium |
| **Complexity** | Medium |
| **Safe for junior** | No — snapping values to a scale needs visual judgment; Part B spans two repos and an npm publish |
| **Conflict risk** | Low — no other open plans exist (all `agent-docs/issue/*` plans belong to closed issues) |

### Triage Notes

- All five existing plan folders (`3`, `6`, `8`, `13`, `21`) correspond to
  closed issues — no working-tree conflicts expected.
- No `agent-docs/github/project.json` exists → no project-board fields to
  honor; no release-branch logic applies. Work branches off `main` as usual.
- The issue itself declares the component-extraction half "can land as its own
  follow-up PR(s) after the token/scale groundwork" — the phasing below takes
  that as the PR split.

## Analysis

### Current state (verified against the working tree)

**Token layer** (`frontend/src/index.css`): three tiers already exist —
`:root` named tokens (`--ink`, `--ochre`, `--ok`, `--stop`, `--warm-gray`, …),
`@theme` Tailwind utilities (`bg-paper`, `text-ink`, `text-warm-gray`,
`text-stop`, …, 15 colors total), and `.radix-themes` scale overrides where
amber→ockra, jade→skog, red→tegel, gray→sand, each with 12 solid + 12
`color-mix` alpha steps. Both app roots (`AuthedRoot` and the public
`SvarRoot` in `frontend/src/main.tsx`) mount `<Theme>`, so the Radix scale
vars are available on every page, including `/svar`.

**Hex census**
(`grep -roE '#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b' frontend/src --include='*.ts*'`):
~193 occurrences (61 distinct 6-digit values plus `#fff`/`#ffffff` shorthand,
which mostly maps to plain `white`/`bg-white`). Per file: `SvarView.tsx` 90,
`Schedule.tsx` 35, `Layout.tsx` 20, `Staff.tsx` 20, `Avatar.tsx` 16,
`TimlaModal.tsx` 6, `Lockup.tsx` 4, `SignInScreen.tsx`/`SignUpScreen.tsx` 1
each. They fall into four buckets:

1. **Exact `@theme` token matches** (~70 occurrences): `#8a7a5c`×20 =
   `warm-gray`, `#c05a3a`×8 = `stop`, `#231d16`×7 = `ink`, `#fbf1dc`×6 =
   `cream`, `#e69a2e`×6 = `ochre`, `#4f7358`×5 = `ok`, `#5a4d38`×2 =
   `ink-soft`, `#b39a6f`×2 = `warm-sand`, `#d8c19a`×3 = `warm-border-strong`,
   `#f2c14e` = `honey`, `#ffffff`×5 = plain `white`. Pure find-and-replace.
2. **Exact Radix-override step matches** (~30): `#e7efe8`×6 = jade-3,
   `#3c5a44`×6 = jade-11, `#cfe0d3`×2 = jade-5, `#f7e6df`×3 = red-3,
   `#a44227`×5 = red-11, `#a5711a`×2 = amber-11, `#e4d9c2`×7 = gray-6,
   `#eeddb8` = amber-6, `#efe3cd` = gray-4 (= `warm-border`). These are the
   ok/stop/wait tints the issue wants as **semantic** tokens — they should not
   be spelled `text-[var(--jade-11)]` at call sites.
3. **Hand-tuned tints with no token** (~35): borders `#ecdfc8`×14,
   chip/segmented background `#f2e8d5`×8, band background `#faf3e6`×5,
   captions `#a5936f`×7, sidebar shades `#2f271c`/`#3a3126`/`#8a7c64`/`#b6a98f`/
   `#e0d4bd`, calendar-cell tints `#dceee2`/`#f4dbd1`/`#e8b7a5`/…, coverage
   heat colors in `Schedule.tsx` (`COVERAGE` map), avatar palette in
   `Avatar.tsx`, plus a long tail of 1–2× near-duplicates of the above.
4. **Brand SVG fills** (`Lockup.tsx`, the logo in `Layout.tsx`): inline SVG —
   can reference CSS custom properties directly (`fill="var(--ochre)"`), so
   they need no guardrail exception.

**Arbitrary-value census** (`grep -rhoE "[a-z-]+-\[[^][]*\]"`): ~330 total.
Hot spots: `text-[…]` ≈ 115 across 20 distinct px sizes (9→34px, including
half-pixels 10.5/11.5/12.5/13.5/14.5/15.5), `rounded-[…]` ≈ 40 across
{2,9,10,11,12,14,17,20,22,30}px, `tracking-[…]` ≈ 23 across 8 values,
spacing (`p*/m*/gap`) ≈ 90 on odd px values (5,7,11,13,15,18,22,26,30,46),
`leading-[…]` ≈ 9, plus genuine one-offs (`grid-cols-[96px_1fr]`,
`w-[400px]`, `max-w-[34ch]`, `shadow-[…]`) that should stay arbitrary.

**Hand-rolled primitives** (Part B candidates), all currently inline:

- Segmented control: `TabButton` row in `SvarView.tsx` (~176–217, 300–311)
  and `FilterTab` row in `Staff.tsx` (~493) — same shape (tinted container,
  active white pill + shadow), built twice.
- Preset pill group: the Hela dagen/Morgon/Dag/Kväll chips in
  `SvarView.tsx` `RangeControl` (~403–435).
- `RangeSlider` in `SvarView.tsx` (~437–490): ~50 lines of custom pointer
  logic (snap to `STEP`, `GAP` min-span, track-owns-gesture), pure
  mouse/touch — **no keyboard access**.
- Round day token, collapsible day row, `Stat` tile, `LegendItem`,
  `CalCellView`, `PeriodOverview` — domain composites (see Design Decision 6).

**`@swedev/ui`** (`~/repos/ui`, v0.4.0, consumed as `^0.4.0`): Radix Themes 3
wrappers with a `semantic | color` discriminated-union prop pattern
(`src/theme/colors.ts` `getRadixColorForSemantic`), one folder per component
with colocated `.stories.tsx`, CSS Modules under `@layer swedev`, Vite library
build, Storybook 10 (`npm run dev` → port 6006), everything peer-dep'd.
Already ships `Badge`, `Button`, `ToggleButton`, `Switch`, `Slider` (thin
Radix wrapper), `Modal`, etc. Notably **Radix Themes 3 includes
`SegmentedControl`** and its `Slider` supports two-thumb ranges — both new
components can follow the library's standard "wrap + semantic props + CSS
module" strategy rather than porting bespoke logic.

### Key considerations

- The `/svar` page is mobile-first and login-free — it must stay visually
  identical in spirit; small snaps (12.5px→13px text, 9px→10px radius) are
  explicitly acceptable per the issue.
- Tailwind v4's spacing scale is dynamic (`py-1.25` = 5px works out of the
  box), so spacing needs **no new tokens** — just a snapping rule.
- Tailwind's automatic 50–950 shades don't exist for custom colors like
  `ok`/`stop`; hence the `color-mix` token approach mandated by the issue.
- Opacity modifiers (`bg-ok/12`) compose over whatever is behind them
  (transparent), while the current tints are opaque mixes toward paper/white.
  Use `/nn` only where the element sits on white/paper and the result reads
  identically; otherwise use the opaque `color-mix(... , var(--color-paper))`
  token.

## Implementation Steps

### Phase 1: Define the missing tokens and the scale (PR 1)

1. Add new semantic color tokens to `@theme` in `frontend/src/index.css`,
   `color-mix`-derived per the issue's convention. Proposed set (tune the
   percentages so each visually matches the hex it replaces — target values
   in comments):
   - Status tints:
     - `--color-ok-soft` ≈ `#e7efe8` (jade-3) — also absorbs `#dceee2`,
       `#eef4ef`, `#d8e4d2`; e.g. `color-mix(in srgb, var(--color-ok) 12%, white)`
     - `--color-ok-line` ≈ `#cfe0d3` (jade-5) — also `#bcd3c0`
     - `--color-ok-strong` ≈ `#3c5a44` (jade-11) — also `#2e4a38`;
       e.g. `color-mix(in oklab, var(--color-ok), black 22%)`
     - `--color-stop-soft` ≈ `#f7e6df` (red-3) — also `#f9ebe4`, `#f4dbd1`
     - `--color-stop-line` ≈ `#efcdbf`/`#e8b7a5` (red-4/5 band)
     - `--color-stop-strong` ≈ `#a44227` (red-11) — also `#a24327`
     - `--color-wait-strong` ≈ `#a5711a` (amber-11) — also `#8a5e14`,
       `#b98a2e`, `#c9a24a`
   - Warm neutrals (the issue's "1–2 border tokens" + the recurring surfaces):
     - `--color-warm-line: #ecdfc8` — hairline card/table border (14×);
       also absorbs `#f2e7cf`, `#f4ead2`, `#e6d8bd` (snap, don't tokenize each)
     - map `#e4d9c2` (7×) → existing `warm-border-strong`? No — it sits
       between `warm-border` and `warm-border-strong`; add
       `--color-warm-line-strong: #e4d9c2` (input/secondary borders)
     - `--color-chip: #f2e8d5` — segmented-control/chip background (8×)
     - `--color-band: #faf3e6` — table header/footer band (5×)
     - `--color-paper-warm: #fffaf0` — hover/today background (2×)
     - caption text `#a5936f` (7×): snap to existing `warm-sand` (`#b39a6f`)
       where it sits on white; keep one token `--color-warm-caption: #a5936f`
       only if the sweep shows the darker value is load-bearing on tinted
       bands (it usually is — decide once, apply everywhere)
   - Sidebar (dark-on-ink) shades, derived from ink:
     - `--color-ink-raised` ≈ `#2f271c` (`color-mix(in oklab, var(--color-ink), white 6%)`)
     - `--color-ink-raised-2` ≈ `#3a3126` (also used by `.btn-ink:hover` in
       `index.css` — switch that rule to the token)
     - `--color-sidebar-muted` ≈ `#b6a98f`, `--color-sidebar-faint` ≈ `#8a7c64`
   - Long-tail 1–2× values (`#cdbfa4`, `#c9bdaa`, `#c2b291`, `#d8c8a6`,
     `#e0d3ba`, `#e0d4bd`, `#cdbc9c`, `#c9b59a`, `#7a6a52`, `#6b5f4c`, …):
     snap to the nearest token above / existing neutral — do **not** mint a
     token per hex. Budget: ≲ 20 new tokens excluding the coverage-heat group
     (Phase 2.2), ≲ 25 total.

   **Derivation policy** (so the token file stays internally consistent):
   status-color tints/shades (`ok-*`, `stop-*`, `wait-*`, `ink-raised*`) are
   `color-mix`-derived from their base token — retheming the base recolors
   them. Warm neutrals (`warm-line`, `chip`, `band`, `paper-warm`,
   `sidebar-*`) are **canonical raw-hex tokens**: they extend the existing
   raw-hex neutral ramp in `:root` and are design-picked, not derivable.

   **Consolidated token table** (final say lives in the implementation; keep
   this table updated in the PR description):

   | Token | Derivation | Replaces (snapped hexes) | Used for |
   |-------|-----------|--------------------------|----------|
   | `--color-ok-soft` | color-mix(ok, white) | `#e7efe8` `#dceee2` `#eef4ef` `#d8e4d2` | want-day bg, ok badges, calendar want cell |
   | `--color-ok-line` | color-mix(ok, white) | `#cfe0d3` `#bcd3c0` | want-day borders |
   | `--color-ok-strong` | color-mix(ok, black) | `#3c5a44` `#2e4a38` | ok text on tints |
   | `--color-stop-soft` | color-mix(stop, white) | `#f7e6df` `#f9ebe4` `#f4dbd1` | cannot-day bg, stop badges |
   | `--color-stop-line` | color-mix(stop, white) | `#efcdbf` `#e8b7a5` | cannot-day borders, open-shift fill |
   | `--color-stop-strong` | color-mix(stop, black) | `#a44227` `#a24327` | stop text on tints |
   | `--color-wait-strong` | color-mix(wait, black) | `#a5711a` `#8a5e14` `#b98a2e` `#c9a24a` | wait/amber text on tints |
   | `--color-warm-line` | raw `#ecdfc8` | `#f2e7cf` `#f4ead2` `#e6d8bd` | hairline card/table borders |
   | `--color-warm-line-strong` | raw `#e4d9c2` | — | input/secondary borders |
   | `--color-chip` | raw `#f2e8d5` | — | segmented/chip backgrounds |
   | `--color-band` | raw `#faf3e6` | — | table header/footer bands |
   | `--color-paper-warm` | raw `#fffaf0` | — | hover/today background |
   | `--color-warm-caption` | raw `#a5936f` (or snap to `warm-sand`) | `#8a7c64` on light bg | mono captions on tinted bands |
   | `--color-ink-raised` | color-mix(ink, white ~6%) | `#2f271c` `#3a2f22` | sidebar raised surfaces |
   | `--color-ink-raised-2` | color-mix(ink, white ~10%) | `#3a3126` | sidebar hover, `.btn-ink:hover` |
   | `--color-sidebar-muted` | raw `#b6a98f` | `#c9bdaa` | sidebar secondary text |
   | `--color-sidebar-faint` | raw `#8a7c64` | `#6b5f4c` `#7a6a52` | sidebar icons/faint labels |
   | `--color-cover-*` (5) | raw (data-viz ramp) | `COVERAGE` map in `Schedule.tsx` | coverage heat bar |
2. Add type/radius tokens to `@theme` (see Design Decision 2):
   - `--text-10: 10px`, `--text-11: 11px`, `--text-13: 13px`,
     `--text-15: 15px`, `--text-19: 19px`, `--text-22: 22px`,
     `--text-30: 30px` (each with a `--text-N--line-height`) — plus snapping
     rules: 9/10.5→10 or 11, 11.5→11, 12.5→13 or 12, 13.5→13 or 14,
     14.5/15.5→15, 18→`text-lg`, 28/32/34→30 or keep one-off if load-bearing
     (the 34px confirmation check icon size is `size=` prop, not text).
   - `--radius-10: 10px` (buttons/inputs — matches the `.rt-Button`
     radius already in `index.css`) and `--radius-14: 14px` (the `/svar`
     card radius, 11×). Snap: 9/11→10, 12→`rounded-xl`, 2→`rounded-xs`,
     17/20/22→`rounded-full` where the element is pill/circle-shaped,
     30 (sheet top)→`rounded-t-3xl`.
   - Tracking: snap −.02/−.025/−.03em→`tracking-tight` (−0.025em),
     −.01em→drop, .02em→`tracking-wide`, .06em→`tracking-wider`,
     .08em→`tracking-widest`; keep `.14em` (single MENY label) arbitrary.
   - Leading: 1.5→`leading-normal`, 1.45→`leading-normal` or snug, 1.3→`leading-snug`,
     1.1/1.05→`leading-none` or keep one exact heading value arbitrary.
   - Spacing: **no tokens** — snap odd px to the nearest half-step
     (5→1 or 1.5, 7→2, 11→3 (or 2.75 where the 1px matters), 13→3 or 3.5,
     15→4, 18→4.5, 22→5.5, 26→6.5, 30→7.5, 46→11.5). Prefer whole/half
     steps; quarter steps only where the exact pixel is load-bearing.
   - Files to modify: `frontend/src/index.css`

### Phase 2: Sweep the files (PR 1, same PR as Phase 1)

Sweep file by file, mechanical buckets first, judgment calls per file.
Order by offender weight; after each file run `npm run lint && npm run
typecheck` in `frontend/` and eyeball the page.

1. `frontend/src/pages/SvarView.tsx` (64 hex + heaviest `[…]` user)
   - Bucket-1 replacements (`text-[#8a7a5c]`→`text-warm-gray`, etc.).
   - `TINT` map (want/cannot accent/bg/border), `TabHeader` badge map,
     `CalCellView` status colors, `LegendItem` args, `Stat` `color` prop,
     `Confirmation` tints → reference `var(--color-…)` strings or Tailwind
     classes; inline `style={{ background: accent }}` may keep receiving a
     CSS-var string (`'var(--color-ok)'`) — no raw hex.
   - Scale sweep per Phase 1 rules.
2. `frontend/src/pages/Schedule.tsx` (23 hex)
   - `NEUTRAL_TINT`/`OPEN_TINT` → ok/stop tokens.
   - `COVERAGE` heat map (`outside/gap/one/two/ok`): semantically load-bearing
     one-offs — define them as tokens (`--color-cover-gap`, `--color-cover-thin`,
     `--color-cover-two`, `--color-cover-ok`, `--color-cover-outside`) rather
     than snapping; they encode meaning, not decoration. (These may live as a
     small `/* coverage heat */` group in `@theme`.)
   - The repeating-linear-gradient hairlines (`#f4ead2`/`#f6ead0`) → warm-line
     tokens via `var()`.
3. `frontend/src/pages/Staff.tsx` (17 hex) — bucket-1 + `warm-line`/`chip`/
   `band` tokens; weekday-chip and filter-tab styling gets *simplified but not
   extracted* here (extraction is Phase 5).
4. `frontend/src/components/Layout.tsx` (18 hex) — sidebar ink-raised/muted
   tokens; logo SVG fills → `fill="var(--cream)"` / `fill="var(--ochre)"`.
5. `frontend/src/components/Avatar.tsx` (8 hex) — `PALETTE` entries become
   CSS-var strings (`{ bg: 'var(--ochre)', fg: 'var(--ink)' }`, …); the two
   non-token bronze/archived values snap to existing neutrals (`#c2b291`→
   `warm-sand`/`mutedwarm`, `#7a6a52`→`ink-soft` or one new token if the
   distinction matters for initials contrast).
6. `frontend/src/components/TimlaModal.tsx`, `Lockup.tsx`,
   `SignInScreen.tsx`, `SignUpScreen.tsx`, `Mono.tsx`, `EmptyState.tsx`,
   `pages/StaffDetail.tsx` — small; same treatment.
7. Verify zero raw hex remains:
   `grep -rE '#[0-9a-fA-F]{3,8}' frontend/src --include='*.tsx' --include='*.ts'`
   → expect no hits (index.css keeps its hex — it *defines* the tokens).

### Phase 3: Guardrail (PR 1)

1. Add to the frontend block of `eslint.config.js` (core rule, no new dep):
   - `no-restricted-syntax` with selectors flagging
     (a) any string/template literal containing `#[0-9a-fA-F]{3,8}` in
     `frontend/src/**/*.{ts,tsx}` except `index.css` (not lintable anyway)
     — message points to `index.css` `@theme`;
     (b) `JSXAttribute[name.name='className']` literals/templates matching
     `-\[\d` (px/number arbitrary values) — message points to the scale.
   - Keep (b) pragmatic: it will not catch every composed string; it exists
     to stop the common case. Genuine one-offs use an inline
     `eslint-disable-next-line` with a reason.
2. **Survivor pass before enforcing:** re-run the arbitrary-value census
   across all of `frontend/src` (including files with no raw hex, e.g.
   `components/OnboardingGate.tsx`, `pages/StaffDetail.tsx` — both carry
   `[…]` values) and for each survivor either (a) convert to a scale step,
   (b) annotate with a targeted `eslint-disable` + reason, or (c) narrow the
   rule selector if a whole category is legitimately arbitrary (e.g.
   `grid-cols-[…]`, `max-w-[…ch]`, `shadow-[…]`). List survivors in the PR
   description.
3. Run `npm run lint` from repo root; confirm the rule fires on a scratch
   `text-[#123456]` and passes clean otherwise.
   - Files to modify: `eslint.config.js`

### Phase 4: Extract primitives to `@swedev/ui` (PR in `~/repos/ui`)

Follow `AGENTS.md` "Adding a component" (folder + `.tsx` + `.stories.tsx` +
`index.ts`, barrel exports, semantic-union props, CSS Modules `@layer swedev`).

1. `SegmentedControl` — wrap Radix Themes `SegmentedControl.Root/.Item`
   (compound-component strategy, like Table/Select). Props: `items`
   (label + optional `LucideIcon` + optional count), `value`, `onValueChange`,
   `size`, `semantic | color`. CSS module recreates the Timla look via Radix
   vars (container `--gray-3`-ish chip, active white pill + shadow) so it
   themes per-deployment. Story: text-only, with icons, with counts.
2. `RangeSlider` — wrap Radix Themes `Slider` fixed to two thumbs:
   props `min`, `max`, `step`, `minGap` (**in value units**, i.e. minutes for
   the Timla use — converted internally to
   `minStepsBetweenThumbs = minGap / step`), `value: [number, number]`,
   `onValueChange`, `semantic | color`, optional `tickLabels`. CSS module
   restyles track/range/thumbs to the chunky mobile look (tall track, 22×30
   white handles, warm shadow) using Radix slider vars. This **replaces** the
   hand-rolled pointer logic and gains keyboard/ARIA support for free (see
   Design Decision 3). Story: default, custom step/minGap, semantic variants,
   disabled. Add a vitest for the min-gap unit conversion (15-min step,
   30-min gap → 2 steps between thumbs).
3. Export both from `src/components/index.ts` / `src/index.ts`; verify
   `npm run build` and Storybook (`npm run dev`).
4. Bump to `0.5.0`, `npm publish` (after the ui-repo PR merges; per-action
   approval from the user is required for commit/push/publish).

*(Scope note: a `Pills` primitive was considered and dropped — the preset
chips are its only consumer, and their semantics are shortcut buttons with a
derived highlight (drag the slider off a preset and no pill is active), not a
value-holding single-select. Per Design Decision 6's own bar they stay
app-local until a second consumer exists.)*

### Phase 5: Refactor consumers (PR 2 in this repo)

1. Bump `frontend/package.json` → `@swedev/ui@^0.5.0`, update lockfile.
2. `SvarView.tsx`: replace `TabButton` row with `SegmentedControl`
   (semantic via want/cannot) and the `RangeSlider` function with the library
   component (`min={DAY_MIN}` `max={DAY_MAX}` `step={STEP}` `minGap={GAP}` —
   minGap is in value units/minutes; constants stay in
   `frontend/src/ranges.ts`; delete the local slider + its styles). The
   preset chips stay as an app-local component on tokens (see Phase 4 scope
   note + Design Decision 6).
3. `Staff.tsx`: `FilterTab` row → `SegmentedControl` (with counts).
4. Keep domain composites (`DayRow`, `PeriodOverview`, `CalCellView`,
   `Stat`, `LegendItem`, `ExceptionList`, confirmation sheet) in the app,
   now free of raw values (done in Phase 2).
5. Verify no inline color/size specs remain where a component now owns them;
   re-run the Phase 2.7 grep and the lint guardrail.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/index.css` | Modify | New `color-mix` semantic tokens, coverage-heat tokens, `--text-*`/`--radius-*` scale entries; `.btn-ink:hover` onto token |
| `frontend/src/pages/SvarView.tsx` | Modify | Heaviest sweep (64 hex, most `[…]`); Phase 5: consume SegmentedControl/RangeSlider |
| `frontend/src/pages/Schedule.tsx` | Modify | Sweep; coverage heat map onto named tokens |
| `frontend/src/pages/Staff.tsx` | Modify | Sweep; Phase 5: FilterTab → SegmentedControl |
| `frontend/src/pages/StaffDetail.tsx` | Modify | Scale sweep (no raw hex) |
| `frontend/src/components/Layout.tsx` | Modify | Sidebar ink-raised/muted tokens; logo SVG fills → `var()` |
| `frontend/src/components/Avatar.tsx` | Modify | Palette → CSS-var references |
| `frontend/src/components/TimlaModal.tsx` | Modify | Sweep (border/band tokens) |
| `frontend/src/components/Lockup.tsx` | Modify | SVG fills → `var()` |
| `frontend/src/components/SignInScreen.tsx` | Modify | Sweep (1 hex + scale) |
| `frontend/src/components/SignUpScreen.tsx` | Modify | Sweep (1 hex + scale) |
| `frontend/src/components/OnboardingGate.tsx` | Modify | No raw hex, but carries `[…]` values — Phase 3 survivor pass |
| `eslint.config.js` | Modify | `no-restricted-syntax` guardrail: raw hex + numeric arbitrary values |
| `frontend/package.json` (+ root `package-lock.json`) | Modify | Phase 5: bump `@swedev/ui` to ^0.5.0 |
| `~/repos/ui/src/components/SegmentedControl/*` | Create | Wrapper + CSS module + story + index |
| `~/repos/ui/src/components/RangeSlider/*` | Create | Two-thumb Radix Slider wrapper + CSS module + story + index |
| `~/repos/ui/src/components/index.ts`, `src/index.ts` | Modify | Barrel exports |
| `~/repos/ui/package.json` | Modify | 0.4.0 → 0.5.0 |

## Codebase Areas

- `frontend/src/` (pages, components, index.css)
- `eslint.config.js` (repo root)
- `~/repos/ui/src/components/` (separate repo, `@swedev/ui`)

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. New tints as `color-mix` semantic tokens in `@theme`, not call-site Radix vars
**Options:** (a) `@theme` tokens (`--color-ok-soft`) per the issue's convention; (b) reference Radix steps at call sites (`bg-[var(--jade-3)]`); (c) raw-hex tokens.
**Decision:** (a).
**Rationale:** The issue mandates the `color-mix` convention; `@theme` tokens generate real Tailwind utilities (`bg-ok-soft`) usable in `className` everywhere, stay derived from the base status colors (retheme-able), and don't leak Radix scale names into app code. Radix vars remain the implementation detail behind `.radix-themes`.

### 2. Additive numeric type/radius tokens (`text-13`, `rounded-10`) instead of overriding Tailwind's semantic names
**Options:** (a) override `--text-sm` etc. to the design's sizes; (b) add numeric px-named tokens alongside the defaults.
**Decision:** (b).
**Rationale:** Overriding `text-sm`/`text-xs` silently reflows every existing use (including places that already read correctly) and diverges from what any Tailwind-literate reader expects the utility to mean. Numeric names are self-documenting, keep the diff local to lines being touched anyway, and make the "handful of steps the design actually uses" explicit. If the set later stabilizes, renaming to semantic steps is a mechanical follow-up.

### 3. `RangeSlider` wraps Radix Slider (two thumbs) rather than porting the custom pointer logic
**Options:** (a) port the ~50-line pointer implementation into the library; (b) wrap Radix Themes `Slider` with `minStepsBetweenThumbs` + heavy CSS restyle.
**Decision:** (b), with (a) as fallback only if the "track owns the gesture / nearest handle follows" feel cannot be acceptably approximated.
**Rationale:** The hand-rolled slider has zero keyboard/ARIA support — a real accessibility gap on the only public-facing page. Radix provides thumbs, keyboard, touch, and min-gap semantics for free, and wrapping Radix is `@swedev/ui`'s documented house strategy. The visual identity lives in CSS either way.

### 4. Guardrail via core `no-restricted-syntax`, no new eslint plugin
**Options:** (a) core `no-restricted-syntax` selector regexes; (b) add a plugin (e.g. eslint-plugin-regex / custom rule package); (c) a grep-based CI script.
**Decision:** (a).
**Rationale:** Zero new dependencies, lives in the existing flat config, and errors show inline in editors. It won't catch every dynamic string — acceptable: the goal is stopping the default failure mode (pasting mockup hex), not building a bulletproof scanner.

### 5. PR split: tokens+sweep+guardrail (PR 1, this repo) → primitives (PR, ui repo) → consumption (PR 2, this repo)
**Options:** one mega-PR vs. staged PRs.
**Decision:** Staged, matching the issue's own suggestion.
**Rationale:** PR 1 is large but mechanical and independently valuable (single source of truth + regression guard). The ui-repo work has its own review/publish cycle. PR 2 is then a small, high-signal refactor. Squash-merge policy keeps history clean per repo.

### 6. Domain composites stay in the app
**Options:** extract everything the issue lists (including day Token, collapsible row header) vs. only the clearly generic three.
**Decision:** Extract `SegmentedControl` and `RangeSlider` now; keep the preset pills, `CalCellView`/day token, collapsible `DayRow` header, `Stat`, `LegendItem` as app-local components built on tokens.
**Rationale:** The issue's own split says domain composites stay in `frontend/src`. The extraction bar is "generic + a second consumer exists or clearly will": `SegmentedControl` has two consumers (SvarView tabs, Staff FilterTab) and a Radix primitive behind it; `RangeSlider` earns its place on a11y (the hand-rolled slider has no keyboard support). The preset pills fail that bar — one consumer, and semantically shortcut buttons with a derived highlight rather than a value-holding single-select (the issue listed them as an example, but an example is not a requirement). The round day token and the collapsible row are entangled with Timla availability semantics. All are candidates for later extraction once a second consumer exists.

### 7. Coverage heat colors become their own token group
**Options:** snap `Schedule.tsx`'s `COVERAGE` map onto ok/stop tints vs. dedicated tokens.
**Decision:** Dedicated `--color-cover-*` tokens.
**Rationale:** They're a sequential data-viz ramp (gap→thin→two→ok), not decorative tints — meaning-bearing "fixed roles" in the same sense as `--ok`/`--stop`. Snapping them onto status tints would blur the distinction the design intentionally draws.

## Verification Checklist

- [ ] `grep -rE '#[0-9a-fA-F]{3,8}' frontend/src --include='*.tsx' --include='*.ts'` returns nothing (PR 1)
- [ ] Arbitrary-value census materially reduced; remaining `[…]` are genuine one-offs (grid templates, ch-widths, single shadows) — re-run the census grep and list survivors in the PR description
- [ ] `npm run lint` (root) passes, including the new guardrail; guardrail demonstrably fires on a scratch `text-[#123456]`
- [ ] `cd frontend && npm run typecheck && npm run build` green
- [ ] Visual pass via `.claude/skills/verify/SKILL.md` recipe: `/staff`, `/staff/:id`, `/schema/:week`, modals, and the public `/svar/:token` page (mobile viewport) — same look as before, no color/spacing regressions beyond agreed snaps
- [ ] Schedule coverage heat bar, today-column highlight, and open-shift dashed style intact
- [ ] Avatar initials colors still deterministic and legible
- [ ] `~/repos/ui`: `npm run build` green; Storybook renders SegmentedControl/RangeSlider stories incl. variants (Phase 4)
- [ ] RangeSlider: keyboard operation (arrow keys move focused handle, min-gap enforced), snap to 15 min, min 30 min span; touch drag on mobile viewport (Phase 4/5)
- [ ] `/svar` flow end-to-end after Phase 5: toggle days, presets, slider, exceptions, save → no behavioral change (`mergedRecurring` dirty-tracking untouched)
- [ ] `@swedev/ui` 0.5.0 published; app consumes it; no local slider/tab code remains in `SvarView.tsx`
