# Plan: Issue #41 — SvarView v2: positive-only normal week + unified exceptions (Kan inte / Kan extra)

## Goal

Rewrite the `/svar/:token` availability editor to the v2 design
(`design/Timla App - Tillgänglighet länk v2.dc.html`), on top of the #40
data model (merged as PR #45, commit `cc0ec02`):

- **Positive-only normal week**: the "Vill jobba" / "Kan inte"
  SegmentedControl goes away. "Din tillgänglighet" is a single positive
  day list (pick days/times you can work); an unselected day is a soft
  "helst inte" (`outside_wishes` nudge), not a hard block. Per-day
  "Vissa tider" stays.
- **Saves send only the `wishes` key** (omit `blocks`), relying on #40's
  per-key PUT semantics so manager-set recurring blocks survive.
- **"Avvikelser i perioden" becomes its own section** with unified rows:
  each toggles **Kan inte / Kan extra** (`block` / dated `wish`), has a
  free-text reason (`note`), an optional time range (whole-day default),
  and an "Inlagt av chefen" badge on manager-entered rows
  (`source === 'manager'`). Staff may delete any row, including
  manager-entered ones.
- **Recurring blocks render read-only** in the period overview, so a
  manager-set "aldrig söndagar" is visible on the phone even though it
  can't be edited here.
- **New "Önskat antal pass / vecka" stepper** + a note-to-manager
  free-text field, stored via #40's `desired_shifts_per_week` /
  `availability_note`.
- **Overview calendar + confirmation per mockup**: "Vill jobba"/"Delvis"
  from the normal week, "Kan inte" (red) / "Kan extra" (yellow) from
  exceptions; the confirmation's middle stat becomes "pass per vecka".
- **Empty-week nudge**: prompt before saving an all-empty week instead
  of implying "never scheduled".

Frontend-only (`frontend/src/`): the backend contract this consumes
landed complete in #40 and is documented in `docs/api.md` (lines
129–145). Closes #37 and #38 as designed-out side effects.

## Approach

Surgical rewrite of `frontend/src/pages/SvarView.tsx` plus its two
derived-model modules,
keeping everything that already matches v2 (header, day-list interaction,
RangeSlider canvas, schedule section, sticky footer, confirmation sheet):

1. **Types first** (`types.ts`): widen the `/svar` contract types to what
   the backend already sends — `SvarException` gains
   `kind`/`note`/`source`, `SvarContext.staff` gains the two new fields,
   `SvarPutBody` keys all become optional per the per-key PUT semantics.
   `svarApi.ts` is generic and needs no change.
2. **Drop the `cannot` editing axis** from the Editor: no tab state, no
   `cannot`/`dirtyCannot`/`openCannot`/`origBlocks`-as-editable. The
   `context.availability.blocks` list stays in a **read-only** state
   value (seeded from the context, refreshed from the PUT response in
   `onSuccess`) as input to the overview. `mergedRecurring` (untouched weekdays round-trip
   verbatim) is kept for wishes — it is what lets #40's backend preserve
   prior provenance on resubmitted rows.
3. **Rebuild the exceptions section** as its own top-level section per the
   mockup, with local rows carrying `kind`, `note` and an optional time
   range. The `/svar` PUT is an add/remove delta with no in-place edit,
   so an edited pre-existing row is sent as `remove_exception_ids` +
   `add_exceptions` (see Design Decisions).
4. **Rework `overview.ts`** to take dated exceptions with `kind` and the
   read-only recurring blocks; add the `extra` status and redefine
   `partial` as "want day with a non-whole-day range" (per the mockup's
   `w.custom ? 'partial' : 'want'`).
5. **New stepper + note field**, sent only when the worker touched them
   (avoids clobbering concurrent manager edits from `/data/staff`).
6. Copy per the issue's softened wording, which **overrides the mockup**
   where they differ ("…föreslås du inte den dagen", not
   "schemaläggs du inte").

## Steps

### Phase 1 — Contract types: `frontend/src/types.ts`

The `/svar` section (lines 87–130) catches up with what
`app/routes/svar.py` + `app/routes/data_availability.py:_interval_json`
already emit:

1. `SvarRecurring` gains optional additive fields the server now sends:
   `id?: string`, `kind?: 'wish' | 'block'`,
   `source?: 'staff' | 'manager' | null`, `note?: string | null`.
   (Load-bearing fields stay `weekday`/`start_minute`/`end_minute`;
   `mergedRecurring` keeps building clean 3-field objects for the PUT.)
2. `SvarException` gains required fields (always emitted):
   `kind: 'wish' | 'block'`, `note: string | null`,
   `source: 'staff' | 'manager' | null`.
3. `SvarContext['staff']` gains `desired_shifts_per_week: number | null`
   and `availability_note: string | null` (emitted by `_context`,
   `app/routes/svar.py:111-128`).
4. `SvarPutBody` becomes per-key optional:

   ```ts
   export interface SvarPutBody {
     wishes?: SvarRecurring[]
     blocks?: SvarRecurring[] // v2 never sends this — omitting preserves manager blocks
     add_exceptions?: {
       on_date: string
       start_minute?: number
       end_minute?: number
       kind?: 'wish' | 'block'
       note?: string
     }[]
     remove_exception_ids?: string[]
     desired_shifts_per_week?: number | null
     availability_note?: string | null
   }
   ```

No change to `svarApi.ts` (generic fetch wrapper).

### Phase 2 — Positive-only normal week: `frontend/src/pages/SvarView.tsx` Editor

0. Create branch `issue/41-svarview-v2` off up-to-date `main` **before
   any edits** (branch + PR flow; all later phases happen on it).
1. Remove the `SegmentedControl` import and the `tab` state (lines 94,
   215–224); remove `cannot`, `openCannot`, `dirtyCannot`, `origBlocks`
   editing state and their handlers (`markCannot`, the `cannot` branches
   of `toggleDay`/`setRange`). Keep `context.availability.blocks` in a
   read-only `recurringBlocks` state value, updated in the save
   mutation's `onSuccess` from the returned context — otherwise the
   overview goes stale after a save that raced a manager edit.
2. "Din tillgänglighet" renders the want `DayList` directly (no tabs).
   `DayList`/`TabHeader`/`RangeControl`/`TINT` lose their
   `kind: 'cannot'` variants — simplify to the want-only styling
   (`TINT` collapses; `semantic="success"`).
3. **Copy** (issue wording wins over the mockup):
   - Section intro stays: "Din normalvecka — den gäller alla veckor i
     perioden."
   - Day-list header: title "Vilka dagar vill du jobba?", subtitle
     "Tryck på dagarna du kan jobba — hoppar du över en dag föreslås du
     inte den dagen. Bara vissa tider? Öppna \"Vissa tider\"."
4. **Save payload** (the `save` mutation, lines 112–137): always send
   `wishes: mergedRecurring(dirtyWant, want, origWishes)`; **never send
   `blocks`**. `onSuccess` reconciliation drops the cannot/blocks halves.

### Phase 3 — Stepper + note-to-manager

After the day list, per the mockup (design lines 114–128):

1. **"Önskat antal pass / vecka"** card: label + sub-caption
   ("Så mycket vill du gärna jobba. Gäller tills du ändrar det — inte
   bara den här perioden." — the issue asks the copy to note the count
   carries across periods) and a −/+ stepper.
   - State seeds from `context.staff.desired_shifts_per_week`
     (`number | null`). `null` renders as "–"; `+` from null goes to 1,
     `−` from null is a no-op. **No clamp on seeded/readback values**
     (backend allows 0–50, a manager may have set > 7 via
     `/data/staff`); only user stepping is bounded — `−` floors at 0,
     `+` caps at 7 unless the current value is already ≥ 7 (then `+`
     is disabled and `−` steps down normally).
   - Track a `dirtyPerWeek` flag; include `desired_shifts_per_week` in
     the PUT body **only when dirty** (per-key semantics — an untouched
     save must not overwrite a concurrent manager edit).
2. **"Något chefen bör veta?"** textarea (`maxLength={1000}`), seeded
   from `context.staff.availability_note ?? ''`, placeholder per mockup
   ("T.ex. pluggar tisdagar, kan hoppa in med kort varsel…"). Same
   dirty-tracking; send `availability_note` only when touched (the
   backend trims and normalizes empty → null via `normalize_note`).
3. `onSuccess`: re-seed both from the returned context and clear the
   dirty flags.

### Phase 4 — "Avvikelser i perioden" as its own section

Move `ExceptionList` out of the (deleted) cannot tab into a top-level
`<section>` between "Din tillgänglighet" and the overview, per the mockup
order. Rework rows (mockup design lines 132–162):

1. **Local model**: `LocalException = SvarException & { isNew?: boolean;
   editedFromId?: string }` — rows track `kind`, `note`, time range.
2. **Row rendering**:
   - Date (mono, `formatIsoDate`), time range shown when not whole-day
     (existing lines 461–465 logic).
   - `note` as the second line (muted), when present.
   - Badge `Inlagt av chefen` when `source === 'manager'` (pill per
     mockup). Generic label — the `/svar` context carries no manager
     name; see Design Decisions.
   - Remove button on **every** row (manager-entered included — the
     badge informs, doesn't lock; settled product decision).
   - **Kan inte / Kan extra** two-option toggle (mockup's inline
     segmented; red active = block, green/yellow active = wish). A small
     inline pair of buttons is enough — `@swedev/ui`'s `SegmentedControl`
     doesn't do per-item semantic colors, so don't force it.
3. **Editing semantics**: any change (kind toggle, note, time range) to a
   pre-existing row marks it `editedFromId: <original id>`; local `id`
   stays stable for React keys. The save payload is built as:
   - `add_exceptions` = every row with `isNew || editedFromId`, as
     `{on_date, start_minute, end_minute, kind, note?}` (note only when
     non-empty; ≤ 500 chars, `maxLength` on the input);
   - `remove_exception_ids` = `removedIds` ∪ all live rows'
     `editedFromId`s, de-duplicated;
   - deleting an already-edited row moves its `editedFromId` into
     `removedIds` (only the remove is sent — the edited values die with
     the row);
   - `onSuccess` replaces local rows with the returned exceptions
     (real ids, no `isNew`/`editedFromId`), extending the existing
     reconciliation so a second save in the same session never re-sends
     stale ids.
4. **Time range**: optional, whole-day (0–1440) default. Per-row
   "Vissa tider" affordance expanding two `<input type="time">` fields
   (via `timeToMinutes`/`minutesToTime` from `time.ts`, `isEnd` handling
   for 00:00 = 1440). **Not** the RangeSlider — its 06–22 canvas can't
   express e.g. a night-shift block or "Läkarbesök 13–15" starting
   outside it cleanly, and exceptions legitimately span 00–24.
   Guard `start < end` before save (disable save or clamp).
5. **Add flow**: keep the hidden `<input type="date">` label ("Lägg till
   datum") but constrain it to the period the section is about:
   `min={schedule.from}`, `max={schedule.to}` — the backend accepts a
   far wider window ([today−366, today+731],
   `app/routes/svar.py:282`), but "Avvikelser i perioden" means this
   period. Ignore an out-of-range picked value (some browsers don't
   enforce min/max). Existing server rows outside the window still
   render (they exist and remain deletable). New rows default to
   `kind: 'block'`, whole-day, empty note, `isNew: true`.
6. Section copy per mockup: "Enstaka datum som bryter mot din
   normalvecka. Kan du inte en viss dag — eller kan hoppa in extra?
   Lägg till det här."

### Phase 5 — Overview rework: `frontend/src/overview.ts`

1. `DayStatus` gains `'extra'`.
2. New signature:

   ```ts
   buildOverview(
     fromIso: string,
     toIsoStr: string,
     want: WeekRanges,
     recurringBlocks: SvarRecurring[],   // read-only, manager-set
     exceptions: { on_date: string; kind: 'wish' | 'block' }[],
   ): CalMonth[]
   ```

3. `statusOf` priority (top wins):
   1. outside period → `out`
   2. dated exception on the date: any `block` → `block` (hard no wins
      over a same-day "Kan extra"), else `wish` → `extra`
   3. weekday has a recurring block → `block` (this is the read-only
      manager-block visibility the issue asks for; it still hard-blocks)
   4. weekday in `want`: whole-day (`isWholeDay`) → `want`, otherwise →
      `partial` (v2 meaning: "Delvis" = limited hours, per the mockup's
      `custom` flag; export/import `isWholeDay` from `ranges.ts`)
   5. otherwise `ledig`
4. `SvarView` call site passes `context.availability.blocks` and the live
   local exceptions (`{on_date, kind}`), and `CalCellView` + legend gain
   the `extra` (yellow) rendering: bg `--color-wait-soft`-family tokens
   (mockup #f7e6bc / #8a5e14 — use the closest existing design tokens,
   e.g. the `wait` family already used in the header period card).
   Legend rows: Vill jobba, Kan inte, Kan extra, Delvis.

### Phase 6 — Confirmation + empty-week nudge

1. **Confirmation stats** (lines 627–631): "önskade dagar"
   (`countDays(want)`), "pass per vecka" (`desired_shifts_per_week`,
   "–" when null), "avvikelser i perioden" (`exceptions.length`).
   `cannotDays` prop goes away; widen `Stat`'s `value` prop (line 644)
   from `number` to `number | string` for the "–" case.
2. **Empty-week nudge**: when the save button is pressed with
   `countDays(want) === 0`, show a confirm bottom-sheet (same visual
   pattern as `Confirmation`) instead of saving directly:
   - Copy along the lines of: "Du har inte valt några dagar. Chefen ser
     inga önskemål från dig — men du kan fortfarande schemaläggas.
     Vill du spara ändå?" with "Spara ändå" / "Gå tillbaka".
   - "Spara ändå" runs the mutation; local `confirmEmpty` state, no new
     dependencies. (The engine treats zero wishes as all-neutral, so
     this is a UX nudge only.)
3. Footer disclaimer ("Det du sparar ersätter din tidigare
   tillgänglighet.") stays — still true for the layers the phone owns.

### Phase 7 — Docstrings and cleanup

1. Update the `SvarView.tsx` header comment: point at the v2 design
   file, describe the positive-only model, and delete the "MVP subset
   (deferred…)" paragraph — this issue ships exactly those deferred
   items.
2. Update `overview.ts` and `ranges.ts` module docstrings where the
   two-layer editing story is described.
3. Remove now-dead code: `countDays` stays (used for wants), the
   `cannot` branches of `TINT`/`TabHeader` go. `rangesToIntervals`
   (`ranges.ts:72-79`) was already unused before this issue — leave it
   out of scope.
4. `docs/api.md` needs **no** change (backend contract untouched).

### Phase 8 — Verification and close-out

1. `npm run precommit` (eslint + `tsc -b` + vite build — the repo's CI
   gates; there is no frontend unit-test runner).
2. Backend suite untouched but run once for safety:
   `DATABASE_URL=postgresql://timla:timla@localhost:5433/timla pytest app`.
3. Manual verify per `.claude/skills/verify/SKILL.md` — see Test Plan.
4. PR from `issue/41-svarview-v2` (created in Phase 2 step 0); body
   ends with `Closes #41, closes #37, closes #38` (per the issue: #37's
   contradiction is designed out, #38's caption/tabs are removed) and
   `Refs #40, #13`.

## Risks

- **Editing a manager-entered exception re-attributes it.** The `/svar`
  PUT has no in-place exception edit, so an edited row is deleted and
  re-added with `source='staff'` — the "Inlagt av chefen" badge
  disappears after the worker modifies it. Acceptable: the worker took
  ownership of the row; deletion of manager rows is an explicitly
  settled product decision. Documented so it isn't rediscovered as a bug.
- **Workers lose the ability to *create* recurring hard blocks.** This is
  the intended product change (standing hard "no" is set by the manager;
  the phone is soft) — but a worker who previously set recurring blocks
  via v1 will see them become read-only calendar days rather than
  editable rows. They can still be removed by the manager surface (#42).
- **`partial` changes meaning** in the overview (was want∩cannot overlap,
  becomes "want with limited hours"). Both callers of `buildOverview`
  live in `SvarView.tsx`, so no cross-page fallout; the legend copy
  ("Delvis") stays truthful.
- **Concurrent manager edits** to `desired_shifts_per_week` /
  `availability_note` could be clobbered by a stale phone save —
  mitigated by only sending those keys when the worker actually touched
  them (dirty-tracking), same spirit as the per-weekday `mergedRecurring`.
- **Provenance survival on no-op saves** relies on #40's verbatim-row
  rule (`app/routes/svar.py:158-186`): `mergedRecurring` must keep
  re-sending untouched weekdays exactly as stored — don't "clean up"
  that logic while refactoring.
- **Time inputs on mobile** (`<input type="time">`) render natively per
  OS; acceptable for MVP and consistent with the existing date input
  approach ("Lägg till datum").

## Test Plan

No frontend unit-test infrastructure exists (`npm run precommit` =
eslint + tsc + vite build is the CI gate). Verification is the build
gates plus a scripted manual pass via `.claude/skills/verify/SKILL.md`:

1. **Preserved manager blocks (the headline #40 behavior)**: seed a
   recurring block via the manager API (`PUT /data/availability/:id`
   with `blocks`), open `/svar/:token`, change a wish day, save →
   `GET /data/availability/:id` still lists the recurring block; the
   phone's overview shows those weekdays red.
2. **Positive week round-trip**: toggle days, set "Vissa tider" on one,
   save → context readback matches; overview shows `want` (whole day)
   vs `partial` (limited hours) correctly.
3. **Exceptions**: add a "Kan inte" whole-day row, add a "Kan extra" row
   with a 13:00–15:00 range and a note, save → both come back with
   correct `kind`/`note`/times; calendar shows red resp. yellow on those
   dates; delete one (including a manager-created one seeded via
   `POST /data/availability/:id/exceptions`), save → gone.
4. **Kind toggle on an existing row**: flip a saved "Kan inte" to
   "Kan extra", save → old id gone, new row `kind='wish'` (verify via
   the manager document read).
5. **Badge**: manager-seeded exception shows "Inlagt av chefen"; own rows
   don't (`source='staff'`); pre-#40 rows (`source=null`) don't.
6. **Stepper + note**: set 3 pass/vecka + a note, save, reload → seeded
   back; a second save without touching them (after a manager PATCH via
   `/data/staff/:id` changed the note) must not overwrite the manager's
   value (dirty-key check).
7. **Empty-week nudge**: clear all days → save shows the prompt;
   "Spara ändå" saves; "Gå tillbaka" doesn't.
8. **Confirmation sheet**: stats read önskade dagar / pass per vecka /
   avvikelser; "Ändra mina svar" returns to an editable state whose
   second save doesn't 400 (stale `remove_exception_ids` regression
   guard, mirrors the existing `onSuccess` reconciliation).
9. **Copy check**: no "Varje vecka" caption, no tabs (#38); no wording
   implying an unselected day means "schemaläggs du inte".

## Triage Info

| Field | Value |
|-------|-------|
| **Blocked by** | None — #40 (hard prerequisite) is CLOSED, merged to `main` as PR #45 (`cc0ec02`) |
| **Blocks** | Nothing hard; #42 (StaffDetail v2) is the sibling consumer of the same #40 backend |
| **Related issues** | #37, #38 (both currently open — **this PR will close them**, designed out), #40 (foundation, merged), #13 (the surface being rewritten), #42 (manager-side sibling), #9 (where `outside_wishes` nudges become visible) |
| **Conflicts with other plans** | None on disk — every other `agent-docs/issue/*` plan belongs to a closed issue. **Soft coordination point with #42** (no plan yet): its scope (exception kind/provenance, desired-shifts/note on StaffDetail) will also touch the shared `frontend/src/types.ts` (`Staff`, `ExceptionInterval`); whoever lands second rebases trivially |
| **Scope** | 3 frontend modules rewritten/modified (`SvarView.tsx`, `overview.ts`, `types.ts`), 1–2 touched lightly (`ranges.ts` docstring/`isWholeDay` export) |
| **Risk** | Low–Medium (frontend-only; the risky per-key PUT semantics are already implemented and tested in the backend) |
| **Safe for junior** | Yes, with this plan — the backend contract is frozen and documented, and each UI change is anchored to mockup + file/line |

## Design Decisions

1. **"Inlagt av chefen" (generic), not "Inlagt av {namn}".** The `/svar`
   context (`app/routes/svar.py:_context`) carries no manager name, and
   `availability_interval.source` stores only `'manager'`, not who.
   Staying frontend-only (the issue's scope) means the generic label.
   A follow-up could add a manager display name to the context if
   per-person attribution matters (multi-manager orgs, #29).
2. **Edit = remove + re-add for pre-existing exceptions.** The `/svar`
   PUT is deliberately an add/remove delta; rather than growing the
   public API with an update verb, an edited row swaps ids. Costs:
   provenance resets to `'staff'` (see Risks) and the row gets a new id —
   both invisible to the worker.
3. **Dirty-key sends for `desired_shifts_per_week`/`availability_note`.**
   Per-key PUT semantics exist precisely so clients only claim the keys
   they own in that save; blanket-sending would reintroduce the
   stale-overwrite class of bug #40 fixed for blocks.
4. **Block beats "Kan extra" on the same date in the overview** —
   mirrors the engine (`app/conflicts.py` checks blocks first), so the
   calendar never paints a day yellow that the engine would refuse.
5. **Native time inputs, not RangeSlider, for exception times.** The
   slider's 06–22 worker canvas is a normal-week concept; exceptions
   need 00–24 (night shifts, early appointments).
6. **Stepper bounds user input to 0–7** (mockup bound) without clamping
   stored values. The backend allows 0–50, so a manager-set value > 7
   renders as-is; `+` is then disabled and `−` steps down normally.
7. **Recurring-block visibility = the overview calendar** (issue wording:
   "Render existing recurring blocks read-only in the overview"). No
   extra read-only list in the normal-week section — the red recurring
   days plus the "Kan inte" legend carry the information without a new
   UI surface.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/pages/SvarView.tsx` | Rewrite (large) | Drop tabs/cannot axis; positive-only day list; exceptions section with kind/note/time + badge; stepper + note; empty-week nudge; confirmation stats; copy |
| `frontend/src/types.ts` | Modify | `/svar` contract catch-up: `SvarException` kind/note/source, `SvarContext.staff` new fields, per-key-optional `SvarPutBody` |
| `frontend/src/overview.ts` | Modify | `extra` status, kind-aware exceptions, read-only recurring blocks, `partial` = limited hours |
| `frontend/src/ranges.ts` | Modify (light) | Docstring update; `isWholeDay` reused by overview logic |
| `frontend/src/svarApi.ts` | None | Generic wrapper already fits |
| `docs/api.md` | None | Backend contract unchanged (documented in #40) |
