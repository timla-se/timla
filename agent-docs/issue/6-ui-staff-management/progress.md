# Implementation Progress: Issue #6

**Started:** 2026-07-06
**Last updated:** 2026-07-06
**Status:** Completed
**Completed:** 2026-07-06

## Completed Steps

- [x] Phase 1: Backend — regenerate-link action + tests + docs
- [x] Phase 2: Frontend foundation (vite proxy, api.ts, types, styles, OrgGate, Layout, routes)
- [x] Phase 3: Shared components (EmptyState; Modal/ConfirmModal from @swedev/ui — see notes)
- [x] Phase 4: Staff roster page
- [x] Phase 5: Share links (copy/generate/regenerate)
- [x] Phase 6: Availability editing (StaffDetail, single-PUT semantics)
- [x] Phase 7: Verification (precommit + pytest 59/59 + browser E2E via chrome-devtools)

## Notes

- Deviation from plan (improvement, same spirit): @swedev/ui 0.2.0 ships
  `Modal` and `ConfirmModal` — used directly instead of building local
  FormModal/ConfirmDialog copies. Only `EmptyState` is local.
- Time convention: end input "00:00" means end-of-day (minute 1440);
  helpers in `frontend/src/time.ts` are shared with #7.
- Browser E2E performed (org gate incl. garbage-UUID probe, staff create,
  link generate, availability wishes/block/exception, archive/unarchive)
  and verified server-side: /compute/conflicts blocks the entered Sunday
  block and dated exception, clean inside wishes. No console errors.
- Local-date bug caught during implementation: DatePicker date must be
  formatted with local getFullYear/getMonth/getDate — toISOString() gives
  the previous day at UTC+2.
