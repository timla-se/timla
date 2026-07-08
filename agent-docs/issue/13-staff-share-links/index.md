# Issue #13: Staff share-links — personal tokenized views

**Based on:** main

## Summary

The staff-facing, login-free mobile page a worker opens from the personal
link their manager texts them. The token (already minted by
`/action/staff/:id/regenerate-link`) resolves to one staff member and org.
Per `design/Timla App - Tillgänglighet länk.dc.html`, the worker reports
when they want / can't work and sees their published shifts; submitting
replaces their whole availability document. The worker URL is Swedish
(`/svar/:token`, like `/schema`); the data endpoints are the only
unauthenticated API surface. Retires the placeholder `/link` name. **Ships
on the existing schema (no migration)** — folds in #7; defers the design's
extra fields (desired-shifts/week, note, exception provenance, "Kan extra").

## Triage Status

| Field | Value |
|-------|-------|
| **Ready to work** | Yes — scope decisions resolved (fold #7 in; defer all schema-touching design extras) |
| **Risk** | High (first unauthenticated public surface), mitigated by shipping additive-only |
| **Safe for junior** | No |

## Plan Review

**Status:** Reviewed
**Reviewed:** 2026-07-08
**Feedback:** Codex flagged the security gaps of an unauthenticated surface — all applied: rate-limit keyed by IP not token (per-token buckets defeat enumeration); server owns exception provenance via id-matching (client can't forge `source:'manager'`); hardened public input validation (unknown-field/list-size/note-length/date bounds); `/svar` bootstraps outside ClerkProvider so the public token page loads no auth JS and needs no Clerk key; `after_request` sets `no-store` + `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex` (covers 404s + page); Vite regex proxy for only the JSON sub-paths; `/link/:token` → 301 to `/svar/:token`; completed the stale-`/link` inventory (10 spots) and the touched-files list (main.tsx, vite.config, types, StaffDetail, data_staff, test_health, seed, README); week label generated from `week_monday`. **Post-review scope call (user):**
design is not authoritative — deferred every schema-touching design extra
(desired-shifts/week, note, exception provenance, "Kan extra" dated wishes),
so #13 now needs **no migration** and ships additive-only; #7 folded in.
**Second review (Fable subagent):** verified the Flask routing/auth/serving
mechanism empirically (holds). Fixed two silent-data-loss bugs it caught:
(H1) exceptions are now an explicit add/remove delta, not a blind
delete-all-dated, so concurrent manager additions + history survive; (H2)
the bucket read is exact-match with non-bucket recurring rows passed through
untouched (the overlap rule would expand 09:00–17:00 → 06:00–22:00 and delete
night intervals). Also: payload carries `org.timezone` + current/next week;
`FOR UPDATE` on the resolver; nosniff + `X-Frame-Options: DENY`; `/link`
redirect gets `no-store`; limiter prunes; CSRF documented as a non-issue;
exception reason-text added to Deferred. Verdict was ready-with-fixes; fixes
applied.

## Related Files

- [plan.md](plan.md) - Full implementation plan

## Related Issues

- #7 Availability editor — folded in; closes as delivered-by-#13
- #10 Publish schedule — the schedule *read* is here (horizon-agnostic, no ISO-week strings); the publish *action* + the publication-period model decision (bias toward arbitrary from/to periods) live in #10
- #6 Staff management — owns the "Kopiera delningslänk" URL that changes to `/svar/:token`
- #3 Auth (merged) — established `/svar` as the sole unauthenticated surface
- #9 Shift editor — consumes the availability this collects, via `/compute/conflicts`
- #11 Auto-schedule — inherits the deferred `desired_shifts_per_week`
