# Research: Designsystem v1.0 spec digest

Extracted from `design/Timla Designsystem.dc.html` (the authority) for
implementation without re-parsing the 74 kB HTML. Values are verbatim from
the doc. See also `design/README.md` for the short version.

## Color tokens

### Brand
| Name | Token | Hex | Role |
|---|---|---|---|
| Bläck (ink) | `--ink` | `#231D16` | Text, symbol |
| Ockra (ochre) | `--ochre` | `#E69A2E` | Primär accent (~10 % of any surface) |
| Honung (honey) | `--honey` | `#F2C14E` | Highlight, hover |
| Grädde (cream) | `--cream` | `#FBF1DC` | Yta, chips |
| Papper (paper) | `--paper` | `#FDF8EE` | Bakgrund |

### Status (fixed roles — never decorative)
| Name | Token | Hex | Role |
|---|---|---|---|
| Skog | `--ok` | `#4F7358` | Bekräftad, ledig |
| Ockra | `--wait` | `#E69A2E` | Väntar, obekräftad |
| Tegel | `--stop` | `#C05A3A` | Avbokad, konflikt |
| Lera-grå | `--muted` | `#B8A68D` | Fullbokad, inaktiv |

### Warm neutrals (dark→light, no token names in doc)
`#231D16` → `#5A4D38` (body/secondary text) → `#8A7A5C` (muted text, labels)
→ `#B39A6F` (mono captions, placeholders) → `#EFE3CD` (standard 1 px card
border) → `#FFFFFF`.

Border/hairline variants seen: `#e4d9c2`, `#f4ead2` (inner card dividers),
`#f2e7cf` (empty calendar slot border), `#d8c19a` (input/secondary-button
border), `#eeddb8` (cream time-slot border).

### Status tint pairs (badges & calendar blocks)
| Role | bg | text | dot | block border |
|---|---|---|---|---|
| Skog/Bekräftad | `#e7efe8` | `#3c5a44` | `#4f7358` | `#cfe0d3` |
| Ockra/Väntar | `#fbf1dc` (block `#fbeed0`) | `#a5711a` | `#e69a2e` | `#f0dcae` |
| Tegel/Avbokad | `#f7e6df` | `#a44227` | `#c05a3a` | — |
| Muted/Fullbokad | `#ede4d3` | `#9a8a6c` | `#b8a68d` | — |
| Ink/"Ny" | `#231d16` | `#f2c14e` | `#f2c14e` | — |
| Ledig (hollow) | `#fff` + 1 px `#d8c19a` | `#8a7a5c` | hollow 1.5 px `#b8a68d` | — |

Link/data-text ochre: `#c07f1e` (hover → ink). Cream-chip text: `#8a6a2a`.

### Shadows (all warm brown)
- Card: `0 4px 20px rgba(90,60,20,.06)`
- Frames/large: `0 12px 40px rgba(90,60,20,.10–.12)`
- Focus ring: `0 0 0 3px rgba(230,154,46,.15)`

## Typography

- **Hanken Grotesk** 400/500/600/700/800 — everything readable.
- **IBM Plex Mono** 400/500 — all time, dates, ids, prices, data
  ("siffror hoppar aldrig").
- Body 16 px/1.6; H3 22 px/600; H2 32 px/700; H1 44 px/800 −.03em;
  Display 60 px/800 −.035em.
- Etikett/label: 13 px (form labels 12 px), weight 600, letter-spacing
  .02em, UPPERCASE, color `#8a7a5c`.
- Mono eyebrows: 11–12 px, letter-spacing .1–.14em, `#b39a6f`.
- Data example: `tors 8 maj · 14:00` mono `#c07f1e`; `09:00–17:00 · #TB-2481`.

## Section 05 — components

- Radii: buttons 10 px (small 8 px), inputs 10 px, cards 16 px, time-slot
  chips 9 px, badge pills 20 px. Overall rule "10–14 px" for controls.
- Buttons (weight 700, 15 px, padding 13px 24px): primary ink
  `#231d16`/`#fbf1dc`; primary accent `#e69a2e`/ink; secondary white/ink +
  1 px `#d8c19a`; ghost transparent/`#c07f1e`; disabled `#ede4d3`/`#b8a68d`.
- Badges: pill radius 20, padding 6px 12px, 13 px/600, 7 px dot; colors per
  tint-pair table above.
- Time slots: mono 14 px, padding 10px 15px, radius 9; Vald ink/honey text,
  Ledig cream `#fbf1dc`/`#8a6a2a` border `#eeddb8`, Bokad `#f6eee0`/`#bfae8a`
  line-through.
- Inputs: 15 px, padding 12px 14px, radius 10, 1 px `#d8c19a`, bg paper;
  focus: border ochre + ring `rgba(230,154,46,.15)`, bg white.
- Booking card: white, 1 px `#efe3cd`, radius 16, shadow card; time line
  mono 13 px `#c07f1e`; footer divider `#f4ead2`; avatar 34 px circle honey.

## Section 06 — calendar/schedule (for #8/#9)

Hard rule: time axis always mono; booking blocks carry the service color;
empty slots are empty cream — never filled unnecessarily.

- Week grid: container white/`#efe3cd`/radius 16/padding 26; columns
  `52px repeat(5,1fr)`, gap 6; cell 44 px, radius 7.
- Time axis: mono 11 px `#b39a6f`, right-aligned. Day header: weekday 700
  13 px, date mono 11 px `#b39a6f`; current day in ochre (`#c07f1e`/`#e69a2e`).
- Empty slot: bg `#fdf8ee`, 1 px `#f2e7cf`. Lunch/rast: `#f5ece0`/`#b8a68d`.
- Arbetsschema grid: `120px repeat(5,1fr)` gap 8; shift cells mono 11 px,
  radius 8, status tints; off/empty paper + em-dash `#c1af92`;
  Ledig(day off) `#f7e6df`/`#a44227`.

## Tone & voice

- Vardaglig svenska, du-tilltal, short sentences; always give the next step
  on errors.
- Time always klartext: `tors 8 maj · 14:00` / `torsdag 8 maj kl 14:00`.
  Never `8/5`, never "imorgon". Ranges with en-dash: `14:00–14:45`.
- Sentence-case headings ("Veckans schema").

## Logo

- Lockup SVGs in `design/assets/` are production. Wordmark = Hanken 800
  lowercase −3 % tracking — never re-typeset, always the SVG.
- Clear space = symbol height on all sides; min wordmark 88 px on web;
  favicon 16 px = symbol only. Favicon `assets/favicon.svg`, app icon
  `assets/app-icon.svg`.

## Other hard rules

- Ochre budget ~10 % of any surface; ink + cream carry the UI.
- Tegel & skog are status-only.
- Icons: 24 px grid, 1.75 px stroke, round caps/joins (matches lucide-react
  defaults except stroke width 2 → consider 1.75); ochre only when
  active/interactive, otherwise ink.

## Frontend facts that shaped the plan

- `@swedev/ui` is our own WIP library (`~/repos/ui`, npm 0.2.0, shared with
  Styrla/OpenVera) — upstream fixes are in scope when they improve the
  result. Semantic map lives in `src/theme/colors.ts`; DatePicker imports
  react-day-picker's stock stylesheet (source of `--rdp-accent-color: blue`).
- `@swedev/ui` semantic→Radix scale map (from `dist/index.js`): action→blue,
  success/valid→jade, warning→amber, error/destructive/danger/invalid→red,
  info→sky, pending→purple, neutral→gray. `<Theme accentColor>` does not
  affect these; scale-token overrides do.
- swedev CSS resolves through Radix vars (`--accent-*`, `--gray-*`,
  `--color-panel`) — confirmed in `dist/index.css`.
- `DatePicker` (react-day-picker) hardcodes `--rdp-accent-color: blue` —
  needs its own override.
- npm workspace at repo root; CI runs `npm ci` + lint + typecheck + build.
