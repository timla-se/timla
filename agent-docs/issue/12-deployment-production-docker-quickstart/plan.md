# Plan: Issue #12 — Deployment story: production docker-compose + quickstart docs

## Goal

Ship a minimal but honest self-hosting path: a production Dockerfile +
docker-compose (gunicorn, postgres, static frontend), environment/config
documentation (secrets, database URL, Clerk keys), and a README quickstart —
so a fresh machine can go from `git clone` to a working instance by following
the docs. The docs must state plainly that auth (Clerk) is the one component
that is **not** self-hosted in MVP, and what that means for where user
identities live (see #3, closed).

## Approach

Most of the runtime plumbing already exists and should be reused, not
rebuilt:

- **`Dockerfile`** is already a solid production-oriented baseline
  (multi-stage: node builds `frontend/dist`, python:3.13-slim runs gunicorn,
  frontend copied in, `ALEMBIC_CONFIG=/timla/alembic.ini` set). No structural
  changes needed. Known limitations to state honestly in the docs rather than
  fix here: the runtime runs as root, and Python deps are lower-bounded (not
  pinned) — acceptable for MVP, documented as such.
- **`docker-compose.yml`** is deliberately dev-oriented: loopback-only
  ports, `--reload`, source volume mounts, hardcoded `timla/timla` postgres
  credentials, `SECRET_KEY` defaulting to `dev-only-secret`, `TIMLA_ENV=dev`,
  `./data/pgdata` bind mount. It stays functionally unchanged for dev.
- **`app/app.py` / `app/config.py`** already have the prod posture we need:
  `TIMLA_ENV` defaults to `prod`, fail-loud guards for missing `SECRET_KEY`
  and `CLERK_PUBLISHABLE_KEY` in prod, `ProxyFix` trusting exactly one
  reverse-proxy hop, and an SPA fallback serving `frontend/dist`.

The gap is (a) a production compose file that doesn't inherit dev's unsafe
defaults, (b) a written config reference, and (c) a clone-to-running
quickstart. Design decisions:

1. **Separate `docker-compose.prod.yml` at the repo root** with a top-level
   `name: timla-prod` and **no fixed `container_name`s**, run with
   `docker compose --env-file .env.prod -f docker-compose.prod.yml ...`.
   A separate file (rather than an override layered on the dev compose)
   keeps the prod definition self-contained and readable; the explicit
   project name isolates it from the dev compose project, which would
   otherwise share the default directory-derived name and let prod commands
   recreate dev services (and vice versa).
2. **Migrations stay an explicit documented step** rather than an entrypoint
   that auto-migrates — the operator sees schema changes happen; no surprise
   DDL on container restart. `ALEMBIC_CONFIG` in the image makes
   `run --rm timla alembic upgrade head` work from any cwd. The documented
   order **migrates before the app serves traffic**:
   `build` → `up -d postgres` → `alembic upgrade head` → `up -d timla`
   (and the same order on upgrades, after a backup).
3. **Fail loudly on missing secrets in the compose file itself** using
   `${VAR:?message}` substitution for `POSTGRES_PASSWORD`, `SECRET_KEY` and
   `CLERK_PUBLISHABLE_KEY`, so `docker compose ... up` refuses to start with
   unset secrets instead of booting with empty values.
4. **Named volume for prod pgdata** (not the dev `./data/pgdata` bind mount)
   so `git clean`/checkout mishaps can't touch the database, and the volume
   survives independent of the checkout. Same PG18 mount point
   (`/var/lib/postgresql`) as the dev file — the version-subdir layout
   already bit us once. Docs must say plainly: a volume is persistence, not
   a backup.
5. **Bind the app to loopback by default** (`127.0.0.1:8899`) and document
   that TLS termination is a reverse proxy's job (short Caddy/nginx snippet);
   `ProxyFix(x_proto=1, x_host=1, x_for=1)` already assumes exactly one proxy
   hop. Make the bind overridable via `${TIMLA_BIND:-127.0.0.1:8899}` — with
   a strong warning: because `ProxyFix` trusts one `X-Forwarded-*` hop and
   the `/svar` rate limiter keys on the resulting remote address, exposing
   the app port directly to the internet enables IP spoofing and rate-limit
   bypass. Loopback + local reverse proxy is the recommended topology;
   anything else requires network-level restrictions.
6. **Dedicated `.env.prod` operator file**, passed explicitly via
   `--env-file .env.prod`, documented by a checked-in `.env.prod.example`.
   This keeps prod config away from the dev `.env` (which `app/_env.py`
   auto-loads for host-run backends) and avoids any overlap confusion: the
   prod `.env.prod` is *only* used for compose variable interpolation — the
   image neither copies nor mounts it, so `_env.py` never sees it; all
   runtime config reaches the app as real env vars set by compose.
   `.gitignore` already ignores `.env.*` (so `.env.prod` stays untracked)
   but needs a `!.env.prod.example` exception for the example to be
   committable.
7. **Single Clerk key input.** The operator sets `CLERK_PUBLISHABLE_KEY`
   once in `.env.prod`; the compose file feeds the same value both to the
   `VITE_CLERK_PUBLISHABLE_KEY` build arg and to the backend's runtime env,
   eliminating the frontend-verifies-app-A / backend-verifies-app-B mismatch
   class. Docs link to Clerk's production-instance guide (domain/DNS setup,
   production vs development keys) rather than pretending "create an app" is
   the whole story.
8. **Clerk honesty section**: the Clerk-hosted auth service is the one
   non-self-hosted component in MVP. User identities (manager accounts,
   emails, sign-in) live in Clerk's cloud, keyed by the Clerk application
   the deployer creates; org/staff/schedule data stays in the deployer's
   Postgres, linked by Clerk user id. The publishable key is baked into the
   frontend bundle **at image build time** (Vite inlines `VITE_*`), so a
   self-hoster builds their own image with their own key — there is no
   generic prebuilt image in MVP, and the docs must not promise one.

Expected modification set (explicit, so "docs + new files" stays honest):
new `docker-compose.prod.yml`, `.env.prod.example`, `.dockerignore`,
`docs/deployment.md`; edits to `.gitignore` (one exception line),
`README.md` (Self-hosting section + status-blurb touch-up), and a one-line
cross-pointer comment at the top of the dev `docker-compose.yml`. No Python
or frontend changes. `CLAUDE.md` is deliberately **not** changed — the
README link is the discoverable entry point.

## Steps

1. **Create `docker-compose.prod.yml`** (repo root):
   - Top-level `name: timla-prod`; no `container_name` on either service.
   - `postgres`: `postgres:18-alpine`, explicit `POSTGRES_USER: timla`,
     `POSTGRES_DB: timla`, `POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?...}`,
     named volume `pgdata:/var/lib/postgresql`, **no host port mapping**
     (the app reaches it on the compose network), same `pg_isready`
     healthcheck as dev, `restart: unless-stopped`.
   - `timla`: `build: .` with
     `VITE_CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY:?...}` as build
     arg, **no** source volume mounts, **no** `--reload` (use the image's
     default CMD), `ports: ["${TIMLA_BIND:-127.0.0.1:8899}:8899"]`,
     environment: `TIMLA_ENV=prod`,
     `DATABASE_URL=postgresql://timla:${POSTGRES_PASSWORD}@postgres:5432/timla`,
     `SECRET_KEY=${SECRET_KEY:?...}`,
     `CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY:?...}`,
     `depends_on: postgres (service_healthy)`, `restart: unless-stopped`,
     and an app healthcheck hitting `/api/health` via
     `python -c "import urllib.request; ..."` (the slim image has no curl).
2. **Create `.env.prod.example`** documenting every variable the prod compose
   consumes: `POSTGRES_PASSWORD` (note: must be URI-safe since it is
   interpolated into `DATABASE_URL`; the hex generator below satisfies this),
   `SECRET_KEY` (generation hint:
   `python3 -c "import secrets; print(secrets.token_hex(32))"` — works for
   the password too), `CLERK_PUBLISHABLE_KEY` (single key, feeds both halves),
   optional `TIMLA_BIND` (with the security warning from design decision 5).
   Comment each line with what it does and whether it is secret. Add the
   `!.env.prod.example` exception to `.gitignore` (the existing `.env.*`
   rule would otherwise ignore it; it also — usefully — keeps `.env.prod`
   untracked).
3. **Create `.dockerignore`**: exclude `.git`, `.env*`, `data/`,
   `node_modules/`, `.venv/`, `__pycache__/`, `.pytest_cache/`,
   `frontend/dist/`, `agent-docs/`, `*.tsbuildinfo` — keeps secrets and junk
   out of the build context (the Dockerfile only COPYs what it needs, but
   the context should not ship `.env` to the daemon at all) and speeds up
   context upload.
4. **Create `docs/deployment.md`** with:
   - *Prerequisites*: Docker + Compose v2, a Clerk application (link to
     Clerk's production-instance guide: production keys, domain/DNS,
     OAuth config), a domain + reverse proxy for TLS.
   - *Quickstart* (migrate-before-serve order):
     `git clone` → `cp .env.prod.example .env.prod` and fill in →
     `docker compose --env-file .env.prod -f docker-compose.prod.yml build` →
     `... up -d postgres` →
     `... run --rm timla alembic upgrade head` →
     `... up -d timla` →
     verify `curl http://127.0.0.1:8899/api/health` and
     `... run --rm timla alembic current` → put a TLS-terminating reverse
     proxy in front (short Caddy/nginx snippet; note the one-hop `ProxyFix`
     assumption and why the app port stays on loopback).
   - *Configuration reference*: table of the operator-set vars
     (`POSTGRES_PASSWORD`, `SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
     `TIMLA_BIND`) plus the compose-internal ones (`DATABASE_URL`,
     `TIMLA_ENV`) with the fail-loud guards in `app/app.py` called out.
     `TIMLA_PORT` is deliberately omitted — gunicorn's bind and the compose
     port mapping are fixed at 8899, so it has no effect in this deployment.
   - *Upgrades*: `git pull` → **backup** → `build` → **`stop timla`** →
     `alembic upgrade head` → `up -d timla` (migrate-before-serve, and the
     old app must not keep serving during schema changes; brief note that
     this implies a short window of downtime, which is the honest MVP
     answer).
   - *Backups*: operational commands —
     `docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres pg_dump -U timla -d timla > timla-backup.sql`
     and the matching `psql` restore, with the preconditions spelled out:
     stop the app first and restore into an empty database/schema (piping a
     dump into a populated DB is unsafe); state that the named volume is
     persistence, not a backup.
   - *Auth (Clerk) — not self-hosted*: the honest section per design
     decision 8, including that removing the Clerk dependency is out of MVP
     scope, and that the Vite build bakes the publishable key into the
     bundle so each deployment builds its own image (no generic prebuilt
     image).
   - *Known limitations*: container runs as root; deps lower-bounded, not
     pinned; single-node compose only.
   - *What the seed script is (and isn't)*: `scripts/seed.py` is demo data
     for development, not part of production setup.
5. **Update `README.md`**: add a "Self-hosting" section between Development
   and License — 5-10 lines: the condensed clone-to-running command sequence
   plus a link to `docs/deployment.md`, and one sentence on Clerk being the
   only hosted dependency. Soften the "Status: idea stage — nothing usable
   yet" opening blurb just enough to not contradict a working self-hosting
   quickstart (e.g. "early stage — staff scheduling MVP under active
   development"). Keep the existing dev instructions untouched.
6. **Add a one-line header comment to the dev `docker-compose.yml`**
   pointing at `docker-compose.prod.yml` (and vice versa) as the drift
   mitigation — this is the only change to the dev file.
7. **Verify end-to-end** (see Test Plan) on a clean state: fresh named
   volume, real image build, migrations, health check, page load, negative
   tests.

## Risks

- **Compose duplication drift**: `docker-compose.yml` (dev) and
  `docker-compose.prod.yml` share service shapes; future changes (new env
  var, port change) must land in both. Mitigation: the cross-pointer header
  comments (step 6); the prod file is small enough to diff by eye.
- **Clerk key at build time** means the image is deployment-specific. If a
  future issue wants a prebuilt GHCR image, the frontend key handling must
  move to runtime injection — out of scope here; the docs must not promise
  a generic image.
- **Same-directory compose projects**: even with `name: timla-prod`, an
  operator running bare `docker compose up` (no `-f`) on a prod box gets the
  *dev* stack. The quickstart must always spell out the full
  `--env-file ... -f ...` invocation (or suggest a shell alias) — never a
  bare `docker compose` command.
- **`/api/health` proves liveness, not correctness**: it returns static env
  state without touching Postgres. The test plan compensates with
  `alembic current` plus a DB-touching HTTP request; a full Clerk sign-in
  walkthrough needs a real browser and is listed as a manual final check.
- **Postgres 18 volume layout** (`/var/lib/postgresql` mount with
  version-specific subdir) already bit the dev compose once; the prod file
  uses the same mount point to avoid a data-loss-shaped surprise on upgrade.
- **Docs-only claims rot**: "Done when a fresh machine can follow the
  README" — the verify step must actually be executed, not assumed. A full
  `docker build` (npm ci + pip install) takes several minutes on first run.

## Test Plan

- `docker compose --env-file .env.prod -f docker-compose.prod.yml config`
  — file parses; with `POSTGRES_PASSWORD`/`SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`
  unset it must **fail with the `:?` messages**, not silently default.
- Fresh-machine simulation from the repo root with a throwaway `.env.prod`
  (Clerk development-instance publishable key), following the documented
  order exactly:
  1. `docker compose --env-file .env.prod -f docker-compose.prod.yml build`
  2. `... up -d postgres`
  3. `... run --rm timla alembic upgrade head` — completes; then
     `... run --rm timla alembic current` shows the head revision.
  4. `... up -d timla`
  5. `curl -s http://127.0.0.1:8899/api/health` →
     `{"status": "ok", "env": "prod", "dev": false}`
  6. `curl -s http://127.0.0.1:8899/` returns the built SPA's `index.html`
     (not the "frontend not built" JSON error).
  7. DB-touching request: `curl -s http://127.0.0.1:8899/svar/bogus-token/data`
     → JSON 404 (`no_such_token`-style), proving a real Postgres query ran
     through the migrated schema — not just static health.
  8. `curl -s http://127.0.0.1:8899/data/anything` → 401 JSON (prod auth
     guard active, not the SPA fallback).
- Isolation check: with the dev stack also present, prod commands operate on
  the `timla-prod` project only (`docker compose ls` shows two distinct
  projects; dev containers untouched). Run the prod stack with a different
  bind for this test (e.g. `TIMLA_BIND=127.0.0.1:8898`) — both stacks
  otherwise contend for host port 8899.
- Negative tests, split correctly:
  - *Compose substitution guard*: unset `CLERK_PUBLISHABLE_KEY` in
    `.env.prod` → `docker compose ... config`/`up` fails with the `:?`
    message (never reaches the container).
  - *App runtime guard*: run the built image directly with
    `docker run -e TIMLA_ENV=prod -e SECRET_KEY=x -e DATABASE_URL=... <image>`
    and no `CLERK_PUBLISHABLE_KEY` → gunicorn workers die with the
    fail-loud `RuntimeError` from `app/app.py` (visible in the container
    logs). Same for a missing `SECRET_KEY`.
- Existing dev flow regression: `docker compose up -d` (dev file) still
  works unchanged (only a header comment was added); backend test suite
  (`pytest app`) untouched by this issue (no Python changes).
- Manual final check (browser): Clerk sign-in against the deployed instance
  and first-org onboarding — confirms the baked-in publishable key matches
  the backend's.
- Docs walkthrough: follow `README.md` → `docs/deployment.md` literally on
  a clean checkout and confirm no undocumented step is needed.
