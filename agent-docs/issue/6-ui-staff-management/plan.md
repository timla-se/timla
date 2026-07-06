# Implementation Plan: UI: staff management

## Summary

Build the manager-facing staff management UI — the first real frontend work in the repo. Because the frontend is currently a placeholder, this issue also establishes the frontend foundation that #7–#10 and #14 will reuse: an API client speaking the `/data` conventions (interim `X-Timla-Org` org gate until #3), React Query hooks, an app shell with navigation, and shared form/dialog components mirroring the OpenVera patterns. On top of that: staff roster CRUD, share-link management (generate/copy/regenerate), and manager-side availability editing.

One small backend addition: `POST /action/staff/:id/regenerate-link` (specced in #13, consumed here; the `share_token` column exists since #2).

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None for implementation — final done-when acceptance ("working share link") depends on #13's public link view |
| **Blocks** | #7, #10 (foundation + link generation), #9/#8 (app shell, API client) |
| **Related issues** | #3 (auth replaces the dev org gate), #4 (closed — API this UI consumes), #14 (shares layout), #17 (wage field lands in this view later) |
| **Scope** | ~14 files: frontend/src/ (foundation + pages + components), 1 backend route, tests |
| **Risk** | Low |
| **Complexity** | Medium |
| **Safe for junior** | Yes |
| **Conflict risk** | Low (no other open plans) |

### Triage Notes

- **Implementation is unblocked.** #13 is open, and its public `/link/:token` view is what makes a share link "working" — so only the final done-when demo ("hand each person a working share link") waits for #13. Everything built here — CRUD, link generation/copy/regeneration, availability editing — is verifiable now. Decision: the manager-scoped `POST /action/staff/:id/regenerate-link` endpoint is built **here** (small, and the UI needs it now); #13 keeps the public link-scoped surface.
- **#17 (hourly wage)** deliberately not included: the `hourly_wage` column doesn't exist yet. When #17 runs, its wage field is added to the forms built here.
- Work proceeds without auth (#3): the API's interim `X-Timla-Org` header is mirrored by a dev org gate in the frontend (see Design Decisions).

## Analysis

- **Backend is ready.** `/data/staff` (CRUD incl. archive/unarchive), `/data/availability/:staff` (document + PUT patterns + exceptions sub-resource) all exist with tests, and `staff` JSON already includes `share_token`. The only missing piece is token generation.
- **Frontend is a placeholder** (`App.tsx` renders a landing card). Everything else must be created, following OpenVera's structure: `src/pages/*.tsx` with React Query directly in pages, `@swedev/ui` components (`Table`, `Button`, `TextField`, `Select`, `Badge`, `TextArea`, `DatePicker`, `Checkbox`), `lucide-react` icons, and local shared components (`FormModal`, `ConfirmDialog`, `EmptyState` — OpenVera keeps these in its `openvera` package; Timla keeps them in `src/components/` until a second consumer justifies extraction).
- **Org context:** there is deliberately no org-enumeration endpoint. The dev interim is a gate screen where the manager pastes their org UUID once (validated against `GET /data/rules`), stored in `localStorage`, attached as `X-Timla-Org` by the API client. #3 replaces exactly this module with Clerk auth — pages don't change.
- **Availability editing here is the manager-side fallback** ("staff who phone in"). Simple, functional form rows — the polished mobile tap-grid is #7's scope. The document model maps directly: wishes/blocks are recurring `{weekday, start_minute, end_minute}` rows; exceptions are dated rows with their own add/delete endpoints.

## Implementation Steps

### Phase 1: Backend — regenerate-link action

1. Create `app/routes/action_staff.py`: `POST /action/staff/<uuid:staff_id>/regenerate-link`
   - `require_staff` (404 outside org), reject archived staff (400 `archived_staff`)
   - `secrets.token_urlsafe(24)` → `UPDATE staff SET share_token = ...`, return full staff JSON (reuse `staff_json` from `data_staff`)
   - `share_token` has a UNIQUE constraint: catch `UniqueViolation` and retry once with a fresh token (collision is astronomically unlikely but must not 500)
   - Register blueprint in `app/routes/__init__.py`
   - Post a note on #13 that the manager-scoped regenerate action now lives in #6
2. Tests in `app/tests/test_api_data.py`: first call generates a token; second call replaces it (old ≠ new); 404 for other org's staff; 400 for archived staff. Update `docs/api.md` (Actions section).

### Phase 2: Frontend foundation

3. Extend `frontend/vite.config.ts` proxy with `/data`, `/compute` and `/action` (today only `/api` and `/link` are proxied — without this the browser E2E path cannot reach the API at all).
4. `frontend/src/api.ts` — fetch wrapper: JSON in/out, `X-Timla-Org` from `localStorage['timla.org']`, throws typed `ApiError` from the canonical `{error, message}` shape, handles `204 No Content` (archive, exception delete); endpoint helpers: `listStaff({includeArchived})`, `createStaff`, `updateStaff`, `archiveStaff`, `getAvailability`, `putAvailability`, `addException`, `deleteException`, `regenerateLink`. Numeric form fields convert `''` → omitted and strings → numbers before hitting the API's strict validation.
5. Add `import '@swedev/ui/styles.css'` to `frontend/src/main.tsx` (only Radix styles are imported today).
6. `frontend/src/types.ts` — `Staff`, `AvailabilityDocument`, `RecurringInterval`, `ExceptionInterval` matching `docs/api.md`.
7. `frontend/src/components/OrgGate.tsx` — if no org id stored: full-screen prompt to paste org UUID, validate via `GET /data/rules`, store, reload state. Marked clearly as dev interim (#3 replaces it). Include a "byt organisation" escape hatch in the layout footer.
8. `frontend/src/components/Layout.tsx` — app shell: sidebar/topbar nav (Personal — active; Schema, Inställningar as disabled placeholders for #8/#14), content outlet.
9. Rewrite `frontend/src/App.tsx` routes: `/` → redirect `/staff`; `/staff`; `/staff/:id`.

### Phase 3: Shared components

10. `frontend/src/components/FormModal.tsx`, `ConfirmDialog.tsx`, `EmptyState.tsx` — mirror OpenVera's equivalents (Radix Dialog based, submit/cancel, error display from `ApiError`).

### Phase 4: Staff roster page

11. `frontend/src/pages/Staff.tsx`:
   - `Table`: name, role, contact, max h/week, link status (`Badge`: "länk finns"/"ingen länk"), archived state; `include_archived` toggle (`Checkbox`)
   - New staff via `FormModal` (name required; phone, email, role, max hours) → `POST /data/staff`
   - Edit via same modal prefilled → `PATCH`
   - Archive via `ConfirmDialog` → `DELETE`; unarchive via `PATCH {archived: false}`
   - Surface API validation errors (400 messages) inline in the modal

### Phase 5: Share links

12. Link cell/section: when `share_token` exists show truncated `${location.origin}/link/${token}` + copy button (clipboard API with failure toast — clipboard can be denied, show the full URL as selectable fallback); "Skapa länk" (first time) and "Regenerera" behind `ConfirmDialog` warning that the old link stops working → `POST /action/staff/:id/regenerate-link`, invalidate staff query.

### Phase 6: Availability editing (manager-side)

13. `frontend/src/pages/StaffDetail.tsx` — reached from the roster row. **No `GET /data/staff/:id` exists**: the page fetches `listStaff({includeArchived: true})` and finds its row (roster is small by definition); unknown id → EmptyState with link back.
    - Wishes and blocks sections: rows of (weekday `Select` 1–7, start/end time inputs stored as minutes), add/remove row
    - **One save action for both sections**: `PUT /data/availability/:staff` replaces wishes AND blocks together — saving them separately from stale state would wipe the other section. The page keeps one document state and always PUTs both arrays. (PUT never touches dated exceptions.)
    - Exceptions section: list of dated blocks with delete; add via `DatePicker` + optional time range (defaults full day) → exceptions endpoints
    - Shared `IntervalRow` component — #7's mobile view can reuse the minute↔time conversion helpers

### Phase 7: Verification

14. `npm run precommit` (lint + typecheck + frontend build) and `pytest app` against compose postgres.
15. End-to-end per the verify skill: seed → backend + `npm run dev` → in the browser: pass the org gate with the seeded org, create/edit/archive staff, generate + copy + regenerate a link (old token invalidated — verify via API), enter wishes/blocks/exception for a staff member, then confirm via `GET /data/availability/:staff?period=` and `/compute/conflicts` that the entered availability is respected. Probes: garbage UUID in the org gate, API 400s surfaced in forms, archived staff hidden by default.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `app/routes/action_staff.py` | Create | Regenerate-link action endpoint |
| `app/routes/__init__.py` | Modify | Register the action blueprint |
| `app/tests/test_api_data.py` | Modify | Token generation/regeneration tests |
| `docs/api.md` | Modify | Document the action endpoint |
| `frontend/vite.config.ts` | Modify | Proxy `/data`, `/compute`, `/action` to the backend |
| `frontend/src/main.tsx` | Modify | Import `@swedev/ui/styles.css` |
| `frontend/src/api.ts` | Create | API client + org header + endpoint helpers |
| `frontend/src/types.ts` | Create | Shared TS types for API payloads |
| `frontend/src/components/OrgGate.tsx` | Create | Dev interim org selection (replaced by #3) |
| `frontend/src/components/Layout.tsx` | Create | App shell + navigation |
| `frontend/src/components/FormModal.tsx` | Create | Shared create/edit modal |
| `frontend/src/components/ConfirmDialog.tsx` | Create | Shared destructive-action confirm |
| `frontend/src/components/EmptyState.tsx` | Create | Shared empty-list state |
| `frontend/src/pages/Staff.tsx` | Create | Roster: CRUD + links + archive |
| `frontend/src/pages/StaffDetail.tsx` | Create | Availability editor (manager-side) |
| `frontend/src/App.tsx` | Modify | Routes through Layout |

## Codebase Areas

- `frontend/src/` (bulk of the work — new)
- `app/routes/` (one new action endpoint)
- `app/tests/`, `docs/`

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. Regenerate-link endpoint built in #6, not #13
**Options:** wait for #13 vs build the manager-scoped action here
**Decision:** build here.
**Rationale:** The UI needs it now; it's ~30 lines against an existing column; #13's remaining scope (public `/link` surface, rate limiting) is untouched. #13's issue text already names #6 as the consumer.

### 2. Dev org gate via localStorage paste, not env var or org list
**Options:** paste-UUID gate / VITE env var / org enumeration endpoint
**Decision:** paste-UUID gate stored in localStorage.
**Rationale:** No org enumeration exists by design (tenant isolation). An env var requires a rebuild per org and doesn't work in the built SPA. The gate is one throwaway component that #3 deletes; seed prints the org id to paste.

### 3. Manager availability editor is simple form rows, not the #7 tap-grid
**Options:** build the polished weekly grid now vs functional rows
**Decision:** functional rows.
**Rationale:** The issue scopes this to "staff who phone in" — a fallback. #7 owns the mobile UX; sharing the `IntervalRow`/minute-conversion helpers avoids double work without pre-building #7.

### 4. Shared components live in `frontend/src/components/`, no package split
**Options:** local components vs a `packages/timla-ui` workspace like OpenVera's `openvera` package
**Decision:** local.
**Rationale:** OpenVera's split exists because its package is consumed externally. Timla has one consumer; extract when a second appears.

### 5. Share link URL built client-side from `location.origin`
**Options:** backend returns full URL vs client composes `origin + /link/ + token`
**Decision:** client composes.
**Rationale:** The backend doesn't reliably know its public origin (proxy); the SPA does. Keeps the API payload as-is.

## Verification Checklist

- [ ] Manager can create, edit, archive and unarchive staff from the browser (done-when part 1)
- [ ] Manager can generate, copy and regenerate a share link; regeneration invalidates the old token (done-when part 2 — link *target* 404s until #13, expected)
- [ ] Manager can enter wishes, blocks and a dated exception on behalf of a staff member (done-when part 3)
- [ ] Entered availability is respected by `/compute/conflicts` (verified via API)
- [ ] API validation errors (400) surface in forms instead of silent failure
- [ ] Archived staff hidden by default, visible with toggle
- [ ] `include_archived`, org gate misuse (garbage UUID) and empty states behave sanely
- [ ] lint + typecheck + build + pytest green
