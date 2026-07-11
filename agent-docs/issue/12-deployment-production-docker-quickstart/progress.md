# Progress: Issue #12 — Deployment story: production docker-compose + quickstart docs

## Status: Completed

(Update as work proceeds — newest entries first)

- 2026-07-11: Completed. Full test plan executed against a real build:
  compose `${VAR:?}` guards fail loudly (verified via explicit
  `--env-file`; note: without `--env-file`, compose auto-loads the dev
  `.env`, which is why the docs insist on the full invocation), image
  built, migrations `0001..0005` applied (migrate-before-serve order),
  `/api/health` → `{"status":"ok","env":"prod","dev":false}`, `/` serves
  the built SPA, `/svar/bogus-token/data` → JSON 404 through the migrated
  schema, `/data/anything` → 401, `timla`/`timla-prod` compose projects
  isolated (dev postgres untouched), app runtime guards raise
  `RuntimeError` for missing `CLERK_PUBLISHABLE_KEY` and `SECRET_KEY`,
  both prod containers reached `healthy`, dev compose still parses.
  Throwaway prod stack torn down (`down -v`); throwaway `.env.prod` kept
  (gitignored) for the manual browser sign-in check. Remaining manual
  check: Clerk sign-in + first-org onboarding in a real browser.
- 2026-07-11: Started implementation on branch
  `issue/12-deployment-production-docker-quickstart`. Steps from plan:
  1. [x] Create `docker-compose.prod.yml`
  2. [x] Create `.env.prod.example` + `.gitignore` exception
  3. [x] Create `.dockerignore`
  4. [x] Create `docs/deployment.md`
  5. [x] Update `README.md` (Self-hosting section + status blurb)
  6. [x] Cross-pointer comment in dev `docker-compose.yml`
  7. [ ] Verify end-to-end (test plan)
