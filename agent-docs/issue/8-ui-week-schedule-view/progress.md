# Implementation Progress: Issue #8

**Started:** 2026-07-07
**Last updated:** 2026-07-07
**Status:** Completed (awaiting commit/PR approval)

## Completed Steps

- [x] Phase 1: `GET /data/publications` — explicit required `period` (400 on missing/malformed/out-of-range week), `null` for unpublished; registered; 5-assertion test; documented in `docs/api.md` (+ backfilled the missing `/data/org` docs from #21)
- [x] Phase 2: `getPublication` + `Publication` type; `time.ts`: `parseWeekPeriod` (validating), `addWeeks`, `formatWeekLabel` (month/year boundary aware), `wallClock` (Intl-based org-tz extraction, ICU-period-safe weekday parse)
- [x] Phase 3: `Schedule.tsx` — header (week nav, "{N} pass · {M} i personal" chip, Publicerad/Utkast pill), Täckning-legend + Öppet pass, hour-axis card, 7 day rows (current-day treatment, `formatIsoDate` dates), coverage heat-strip with tooltips, lane-stacked bars (name + mono time, neutral tint via `colorKey` hook for #27, dashed lucka "Öppet pass" state, "Okänd" fallback, note as title), search dimming, loading/error/empty states, invalid week → redirect; routes `/schema` (org-tz current-week redirect) + `/schema/:week`; Layout: Arbetsschema nav item, pageLabel, route-aware search placeholder, query cleared on route change
- [x] Phase 4: precommit + 61 pytest green; verified in browser against seed: current week (Publicerad-chip, korrekt "Vecka 28 · 6–12 juli" — mockens "7–13 juli" är fiktiv), W29 (Utkast, 29 bars), manually created open shift (dashed bar + lucka coverage) and archived staff (bars keep name, Personal badge 11→10), search dims 27/30 bars, deep links + redirect work; verification data restored afterwards

## Current Work

Done. Working tree on `issue/8-ui-week-schedule-view` for review.

## Notes

- No `--commit`: commit/PR awaits user approval.
- The two design files + the plan folder are untracked and belong in this branch's commit.
- Coverage semantics **revised per user feedback** (2026-07-07): Lucka = hours covered by an open shift (an explicit unstaffed need, `staff_id NULL`). Hours with no shifts at all are neutral — the earlier activity-window heuristic falsely flagged closed midday hours as gaps. Verified visually: only the open-shift day shows red 14–17; shift-free afternoons render neutral.
