# Timla design

Source-of-truth design documents (open the `.dc.html` files in a browser;
`support.js` is their shared runtime). Applied to the app via issue #21.

| File | Contents |
|------|----------|
| `Timla Designsystem.dc.html` | **v1.0 — the authority.** Logo, color roles, typography (Hanken Grotesk + IBM Plex Mono for all time/data), icons, components (buttons, statuses, time slots, booking cards), calendar/schedule view specs, tone & voice, print. |
| `Timla Auth.dc.html` | Login + create-account screens (referenced from #3). |
| `Timla Landningssida.dc.html` | Marketing site for timla.se (#22). |
| `Timla Motiv - Kalendermönstret.dc.html` | Rules for the calendar-pattern motif (#23). |
| `Timla riktningar.dc.html` | Exploration history behind the chosen direction. |
| `assets/` | Logo lockups (default/mono/cream), app icon, favicon — production SVGs. |
| `screenshots/` | Rendered stills of the explorations and final screens. |

Quick reference (details in the design system doc):

- **Colors:** ink `#231D16`, ochre `#E69A2E` (primary accent, ~10% of any
  surface), honey `#F2C14E`, cream `#FBF1DC`, paper `#FDF8EE`.
  Status roles: ok/confirmed `#4F7358` (skog), waiting = ochre,
  cancelled/conflict `#C05A3A` (tegel), full/inactive `#B8A68D`.
- **Type:** Hanken Grotesk 400–800 for everything readable; IBM Plex Mono
  400/500 for time, dates, ids and data — numbers must never jump.
- **Components:** radius 10–14 px, 1 px warm borders, soft shadows.
- **Voice:** everyday Swedish, du-tilltal; time always in klartext
  ("tors 8 maj · 14:00").
