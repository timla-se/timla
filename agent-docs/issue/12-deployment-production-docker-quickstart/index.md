# Issue #12: Deployment story: production docker-compose + quickstart docs

**Based on:** main

## Summary

Adds a self-contained production deployment path: a new
`docker-compose.prod.yml` (project `timla-prod`, gunicorn app + postgres,
fail-loud `${VAR:?}` secrets, named volume, single Clerk key input), a
committed `.env.prod.example` operator template (with a `.gitignore`
exception), a `.dockerignore`, a `docs/deployment.md` clone-to-running guide
(migrate-before-serve order, config reference, backups, reverse-proxy/TLS,
and an honest section on Clerk being the one non-self-hosted component), and
a short "Self-hosting" section in `README.md`. The existing multi-stage
`Dockerfile` is reused unchanged; the dev `docker-compose.yml` only gains a
cross-pointer comment.

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |

No blockers: issue #3 (Clerk auth, referenced in the body) is closed; no
other open plan touches the compose/README/docs files. No application code
changes — but this defines the documented production path (credentials,
persistent data, migration/upgrade order), hence Medium rather than Low.

## Plan Review

**Status:** Reviewed

Reviewed: 2026-07-11 (codex). Key feedback applied: migrate-before-serve
ordering, compose project isolation (`name: timla-prod`), dedicated
`.env.prod` via `--env-file` (plus the required `.gitignore` exception for
the example), single Clerk key feeding both build arg and runtime env, full
postgres env spec, `.dockerignore`, split negative tests (compose `:?` guard
vs app runtime guard), a DB-touching verification step, and risk raised to
Medium. Re-review confirmed the plan complete after three final fixes:
`stop timla` before upgrade migrations, a distinct `TIMLA_BIND` for the
dev/prod isolation test, and restore preconditions (stopped app, empty DB).

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
