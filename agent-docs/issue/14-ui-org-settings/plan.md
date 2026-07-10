# Plan: Issue #14 — UI: organization settings — name, timezone, scheduling rules

## Goal

A manager can edit the organization (name, timezone) and the org-level
scheduling rules (max hours/week, min rest between shifts) from the
browser. Closes the gap where `Rule` exists in the data model (#2) and
API (#4) but no UI owns editing it.

**Done when:** a manager can change the rules from the browser and the
shift editor's conflict warnings reflect the new values.

## Approach

Most of the backend already exists:

- `GET /data/org` (`app/routes/data_org.py`) returns `{id, name, timezone}`.
- `GET/PUT /data/rules` (`app/routes/data_rules.py`) is complete, validated
  (numbers in `0 < v <= 168` or `null`), and upserts the `org_rule`
  singleton. **Note: PUT is a full replace — a missing field becomes
  `null`**, so the UI must always send both fields.
- The conflicts engine (`app/conflicts.py::_load_context`) reads `org_rule`
  fresh on every check, and saved shifts are never re-validated after the
  fact. The issue's requirement "changing a rule does not retroactively
  invalidate saved shifts; it applies to conflict checking from that point
  on" therefore holds **by construction** — no code needed, only a test
  that documents it. Precisely: "non-retroactive" means the rule update
  itself never mutates/deletes saved shifts; a saved shift *is* rechecked
  under the new rules the next time it is edited (time/assignee change)
  or included in a `/compute/conflicts` proposal. Note the exceeded rules
  are **hard conflicts** (`max_hours`, `insufficient_rest`), not soft
  warnings — writes return `409` unless forced (`app/conflicts.py`,
  `ShiftModal.tsx` renders them under "Konflikter").

The remaining work is:

1. **Backend:** one new endpoint, `PATCH /data/org` (partial update of
   `name`/`timezone`), mirroring the validation already in `POST /data/org`
   and the unknown-field/empty-body conventions from `data_staff.py`.
2. **Frontend:** a new `Settings` page wired to the existing (currently
   inert) "Inställningar" nav item in `Layout.tsx`, with two cards:
   Verksamhet (name + timezone) and Schemaregler (max hours/week, min rest).
3. **Docs + tests.**

No schema change, no migration.

**Caching:** the org query (`queryKey: ['org']`, 30 s `staleTime` from
`main.tsx`) feeds `Layout.tsx` (sidebar + breadcrumb) and `App.tsx`
(`ScheduleRedirect`), so the org mutation must update it. A **timezone**
change additionally affects everything evaluated in the org zone —
shift period boundaries (`data_shifts.py`) and publication divergence
(`data_publications.py`) — so it must also invalidate the `['shifts']`
and `['publication']` query prefixes (keys per `Schedule.tsx`:
`['shifts', period]`, `['publication', period]`). Rules need a `['rules']`
query key on the new page; conflict warnings themselves come from
server-side `POST /compute/conflicts` / write-time 409s, which read
`org_rule` per request — no cache to bust there.

**Publication policy (delegated here by #10):** publication boundaries
are local dates interpreted in the org's *current* timezone. After a
timezone change, a near-midnight shift can move to a neighbouring local
date, shifting which publication covers it and flipping `diverged`.
Decision for MVP: **reinterpret, don't freeze or rebase** — consistent
with how availability wall-clock minutes and week semantics already
reinterpret under the current org zone. Document this in `docs/api.md`
and cover published schedules in the UI helper text.

## Steps

1. **Backend — `PATCH /data/org`** in `app/routes/data_org.py`:
   - Extract the IANA-zone check from `create_org` (the
     `ZoneInfo(tz)` / `except (ZoneInfoNotFoundError, ValueError)` block,
     including the path-like-key comment) into a module-level
     `_validate_timezone(tz)` helper used by both POST and PATCH; it also
     rejects non-string/`null` values.
   - PATCH accepts any subset of `{name, timezone}`; unknown keys →
     `400 unknown_field`; empty body → `400 invalid` "No fields to
     update" (both per the `data_staff._validate`/PATCH convention).
   - `name` if present: string, non-empty after trim; persist the
     **trimmed** value (same rule as POST).
   - `timezone` if present: string + valid IANA zone.
   - `UPDATE organization SET ... WHERE id = %s RETURNING id, name,
     timezone` built from the provided fields, then `conn.commit()`.
     Respond `200` with the same shape as GET.
   - Uses `current_org(conn)` so `401`/`403 no_org` behavior matches the
     rest of `/data`.
   - Update the module docstring ("settings editing is #14" is now stale).

2. **Backend tests** in `app/tests/test_api_data.py` (org section):
   - PATCH name only / timezone only / both → response and persistence
     via a follow-up GET; name whitespace is trimmed in the stored value.
   - `400 invalid`: empty or non-string name; invalid timezone including
     non-string, `null`, and the path-like `'/Europe/Stockholm'`
     regression from POST; empty body `{}`.
   - `400 unknown_field` for a typo'd key.
   - `401` unauthenticated (bare `app.test_client()`); `403 no_org` for
     an authenticated principal without an org (see `test_auth.py`
     fixtures).
   - Non-retroactivity documentation test (in `test_conflicts.py`):
     create a saved shift valid under no rules, then `PUT /data/rules`
     with a stricter rule → the shift still exists in `GET /data/shifts`;
     a subsequent `POST /compute/conflicts` on the same schedule now
     reports `max_hours`/`insufficient_rest` in **`conflicts`** (hard),
     and an equivalent unforced shift write returns `409 conflict`.

3. **Docs** — `docs/api.md` Org section: add the
   `PATCH /data/org | Any subset of {name, timezone}` row, drop the
   "Editing is #14" note from the GET row, and add a short paragraph on
   timezone-change semantics (availability wall-clock reinterpretation,
   shift week membership, publication divergence — see Risks/Approach).

4. **Frontend API client** — `frontend/src/api.ts`:
   - `updateOrg(payload: { name?: string; timezone?: string })` →
     `PATCH /data/org`.
   - `putRules(payload: Rules)` → `PUT /data/rules` (always send both
     fields — full replace).
   - `Org` and `Rules` interfaces already exist in `types.ts`; no changes.

5. **Frontend — Settings page** `frontend/src/pages/Settings.tsx`:
   - Route `/installningar` in `App.tsx`; in `Layout.tsx` give the
     "Inställningar" `NavItem` a `to: '/installningar'`, extend
     `pageLabel()`, and hide the topbar search field on pages that don't
     consume it (it would be nonfunctional and misleading on Settings).
   - Extract `TIMEZONES` from `OnboardingGate.tsx` into a shared module
     (e.g. `frontend/src/timezones.ts`) and reuse it. The select must
     include the org's **current** timezone even when it is not in the
     curated list (POST accepts any IANA zone), deduplicated against the
     curated entries, so the saved value is never silently swapped.
     Accepted MVP limitation: managers can only pick from the curated
     list (plus their current off-list value) — no free-form IANA input.
   - **Form state lifecycle** (both cards): load via
     `useQuery({ queryKey: ['org'] })` / `useQuery({ queryKey: ['rules'],
     queryFn: getRules })` with explicit loading and load-error states;
     seed local form state **once** from the loaded data (no reseeding on
     background refetch, so a refetch never clobbers in-progress edits);
     each card is its own `<form>` with its own submit button, disabled
     while pristine or while its mutation is pending; show brief success
     feedback on save (the page stays open, unlike the modals).
   - Card "Verksamhet": name `TextField` + timezone `Select`. Save via
     `useMutation(updateOrg)`; on success `queryClient.setQueryData(['org'],
     response)`, and **if the timezone changed** also invalidate the
     `['shifts']` and `['publication']` prefixes. Confirm before saving a
     changed timezone (window.confirm, same idiom as sign-out) — helper
     text explains that times, week boundaries and published schedules
     are reinterpreted in the new zone.
   - Card "Schemaregler": two numeric fields, `max_hours_per_week`
     ("Max timmar/vecka") and `min_rest_hours` ("Min vila mellan pass,
     timmar"). Keep raw **string** state and parse with comma-decimal
     support, same idiom as `Staff.tsx`; empty input ↔ `null` (rule
     unset). Client-side guard matching the API (`0 < v <= 168`); server
     errors surface in a `Callout`. On success
     `queryClient.setQueryData(['rules'], response)` — use the canonical
     PUT response since `numeric(4,1)` may round the entered value.
     Helper text: a rule change applies to conflict checking from now on
     and does not invalidate saved shifts.
   - Follow the existing form idiom (see `OnboardingGate.tsx`):
     `@swedev/ui` `Button`/`TextField`/`Select`/`Callout` + Radix
     `Flex`/`Text`, Swedish labels, paper-card styling like the other pages.

6. **Verify end-to-end** (`.claude/skills/verify/SKILL.md` recipe):
   change min rest to a strict value in Settings, open the shift editor
   on `/schema/:week`, confirm the live conflict list reflects the new
   rule and an unforced save 409s; change the org name and confirm the
   sidebar/breadcrumb update without a reload; change the timezone with
   a near-midnight shift on the board and confirm period membership and
   publication divergence re-evaluate after the cache invalidation.

## Risks

- **Timezone-change semantics** (Medium — the main risk of this issue).
  Availability is wall-clock minutes in the org timezone, so changing the
  zone reinterprets every wish/block in the new zone (usually what a
  mis-onboarded org wants). Shifts are UTC instants, so a near-midnight
  shift can move to an adjacent local date/week in period queries — which
  also shifts which **publication** covers it and can flip `diverged`
  (policy delegated here by #10; decision: reinterpret, no freeze/rebase,
  no data migration). Mitigations: confirm dialog + helper text, cache
  invalidation of `['shifts']`/`['publication']`, and the docs paragraph.
- **`PUT /data/rules` is a full replace.** If the UI ever sends only one
  field, the other is silently cleared to `null`. The page must always
  submit both values from its form state.
- **Curated timezone list vs stored value.** The onboarding list has five
  zones but the API accepts any IANA zone; the settings select must render
  the current value even when off-list (deduplicated), and the curated-only
  choice is an accepted MVP limitation.
- **Async form-state pitfalls.** Seeding form state from an async query
  risks blank initial state, refetches clobbering edits, or saving before
  load — handled by the seed-once + pristine/pending-disabled lifecycle
  in Step 5.
- **Stale org cache.** `['org']` feeds the sidebar, breadcrumb and the
  `/schema` redirect; forgetting to update it after `updateOrg` leaves
  the old name/timezone visible for up to the 30 s `staleTime`.

## Test Plan

- Backend: `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla
  alembic upgrade head` + `pytest`: new PATCH /data/org tests (incl.
  `403 no_org`, empty body, trim, unknown field, bad timezones) and the
  non-retroactivity test in `test_conflicts.py` pass; existing
  rules/conflicts tests stay green (they already exercise
  `PUT /data/rules` mid-flow).
- Frontend: `npm run precommit` (lint + typecheck + build) green — no
  unit-test framework in `frontend/` today.
- Manual verify per Step 6: rules change reflected in live conflict list
  and write-time 409; org rename reflected in shell without reload;
  timezone change round-trips, confirms first, and re-evaluates
  shifts/publications.
