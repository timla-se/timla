# Progress: Issue #42 — StaffDetail: desired shifts/week, manager note, exception kind + provenance

## Status: Completed

(Update as work proceeds — newest entries first)

- 2026-07-10: All phases done and verified; implementation complete on
  `issue/42-staffdetail-desired-shifts-provenance` (from `main`), awaiting review.
  - [x] Phase 1 — Contract types + API client (`types.ts`, `api.ts`)
  - [x] Phase 2 — StaffDetail: exceptions v2 (display; `semantic="danger"` is a valid @swedev/ui Semantic, maps to red like `error`)
  - [x] Phase 3 — StaffDetail: add-exception form v2 (kind toggle, Orsak field, "Vissa tider" disclosure, NaN-aware guard)
  - [x] Phase 4 — StaffDetail: per-staff fields (Önskemål section, strict 0–50 parse, PATCH /data/staff, state keyed on staff.id)
  - [x] Phase 5 — Copy: recurring blocks escape-hatch hint
  - [x] Phase 6 — Seed data (provenance stamps, two "Kan extra" exceptions, desired shifts for 3 staff, Emma's availability note)
  - [x] Phase 7 — Verification:
    - `npm run lint` / `typecheck` / `build` green (also via root `npm run precommit`)
    - `pytest app` against migrated compose Postgres: 119 passed, 0 skipped
    - `scripts/seed.py` ran clean twice; psql spot-check confirmed `kind='wish' AND on_date IS NOT NULL` rows, notes, both `source` values, and staff rows with the new fields
    - Verify recipe (browser, port 8899): manager-added "Kan extra" with reason + 12:00–18:00 range → green badge + note, DB row stamped `source='manager'`; delete works; Önskemål save → persists across reload and shows on the phone (stepper 4 + note); worker-added phone exception → "Ifyllt av personalen" in StaffDetail; legacy row (null source/note) renders without badges and deletes cleanly; invalid desired-shifts input (99, "3,5") disables save with friendly message
- 2026-07-10: Started implementation on branch `issue/42-staffdetail-desired-shifts-provenance` (from `main`).
