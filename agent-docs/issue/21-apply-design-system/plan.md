# Implementation Plan: Apply the Timla design system to the web app

## Summary

Wire Designsystem v1.0 (merged in `design/`, PR #24) into the frontend: color
tokens as CSS custom properties + Tailwind theme, self-hosted Hanken Grotesk +
IBM Plex Mono, logo/favicon assets, fixed status color roles, a Swedish
klartext time-format helper, and a restyle of the four existing views (Layout,
OrgGate, Staff, StaffDetail) so nothing looks like default Radix. The point is
that #8/#9 build on the right tokens from day one.

Two small enablers land upstream in `@swedev/ui` (our own WIP library,
`~/repos/ui`, published to npm as 0.2.0): `action` follows the Radix theme
accent instead of hardcoded blue, and DatePicker's react-day-picker vars
alias the Radix accent tokens. Both make the library's stated
per-deployment-branding promise actually hold, for every swedev project.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None (prerequisite "design package lands in `design/`" satisfied by PR #24) |
| **Blocks** | #8, #9 (soft — they *can* start without this, but the issue explicitly wants tokens first) |
| **Related issues** | #8 UI: week schedule view, #9 UI: shift editor, #3 Auth (all reference this design work); #22 landing, #23 motif (same design package, separate issues) |
| **Scope** | ~14 files in this repo: `frontend/` (incl. new `frontend/public/` with 5 copied SVGs) + root `package-lock.json`; **plus 2–3 files in `~/repos/ui`** (`src/theme/colors.ts`, `src/components/DatePicker/*`) released as `@swedev/ui` 0.3.0; no backend changes |
| **Risk** | Medium |
| **Complexity** | Medium |
| **Safe for junior** | No — the Radix/swedev token-override layer needs care; visual QA against the design doc requires judgment |
| **Conflict risk** | Low — only other plan (`6-ui-staff-management`) is done/merged; no open PRs |

### Triage Notes

- Issue is open, milestone MVP, project status already "Todo"; no parent
  issue, no blocker labels, no open PRs touching these files.
- Cross-repo sequencing: the `@swedev/ui` 0.3.0 changes must be built,
  published to npm and the Timla dep bumped **before** Timla's CI can go
  green (CI runs `npm ci` against the registry — a local `npm link` won't
  reach CI). Publishing needs explicit user approval. Fallback if
  publishing is inconvenient right now: the Timla-side scale overrides work
  against 0.2.0 too by additionally hijacking the blue scale — ugly but
  removable later.
- All design source material is in-repo: `design/Timla Designsystem.dc.html`
  (the authority), `design/README.md` (quick reference), `design/assets/*.svg`
  (production logo/favicon SVGs). A full spec digest with exact hex/px values
  is in [research.md](research.md).

## Analysis

### Current state

- `frontend/src/index.css` is a single line (`@import 'tailwindcss'`) — no
  tokens, no fonts, no favicon; `index.html` has title "Timla" only. The app
  renders in default Radix blue/gray with system fonts.
- Stack: Vite + React 19 + Tailwind 4 (CSS-first `@theme`) + Radix Themes 3 +
  `@swedev/ui` 0.2. Views: `Layout`, `OrgGate`, `EmptyState`, `Staff`,
  `StaffDetail`. npm workspace rooted at repo root (deps install from root,
  `npm ci` in CI).

### The central constraint: how theming reaches the components

`@swedev/ui` components take `semantic` props that are **hardcoded** to Radix
color scales (verified in `dist/index.js`):

| semantic | Radix scale |
|---|---|
| `action` | `blue` |
| `success` / `valid` | `jade` |
| `warning` | `amber` |
| `error` / `destructive` / `danger` / `invalid` | `red` |
| `info` | `sky` |
| `pending` | `purple` |
| `neutral` | `gray` |

`<Theme accentColor=...>` therefore does **not** restyle these components
today — even though the library's README promises exactly that
("per-organization branding"). Since `@swedev/ui` is our own WIP library
(`~/repos/ui`, npm 0.2.0, shared with Styrla/OpenVera), the right fix is
split in two:

**Upstream in `@swedev/ui` (→ 0.3.0):**

1. `src/theme/colors.ts`: `action` (the brand-accent semantic) maps to the
   **theme accent** instead of hardcoded `blue` — `getRadixColorForSemantic`
   returns `undefined` for `action`, and components that get no `color` prop
   inherit `<Theme accentColor>`, which is plain-Radix behavior. Return type
   widens to `RadixColor | undefined`; the `color = getRadixColorForSemantic(
   semantic)` assignment in each wrapper already tolerates `undefined`.
   Status semantics (`success`→jade, `warning`→amber, `error`→red, …) stay
   hardcoded — they are *semantic* scales and consumers rebrand them at the
   token level.
2. `src/components/DatePicker`: react-day-picker's stylesheet hardcodes
   `--rdp-accent-color: blue` and `--rdp-accent-background-color: #f0f0ff`;
   alias them (plus `--rdp-today-color`) to `var(--accent-9)` /
   `var(--accent-3)` / `var(--accent-11)` in `DatePicker.module.css` so the
   calendar follows the theme everywhere.

Behavior note for 0.3.0: `action` components shift from blue to the
consumer's accent (Radix default: indigo). Consumers that want the old look
set `accentColor="blue"`. Verify in Storybook; note in release notes.

**In Timla (this repo):** Radix Themes' documented token-override path —
redefine scale custom properties on `.radix-themes` in `index.css`. Nearly
all swedev CSS resolves through `var(--accent-*)`/scale vars (known
exceptions after Phase 0: Modal's white panel — fine, Timla's cards are
white — and ToggleButton's black inset shadow), so this rebrands every
component with zero TSX churn:

- Accent (via `accentColor="amber"`) → **ochre scale**: solid step 9 =
  `#E69A2E`, step 10 (hover) slightly darker, `--amber-contrast: #231D16`
  (ink text on ochre, per the "Bekräfta" primary button spec), steps 1–5
  from cream/honey tints, 11–12 text steps from `#c07f1e`/`#a5711a`.
  Amber doubles as `warning` — which is exactly right: Väntar **is** ockra
  in the design, so accent and wait sharing a scale is by design, not a
  collision.
- `jade` (success) → **skog**: 9 = `#4F7358`, tint bg `#e7efe8`, text 11/12 =
  `#3c5a44`.
- `red` (error/destructive) → **tegel**: 9 = `#C05A3A`, tint bg `#f7e6df`,
  text `#a44227`.
- `blue` is left alone — nothing hijacked, stays available for future use.
- `gray` (neutral + all chrome) → start from `grayColor="sand"` on `<Theme>`
  (Radix's warm gray, closest to the doc's warm neutral scale) and override
  the steps that matter visually: borders 6/7 → `#EFE3CD`/`#d8c19a`, text
  10/11 → `#8a7a5c`/`#5a4d38`, 12 → ink.
- Panel/background tokens: `--color-background: #FDF8EE` (paper),
  `--color-panel-solid: #FFFFFF` (cards).
- `radius="large"` on `<Theme>` + `--radius-factor` tuned so control radii
  land in the spec's 10–14 px band.

For each remapped scale, override the full set Radix components consume:
steps `1..12`, alpha `a1..a12`, and the functional tokens `--{scale}-surface`,
`--{scale}-indicator`, `--{scale}-track`, `--{scale}-contrast` — not just the
numbered steps, or soft/surface/progress states keep the old hue.

The DatePicker rdp vars are handled upstream (see above); swedev `Modal`
header/footer use `--gray-3` and inherit the warm gray automatically —
verify visually.

### Everything else

- **Fonts**: self-host via Fontsource (issue suggests it):
  `@fontsource-variable/hanken-grotesk` (one variable file covers 400–800)
  and `@fontsource/ibm-plex-mono` (400 + 500). Point both Tailwind
  (`--font-sans`, `--font-mono`) and Radix (`--default-font-family`,
  `--heading-font-family`, `--code-font-family`) at them.
- **Mono convention** ("siffror hoppar aldrig"): a tiny `<Mono>` component +
  the `font-mono` utility; all time/date/id/data rendering goes through it.
- **Time klartext**: extend `frontend/src/time.ts` with hand-rolled Swedish
  short-name arrays (deterministic — `Intl` sv-SE adds periods like "okt."
  that the design doesn't show) producing `tors 8 maj · 14:00` and en-dash
  ranges `09:00–17:00`. `intervalLabel` already uses en-dash; keep it.
- **Status roles**: a `STATUS` map in `frontend/src/status.ts` documenting
  the fixed roles (Bekräftad/ledig=skog→`success`, Väntar=ockra→`warning`,
  Avbokad/konflikt=tegel→`error`, Fullbokad/inaktiv=lera-grå→`neutral`) so
  badges today and time slots in #8/#9 mean the same thing. Current usages
  (`länk finns`=success, `arkiverad`=neutral) already fit the roles and get
  recolored by the token layer for free.
- **Brand**: copy `design/assets/` SVGs to `frontend/public/`; favicon +
  apple-touch-icon links in `index.html`; lockup in the Layout sidebar and on
  OrgGate (replacing the plain-text "Timla" headings). Wordmark is never
  re-typeset in CSS — always the SVG lockup (letter-spacing −3% baked in).

## Implementation Steps

### Phase 0: Upstream `@swedev/ui` 0.3.0 (in `~/repos/ui`)

1. `src/theme/colors.ts`: `action: undefined` (theme accent); widen the
   **map type and** return type to `RadixColor | undefined`; update the doc
   comment
2. `src/components/Callout/Callout.tsx`: `finalColor` is typed
   `RadixColor` and indexes the default-icon lookup — widen to
   `RadixColor | undefined` and guard the icon lookup, or the build breaks
   (only wrapper that doesn't tolerate `undefined`; Button/Badge/Checkbox/
   Switch/TextField/TextArea/Select/Slider/ProgressBar/Dropdown all pass
   optional color through fine — codex-verified)
3. `src/components/DatePicker/DatePicker.module.css`: alias
   `--rdp-accent-color`, `--rdp-accent-background-color`,
   `--rdp-today-color` (+ `--rdp-range_start-color`/`--rdp-range_end-color`
   → `var(--accent-contrast)` for future range mode) to Radix accent tokens.
   Selector must target the rdp root — `.DatePicker :global(.rdp-root)` —
   because react-day-picker defines the blue defaults on `.rdp-root` itself
   and the module CSS is imported before `react-day-picker/style.css`
4. Opportunistic leak fix while here: `Pagination.module.css` hardcodes
   `text-gray-400` → `var(--gray-9)` (Modal's `bg-white` and ToggleButton's
   black inset shadow are acceptable for now — note as known leaks)
5. Verify in Storybook (`npm run dev`) across **all semantic wrappers**
   (Button, Badge, Callout incl. default icon, Checkbox, Switch, TextField,
   Slider, ProgressBar) that `action` follows `accentColor`; DatePicker
   selected/today follow accent (range states aren't reachable via the
   public wrapper — `mode="single"` hardcoded — so the range aliases are
   verified by inspection only); `npm run build` + `npm test` green
6. Bump to 0.3.0, note the action-color behavior change in the release notes
7. **Ask the user** before committing/publishing (`npm publish`) — then bump
   `@swedev/ui` to `^0.3.0` in `frontend/package.json` (root `npm install`
   so the lockfile resolves the registry tarball, or Timla CI fails)
   - Files: `~/repos/ui/src/theme/colors.ts`,
     `~/repos/ui/src/components/Callout/Callout.tsx`,
     `~/repos/ui/src/components/DatePicker/DatePicker.module.css`,
     `~/repos/ui/src/components/Pagination/Pagination.module.css`,
     `~/repos/ui/package.json`

### Phase 1: Tokens & fonts (the foundation)

1. Add font dependencies to `frontend/package.json`
   - `@fontsource-variable/hanken-grotesk`, `@fontsource/ibm-plex-mono`,
     `@swedev/ui` → `^0.3.0`
   - `npm install` from repo root (workspace)
2. Build the token layer in `frontend/src/index.css`
   - `:root` custom properties exactly as the issue names them: `--ink`,
     `--ochre`, `--honey`, `--cream`, `--paper`, `--ok`, `--wait`, `--stop`,
     `--muted`, plus the warm neutral scale and tint pairs from research.md
   - Tailwind `@theme`: `--color-ink`, `--color-ochre`, `--color-honey`,
     `--color-cream`, `--color-paper`, `--color-ok`, `--color-wait`,
     `--color-stop`, `--color-mutedwarm`, border tints; `--font-sans`,
     `--font-mono`
   - `.radix-themes` scale overrides per the mapping table above
     (amber→ockra — serves both accent and warning — jade→skog, red→tegel,
     sand-gray tweaks, background/panel, font-family tokens, focus ring
     `0 0 0 3px rgba(230,154,46,.15)`)
   - `body { background: var(--paper); color: var(--ink); }`
   - Files: `frontend/src/index.css`, `frontend/package.json`
3. Theme props + font imports in `frontend/src/main.tsx`
   - `import '@fontsource-variable/hanken-grotesk'` + two plex-mono weights
   - `<Theme accentColor="amber" grayColor="sand" radius="large"
     panelBackground="solid">` — without `panelBackground="solid"` Radix
     panels default to translucent and the `--color-panel-solid` override
     never applies (swedev Modal reads `--color-panel`)
4. Add `<Mono>` in `frontend/src/components/Mono.tsx` (span with `font-mono`,
   accepts `className`)

### Phase 2: Brand assets

1. Copy `design/assets/{favicon.svg,app-icon.svg,timla-lockup.svg,timla-lockup-mono.svg,timla-lockup-cream.svg}`
   → `frontend/public/`
2. `frontend/index.html`: `<link rel="icon" href="/favicon.svg">`,
   `<link rel="apple-touch-icon" href="/app-icon.svg">`, keep title "Timla"
   - Files: `frontend/index.html`, `frontend/public/*`

### Phase 3: Helpers (time + status)

1. `frontend/src/time.ts`: add `WEEKDAY_SHORT` (`mån`…`sön`) and
   `MONTH_SHORT` (`jan`…`dec`) arrays + `formatDayDate(date)` →
   `tors 8 maj` and `formatDayDateTime(date)` → `tors 8 maj · 14:00`;
   also `formatIsoDate('2026-05-08')` for the API's `YYYY-MM-DD` strings
   (StaffDetail renders exception dates raw today) — parse the parts
   manually, **not** `new Date('YYYY-MM-DD')` which parses as UTC and can
   shift the displayed day; unit-style doc comments noting the klartext
   rule (never `8/5`, never "imorgon")
2. `frontend/src/status.ts`: `STATUS` map (role → semantic + Swedish label +
   token) with a comment tying it to design section 05; export a
   `statusBadgeProps(role)` helper for #8/#9 reuse
   - Files: `frontend/src/time.ts`, `frontend/src/status.ts` (new)

### Phase 4: Restyle existing views

1. `Layout.tsx`: sidebar gets cream/paper treatment — white or cream panel,
   1px `#EFE3CD` right border, lockup SVG (~120 px wide) instead of the text
   heading, nav active state = cream bg + ochre-brown text (ochre budget:
   the active indicator is the accent, not whole-row ochre), org id in
   `<Mono>`
2. `OrgGate.tsx`: paper background, centered white card (radius 16, border
   `#EFE3CD`, soft shadow `0 4px 20px rgba(90,60,20,.06)`), lockup on top,
   UUID input in `font-mono` (it's an id — mono rule), du-tilltal copy check
3. `EmptyState.tsx`: dashed warm border (`#d8c19a`), cream tint bg,
   muted text colors
4. `Staff.tsx`: table chrome inherits tokens; `Max h/v` numbers and the
   share-link badge stay semantic (recolored via tokens); numbers in
   `<Mono>`; copy check for du-tilltal ("kopierad!" ok)
5. `StaffDetail.tsx`: time inputs/labels in mono where they render times
   (`intervalLabel` output wrapped in `<Mono>`), exception dates through
   `formatIsoDate`, section headings sentence case, DatePicker visually
   verified after the rdp overrides; fix the status-role inconsistency:
   the `arkiverad` badge is `semantic="warning"` today but the role says
   inactive = lera-grå → change to `neutral` (matching Staff.tsx)
   - Files: the five component/page files above

### Phase 5: Verification

1. `npm run lint && npm run typecheck:frontend && npm run build:frontend`
2. Run the app against seeded data (verify skill: `.claude/skills/verify/SKILL.md`)
   and eyeball every view against `design/screenshots/` + the design doc:
   fonts actually load (network tab / rendered glyphs), favicon shows,
   statuses carry the fixed colors, ochre ≲10% of any surface, no
   default-Radix blue anywhere (incl. modals, checkbox, DatePicker, focus
   rings, table hover)
3. Grep for leftovers:
   `grep -rnE 'color="(blue|red|gray|amber|jade|sky|purple)"|--(gray|accent|blue)-|gray-[0-9]' frontend/src`
   — each hit should be either removed or intentional (Radix gray vars now
   resolve to warm sand); no raw Radix `color=` props should bypass the
   semantic layer

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/index.css` | Modify (bulk) | Tokens, Tailwind `@theme`, Radix scale overrides, fonts wiring, body base |
| `frontend/package.json` | Modify | Fontsource deps |
| `frontend/src/main.tsx` | Modify | Font imports, `<Theme>` props |
| `frontend/index.html` | Modify | Favicon, apple-touch-icon |
| `frontend/public/*.svg` | Create (copy) | Logo lockups, app icon, favicon from `design/assets/` |
| `frontend/src/components/Mono.tsx` | Create | The "siffror hoppar aldrig" convention |
| `frontend/src/time.ts` | Modify | Swedish klartext date/time formatting |
| `frontend/src/status.ts` | Create | Fixed status color roles for badges + future time slots |
| `frontend/src/components/Layout.tsx` | Modify | Sidebar restyle + lockup |
| `frontend/src/components/OrgGate.tsx` | Modify | Card restyle + lockup |
| `frontend/src/components/EmptyState.tsx` | Modify | Warm empty-state styling |
| `frontend/src/pages/Staff.tsx` | Modify | Mono data, token-consistent chrome |
| `frontend/src/pages/StaffDetail.tsx` | Modify | Mono times, `formatIsoDate`, `arkiverad` badge → neutral |
| `package-lock.json` (repo root) | Modify (generated) | Workspace lockfile picks up Fontsource deps + swedev bump |
| `~/repos/ui/src/theme/colors.ts` | Modify (other repo) | `action` → theme accent instead of hardcoded blue |
| `~/repos/ui/src/components/Callout/Callout.tsx` | Modify (other repo) | Tolerate `undefined` color; guard icon lookup |
| `~/repos/ui/src/components/DatePicker/DatePicker.module.css` | Modify (other repo) | rdp accent vars → Radix accent tokens (on `.rdp-root`) |
| `~/repos/ui/src/components/Pagination/Pagination.module.css` | Modify (other repo) | `text-gray-400` → gray token (theming leak) |
| `~/repos/ui/package.json` | Modify (other repo) | Version 0.3.0 |

## Codebase Areas

- `frontend/src/` (all of it — styling touches every view)
- `frontend/public/` (new assets)
- `~/repos/ui` — `src/theme/`, `src/components/DatePicker/` (separate repo,
  separate release)
- No backend (`app/`), migration, or docs changes

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. Fix the accent plumbing upstream in `@swedev/ui`; brand values via Radix scale-token overrides in Timla
**Options:** (A) Timla-only: override Radix scales incl. hijacking `blue` for
the action semantic vs (B) stop using swedev `semantic` props and pass
explicit Radix `color`/classNames everywhere vs (C) upstream: `action`
follows the theme accent + DatePicker follows accent tokens; Timla overrides
only the scales that carry brand *values* (amber/jade/red/sand).
**Decision:** C. (Revised from A when it surfaced that `@swedev/ui` is our
own WIP library at `~/repos/ui`.)
**Rationale:** `action` meaning "hardcoded blue" was always a bug relative to
the library's own per-deployment-branding promise — fixing it upstream
benefits Styrla/OpenVera too and spares Timla a hijacked blue scale (blue
stays usable). Status semantics stay hardcoded upstream because they are
semantic (success *is* the green role); their hue is a brand decision that
belongs in each consumer's token layer. B causes churn in every view and
loses semantics.

### 1b. `action` → `undefined` (inherit accent), not a configurable semantic map
**Options:** Return `undefined` for `action` so components inherit
`<Theme accentColor>` vs adding a `SemanticColorProvider`/config API to
remap any semantic per app.
**Decision:** `undefined`/inherit.
**Rationale:** One-line change with plain-Radix semantics; a config API is
new surface area no consumer needs yet — token-level overrides already remap
the status scales. Can be added later without conflicting with this.

### 2. Fontsource self-hosting with the variable Hanken Grotesk
**Options:** Google Fonts CDN vs Fontsource static weights vs
`@fontsource-variable`.
**Decision:** `@fontsource-variable/hanken-grotesk` + static
`@fontsource/ibm-plex-mono` 400/500.
**Rationale:** Self-hosted is what the issue asks for (privacy + offline dev).
The variable font is one file for all of 400–800 (the design uses five
weights); Plex Mono has no variable weight axis on Fontsource, and we only
need two weights.

### 3. Hand-rolled Swedish name arrays instead of `Intl.DateTimeFormat`
**Options:** `Intl` with `sv-SE` vs constant arrays in `time.ts`.
**Decision:** Constant arrays.
**Rationale:** The design shows `tors 8 maj` exactly; `Intl` sv-SE renders
some short months with trailing periods ("okt.", "jan.") and its output can
drift across ICU versions — the wrong shape for a hard visual rule.
`time.ts` already owns weekday names; this extends an existing pattern.

### 4. Keep `accentColor="amber"`/`grayColor="sand"` as the base layer under the overrides
**Options:** Default theme + override everything vs nearest built-in palette +
override the visible steps.
**Decision:** Nearest built-ins (`amber`, `sand`) + targeted overrides.
**Rationale:** Every scale step we don't explicitly override still renders
something warm and plausible instead of blue/cool gray — fewer invisible
regressions in states we forget to test (hover, alpha overlays, disabled).

### 5. Logo always as SVG lockup, never re-typeset
**Options:** Render "timla" wordmark with CSS (Hanken 800, −3% tracking) vs
use the production SVGs.
**Decision:** SVGs from `design/assets/`.
**Rationale:** The design doc treats the lockup as a fixed asset with clear-
space and minimum-size rules; re-typesetting invites drift and the assets
already exist.

## Verification Checklist

- [ ] App uses tokens/fonts/logo throughout; no default-Radix-looking view remains (issue "done when")
- [ ] Statuses follow the fixed color roles (skog/ockra/tegel/lera-grå) in badges
- [ ] Hanken Grotesk renders for UI text, IBM Plex Mono for all time/id/data (check UUID field, intervals, max h/v)
- [ ] Favicon + tab title correct; lockup in sidebar and OrgGate
- [ ] Time renders as `tors 8 maj · 14:00` style klartext where dates appear
- [ ] Ochre stays ~10% of any surface; tegel/skog appear only as status
- [ ] DatePicker, modals, checkboxes, table hover, focus rings all warm (no blue/purple leaks)
- [ ] `@swedev/ui` 0.3.0: Storybook shows action components + DatePicker following `accentColor`; build + tests green; published; Timla dep bumped
- [ ] `npm run lint`, `npm run typecheck:frontend`, `npm run build:frontend` green
- [ ] Existing flows still work end-to-end (staff CRUD, links, availability) via verify recipe
