# Timla

Composable time/booking/scheduling platform. MVP scope = the staff
scheduling (arbetsschema) module only; plan lives in milestone
[MVP](https://github.com/timla-se/timla/milestone/1).

## Workflow

- Branch + PR flow — never commit directly to main.
- **All PRs are squash-merged** (enforced in repo settings).
- CI must be green before merge: eslint, tsc, vite build, alembic + pytest.

## Architecture

- Backend: flat Flask modules in `app/` (OpenVera pattern), **raw psycopg3,
  no ORM**. Migrations are hand-written SQL via Alembic (`op.execute`,
  autogenerate disabled).
- API convention: `docs/primitives.md` — `/data` (reads/writes), `/compute`
  (pure, no side effects, may read), `/action` (does things). The staff
  share-link (`/svar/:token` page + its `/data`/`/availability` JSON) is the
  only unauthenticated surface; `/link/:token` 301-redirects to it.
- Week semantics: ISO 8601 weeks, Monday start, evaluated in the org
  timezone; an overnight shift belongs to the week where it **starts**.
  Helpers in `app/weeks.py` — use them, don't reimplement.
- Availability is stored as wall-clock minutes in the org timezone
  (DST-safe); expansion to UTC goes through `app/weeks.py`.

## Dev

- `docker compose up -d postgres` — Postgres on host port **5433** (not 5432).
- `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla alembic upgrade head`
- Seed demo data: same env, `python scripts/seed.py` (idempotent). Set
  `TIMLA_SEED_USER=<clerk-user-id>` to bind your own Clerk account to the
  seeded org.
- Backend config: copy `.env.example` to `.env` (gitignored, auto-loaded by
  `app/_env.py`); real env vars still override it. `CLERK_PUBLISHABLE_KEY`,
  `DATABASE_URL`, `TIMLA_ENV` live here.
- Auth (issue #3): both halves need the same Clerk app's publishable key —
  `CLERK_PUBLISHABLE_KEY` for the backend (root `.env`),
  `VITE_CLERK_PUBLISHABLE_KEY` in `frontend/.env.local` for the frontend.
  Neither is required to run the backend test suite (`app.config['TESTING']`
  uses a synthetic principal).
- Verify recipe: `.claude/skills/verify/SKILL.md`.
