# Progress: Issue #14 — UI: organization settings — name, timezone, scheduling rules

## Status: Completed

(Update as work proceeds — newest entries first)

- 2026-07-10: Completed. All plan steps done and verified end-to-end:
  1. `PATCH /data/org` (partial update, `_validate_timezone` extracted,
     data_staff-style unknown-field/empty-body conventions).
  2. Backend tests: PATCH matrix in `test_api_data.py` (name/timezone/both,
     trim, invalid names, path-like/non-string timezones, unknown field,
     empty body, 401/403 no_org) + non-retroactivity documentation test in
     `test_conflicts.py`. Full suite: 152 passed.
  3. `docs/api.md`: PATCH row + timezone-change reinterpretation paragraph
     (policy delegated by #10: reinterpret, no freeze/rebase).
  4. `frontend/src/api.ts`: `updateOrg`, `putRules`.
  5. `frontend/src/pages/Settings.tsx` at `/installningar` (nav item live,
     breadcrumb label, topbar search hidden on non-consuming pages);
     `TIMEZONES` extracted to `frontend/src/timezones.ts` with off-list
     current-value support; seed-once form lifecycle, pristine/pending
     disable, "Sparat ✓" flash; org save updates `['org']` cache and a
     timezone change invalidates `['shifts']`/`['publication']` after a
     window.confirm; rules card sends both fields (full-replace PUT),
     comma-decimal parsing, 0<v<=168 guard. Lint + tsc + build green.
  6. Verified in the browser against seeded data: rename updates
     sidebar/breadcrumb without reload; min-rest 23 h shows live
     "För kort dygnsvila … minst 23 h" in the shift editor and an unforced
     time-changed save 409s ("Passet krockar" / "Spara ändå"); timezone
     Stockholm→Helsinki confirms first, persists, and the whole board
     reinterprets (+1 h, overnight tail moves). Demo data restored after.
- 2026-07-10: Steps 1–3 done: `PATCH /data/org` (+ `_validate_timezone`
  extraction, docstring update), backend tests (PATCH matrix in
  `test_api_data.py`, non-retroactivity in `test_conflicts.py` — full
  suite 152 passed), `docs/api.md` Org section + timezone-change
  paragraph. Next: frontend API client + Settings page.
- 2026-07-10: Started implementation on branch `issue/14-ui-org-settings`.
  Steps pending: (1) PATCH /data/org, (2) backend tests, (3) docs,
  (4) frontend API client, (5) Settings page, (6) end-to-end verify.
