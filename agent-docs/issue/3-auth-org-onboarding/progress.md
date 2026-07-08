# Implementation Progress: Issue #3

**Started:** 2026-07-08
**Last updated:** 2026-07-08
**Status:** Completed

## Completed Steps

- [x] Phase 1, Step 1: Add PyJWT + cryptography to requirements.txt
- [x] Phase 1, Step 2: Create app/auth.py (ported/trimmed from openvera)
- [x] Phase 1, Step 3: app/app.py — attach_user + require_manager_auth hooks, prod config guard
- [x] Phase 1, Step 4: app/api_utils.py — rewrite current_org body
- [x] Phase 1, Step 5: app/routes/data_org.py — add POST /data/org
- [x] Phase 2, Step 6: migrations/versions/0002_org_user.py (applied and verified locally)
- [x] Phase 3, Step 7: app/tests/conftest.py — TESTING-mode synthetic user fixtures
- [x] Phase 3, Step 8: app/tests/test_auth.py + migrate test_health.py/test_api_data.py
- [x] Phase 3, Step 9: scripts/seed.py — optional TIMLA_SEED_USER binding (verified idempotent)
- [x] Phase 3, Step 10: Confirmed requirements-dev.txt needs no change (`-r requirements.txt` picks up new deps)
- [x] Phase 4, Step 11: frontend/package.json — add @clerk/react (lockfile updated via npm install)
- [x] Phase 4, Step 12: frontend/.env.local — documented (dev-provided, not committed)
- [x] Phase 4, Step 13: frontend/src/main.tsx — ClerkProvider + token bridge
- [x] Phase 4, Step 14: frontend/src/api.ts — bearer token, createOrg
- [x] Phase 5, Step 15: frontend/src/components/SignInScreen.tsx
- [x] Phase 5, Step 16: frontend/src/components/OnboardingGate.tsx
- [x] Phase 5, Step 17: Delete frontend/src/components/OrgGate.tsx
- [x] Phase 5, Step 18: frontend/src/App.tsx — manual isLoaded/isSignedIn gating (see deviation note)
- [x] Phase 5, Step 19: frontend/src/components/Layout.tsx — sign-out, UserButton
- [x] Phase 6, Step 20: docs/api.md — replaced interim auth section, documented POST /data/org, plus a Clerk dev-setup note in CLAUDE.md
- [x] Phase 6, Step 21: docs/primitives.md — re-read, no change needed (already stated the real invariant)

## Current Work

All phases complete. Running the plan's verification checklist next.

## Notes

Plan reviewed by codex on 2026-07-08 (see index.md). No blockers. Working
on branch `issue/3-auth-org-onboarding` off `main`. `--commit` was not
passed, so implementation stays on this branch for manual review — no
commit/push/PR at the end.

Backend (Phases 1-3) done and verified: full suite is 69/69 passing
(`DATABASE_URL=... .venv/bin/python -m pytest app/tests -q`), migration
0002 applies and downgrades cleanly, `scripts/seed.py` verified both with
and without `TIMLA_SEED_USER` (idempotent rebinding confirmed by rerun).

**Deviation from the plan (Phase 5, Step 18):** the plan assumed
`@clerk/react` exports `<SignedIn>`/`<SignedOut>` control-flow
components — it doesn't (that's `@clerk/clerk-react`, a different
package). Confirmed via the installed package's actual type exports and
by checking how `~/repos/openvera` really handles this (its `Layout.tsx`
never uses those either — it checks `useAuth().isLoaded`/`isSignedIn`
directly). `App.tsx` was written using that same manual-check pattern
instead. Caught by running the project's real build/typecheck scripts
(`npm run build:frontend` / `npm run typecheck:frontend`, both `tsc -b`)
— an earlier bare `npx tsc --noEmit` silently checked zero files because
this repo's tsconfig is solution-style (`files: []` + `references`),
which doesn't get picked up without `-b`. Also added
`frontend/src/vite-env.d.ts` (missing before this issue — nothing had
used `import.meta.env` yet), required for `main.tsx`'s
`VITE_CLERK_PUBLISHABLE_KEY` read to typecheck.

Frontend verified via the project's actual npm scripts: `npm run
build:frontend`, `npm run lint`, `npm run typecheck:frontend` all pass.

**Live end-to-end verification (2026-07-08):** ran the actual app against
a real Clerk dev instance (`app_3GDerku24C0olN5yS5DYiSE5FCk`, linked via
`clerk link` + `clerk env pull`). Full cycle confirmed in a real browser:
sign-up (Clerk test-mode `+clerk_test` email, fixed OTP) → onboarding
form → org created → app usable → sign-out → back to sign-in cleanly.
Backend log showed the exact expected sequence (`GET /data/org` 403
`no_org` → `POST /data/org` 201 → 200s), and the `org_user` row was
created correctly bound to the real Clerk user id.

Two gaps found by actually clicking through it, both fixed:
- `SignInScreen`'s "Sign up" link bounced to Clerk's unstyled hosted
  Account Portal (not in the original plan — Design Decision 3 called
  for a styled onboarding step but didn't anticipate the sign-up entry
  point itself needing its own screen). Fixed: new
  `frontend/src/components/SignUpScreen.tsx` mirroring SignInScreen per
  the design's "Skapa konto" copy, plus `signUpUrl="/sign-up"` /
  `signInUrl="/sign-in"` props and matching routes in `App.tsx` so both
  directions stay in-app.
- Clerk's `<SignIn>`/`<SignUp>` render their own bordered/shadowed card
  by default, nesting visibly inside our own panel ("modal in modal").
  Fixed with a shared `frontend/src/clerkAppearance.ts` (`elements:
  {rootBox, cardBox, card, footer, footerAction}` stripped to blend into
  the parent panel) — verified empirically via screenshot since Clerk's
  exact element keys aren't in the shipped type declarations.

`frontend/.env.local` now holds a real `VITE_CLERK_PUBLISHABLE_KEY`
(dev instance, gitignored, confirmed via `git check-ignore`). The pulled
`CLERK_SECRET_KEY` was discarded — unused by this design (JWKS-based
verification only, no secret-key API calls) and doesn't belong in the
frontend directory regardless.
