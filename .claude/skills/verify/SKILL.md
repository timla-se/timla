---
name: verify
description: Build, launch and drive Timla to verify a change end-to-end. Use after changing backend (app/) or frontend (frontend/) code to observe real behavior at the HTTP surface.
---

# Verifying Timla changes

## Build & launch

```bash
# Backend deps (once): python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Frontend deps (once): npm install

# Build the SPA so the backend can serve it:
npm run build:frontend

# Start the backend on :8899 (health + SPA need no database;
# /data//compute//action routes need the compose postgres on host port 5433):
TIMLA_ENV=dev DATABASE_URL=postgresql://timla:timla@localhost:5433/timla \
  .venv/bin/python app/run_server.py
```

Flask debug mode spawns a reloader child — `kill <pid>` of the parent can
leave the child bound to :8899. Always clean up with:
`lsof -ti :8899 | xargs kill`.

## Drive

- Health: `curl -s http://localhost:8899/api/health` → `{"status": "ok", ...}`
- SPA: `curl -s http://localhost:8899/` → index.html; any client route
  (e.g. `/schema/vecka-28`) must also return the SPA (200 text/html)
- Static assets: `/assets/<file from frontend/dist/assets/>` → 200 with
  correct content-type
- Unknown `/api/*` or `/link/*` paths must return JSON 404
  (`{"error": "not_found"}`), never the SPA
- For UI flows, `npm run dev` serves Vite on :5173 with `/api` and `/link`
  proxied to :8899

## Authenticated pages (Personal, Arbetsschema, modals) in automation

Clerk runs a **development instance** (`pk_test_…`), so Clerk's test-account
flow works — no real email, no secrets, automatable in the browser:

1. **Test account** (already registered): `dev+clerk_test@timla.se` /
   password `timla-dev-testkonto-42`. Any `…+clerk_test@…` address works for
   new accounts; the email-verification step always accepts code **424242**
   in dev instances — as does the **client-trust check** ("You're signing in
   from a new device"), which appears when signing in from a fresh browser
   context (e.g. chrome-devtools' `isolatedContext`, useful precisely because
   its clean cookie state exercises that flow). Clerk's Turnstile bot check
   passes with a single click on "Verify you are human" in a real
   (non-headless) browser.
2. **Sign in** at `/sign-in` (email + password + Continue). If a Turnstile
   checkbox appears, click it.
3. **Bind the account to the seeded org** (seeding wipes and recreates the
   org, so re-run this after every `scripts/seed.py`):

   ```bash
   docker exec timla-postgres psql -U timla -d timla -c "
   INSERT INTO org_user (user_id, org_id)
   SELECT '<clerk-user-id>', id FROM organization WHERE name='Demo Bistro'
   ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id;"
   ```

   The signed-in user id is readable in the browser:
   `window.Clerk.user.id`. (Do NOT set `TIMLA_SEED_USER` to the test
   account — that env var is for the developer's own account binding.)
4. Now `/staff`, `/staff/:id`, `/schema/:week` and the modals render with
   real seeded data. The public `/svar/:token` page needs none of this.

The same recipe works against the **production compose stack**
(`docs/deployment.md`) — it uses the same `pk_test_…` key, so the test
account, code 424242 and first-org onboarding are all drivable in the
browser there too. Remember migrate-before-serve: a bare `up -d` skips
migrations and `/data/org` 500s (`relation "org_user" does not exist`) —
run the quickstart's `alembic upgrade head` step first, and tear down with
`down -v` afterwards.

## Gotchas

- Postgres from docker-compose listens on host port **5433** (not 5432),
  loopback only.
- API responses must carry `Cache-Control: no-store...`; SPA/assets must not.
