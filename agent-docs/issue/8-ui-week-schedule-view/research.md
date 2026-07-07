# Research: Arbetsschema & Kalender designs (Strandkiosken)

Digest of the two design files, extracted 2026-07-07. **The Arbetsschema
screen is the design for #8.** The Kalender screen shows the *booking
calendar* (uthyrning/leverans/evenemang/drift events) — a booking-module
view outside MVP scope; it is summarized here only so the shared patterns
and the nav split are on record.

## Information architecture

- **Kalender** and **Arbetsschema** are two separate sidebar nav items with
  different datasets: Kalender = business events on a vertical time grid
  (day columns), Arbetsschema = staff shifts on horizontal weekday rows.
- Nav order in the new designs: Översikt, Kalender, **Arbetsschema**,
  Personal, Resurser, Rapporter. (Current app NAV lacks Arbetsschema and
  has "Bokningar" — needs updating.)
- Breadcrumb: `{Org} / Arbetsschema`; topbar search placeholder is
  route-specific ("Sök personal…" on schema, "Sök i kalendern…" on
  calendar).
- Neither file has a `text/x-dc` script — fully static mocks; interactions
  must be designed.

## Arbetsschema — page header

- H1 "Arbetsschema" 28px/800/-.03em (smaller than Personal's 32px).
- Week nav right of title (gap 18): 32×32 prev/next buttons (white, border
  `#d8c19a`, chevron `#5a4d38`), label **"Vecka 28 · 7–13 juli"** — "Vecka
  28" 15px/700 ink, date range `#b39a6f`/600. (Kalender also has an "Idag"
  button; Arbetsschema does not.)
- Stat chip after nav: mono 12px `#8a7a5c`, padding 6px 11px, radius 8,
  bg `#f2e8d5` — design copy "Öppet 10–20 · 5 i personal" (opening hours
  don't exist in our data model; see plan).
- Buttons right: "Auto-schemalägg" (secondary, ochre icon — #11 territory)
  and "Publicera schema" (ink primary, ochre check icon — #10 territory).

## Arbetsschema — grid

- Legend row above card: 12.5px, groups divided by 1px×16px `#e4d9c2`:
  1. "Erfarenhet" (mono 10px uppercase `#a5936f`): Hög `#e7efe8`/`#cfe0d3`,
     Medel `#fbeed0`/`#f0dcae`, Låg `#f7e6df`/`#efcdbf` (11×11 swatch r3)
  2. Role badges: "Ö" Öppningsansvarig (bg `#f2c14e` ink text), "S"
     Stängningsansvarig (bg `#231d16` honey text) — 16×16 r4, 9px/800
  3. "Täckning / h": Lucka `#e8b7a5`, 1 (tunt) `#f0d3a0`, 2+ (ok)
     `#bcd3c0` (16×8 swatch r2)
- Card: white, border `#ecdfc8`, radius 16, overflow hidden.
- Header row: grid `96px 1fr`, bg `#faf3e6`, border-bottom `#ecdfc8`; left
  cell mono 10px uppercase "Dag"; right = nested `repeat(12,1fr)` hour
  labels 09→20, mono 10px `#b39a6f`, `border-left:1px solid #f2e7cf`,
  padding `10px 0 8px 6px`.
- Day rows: grid `96px 1fr`, `border-bottom:2px solid #e6d8bd` (none on
  last). Left cell (padding 14, border-right `#f2e7cf`): weekday 15px/800
  ink + date mono 11px `#b39a6f` ("7 juli"). Current day: row bg
  `#fffaf0`, weekday `#c07f1e` + 5px dot `#e69a2e`, date `#c9a24a`.
- Timeline area: `position:relative`, hour gridlines via
  `repeating-linear-gradient(to right, #f4ead2 0, #f4ead2 1px, transparent
  1px, transparent calc(100%/12))`; current-day lines `#f6ead0`.
- Row height varies with stacking: 98px (2 lanes) / 134px (3 lanes);
  lane tops 24/60/96px.

## Arbetsschema — shift bars

- `.bar`: absolute, radius 7, height 30, padding 0 9px, flex gap 7,
  font 11.5px, nowrap; left/width as % of the hour span (1h ≈ 8.33%).
- Content: **name** (700) + **mono time range** 10px opacity .8
  ("09:30–15:00") + optional role badge `margin-left:auto`.
- Bar tint = experience in the mock (Hög/Medel/Låg = the three tint pairs
  above). Our analog: **role** (kock/servis/bar…), see plan decision.
- Role badge `.rb`: 10.5px/700, padding 2px 5px, r6 (Ö honey/ink, S
  ink/honey).
- Warning chip variant (Tis/Ella): "S?" `#a44227`, 1px dashed `#c05a3a`,
  r5, padding 1px 5px, cursor help, title "Ingen stängningsansvarig –
  tilldela någon". (Conflict surfacing — #9 territory.)
- No open/unassigned bars in the mock — must be designed (see plan).

## Coverage heat-strip

- Top of each row: absolute left/right 0, top 6px, height 7px, grid
  `repeat(12,1fr)` gap 1px, z-index 0; cells r2 with native `title`
  tooltips "13:00 · 2 i tjänst".
- Level colors: edge/closed `#efe6d4`, 1 in service `#f0d3a0`, 2
  `#d8e4d2`, 3+ `#bcd3c0`; Lucka (0 during open hours) `#e8b7a5`.
- Derivable client-side from the week's shifts.

## Kalender (out of scope for #8 — reference only)

- Vertical time axis 08–20 at 50px/h, gutter 48px, 7 day columns;
  day headers mono uppercase + 18px/800 date, current-day `#fdf3e0` bg,
  weekend `#fbf6ea`.
- Event blocks (absolute, r8, padding 5px 8px, mono 9.5px time + 11px/700
  title) colored by event type: uthyrning `#e7efe8`, leverans `#fbeed0`,
  evenemang `#f7e6df`, drift solid `#231d16` with honey text.
- Header: "Idag" button, Dag/Vecka/Månad segmented control, "Ny post" ink
  button. All booking-module features.

## Backend-implied data vs reality

| Design implies | We have | Gap |
|---|---|---|
| Shifts w/ person, times | `GET /data/shifts?period=YYYY-Www` (staff_id, starts_at/ends_at ISO, note) | none |
| Staff names/roles | `GET /data/staff` | none |
| Experience level per staff | — | #27 (org-defined custom fields); #8 renders neutral bars behind a colorKey hook |
| Per-shift role Ö/S | only `note` | out of scope (#9/framtida) |
| Coverage per hour | derivable from shifts | client-side |
| Opening hours ("Öppet 10–20") | — | not in rules; replace chip content |
| Publish state | `publication` table (org, week, snapshot) — **no endpoint** | add `GET /data/publications` read |
| Auto-schemalägg | — | #11 (stretch) |
| Week nav | `isoWeek`/`isoWeekPeriod` in `frontend/src/time.ts`; `app/weeks.py` server-side | need label + add/parse helpers |

Seed data: Demo Bistro, roles kock/servis/bar, ~29 shifts in current week
(published via `publication` row) + draft next week — good for verifying
both publish states and the role legend.
