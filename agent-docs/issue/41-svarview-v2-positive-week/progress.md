# Progress: Issue #41 — SvarView v2: positive-only normal week + unified exceptions (Kan inte / Kan extra)

## Status: Completed

(Update as work proceeds — newest entries first)

- 2026-07-10: All phases done; verification complete. Completed:
  - Phase 1 — `types.ts`: `SvarRecurring` gained optional `id`/`kind`/`source`/`note`; `SvarException` gained required `kind`/`note`/`source`; `SvarContext.staff` gained `desired_shifts_per_week`/`availability_note`; `SvarPutBody` per-key optional.
  - Phase 2 — positive-only normal week: tabs/`cannot` axis removed; `recurringBlocks` kept read-only in state (refreshed in `onSuccess`); saves send `wishes` only, never `blocks`; issue copy ("…föreslås du inte den dagen").
  - Phase 3 — "Önskat antal pass / vecka" stepper (user stepping bounded 0–7, stored values unclamped, null renders "–") + "Något chefen bör veta?" textarea; both dirty-key-sent only.
  - Phase 4 — "Avvikelser i perioden" own section: rows with Kan inte/Kan extra toggle, note (maxLength 500), optional time range via native time inputs, "Inlagt av chefen" badge, remove on every row; edit = `remove_exception_ids` (editedFromId ∪ removedIds, de-duplicated) + `add_exceptions`; date input constrained to the period with out-of-range guard.
  - Phase 5 — `overview.ts`: `extra` status, kind-aware exceptions (block beats extra), read-only recurring blocks paint red, `partial` = want with limited hours; legend + `CalCellView` gained yellow (wait tokens).
  - Phase 6 — confirmation stats (önskade dagar / pass per vecka / avvikelser i perioden, `Stat` widened to `number | string`); empty-week nudge sheet ("Spara ändå" / "Gå tillbaka").
  - Phase 7 — docstrings updated (`SvarView.tsx` header, `overview.ts`, `ranges.ts`); MVP-deferred paragraph deleted.
  - Phase 8 — `npm run precommit` green (eslint + tsc + vite build); backend suite 119 passed; manual verify per Test Plan items 1–9 against a live server + seeded data with browser automation (manager blocks survive wishes-only save, provenance preserved on verbatim rows, kind flip swaps ids, badge on `source='manager'`, dirty-key note/stepper not clobbering manager edits, empty-week nudge, second save after "Ändra mina svar" no 400, out-of-range date ignored, retired copy gone).

  Not committed — no `--commit`/`--PR` flag; work sits on branch `issue/41-svarview-v2-positive-week` for review. PR body should end with `Closes #41, closes #37, closes #38` and `Refs #40, #13` per the plan.
- 2026-07-10: Started implementation on branch `issue/41-svarview-v2-positive-week` (from `main`).
