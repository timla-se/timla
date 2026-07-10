# Implementation Progress: Issue #40

**Started:** 2026-07-09
**Last updated:** 2026-07-09
**Status:** Completed

## Completed Steps

- [x] Phase 1: Migration `0003_availability_v2.py` (drop CHECK; add `source`, `note`, `staff.desired_shifts_per_week`, `staff.availability_note`) — up/down/up round-trip verified
- [x] Phase 2: `app/routes/svar.py` — None-sentinel `_validate`, per-kind DELETE, exception `kind`/`note`, staff params, `source='staff'`, `_context` exposure
- [x] Phase 3: `app/routes/data_availability.py` — mirror per-kind PUT, exception `kind`/`note`, `_document` wishes filter, `_interval_json` emits `source`/`note`, `source='manager'`
- [x] Phase 4: `app/conflicts.py` — gate `outside_wishes` on recurring wishes only
- [x] Phase 5: `app/routes/data_staff.py` — expose `desired_shifts_per_week` + `availability_note`
- [x] Phase 6: `docs/api.md` — contract update
- [x] Phase 7: tests (`test_schema.py`, `test_svar.py`, `test_conflicts.py`, `test_api_data.py`)
- [x] Phase 8: verification — backend 117 passed, `npm run precommit` clean, migration up/down/up clean

## Current Work

Complete on branch `issue/40-availability-model-v2`. Uncommitted (no `--commit`/`--PR`); awaiting review/commit decision.

## Notes

- Shared `normalize_note` helper added to `api_utils.py` (trim, empty→None, length cap).
- Backward compat is load-bearing: v1 clients send both `wishes`+`blocks` → per-kind replace degrades to today's whole-replace; new response keys additive. Explicitly tested (old-payload cases pass unchanged).
- One implementation catch beyond the plan: the `/svar` PUT builds its response context from the `staff` row fetched *before* the staff-param UPDATE, so the updated values are merged into the local dict (`staff = {**staff, **staff_updates}`) before `_context` — otherwise the just-saved `desired_shifts_per_week`/`availability_note` read back stale.
- `test_schema.py::test_wish_cannot_be_dated` inverted to `test_dated_wish_is_allowed` (the CHECK it guarded is gone).
