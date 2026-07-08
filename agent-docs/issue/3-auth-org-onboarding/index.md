# Issue #3: Auth and organization onboarding

**Based on:** main

## Summary

Replaces the dev-interim `X-Timla-Org` header with real Clerk-based
authentication: a backend JWT-verification module mapping bearer tokens
to users, a new local `org_user` table for org membership (deliberately
not Clerk Organizations), a `POST /data/org` onboarding endpoint, and a
frontend sign-in/sign-up + first-login onboarding flow styled per
`design/Timla Auth.dc.html`. Multi-admin invites are tracked separately
in #29.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | High |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-08
**Feedback:** Codex approved the overall shape (backend → migration → tests → frontend → docs). Applied: migrate 3 existing tests that assumed the interim `X-Timla-Org` header (`test_health.py`, two spots in `test_api_data.py`) now that unauthenticated unknown `/data|/compute|/action` paths 401 before routing resolves 404; route-sweep test must substitute concrete UUIDs into parameterized routes or it silently passes; `OnboardingGate` needs explicit loading/error states (not just success/no_org) plus waiting on Clerk's `isLoaded`; `POST /data/org` needs `isinstance` validation and an atomic `ON CONFLICT` instead of check-then-insert; added backend `CLERK_PUBLISHABLE_KEY` dev-setup note and `package-lock.json` to the files summary; triage `Blocks` corrected to include #26 and #29.

## Related Files

- [plan.md](plan.md) - Full implementation plan

## Related Issues

- #12 Deployment story — the self-hosting trade-off #3's body references
- #13 Staff share-links — the only other unauthenticated surface
- #14 Org settings — adds `PATCH /data/org` on top of this issue's `POST`
- #21 Design system (merged) — tokens/shell the new auth screens reuse
- #26 Invite staff by e-mail — explicitly depends on #3; scope adjacent to #29, cross-reference before either is picked up
- #29 Invite additional managers — multi-admin follow-up, out of scope here
