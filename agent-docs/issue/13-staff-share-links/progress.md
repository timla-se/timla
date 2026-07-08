# Implementation Progress: Issue #13

**Started:** 2026-07-08
**Last updated:** 2026-07-08
**Status:** Completed

## Completed Steps

- [x] Phase 1.1: app/ratelimit.py — in-memory IP-keyed sliding-window limiter (prunes, safety-cap sweep)
- [x] Phase 1.2: app/routes/svar.py — resolver (FOR UPDATE), GET /svar/:token/data, PUT (recurring whole-replace bucket-only + exception delta), /link 301
- [x] Phase 1.3: app/routes/__init__.py — register blueprint
- [x] Phase 1.4: app/app.py — retire link from API_PREFIXES, /svar+/link after_request security headers, IP rate-limit before_request
- [x] Phase 1.5: frontend/vite.config.ts — regex proxy for /svar/:token/(data|availability) + /link redirect, drop /link
- [x] Phase 3: app/tests/test_svar.py (13 tests) + test_health.py update — full suite 91 passed
- [x] Phase 4.8: frontend/src/main.tsx — branch /svar/* to SvarRoot outside ClerkProvider
- [x] Phase 4.9: frontend/src/svarApi.ts — anonymous token-scoped API
- [x] Phase 4.10: frontend/src/pages/SvarView.tsx — the mobile page (MVP subset)
- [x] Phase 4.11: frontend/src/buckets.ts — bucket constants + exact-match grid helpers
- [x] Phase 4.12: frontend/src/types.ts (SvarContext) + Staff.tsx shareUrl → /svar
- [x] Phase 5: docs (primitives.md, api.md incl. new /svar section, CLAUDE.md, README.md) + seed.py + action_staff.py comment
- [x] Verification: backend 91 pass, frontend precommit (lint+typecheck+build) green, live drive on mobile viewport

## Current Work

Complete. `--commit` not passed → stays on branch `issue/13-staff-share-links` for review.

## Notes

Live-verified end-to-end (Vite :5173 + Flask :8899, seeded Demo Bistro):
- The /svar/:token page renders faithfully on a 414px mobile viewport (context
  header, tab switcher, 7×3 bucket grid, horizon-agnostic "Ditt schema", sticky
  submit, confirmation bottom-sheet).
- Toggle → Spara → confirmation works; a second load persists the toggled
  buckets.
- **H2 preservation confirmed against the DB:** a worker save added the 2
  toggled bucket rows AND kept all 5 of Lisa's original non-bucket (09:00–17:00)
  wishes untouched — not expanded to 06:00–22:00, not deleted.
- Live security headers on /svar/:token/data: no-store, no-referrer,
  noindex, nosniff, X-Frame-Options: DENY. /link/abc → 301 /svar/abc + no-store.

Structurally satisfied (not separately live-tested): submitted availability
feeds the same `availability_interval` table `/compute/conflicts` reads, so it
is respected by the shift editor (#9).

Zero migrations (all schema-touching design extras deferred). #7 folded in.

**Design correction (updated design file):** the availability UI was reworked
from the flat 7×3 tap grid to the new **day-row model** — each weekday is a
card you toggle on/off (default = whole day = all 3 buckets), with a "Vissa
tider" expander to narrow to Morgon/Dag/Kväll. Added the period-framing header
("Du svarar för schemat" + period range, "Fyll i din normalvecka en gång…")
and renamed the dated section to "Avvikelser i perioden". Frontend-only —
same per-weekday bucket data model, so backend/buckets.ts/API contract and all
tests are unchanged. Re-verified live: whole-day toggle → 3 buckets, narrowing
→ subset, and H2 preservation still holds (Ali's seeded 15:00–23:00 non-bucket
wishes survived a day-model save). Still deferred per prior decision: "Önskat
antal pass / vecka", the free-text note, and "Kan extra" (dated positive
availability — needs the wish-is-recurring CHECK relaxed).

**Buckets removed 2026-07-08 (user decision "Ta bort buckets och byt
datamodell"):** the 3 fixed time buckets (Morgon/Dag/Kväll) are gone. The
worker view is now day-first with **one arbitrary time range per weekday** —
tap a day = whole day (00:00–24:00), "Vissa tider" opens a start/end control
(native `<input type=time>`). No buckets anywhere (backend validation now
accepts arbitrary `0<=start<end<=1440`, same as the manager PUT). The recurring
layer is a **full whole-replace** (H2 passthrough dropped — no worker/manager
split remains); exceptions unchanged (delta). `frontend/src/buckets.ts` →
`frontend/src/ranges.ts`. Plan Design Decisions 2 & 3 updated/superseded.
New accepted limitation: one range per weekday (multi-range days deferred;
a stored split collapses to its bounding span). Backend 91 pass; frontend
lint+typecheck+build green.

**Time control finalized 2026-07-08 (design-agent proposal in the updated
design file):** "Vissa tider" now shows **4 preset chips** (Hela dagen / Morgon
/ Dag / Kväll — the old buckets, now as *shortcuts*) **plus a free dual-handle
range slider** on a **06:00–22:00 canvas** (15-min snap, 30-min min span, live
range + duration). Buckets return only as convenience presets on a free
control. `WHOLE_DAY` is now 06:00–22:00 (was 00–24); nights stay a manager-UI
concern. Backend unchanged (already accepts these ranges).

**Dates on the weekday buttons (user request):** each day row now shows the
concrete date in front of the range — "Måndag  6 juli · 09:00–17:00". Dates are
anchored to the **first week of the period** (ISO Monday of the week containing
`schedule.from`), computed frontend-side from `schedule.from`; off days show the
date alone. NOTE: because the first-week Monday can fall a day or two before the
horizon start, verify this anchoring is the intended one (alternative: first
occurrence of each weekday on/after the period start — but that lists dates
out of order). Verified live: presets, slider drag, and dates all round-trip
(Måndag 13:00–22:00 via slider → persisted 780–1320).

**Mini calendar "Din period i överblick" added 2026-07-08 (design-agent
proposal; user chose availability-only):** new `frontend/src/overview.ts`
(`buildOverview`) + `PeriodOverview` in SvarView, placed between the
availability section and "Ditt schema". A month-grouped wall calendar over the
period; each in-period day is a token coloured by resolved status — green
(vill jobba), red (kan inte, incl. dated blocks), green+red-dot (Delvis = both
want & cannot that weekday); out-of-period and adjacent-month days faded; ISO
week numbers on the left; legend below. Derived live via useMemo from
want/cannot/exceptions — verified live (Lisa's Mon–Fri wishes = green, seeded
Sunday block = red; toggling Måndag off cleared the July Monday tokens).
Read-only. Dropped the design's "Kan extra" legend item (dated positive
availability still deferred — can't occur yet). Frontend lint+typecheck+build
green; backend untouched.
