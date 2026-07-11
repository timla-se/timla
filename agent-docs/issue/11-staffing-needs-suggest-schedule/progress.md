# Progress: Issue #11 — Staffing needs + /compute/suggest-schedule v0 (stretch)

## Status: Completed (2026-07-11)

(Update as work proceeds — newest entries first)

- 2026-07-11: Steps 4–8 done. Full verify pass: 240 backend tests green,
  precommit (eslint + tsc + vite build) green; end-to-end against seeded
  data — needs expansion with override + `configured`, suggest → zero
  hard conflicts via /compute/conflicts, apply persists all shifts,
  re-run suggests nothing; browser UI verified (heat strip worst-point
  tooltips "HH:MM · S av N", "Öppet 10–18"/"Öppet 10–16" chips,
  closed-Wednesday override, new legend, Auto-schemalägg on draft week
  "16 pass skapade · inga luckor kvar", confirm dialog on published
  week, empty week renders all-lucka grid). Demo DB reseeded clean.
- 2026-07-11: Steps 2–3 done — `app/needs.py` (day-override expansion),
  `/data/staffing-needs` routes registered, 19 new API tests passing;
  seed.py seeds the demand curve + a dated closed-day sentinel
  (idempotence verified by double run).
- 2026-07-11: Step 1 done — migration `0006_staffing_needs` (upgrade +
  downgrade round-trip verified), schema tests added, 29 passing.
- 2026-07-11: Started implementation on branch
  `issue/11-staffing-needs-suggest-schedule` (from `main`).

## Steps

- [x] 1. Migration + schema tests (`migrations/versions/0006_staffing_needs.py`)
- [x] 2. `app/needs.py` + `/data/staffing-needs` routes + API tests
- [x] 3. Seed data (`scripts/seed.py`)
- [x] 4. Frontend: coverage against the needs curve (`Schedule.tsx`)
- [x] 5. Generator engine + tests (`app/suggest.py`)
- [x] 6. Compute route + contract tests (`app/routes/compute_suggest.py`)
- [x] 7. Frontend: "Auto-schemalägg" apply flow
- [x] 8. Docs + end-to-end verification
