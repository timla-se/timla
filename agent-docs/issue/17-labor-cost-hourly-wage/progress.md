# Progress: Issue #17 — Labor cost: hourly wage per staff + monthly hours/cost summary

## Status: Completed

**Completed:** 2026-07-10

(Update as work proceeds — newest entries first)

- 2026-07-10: All steps done. Verification: alembic 0004↔0005 round-trip OK;
  `pytest app` 196 passed; frontend typecheck/lint/build green (also via
  `npm run precommit`); seed ran twice (idempotent, 2 wage-less staff for
  the uncosted demo state); end-to-end HTTP check against the seeded org —
  report totals match hand-math in Decimal (30 792,50 kr known cost, 26 h
  uncosted, `cost_complete: false`), `/svar/:token/data` contains no
  `hourly_wage`, PUT with `hourly_wage` → 400 `unknown_field`, staff wage
  round-trips; server smoke: `/api/health` ok, `/rapporter` serves the SPA.
  Design decisions to confirm at PR time: live shifts (not publication
  snapshots) + current wage applies retroactively.
- 2026-07-10: Frontend complete (steps 10–13): types/api layer, wage field
  in staff modals, `/rapporter` page with month picker (org-timezone
  default), nav + breadcrumb, seed wages.
- 2026-07-10: Backend complete (steps 1–8): migration round-trips
  (0004↔0005), full suite 196 passed. Continuing with docs + frontend.
- 2026-07-10: Branch `issue/17-labor-cost-hourly-wage` created from main. Starting Phase 1 (migration 0005).

### Steps

- [x] 1. Migration `0005_staff_hourly_wage.py`
- [x] 2. `app/routes/data_staff.py` — `hourly_wage` editable field
- [x] 3. Fix `test_staff_rejects_unknown_fields` + staff API wage tests
- [x] 4. `app/weeks.py` — `month_bounds_utc` + tests
- [x] 5. `app/routes/compute_labor_cost.py` + blueprint registration
- [x] 6. Backend tests `test_compute_labor_cost.py`
- [x] 7. `test_schema.py` — CHECK constraint test
- [x] 8. `/svar` surface guard tests
- [x] 9. `docs/api.md`
- [x] 10. Frontend API layer (`types.ts`, `api.ts`)
- [x] 11. Wage editing in `Staff.tsx`
- [x] 12. Report page `Reports.tsx` + routing/nav
- [x] 13. `scripts/seed.py` wages
- [x] 14. Verify (alembic round-trip, pytest, frontend checks, seed, HTTP e2e)
