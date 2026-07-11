# Timla

> **Status: early stage — staff scheduling MVP under active development.**
> Expect things to change. The first milestone
> ([MVP](https://github.com/timla-se/timla/milestone/1)) covers only the
> staff-scheduling (work schedule) module — booking modules come later.

Timla is an open-source, composable platform for time, booking and
scheduling, aimed at Swedish organizations — hair salons, sports clubs,
restaurants, freelancers, and everyone else whose day revolves around a
calendar.

Existing tools (Calendly, Planday, Doodle) each solve *one* problem. Timla
is the composable layer underneath: a core time engine with modules for
appointment booking, staff scheduling, resource booking, time reporting and
meeting planning. The primary end-user interface is a web UI (booking page,
calendar, schedule); an agent interface is an optional parallel channel
built on the same API primitives.

Timla is part of the same family as [OpenVera](https://github.com/openvera/openvera)
(bookkeeping) and shares its philosophy: build primitives that drive both
web UI and agents, keep data self-hostable, integrate with the Swedish
ecosystem (Swish, BankID, SMS reminders).

## Development

Backend is Flask + Postgres (raw psycopg3, Alembic for migrations);
frontend is React 19 + Vite in an npm workspace. The API follows a
composable primitives convention — see [docs/primitives.md](docs/primitives.md).

```bash
# Postgres (host port 5433) + app container
docker compose up -d

# Frontend dev server (proxies /api and /svar JSON to the backend)
npm install
npm run dev

# Backend on the host instead of Docker, if you prefer
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATABASE_URL=postgresql://timla:timla@localhost:5433/timla \
  TIMLA_ENV=dev .venv/bin/python app/run_server.py

# Tests and checks
.venv/bin/pytest app
npm run lint && npm run typecheck:frontend && npm run build:frontend
```

## Self-hosting

A production instance runs from [`docker-compose.prod.yml`](docker-compose.prod.yml)
(gunicorn app + Postgres). Auth is the one hosted dependency: manager
sign-in goes through a [Clerk](https://clerk.com) application you create —
everything else lives in your own Postgres.

```bash
git clone https://github.com/timla-se/timla.git && cd timla
cp .env.prod.example .env.prod   # fill in secrets + Clerk key first
docker compose --env-file .env.prod -f docker-compose.prod.yml build
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm timla alembic upgrade head
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d timla
```

Full guide — reverse proxy/TLS, config reference, upgrades, backups:
[docs/deployment.md](docs/deployment.md).

## License

[MIT](LICENSE)
