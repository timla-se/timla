# Progress: Issue #10 — Publish schedule and read-only staff view

## Status: Completed

(Update as work proceeds — newest entries first)

- 2026-07-10: **Completed.** Frontend landed (types/api rework,
  `publishState` badge helper with the four states Utkast / Publicerad /
  Ändringar sedan publicering / Delvis publicerad, "Publicera schema" button
  with 409-aware error Callout, publication invalidation on shift writes).
  `docs/api.md` updated (publications list read, `POST /action/publish`,
  svar schedule note). Verified: 146 pytest green, `npm run precommit`
  (eslint + tsc + vite build) green, end-to-end publish→edit→frozen
  snapshot→re-publish flow against seeded Demo Bistro at the HTTP surface,
  server smoke (health, SPA, share link). Browser/Clerk UI click-through not
  run (automation context); badge derivation covered by the API-level matrix.
  - [x] Phase 7 — Frontend (types, api, Schedule badge + button, ShiftModal)
  - [x] Phase 9 — Docs + verification
- 2026-07-10: Backend complete, 146 tests green. Migration backfill verified
  stepwise against a scratch db (`timla_migr_test`: upgrade 0003 → insert
  week-keyed rows incl. 2026-W01 and 2020-W53 → upgrade head → Monday-aligned
  7-day periods, snapshots intact; downgrade 0004→0003 executable). Seed
  script idempotent-rerun verified.
  - [x] Phase 1 — Migration `0004_publication_period.py`
  - [x] Phase 2 — `parse_period` extraction in `app/api_utils.py`
  - [x] Phase 3 — `app/publications.py` + `POST /action/publish`
  - [x] Phase 4 — `GET /data/publications` rework (range, list, `diverged`)
  - [x] Phase 5 — Staff link read (`app/routes/svar.py`)
  - [x] Phase 6 — Seed script (`scripts/seed.py`)
  - [ ] Phase 7 — Frontend (types, api, Schedule badge + button, ShiftModal)
  - [x] Phase 8 — Tests (schema, action_publish, api_data, svar, backfill)
  - [ ] Phase 9 — Docs + verification
