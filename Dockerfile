# Timla Docker image — multi-stage build.
#
# Stage 1 (frontend-build): Node builds the frontend with Vite.
# Stage 2 (runtime): Python slim with Flask + psycopg, gets the built
#   frontend/dist copied from stage 1. Server hosts therefore don't need
#   Node.js installed — only Docker.

# ----- Stage 1: frontend build -----
FROM node:24-alpine AS frontend-build
WORKDIR /build

# Vite inlines VITE_* at build time, so the Clerk publishable key must be
# present during `npm run build:frontend`, not just at runtime. Pass it with
# `docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_...`. It's a
# publishable (non-secret) key, safe to bake into the bundle.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

# Copy workspace manifests first so `npm ci` can be cached across source changes.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm ci

COPY frontend ./frontend

RUN npm run build:frontend

# ----- Stage 2: Python runtime -----
FROM python:3.13-slim
WORKDIR /timla/app

COPY requirements.txt /timla/
RUN pip install --no-cache-dir -r /timla/requirements.txt

COPY app/ /timla/app/
COPY scripts/ /timla/scripts/
COPY alembic.ini /timla/alembic.ini
COPY migrations/ /timla/migrations/
# The Alembic CLI looks for `alembic.ini` in cwd by default, but our
# WORKDIR is /timla/app. ALEMBIC_CONFIG lets the CLI find it from anywhere.
ENV ALEMBIC_CONFIG=/timla/alembic.ini

COPY --from=frontend-build /build/frontend/dist /timla/frontend/dist

EXPOSE 8899
CMD ["gunicorn", "--bind", "0.0.0.0:8899", "--workers", "2", "app:app"]
