# Implementation Progress: Issue #7

**Started:** 2026-07-09
**Last updated:** 2026-07-09
**Status:** Completed

## Completed Steps

- [x] Phase 1: End-to-end acceptance test (backend) — added
      `test_svar_availability_respected_by_conflicts` to `app/tests/test_svar.py`.
      Writes availability through `PUT /svar/:token/availability`, then asserts
      `/compute/conflicts` reports `blocked` for a recurring-Sunday block and a
      dated vacation exception, `outside_wishes` (soft) for a Tuesday outside the
      Monday wish, and clean for a shift inside the wish; asserts `/data/shifts`
      rejects the blocked time with 409 (and accepts it with `?force=true`).
      Added the `org_user` + `X-Test-User` auth setup and refreshed the module
      docstring.
- [x] Phase 2: Manager-side copy refresh — replaced the stale
      "När delningslänkarna (issue #13) finns…" intro in
      `frontend/src/pages/StaffDetail.tsx`.
- [x] Phase 3: Verification — CI gates run locally, all green (see Notes).
      Conflict-respect covered by the Phase 1 test. The phone flow and manager
      view were driven live in a real browser (chrome-devtools) against the
      seeded stack — see "Live verification" in Notes.
- [ ] Phase 4: Branch + PR with `Closes #7` — skipped (no `--commit`/`--PR`);
      changes stay on the feature branch for manual review.

## Current Work

Implementation complete on branch `issue/7-ui-availability-editor`. Awaiting
review / commit decision.

## Notes

- **Scope:** #7's staff + manager editors already shipped (#13, #6) and the
  conflict engine already respects the data (#5). This change closes the
  acceptance gap — a regression-guarded proof that svar-registered availability
  feeds the engine — plus a stale-copy fix. Live conflict warnings *inside the
  shift editor UI* are issue #9, deliberately out of scope.
- **Verification results:**
  - `app/tests/test_svar.py` — 19 passed (incl. the new test).
  - Full backend suite — 92 passed.
  - `npm run precommit` (eslint + tsc + vite build) — clean (pre-existing
    >500 kB chunk-size warning only).
- **Test design:** all dates derive from `date.today()` via `_next_weekday`
  and all shift instants are built with `local_instant(..., 'Europe/Stockholm')`,
  so weekday/DST alignment matches the engine's expansion and nothing is
  pinned to a calendar date.
- **Live verification (real browser, seeded stack on :8899):**
  - `/svar/:token` (mobile, 390px, no login): loaded, toggled a Söndag wish,
    saved → "Tack Lisa!" confirmation sheet, reloaded → the wish persisted.
  - Manager `StaffDetail`: the new intro copy renders (old "delningslänkarna
    (issue #13)" text gone), and the Söndag wish registered via the phone link
    appears in the manager's Sammanfattning — cross-surface consistency, the
    core #7 requirement, confirmed end-to-end.
  - Note: Lisa carries both a Söndag wish (soft) and a seeded Söndag whole-day
    block (hard) at once — legitimate, the block wins in the engine.
