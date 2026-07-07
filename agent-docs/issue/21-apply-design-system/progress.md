# Implementation Progress: Issue #21

**Started:** 2026-07-07
**Last updated:** 2026-07-07
**Status:** Completed (@swedev/ui 0.3.0 published; awaiting Timla commit/PR approval)

## Completed Steps

- [x] Phase 0: Upstream `@swedev/ui` 0.3.0 (`~/repos/ui`): action→accent (`colors.ts`), Callout tolerates undefined color, DatePicker rdp vars → accent tokens, Pagination gray-leak fix, version bumped to 0.3.0, build + tests green. **Not committed/published — awaits user approval.**
- [x] Phase 1: Tokens & fonts — Fontsource deps installed, `index.css` token layer (`:root`, `@theme`, Radix scale overrides amber/jade/red/gray, warm shadows, warm focus ring), `main.tsx` Theme props (`accentColor="amber" grayColor="sand" radius="large" panelBackground="solid"`) + font imports, `<Mono>` component
- [x] Phase 2: Brand assets — 5 SVGs to `frontend/public/`, favicon + apple-touch-icon + theme-color in `index.html`
- [x] Phase 3: Helpers — `time.ts` klartext formatters (`formatDayDate`, `formatDayDateTime`, `formatIsoDate` with manual parse), `status.ts` role map
- [x] Phase 4: Restyle — Layout (lockup, cream active nav, mono org id), OrgGate (white card + lockup, mono UUID input), EmptyState (warm dashed), Staff (mono contact/hours), StaffDetail (mono times, `formatIsoDate` for exception dates, arkiverad badge warning→neutral, mono time inputs)
- [x] Phase 5: Verification — lint/typecheck/build green; app driven via browser against seeded data: OrgGate/Staff/StaffDetail/modal/DatePicker all warm (fonts confirmed via computed styles: Hanken Grotesk Variable + IBM Plex Mono; action button #E69A2E/ink; jade badge renders skog tint; rdp accent #e69a2e through the portal); SPA routes/JSON 404s/cache headers per verify recipe; leftover-grep clean (all hits intentional); `npm run precommit` green

## Current Work

Done. Working tree on `issue/21-apply-design-system` (Timla) + uncommitted changes in `~/repos/ui`.

## Follow-up rounds (same branch)

- **Review feedback round** (commit `aeab3fc`): font-mono layer fix, inline `<Lockup>`, apple-touch-icon PNG, year in `formatDayDate`.
- **Design feedback round** (@swedev/ui 0.4.0, unpublished): checkbox first-line alignment (1lh), ghost-button box tokens, modal chrome, Badge `dot` — plus the discovery that `@layer swedev` always loses to Radix's unlayered CSS (box rules moved out of the layer).
- **"Timla App - Personal" design** (design/Timla App - Personal.dc.html): implemented exactly — ink sidebar shell with topbar (breadcrumb/search/konto), stat cards, filter tabs, new table layout (avatar/email, arbetstider from availability, timmar from `/data/shifts`, status pills, ⋯-dropdown), `TimlaModal` chrome + Ny medarbetare modal where day chips write real availability wishes and "Skapa delningslänk" mints the share link. New backend endpoint `GET /data/org` (+ test) for the org name. Skipped as feature-less: Bjud in-modal (no invite backend), Bokningar count badge, notification dot. Verified end-to-end (created a staff member through the modal; wishes + token confirmed via API).

## Notes

- Found during verification: browser-default **blue focus ring** on unstyled buttons (e.g. Modal close) — added zero-specificity `:where(:focus-visible)` warm outline in `index.css` (Radix's own focus styles still win).
- `@swedev/ui` 0.3.0 committed and published 2026-07-07; **0.4.0 pending** (committed changes in `~/repos/ui` working tree, needs publish + Timla dep bump to `^0.4.0`).
- Remaining for the user: (1) approve @swedev/ui 0.4.0 commit+publish, (2) bump Timla dep + lockfile, (3) approve Timla commit to PR #25, (4) push `~/repos/ui` main.
