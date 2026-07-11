# Deployment (self-hosting)

How to run a production Timla instance with Docker Compose: one app
container (gunicorn serving the API and the built frontend) and one
Postgres container, defined in [`docker-compose.prod.yml`](../docker-compose.prod.yml).

> **Always pass the full flags.** The repo also contains a dev
> `docker-compose.yml`, so a bare `docker compose up` on a production
> box starts the *dev* stack. Every command below therefore spells out
> `--env-file .env.prod -f docker-compose.prod.yml` — consider a shell
> alias:
>
> ```bash
> alias timla-prod='docker compose --env-file .env.prod -f docker-compose.prod.yml'
> ```

## Prerequisites

- Docker with Compose v2 (`docker compose version`).
- A [Clerk](https://clerk.com) application. For a real deployment you want a
  **production instance** (its `pk_live_...` publishable key, your domain,
  DNS records, OAuth credentials) — follow
  [Clerk's production deployment guide](https://clerk.com/docs/deployments/overview).
  A development-instance key (`pk_test_...`) works for trying things out.
- A domain and a TLS-terminating reverse proxy (Caddy, nginx, ...) on the
  same host. The app itself only listens on loopback.

## Quickstart

From `git clone` to a running instance:

```bash
git clone https://github.com/timla-se/timla.git
cd timla

# 1. Configure. Fill in every variable — compose refuses to start with
#    unset secrets. Generation hints are in the file.
cp .env.prod.example .env.prod
$EDITOR .env.prod

# 2. Build the image. The Clerk publishable key is baked into the frontend
#    bundle here, so .env.prod must be filled in BEFORE building.
docker compose --env-file .env.prod -f docker-compose.prod.yml build

# 3. Start postgres and run migrations — before the app serves traffic.
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm timla alembic upgrade head

# 4. Start the app.
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d timla

# 5. Verify.
curl -s http://127.0.0.1:8899/api/health
# → {"status": "ok", "env": "prod", "dev": false}
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm timla alembic current
# → shows the head revision
```

Then put a reverse proxy in front (next section) and sign in via Clerk to
create the first organization.

## Reverse proxy and TLS

The app binds to `127.0.0.1:8899` and expects **exactly one** reverse-proxy
hop in front of it: TLS termination is the proxy's job, and the app's
`ProxyFix` middleware trusts one level of `X-Forwarded-*` headers.

Caddy (automatic TLS):

```caddyfile
timla.example.se {
    reverse_proxy 127.0.0.1:8899
}
```

nginx (with TLS configured separately, e.g. via certbot):

```nginx
server {
    server_name timla.example.se;
    # ... listen 443 ssl; certificates ...
    location / {
        proxy_pass http://127.0.0.1:8899;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

**Why loopback:** because `ProxyFix` trusts one forwarded hop and the
`/svar` share-link rate limiter keys on the resulting client address,
exposing port 8899 directly to the internet would let clients spoof their
IP and bypass rate limiting. `TIMLA_BIND` in `.env.prod` can override the
bind for special topologies (e.g. a proxy on another host), but then the
port must be unreachable from untrusted networks by other means (firewall,
private network).

## Configuration reference

Operator-set, in `.env.prod` (read only by docker compose for variable
interpolation — the file is never copied into or mounted in the image; the
app receives everything as real environment variables):

| Variable | Secret | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Password for the bundled Postgres. Interpolated into `DATABASE_URL`, so it must be URI-safe — use the hex generator from `.env.prod.example`. |
| `SECRET_KEY` | yes | Flask session signing key. Must be stable across restarts and shared by all gunicorn workers. |
| `CLERK_PUBLISHABLE_KEY` | no | Clerk publishable key. One value feeds both the frontend build arg and the backend runtime — the halves cannot drift apart. Set before `build`. |
| `TIMLA_BIND` | no | Optional host bind, default `127.0.0.1:8899`. See the warning above before changing. |

Set by the compose file (not operator-configurable there):

| Variable | Value | Notes |
|---|---|---|
| `TIMLA_ENV` | `prod` | Enables the fail-loud guards in `app/app.py`: the app **refuses to start** if `SECRET_KEY` or `CLERK_PUBLISHABLE_KEY` is missing, instead of booting broken. Compose additionally refuses to start at all (`${VAR:?}`) if the secrets are unset. |
| `DATABASE_URL` | `postgresql://timla:${POSTGRES_PASSWORD}@postgres:5432/timla` | Postgres is only reachable on the compose network; no host port is published. |

`TIMLA_PORT` is deliberately not part of this deployment: gunicorn's bind
and the compose port mapping are fixed at 8899. Change the *host* side via
`TIMLA_BIND` instead.

## Upgrades

Migrations run while the old app is stopped (schema changes must not race
running workers), which means a short window of downtime — the honest MVP
answer; zero-downtime deploys are out of scope.

```bash
git pull

# Backup first — see the next section.

docker compose --env-file .env.prod -f docker-compose.prod.yml build
docker compose --env-file .env.prod -f docker-compose.prod.yml stop timla
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm timla alembic upgrade head
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d timla
```

## Backups

The named `pgdata` volume is **persistence, not a backup**: it survives
container recreation, but not volume deletion, disk failure, or a botched
migration. Take real dumps:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U timla -d timla > timla-backup.sql
```

Restore — only into an **empty** database, with the app stopped (piping a
dump into a populated database is unsafe):

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop timla
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U timla -d postgres -c 'DROP DATABASE timla' -c 'CREATE DATABASE timla OWNER timla'
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U timla -d timla < timla-backup.sql
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d timla
```

## Auth (Clerk) is not self-hosted

Clerk is the **one component of MVP Timla that is not self-hosted**. What
that means in practice:

- **User identities live in Clerk's cloud**, not in your Postgres: manager
  accounts, e-mail addresses, sign-in flows and sessions belong to the
  Clerk application you create. Your database stores organizations, staff,
  schedules and availability, linked to managers by Clerk user id.
- **Availability of sign-in depends on Clerk.** If Clerk is down, managers
  can't sign in or refresh their sessions. The unauthenticated staff
  share-links (`/svar/<token>`) keep working — they don't touch Clerk.
- **The publishable key is baked into the frontend bundle at image build
  time** (Vite inlines `VITE_*` variables). Each deployment therefore builds
  its own image with its own key — there is no generic prebuilt Timla image
  in MVP, and changing the key means rebuilding.
- Removing the Clerk dependency (self-hosted auth) is out of scope for MVP.

## Known limitations

- The app container runs as root (no `USER` in the Dockerfile yet).
- Python dependencies are lower-bounded, not pinned — builds are not
  perfectly reproducible.
- Single-node docker compose only; no clustering, no zero-downtime deploys.

## What the seed script is (and isn't)

`scripts/seed.py` creates *demo* data for development. It is not part of
production setup — a fresh production instance starts empty, and the first
signed-in manager creates their organization through the UI.
