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

## Gotchas

- Postgres from docker-compose listens on host port **5433** (not 5432),
  loopback only.
- API responses must carry `Cache-Control: no-store...`; SPA/assets must not.
