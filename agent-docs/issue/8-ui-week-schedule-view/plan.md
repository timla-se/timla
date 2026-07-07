# Implementation Plan: UI: week schedule view

## Summary

Build the Arbetsschema screen per `design/Timla App - Arbetsschema
Strandkiosken.dc.html`: a read-only week view with weekday rows × a
horizontal hour axis, shift bars colored by role, a per-hour coverage
heat-strip, week navigation with klartext labels ("Vecka 28 · 7–13 juli"),
and a Publicerad/Utkast status chip backed by a new `GET /data/publications`
read endpoint. Editing (#9), publishing (#10) and auto-scheduling (#11) are
explicitly out — but the layout leaves their slots ready.

## Triage Info

> Decision-support metadata for this issue.

| Field | Value |
|-------|-------|
| **Blocked by** | None — #21 (tokens/shell) is merged, `GET /data/shifts` + seed data exist |
| **Blocks** | #9 (shift editor builds directly on this view), #10 (publish action lands next to the status chip) |
| **Related issues** | #9, #10, #11 (Auto-schemalägg button belongs there), #21 (tokens + app shell), **#27 (custom staff fields — supplies the bar color key later)**. Opening hours (for the "Öppet 10–20" chip and sharper coverage) are covered by **no existing issue** — #14 is name/timezone/rules today; flag as a possible #14 extension when it's planned |
| **Scope** | ~10 files: 1 new page + helpers in `frontend/src/`, small `Layout`/`App` updates, 1 new backend read route + test + docs. No migrations |
| **Risk** | Medium |
| **Complexity** | Medium — the bar geometry (lanes, clamping, % positioning) is the tricky part |
| **Safe for junior** | No — timeline math and design fidelity need care |
| **Conflict risk** | Low — no other open plans; touches `Layout.tsx` which #21 just rewrote (merged) |

### Triage Notes

- Issue is open, milestone MVP, project status "Todo", no blocker labels.
- Issue comment (design note) requires building on the #21 tokens — merged,
  so satisfied.
- The issue body says "week grid (days × staff)"; the newer Arbetsschema
  design uses weekday rows × a time axis instead. **The design file wins**
  — it postdates the issue text and is the explicit spec.
- **The Kalender design file is NOT this issue.** It shows the booking
  calendar (uthyrning/leverans/evenemang/drift) — booking-module scope,
  post-MVP. The Kalender nav item stays inert; the new **Arbetsschema** nav
  item is added for this view (design nav order: Översikt, Kalender,
  Arbetsschema, Personal, …).
- Design digest with exact values: [research.md](research.md).

## Analysis

### What the design needs vs what exists

Data: `GET /data/shifts?period=2026-W28` already returns everything the
grid renders (staff_id, starts_at/ends_at, note), and `GET /data/staff`
supplies names/roles. The coverage heat-strip is pure derivation (count
overlapping shifts per hour).

**Timezone rule (load-bearing):** the API returns `timestamptz` *instants*,
not wall-clock times. All day grouping, minute-of-day math, hour labels,
coverage buckets and the "/schema → current week" redirect must be computed
in **`org.timezone`** (from `/data/org`, already fetched by the shell), via
`Intl.DateTimeFormat(..., { timeZone })` part extraction — never via
browser-local `Date` getters. A `time.ts` helper `wallClock(instant, tz)` →
`{isoDate, weekday, minuteOfDay}` centralizes this so the page never touches
raw getters. Two gaps:

1. **Publish state** — the `publication` table exists (unique per org+week)
   but has no endpoint. #8 shows a status chip (Publicerad tors 10 juli /
   Utkast), so add a minimal read: `GET /data/publications?period=YYYY-Www`
   → `{week, published_at}` or `null`. The table is keyed by the week
   *string*, so the route takes `period` **explicitly** (required; not via
   `resolve_period()`, which also accepts from/to ranges), validates with
   `week_monday()` and queries by the original string. The #10 publish
   action will POST next to it later (its divergence indicator may need
   snapshot data — out of scope here).
2. **Bar color key** — the mock colors bars by *experience level*. Per
   user direction (2026-07-07) that key must be **org-defined custom
   fields** (GitHub Projects-style: admin creates "Erfarenhet" — or
   "Nivå: Senior/Junior" — with their own select options), which is its
   own feature: **#27**. #8 therefore ships with **neutral bars** (one
   tint pair for all staff; the design language still carries via mono
   times, coverage strip and the block geometry) and a small **color-key
   abstraction** in the page: bar tint and the Erfarenhet legend group
   resolve through a `colorKey(staff) → tint` function that defaults to
   the neutral constant. When #27 lands, it plugs the designated field in
   there without restructuring the view.

Design elements deliberately deferred, with their slots:
- **"Publicera schema"** button → #10 (the chip marks the spot).
- **"Auto-schemalägg"** button → #11.
- **Ö/S role badges + "S?" warning chip** → needs per-shift roles and
  conflict surfacing; #9/future. Shift `note` renders as native `title` on
  the bar so seeded notes stay reachable.
- **"Öppet 10–20" chip content** — opening hours aren't in the org model
  and no issue covers them yet (possible #14 extension). The chip renders
  real numbers instead: "{N} pass · {M} i personal" for the shown week.
- **Open (unassigned) shifts** — required by the issue but absent in the
  mock. Design: same bar geometry, dashed 1px `#c05a3a` border, Lucka tint
  `#e8b7a5` at ~35% opacity background, text "Öppet pass" in `#a44227` +
  mono time range. Reuses the design's warning/dashed language.

### Geometry

- **Hour span**: derived from the week's data — `floor(min start)` to
  `ceil(max end)` in org-local hours, defaulting to 08–20 when the week is
  empty, always ≥ 8 columns so bars never get absurdly wide. Overnight
  shifts (org-local end *date* after start date): positioning/span uses an
  effective end of minute 1440 — never raw end-minute, which would produce
  a negative-width bar — and the time label gets an "→" suffix (the shift
  belongs to its start day, per week semantics). The grid gets a min-width
  + horizontal scroll inside the card so long axes (e.g. 09–23 in seed)
  never crush the labels.
- **Lanes**: greedy interval stacking per day — sort by start, place each
  shift in the first lane whose last bar ends ≤ its start. Row height =
  `24 + lanes * 36 + 8` px (matches the mock's 98/134 at 2/3 lanes).
- **Positioning**: `left`/`width` as percentages of the hour span, same as
  the mock's 12-column math.
- **Coverage strip**: one cell per axis hour. Level = count of **assigned**
  shifts covering the hour. **Lucka = an open shift covers the hour** (an
  open shift — `staff_id NULL` — is an explicit unstaffed need, so lucka
  and öppet pass are the same signal; revised 2026-07-07 per user, the
  earlier "activity window" heuristic falsely flagged closed midday hours
  as gaps). Hours with no shifts at all are neutral `#efe6d4`; lucka
  `#e8b7a5`; 1 = `#f0d3a0`, 2 = `#d8e4d2`, 3+ = `#bcd3c0`. Native `title`
  tooltip "13:00 · 2 i tjänst".

### Routing & shell

- Route `/schema/:week` (e.g. `/schema/2026-W28`) + `/schema` →
  redirect to the current week. Deep-linkable weeks; prev/next update the
  URL. (The backend SPA fallback already serves `/schema/*` — it is the
  example route in the verify recipe.)
- `Layout.tsx`: add **Arbetsschema** nav item (icon `CalendarRange` or
  similar lucide with 1.75 stroke) routed to `/schema`, positioned after
  Kalender per the design; extend `pageLabel()`; make the topbar search
  placeholder route-aware ("Sök personal…" everywhere for now — it filters
  the schedule's bars by staff name on this view, same context as
  Personal).
- Week label: "Vecka 28 · 7–13 juli" — new `time.ts` helpers:
  `parseWeekPeriod('2026-W28')` → Monday `Date`, `addWeeks`,
  `formatWeekLabel(period)` → `{ week: 'Vecka 28', range: '7–13 juli' }`
  handling month/year boundaries ("28 juli–3 aug", "29 dec–4 jan 2027").
  Hand-rolled month names already exist.

## Implementation Steps

### Phase 1: Backend — publications read endpoint

1. `app/routes/data_publications.py`: `GET /data/publications` with an
   explicit **required** `period` query param (validated via
   `week_monday()`, 400 on missing/invalid); returns
   `{"week": ..., "published_at": ...}` or `null` (200) for the org+week
   - Register in `app/routes/__init__.py`
2. Tests in `app/tests/test_api_data.py`: 401 without org header; 400 on
   missing and on malformed period; null for an unpublished week; the row
   (correct week + timestamp) after inserting a publication fixture
3. Document the endpoint in `docs/api.md`
   - Files: `app/routes/data_publications.py` (new),
     `app/routes/__init__.py`, `app/tests/test_api_data.py`, `docs/api.md`

### Phase 2: Frontend helpers & API

1. `frontend/src/api.ts`: `getPublication(period)` typed
   `{ week: string; published_at: string } | null`
2. `frontend/src/time.ts`: `parseWeekPeriod`, `addWeeks`,
   `formatWeekLabel` (+ unit-style doc comments; reuse MONTH_SHORT) and
   `wallClock(instant, tz)` per the timezone rule in Analysis
3. `frontend/src/types.ts`: `Publication` type
   - Files: the three above

### Phase 3: The Schedule page

1. `frontend/src/pages/Schedule.tsx` (new) — per research.md geometry:
   - Header: H1 "Arbetsschema" 28px, week nav (prev/next chevron buttons +
     "Vecka N · range" label), stat chip "{pass} pass · {personer} i
     personal" (mono, `#f2e8d5`), publish status chip: skog dot pill
     "Publicerad {formatDayDate}" or lera "Utkast"
   - Legend row: Täckning/h group only (the Erfarenhet group joins via
     #27's color key; bars resolve tint through the `colorKey` abstraction,
     defaulting to one neutral pair)
   - Card with hour-axis header ("Dag" + hour labels), 7 weekday rows
     (Mon–Sun): left day cell (weekday + "7 juli" mono date,
     current-day treatment), timeline with hour gridlines
     (repeating-linear-gradient), coverage strip, shift bars
   - Bars: name 700 + mono time range; open shifts dashed per Analysis;
     archived staff still render by name (roster fetched with
     include_archived); `title` = note when present
   - Topbar search filters: matching staff's bars stay, others dim to 35%
     opacity (keeps the grid stable). The shell's search state is global —
     clear it on route change (small `Layout` effect) so a Personal-page
     query doesn't silently dim schedule bars
   - Bars for unknown/missing `staff_id` lookups fall back to "Okänd" +
     neutral tint (defensive; FK should prevent it)
   - Loading spinner, error Callout on failed queries, + EmptyState ("Inga
     pass den här veckan ännu — passläggning kommer i #9") when the week
     has no shifts
2. `frontend/src/App.tsx`: routes `/schema` (redirect to current week) and
   `/schema/:week`; invalid week param → redirect to current week
3. `frontend/src/components/Layout.tsx`: nav item + pageLabel + search
   placeholder
   - Files: `Schedule.tsx` (new), `App.tsx`, `Layout.tsx`

### Phase 4: Verification

1. `npm run precommit` + backend pytest (all, incl. new publications test)
2. Verify recipe: seed org shows the current week published with ~29
   bars over 10+ staff; navigate prev/next (empty weeks render the empty
   state; next week shows the draft chip); deep-link `/schema/2026-W28`
   directly; search dims non-matching bars; coverage tooltips correct
   spot-checked against seeded times; screenshot vs the design file
3. The seed has **no open shifts and no archived staff** — exercise those
   states manually during verification: `PATCH /data/shifts/:id` with
   `staff_id: null` on one shift (open-shift bar + lucka coverage), and
   archive one staff member (their bars must keep rendering by name)
3. Grep check: no hardcoded blue/default-Radix leaks in the new page

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `app/routes/data_publications.py` | Create | Read publish state per week |
| `app/routes/__init__.py` | Modify | Register blueprint |
| `app/tests/test_api_data.py` | Modify | Publications endpoint tests |
| `docs/api.md` | Modify | Document `GET /data/publications` |
| `frontend/src/pages/Schedule.tsx` | Create | The Arbetsschema view |
| `frontend/src/App.tsx` | Modify | `/schema` + `/schema/:week` routes |
| `frontend/src/components/Layout.tsx` | Modify | Nav item, pageLabel, search placeholder |
| `frontend/src/api.ts` | Modify | `getPublication` |
| `frontend/src/types.ts` | Modify | `Publication` |
| `frontend/src/time.ts` | Modify | Week parse/add/label helpers |

## Codebase Areas

- `frontend/src/` (new page + shell touches)
- `app/routes/`, `app/tests/`, `docs/` (one read endpoint)
- No migrations, no design-package changes

## Design Decisions

> Non-trivial choices made during planning. Feedback welcome; otherwise implementation proceeds with these.

### 1. Neutral bars now; color key arrives with org-defined custom fields (#27)
**Options:** (A) fixed `experience` column vs (B) color by free-text role
vs (C) neutral bars + a color-key hook, real key via #27's custom fields.
**Decision:** C. (Twice revised 2026-07-07: draft chose B; user preferred
experience but as *dynamic, org-defined* fields à la GitHub Projects —
one org wants Hög/Medel/Låg, another Senior/Junior — which became #27;
user then chose to ship #8 first with neutral bars.)
**Rationale:** The custom-fields feature is real product surface (field
CRUD, options, dynamic forms) and would swallow a read-only view issue.
Neutral bars still deliver the MVP heart — a readable week — since the
mock's other signals (coverage strip, geometry, mono times) don't depend
on per-staff color. The `colorKey` abstraction keeps #27's landing a
one-function change.

### 2. Publish status: read-only chip + new `GET /data/publications`, no button
**Options:** Render the mock's "Publicera schema" button (disabled or
fake) vs show only real state via a small read endpoint vs skip publish
entirely.
**Decision:** Chip + read endpoint; button comes with #10.
**Rationale:** The `publication` table already distinguishes the seeded
weeks (published vs draft) — showing it is real value and gives #10 an
obvious slot. A dead button is a fake flow; skipping entirely wastes data
we have. The read endpoint is ~20 lines in the established `/data` pattern.

### 3. Route carries the week: `/schema/:week`
**Options:** Component state only vs URL param.
**Decision:** URL param (`/schema/2026-W28`), `/schema` redirects to now.
**Rationale:** Deep-linkable weeks are the natural unit managers share;
the SPA fallback already treats `/schema/vecka-28`-style routes as the
canonical example; #9/#10 inherit an addressable context for free.

### 4. Dynamic hour span instead of the mock's fixed 09–20
**Options:** Fixed axis 09–20 vs axis derived from the week's shifts.
**Decision:** Derived (min→max hour, default 08–20 when empty, min 8 cols),
overnight clamped at 24:00 with "→" suffix.
**Rationale:** The mock's span matches a kiosk's opening hours, which we
don't have as data (noted as a #14 follow-up). Seeded bistro shifts run to
23:00 — a fixed 09–20 axis would cut real bars. Deriving keeps every org
readable without configuration.

### 5. Open shifts get a designed state now (dashed lucka bar)
**Options:** Skip open shifts (mock doesn't show them) vs design a state.
**Decision:** Dashed `#c05a3a` border, lucka-tinted bg, "Öppet pass" text.
**Rationale:** The issue text explicitly requires open shifts, and the
seed/`shift.staff_id = NULL` model supports them. The dashed+tegel language
already means "saknas/varning" in the design (S?-chip, invited avatar), so
the state stays inside the established vocabulary.

## Verification Checklist

- [ ] Seeded demo org shows a readable week schedule (issue "done when")
- [ ] Week navigation: prev/next + deep link `/schema/2026-W28`; `/schema` lands on current week
- [ ] Shift bars show name + mono time range in the neutral tint; tint resolves via the `colorKey` abstraction (single place for #27 to plug into)
- [ ] Open (unassigned) shifts render as designed dashed bars
- [ ] Coverage strip levels + tooltips correct for seeded data
- [ ] Publicerad/Utkast chip matches the seeded weeks (current = published, next = draft)
- [ ] Current-day highlight, weekend rows, empty-week EmptyState
- [ ] Time axis mono everywhere; empty cells stay cream (design-system hard rules)
- [ ] Read-only confirmed — no mutations anywhere on the page
- [ ] `npm run precommit` + full backend pytest green
