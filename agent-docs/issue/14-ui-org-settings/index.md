# Issue #14: UI: organization settings — name, timezone, scheduling rules

**Based on:** main

## Summary

Manager settings view: edit org name and timezone (new `PATCH /data/org`)
and the org scheduling rules via the existing `GET/PUT /data/rules`, with
the shift editor's conflict warnings picking up new rule values from that
point on (already guaranteed server-side — rules are read per check).
Carries the timezone-change policy delegated by #10 (publications
reinterpret under the current org zone; no freeze/rebase).

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes |
| **Risk** | Medium |

Dependencies #2, #3, #4, #5 (and the shift editor #9, publications #10)
are all closed; no open plans touch the same files.

## Plan Review

**Status:** Reviewed

**Reviewed:** 2026-07-10

**Feedback:** Codex review applied: invalidate timezone-dependent caches
(`['shifts']`/`['publication']`, not just `['org']`), carry #10's
publication policy into this issue, specify the async form-state
lifecycle, correct conflict terminology (max_hours/insufficient_rest are
hard conflicts), broaden PATCH edge-case tests, and raise risk to Medium
for the timezone-change blast radius.

## Related Files

- [plan.md](plan.md) - Full implementation plan
- [progress.md](progress.md) - Implementation progress log
- [research.md](research.md) - Research findings (if exists)
