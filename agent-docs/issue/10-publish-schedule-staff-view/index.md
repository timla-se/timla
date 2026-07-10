# Issue #10: Publish schedule and read-only staff view

**Based on:** main

## Summary

Land the publish action on the existing snapshot model: `POST
/action/publish` freezes a period's live shifts into a `publication`
snapshot that staff share links read, while managers keep editing live.
Settles the issue's open design decision by generalizing the publication
period from one ISO week to an arbitrary `from`/`to` date range (migration
`0004`: `period_start`/`period_end` + non-overlap exclusion constraint),
reworks `GET /data/publications` (range form, list shape, server-computed
`diverged`), swaps the staff read to an overlap query (contract unchanged),
and adds the week view's "Publicera schema" button + four-state
publish/divergence badge (Utkast / Publicerad / Ändringar sedan
publicering / Delvis publicerad).

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-10
**Feedback:** Codex found the interval model, snapshot semantics, and test
coverage solid; it required a per-org advisory lock (FOR UPDATE can't
serialize first-publishes), an executable downgrade, preserved
`published_at` on trimmed fragments, a stepwise backfill verification, a
shared `app/publications.py` domain module, batched divergence queries, a
distinct "Delvis publicerad" badge state, publish-error surfacing, and a
documented #14 timezone-change policy — all applied.

## Related Files

- [plan.md](plan.md) - Full implementation plan
