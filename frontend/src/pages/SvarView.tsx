import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Calendar, Check, ChevronDown, ChevronRight, Lock, Plus, Sparkles, X } from 'lucide-react'
import { RangeSlider } from '@swedev/ui'

import { ApiError } from '../api'
import { getSvarContext, putSvarAvailability } from '../svarApi'
import {
  countDays, DAY_MAX, DAY_MIN, durationLabel, GAP, intervalsToRanges, isWholeDay,
  PRESETS, rangeLabel, STEP, weekdayDates, WEEKDAYS, WHOLE_DAY,
  type DayRange, type WeekRanges,
} from '../ranges'
import { buildOverview, type CalCell, type CalMonth } from '../overview'
import { Lockup } from '../components/Lockup'
import type { SvarContext, SvarException, SvarPutBody, SvarRecurring } from '../types'
import { formatIsoDate, minutesToTime, timeToMinutes, weekdayLabel, wallClock } from '../time'

/**
 * The login-free staff share-link page (issues #13, #41), mobile-first, per
 * design/Timla App - Tillgänglighet länk v2.dc.html.
 *
 * The worker fills in their *normalvecka* (normal week) once — it applies to
 * the whole planning period. The model is positive-only: pick the days you
 * want to work (whole day, or "Vissa tider" for a 06:00–22:00 range); an
 * unselected day is a soft "helst inte" nudge, not a hard block. Standing
 * hard blocks are set by the manager and render read-only in the overview
 * calendar. Individual dates that differ are unified "Avvikelser i perioden"
 * rows — "Kan inte" (dated block) or "Kan extra" (dated wish) with a reason
 * and an optional time range. "Önskat antal pass / vecka" and a free-text
 * note to the manager round out the answer.
 *
 * Saves send only the keys the phone owns (never `blocks`; the stepper/note
 * only when touched), relying on #40's per-key PUT semantics so concurrent
 * manager edits survive. The recurring wishes layer is replaced whole on
 * save; exceptions are an add/remove delta.
 */
export default function SvarView() {
  const { token = '' } = useParams()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['svar', token],
    queryFn: () => getSvarContext(token),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })

  if (isLoading) {
    return <Centered><div className="text-sm text-warm-sand">Laddar…</div></Centered>
  }
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <Centered>
        <div className="max-w-88 text-center">
          <h1 className="mb-2 text-xl font-extrabold">{notFound ? 'Länken gäller inte längre' : 'Något gick fel'}</h1>
          <p className="text-sm text-ink-soft">
            {notFound
              ? 'Be din chef skicka en ny länk.'
              : 'Kontrollera din anslutning och ladda om sidan.'}
          </p>
        </div>
      </Centered>
    )
  }
  if (!data) return null
  return <Editor token={token} context={data} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-line-strong p-6">{children}</div>
  )
}

/** A dated exception as the phone edits it. `isNew` rows only exist locally;
 * an edited pre-existing row keeps its id for React keys but remembers the
 * server id it replaces in `editedFromId` — the PUT has no in-place edit, so
 * the save sends it as remove(editedFromId) + add(current values). */
type LocalException = SvarException & { isNew?: boolean; editedFromId?: string }

/** The complete recurring payload for one kind: weekdays the worker edited use
 * the editor's chosen range; untouched weekdays keep their exact stored rows
 * (split intervals, times outside the 06–22 canvas) so a save never rewrites
 * what the worker didn't touch — and #40's verbatim-row rule preserves their
 * prior provenance. */
function mergedRecurring(dirty: Set<number>, ranges: WeekRanges, original: SvarRecurring[]): SvarRecurring[] {
  const out: SvarRecurring[] = []
  for (const { weekday } of WEEKDAYS) {
    if (dirty.has(weekday)) {
      const r = ranges[weekday]
      if (r) out.push({ weekday, start_minute: r.start, end_minute: r.end })
    } else {
      for (const o of original) {
        if (o.weekday === weekday) out.push({ weekday, start_minute: o.start_minute, end_minute: o.end_minute })
      }
    }
  }
  return out
}

function Editor({ token, context }: { token: string; context: SvarContext }) {
  const { schedule } = context
  const dates = weekdayDates(schedule.from)
  const [want, setWant] = useState<WeekRanges>(() => intervalsToRanges(context.availability.wishes))
  const [openWant, setOpenWant] = useState<Set<number>>(() => new Set())
  // Manager-set recurring blocks: read-only on the phone (v2 never sends
  // `blocks`), but kept in state — refreshed from the PUT response — so the
  // overview stays truthful after a save that raced a manager edit.
  const [recurringBlocks, setRecurringBlocks] = useState<SvarRecurring[]>(() => context.availability.blocks)
  const [exceptions, setExceptions] = useState<LocalException[]>(() => context.availability.exceptions)
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  // The mobile editor's per-day range is a lossy projection of the stored rows
  // (it clamps to 06:00–22:00 and collapses split days). To avoid rewriting
  // rows the worker never touched, keep the originals and only replace
  // weekdays the worker actually edited — untouched weekdays round-trip
  // verbatim (review: no-op save must be a no-op).
  const [origWishes, setOrigWishes] = useState<SvarRecurring[]>(() => context.availability.wishes)
  const [dirtyWant, setDirtyWant] = useState<Set<number>>(() => new Set())
  // Per-staff params: sent only when the worker touched them, so an untouched
  // save never clobbers a concurrent manager edit (per-key PUT semantics).
  const [perWeek, setPerWeek] = useState<number | null>(() => context.staff.desired_shifts_per_week)
  const [dirtyPerWeek, setDirtyPerWeek] = useState(false)
  const [note, setNote] = useState(() => context.staff.availability_note ?? '')
  const [dirtyNote, setDirtyNote] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      const body: SvarPutBody = {
        // Always the complete wishes state; NEVER send `blocks` — omitting the
        // key is what keeps manager-set recurring blocks intact (#40).
        wishes: mergedRecurring(dirtyWant, want, origWishes),
        // Edited pre-existing rows are re-added under a fresh id…
        add_exceptions: exceptions
          .filter((e) => e.isNew || e.editedFromId)
          .map((e) => ({
            on_date: e.on_date,
            start_minute: e.start_minute,
            end_minute: e.end_minute,
            kind: e.kind,
            ...(e.note?.trim() ? { note: e.note.trim() } : {}),
          })),
        // …while their original id joins the removals (de-duplicated).
        remove_exception_ids: [...new Set([
          ...removedIds,
          ...exceptions.map((e) => e.editedFromId).filter((id): id is string => Boolean(id)),
        ])],
      }
      if (dirtyPerWeek) body.desired_shifts_per_week = perWeek
      if (dirtyNote) body.availability_note = note.trim() || null
      return putSvarAvailability(token, body)
    },
    // Reconcile local state with the persisted truth: exceptions get real ids
    // and lose isNew/editedFromId, removedIds/dirty reset. Without this a
    // second save in the same session ("Ändra mina svar") re-sends stale
    // remove_exception_ids (→ 400) or re-inserts exceptions as duplicates.
    onSuccess: (data) => {
      setWant(intervalsToRanges(data.availability.wishes))
      setOrigWishes(data.availability.wishes)
      setRecurringBlocks(data.availability.blocks)
      setExceptions(data.availability.exceptions)
      setRemovedIds([])
      setDirtyWant(new Set())
      setPerWeek(data.staff.desired_shifts_per_week)
      setDirtyPerWeek(false)
      setNote(data.staff.availability_note ?? '')
      setDirtyNote(false)
      setSubmitted(true)
    },
  })

  const markWant = (wd: number) => setDirtyWant((s) => new Set(s).add(wd))
  const toggleDay = (weekday: number) => {
    setWant({ ...want, [weekday]: want[weekday] ? null : { ...WHOLE_DAY } })
    markWant(weekday)
  }
  const setRange = (weekday: number, range: DayRange) => {
    setWant({ ...want, [weekday]: range })
    markWant(weekday)
  }
  const toggleOpen = (weekday: number) => {
    const next = new Set(openWant)
    if (next.has(weekday)) next.delete(weekday)
    else next.add(weekday)
    setOpenWant(next)
  }

  const overview = useMemo(
    () => buildOverview(schedule.from, schedule.to, want, recurringBlocks, exceptions),
    [schedule.from, schedule.to, want, recurringBlocks, exceptions],
  )

  const removeException = (ex: LocalException) => {
    setExceptions((xs) => xs.filter((x) => x !== ex))
    // Deleting an edited row: only the remove of the original id is sent —
    // the edited values die with the row.
    const removeId = ex.editedFromId ?? (ex.isNew ? null : ex.id)
    if (removeId) setRemovedIds((ids) => (ids.includes(removeId) ? ids : [...ids, removeId]))
  }
  const addException = (onDate: string) => {
    // The date input is period-constrained (min/max), but not every browser
    // enforces it — ignore out-of-range picks. ISO dates compare as strings.
    if (!onDate || onDate < schedule.from || onDate > schedule.to) return
    setExceptions((xs) => [...xs, {
      id: `new-${onDate}-${xs.length}`,
      on_date: onDate,
      start_minute: 0,
      end_minute: 1440,
      kind: 'block',
      note: null,
      source: null,
      isNew: true,
    }])
  }
  const patchException = (ex: LocalException, patch: Partial<LocalException>) => {
    setExceptions((xs) => xs.map((x) => x === ex
      ? { ...x, ...patch, ...(x.isNew ? {} : { editedFromId: x.editedFromId ?? x.id }) }
      : x))
  }

  // timeToMinutes NaNs are never committed, so only ordering can go bad.
  const hasInvalidTimes = exceptions.some((e) => e.start_minute >= e.end_minute)

  const onSavePress = () => {
    if (countDays(want) === 0) setConfirmEmpty(true)
    else save.mutate()
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col bg-paper">
      <div className="flex-1 overflow-y-auto">
        {/* Context header */}
        <header className="px-6 pb-5 pt-4">
          <div className="mb-5 flex items-center justify-between">
            <Lockup className="h-5.5 w-auto" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-2.5 py-1.5 font-mono text-11 text-warm-gray">
              <Lock size={11} strokeWidth={2} /> Säker länk
            </span>
          </div>
          <h1 className="m-0 mb-3 text-30 font-extrabold leading-none tracking-tight">
            Hej {context.staff.first_name}!
          </h1>
          <div className="flex items-center gap-3 rounded-14 border border-warm-line bg-white py-3 px-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-10 bg-stop text-sm font-extrabold text-white">
              {context.org.initials}
            </div>
            <div className="min-w-0">
              <div className="text-15 font-bold">{context.org.name}</div>
              <div className="font-mono text-11 text-warm-gray">Din arbetsplats</div>
            </div>
          </div>
          {/* Period framing: one normal week covers the whole period. */}
          <div className="mt-2.5 flex items-center gap-3 rounded-14 border border-wait-line bg-cream py-3 px-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-10 bg-wait-soft text-wait-strong">
              <Calendar size={18} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <div className="text-13 font-bold text-ink-soft">Du svarar för schemat</div>
              <div className="font-mono text-xs text-wait-strong">
                {formatIsoDate(schedule.from)} – {formatIsoDate(schedule.to)}
              </div>
            </div>
          </div>
          <p className="m-0 mt-3.5 px-0.5 text-13 leading-normal text-warm-gray">
            Fyll i din normalvecka en gång — den gäller hela perioden. Behöver en vecka se annorlunda ut lägger du till en avvikelse.
          </p>
        </header>

        {/* Availability — positive-only normal week */}
        <section className="px-6 pb-2 pt-1.5">
          <h2 className="m-0 mb-0.5 text-xl font-extrabold tracking-tight">Din tillgänglighet</h2>
          <p className="m-0 mb-4 text-13 text-warm-gray">Din normalvecka — den gäller alla veckor i perioden.</p>

          <div className="mb-4 flex items-start gap-2">
            <span className="mt-px flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--color-ok-soft)' }}>
              <Sparkles size={15} className="text-ok" />
            </span>
            <div>
              <div className="text-15 font-bold leading-snug">Vilka dagar vill du jobba?</div>
              <div className="text-13 text-warm-gray">
                Tryck på dagarna du kan jobba — hoppar du över en dag föreslås du inte den dagen. Bara vissa tider? Öppna "Vissa tider".
              </div>
            </div>
          </div>
          <DayList
            ranges={want}
            dates={dates}
            open={openWant}
            onToggleDay={toggleDay}
            onSetRange={setRange}
            onToggleOpen={toggleOpen}
          />

          {/* Önskat antal pass / vecka */}
          <div className="mt-4.5 flex items-center justify-between gap-3 rounded-14 border border-warm-line bg-white py-3.5 px-4">
            <div className="min-w-0">
              <div className="text-sm font-bold">Önskat antal pass / vecka</div>
              <div className="text-xs leading-snug text-warm-gray">
                Så mycket vill du gärna jobba. Gäller tills du ändrar det — inte bara den här perioden.
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <button
                onClick={() => {
                  if (perWeek === null || perWeek <= 0) return
                  setPerWeek(perWeek - 1)
                  setDirtyPerWeek(true)
                }}
                disabled={perWeek === null || perWeek <= 0}
                aria-label="Färre pass"
                className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-warm-border-strong bg-paper text-lg font-extrabold text-ink-soft disabled:opacity-40"
              >
                −
              </button>
              <span className="w-5 text-center font-mono text-lg font-semibold">{perWeek ?? '–'}</span>
              <button
                onClick={() => {
                  // User stepping is bounded 0–7; a stored value > 7 (manager-
                  // set via /data/staff) renders as-is and only steps down.
                  if (perWeek !== null && perWeek >= 7) return
                  setPerWeek(perWeek === null ? 1 : perWeek + 1)
                  setDirtyPerWeek(true)
                }}
                disabled={perWeek !== null && perWeek >= 7}
                aria-label="Fler pass"
                className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-warm-border-strong bg-paper text-lg font-extrabold text-ink-soft disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          {/* Note to the manager */}
          <div className="mt-3.5">
            <label htmlFor="svar-note" className="mb-2 block text-11 font-semibold uppercase tracking-wide text-warm-gray">
              Något chefen bör veta?
            </label>
            <textarea
              id="svar-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => { setNote(e.target.value); setDirtyNote(true) }}
              placeholder="T.ex. pluggar tisdagar, kan hoppa in med kort varsel…"
              className="w-full resize-none rounded-xl border border-warm-border-strong bg-white py-3 px-3.5 text-sm leading-normal text-ink placeholder:text-warm-sand"
            />
          </div>
        </section>

        {/* Avvikelser i perioden */}
        <section className="px-6 pb-2 pt-5.5">
          <h2 className="m-0 mb-0.5 text-xl font-extrabold tracking-tight">Avvikelser i perioden</h2>
          <p className="m-0 mb-3.5 text-13 leading-normal text-warm-gray">
            Enstaka datum som bryter mot din normalvecka. Kan du inte en viss dag — eller kan hoppa in extra? Lägg till det här.
          </p>
          <div className="flex flex-col gap-2">
            {exceptions.map((ex) => (
              <ExceptionRow
                key={ex.id}
                ex={ex}
                onPatch={(patch) => patchException(ex, patch)}
                onRemove={() => removeException(ex)}
              />
            ))}
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-warm-border-strong py-3 text-sm font-bold text-ochre-deep">
              <Plus size={16} strokeWidth={2} /> Lägg till datum
              <input
                type="date"
                className="sr-only"
                min={schedule.from}
                max={schedule.to}
                onChange={(e) => { addException(e.target.value); e.target.value = '' }}
              />
            </label>
          </div>
        </section>

        {/* Period overview — wishes + read-only recurring blocks + exceptions
            projected onto real dates */}
        <PeriodOverview months={overview} />

        {/* Schedule */}
        <ScheduleSection context={context} />
        <div className="h-5" />
      </div>

      {/* Sticky submit */}
      <footer className="shrink-0 border-t border-warm-line bg-paper px-6 pb-6 pt-3.5">
        <div className="mb-2.5 text-center text-11 text-warm-gray">
          Det du sparar ersätter din tidigare tillgänglighet.
        </div>
        {save.isError && (
          <div className="mb-2.5 text-center text-13 text-stop">
            Kunde inte spara. Försök igen.
          </div>
        )}
        {hasInvalidTimes && (
          <div className="mb-2.5 text-center text-13 text-stop">
            Kontrollera tiderna på dina avvikelser — sluttiden måste vara efter starttiden.
          </div>
        )}
        <button
          onClick={onSavePress}
          disabled={save.isPending || hasInvalidTimes}
          className="flex w-full items-center justify-center gap-2 rounded-14 bg-ink py-4 text-base font-bold text-honey disabled:opacity-70"
        >
          <Check size={18} strokeWidth={2.2} className="text-ochre" />
          {save.isPending ? 'Sparar…' : 'Spara min tillgänglighet'}
        </button>
      </footer>

      {confirmEmpty && (
        <EmptyWeekNudge
          onConfirm={() => { setConfirmEmpty(false); save.mutate() }}
          onCancel={() => setConfirmEmpty(false)}
        />
      )}

      {submitted && (
        <Confirmation
          firstName={context.staff.first_name}
          orgName={context.org.name}
          wantDays={countDays(want)}
          perWeek={perWeek}
          exCount={exceptions.length}
          onClose={() => setSubmitted(false)}
        />
      )}
    </div>
  )
}

function DayList({ ranges, dates, open, onToggleDay, onSetRange, onToggleOpen }: {
  ranges: WeekRanges
  dates: Record<number, string>
  open: Set<number>
  onToggleDay: (weekday: number) => void
  onSetRange: (weekday: number, range: DayRange) => void
  onToggleOpen: (weekday: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {WEEKDAYS.map(({ weekday }) => {
        const range = ranges[weekday]
        const on = range !== null && range !== undefined
        const isOpen = open.has(weekday)
        const date = dates[weekday] ?? ''
        return (
          <div key={weekday}>
            <div
              className="flex items-center gap-2.5 rounded-14 border py-3 px-3"
              style={on
                ? { background: 'var(--color-ok-soft)', borderColor: 'var(--color-ok-line)' }
                : { background: 'white', borderColor: 'var(--color-warm-line-strong)' }}
            >
              <button onClick={() => onToggleDay(weekday)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border-2"
                  style={on
                    ? { background: 'var(--color-ok)', borderColor: 'var(--color-ok)', color: 'white' }
                    : { borderColor: 'var(--color-warm-border-strong)' }}
                >
                  {on && <Check size={14} strokeWidth={2.6} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-15 font-bold ${on ? 'text-ink' : 'text-warm-gray'}`}>
                    {weekdayLabel(weekday)}
                  </span>
                  <span className="block text-xs text-warm-gray">
                    <span className="font-mono">{date}</span>
                    {range && <> · {rangeLabel(range)}</>}
                  </span>
                </span>
              </button>
              {on && (
                <button
                  onClick={() => onToggleOpen(weekday)}
                  aria-expanded={isOpen}
                  className="flex shrink-0 items-center gap-1 rounded-10 bg-chip px-2.5 py-1.5 text-xs font-semibold text-warm-gray"
                >
                  Vissa tider
                  <ChevronDown
                    size={14}
                    strokeWidth={2.4}
                    className="transition-transform"
                    style={isOpen ? { transform: 'rotate(180deg)' } : undefined}
                  />
                </button>
              )}
            </div>
            {range && isOpen && (
              <RangeControl range={range} onChange={(r) => onSetRange(weekday, r)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function RangeControl({ range, onChange }: { range: DayRange; onChange: (r: DayRange) => void }) {
  const accent = 'var(--color-ok)'
  return (
    <div className="px-3 pb-1.5 pt-3">
      <div className="mb-4 flex gap-1.5">
        {PRESETS.map((p) => {
          const active = p.whole ? isWholeDay(range) : range.start === p.start && range.end === p.end
          return (
            <button
              key={p.label}
              onClick={() => onChange({ start: p.start, end: p.end })}
              className="flex-1 basis-0 rounded-full border px-2 py-2 text-center text-13 font-semibold"
              style={active
                ? { background: accent, borderColor: accent, color: 'white' }
                : { background: 'white', borderColor: 'var(--color-warm-border-strong)', color: 'var(--color-warm-gray)' }}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold text-ink">
          {minutesToTime(range.start)}–{minutesToTime(range.end)}
        </span>
        <span className="text-13 text-warm-gray">{durationLabel(range)}</span>
      </div>
      <RangeSlider
        className="svar-range"
        semantic="success"
        min={DAY_MIN}
        max={DAY_MAX}
        step={STEP}
        minGap={GAP}
        value={[range.start, range.end]}
        onValueChange={([s, e]) => onChange({ start: s, end: e })}
      />
      <div className="mt-2 flex justify-between font-mono text-10 text-warm-sand">
        <span>06</span><span>10</span><span>14</span><span>18</span><span>22</span>
      </div>
    </div>
  )
}

/** One "Avvikelser i perioden" row: date + optional time range, free-text
 * reason, "Kan inte"/"Kan extra" toggle and a provenance badge. Exceptions
 * legitimately span 00–24 (night shifts, early appointments), so times are
 * native <input type="time">, not the 06–22 RangeSlider canvas. */
function ExceptionRow({ ex, onPatch, onRemove }: {
  ex: LocalException
  onPatch: (patch: Partial<LocalException>) => void
  onRemove: () => void
}) {
  const isBlock = ex.kind === 'block'
  const wholeDay = ex.start_minute === 0 && ex.end_minute === 1440
  const [showTimes, setShowTimes] = useState(!wholeDay)
  const invalid = ex.start_minute >= ex.end_minute
  return (
    <div className="rounded-14 border border-warm-line bg-white p-3">
      <div className="flex items-center gap-3">
        <span
          className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg"
          style={isBlock
            ? { background: 'var(--color-stop-soft)', color: 'var(--color-stop)' }
            : { background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}
        >
          <Calendar size={17} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-13 font-semibold text-ink">{formatIsoDate(ex.on_date)}</span>
            {!wholeDay && (
              <span className={`font-mono text-xs ${invalid ? 'text-stop' : 'text-warm-gray'}`}>
                {minutesToTime(ex.start_minute)}–{ex.end_minute === 1440 ? '24:00' : minutesToTime(ex.end_minute)}
              </span>
            )}
            {ex.source === 'manager' && (
              <span className="inline-flex items-center rounded-full bg-cream px-2 py-0.5 text-10 font-bold text-wait-strong">
                Inlagt av chefen
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onRemove}
          aria-label="Ta bort"
          className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-chip text-warm-gray"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
      <input
        type="text"
        maxLength={500}
        value={ex.note ?? ''}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder="Orsak (valfritt)"
        className="mt-2.5 w-full rounded-10 border border-warm-line bg-white px-3 py-2 text-13 text-ink placeholder:text-warm-sand"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-10 bg-chip p-1">
          {/* A small inline pair, not SegmentedControl — it can't do per-item
              semantic colors (red "Kan inte" / green "Kan extra"). */}
          <button
            onClick={() => { if (!isBlock) onPatch({ kind: 'block' }) }}
            className="flex-1 rounded-lg py-1.5 text-13 font-bold"
            style={isBlock
              ? { background: 'var(--color-stop)', color: 'white' }
              : { color: 'var(--color-warm-gray)' }}
          >
            Kan inte
          </button>
          <button
            onClick={() => { if (isBlock) onPatch({ kind: 'wish' }) }}
            className="flex-1 rounded-lg py-1.5 text-13 font-bold"
            style={!isBlock
              ? { background: 'var(--color-ok)', color: 'white' }
              : { color: 'var(--color-warm-gray)' }}
          >
            Kan extra
          </button>
        </div>
        <button
          onClick={() => setShowTimes((v) => !v)}
          aria-expanded={showTimes}
          className="flex shrink-0 items-center gap-1 rounded-10 bg-chip px-2.5 py-2 text-xs font-semibold text-warm-gray"
        >
          Vissa tider
          <ChevronDown
            size={14}
            strokeWidth={2.4}
            className="transition-transform"
            style={showTimes ? { transform: 'rotate(180deg)' } : undefined}
          />
        </button>
      </div>
      {showTimes && (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="time"
            value={minutesToTime(ex.start_minute)}
            onChange={(e) => {
              const m = timeToMinutes(e.target.value)
              if (!Number.isNaN(m) && m !== ex.start_minute) onPatch({ start_minute: m })
            }}
            className="flex-1 rounded-10 border border-warm-line bg-white px-2.5 py-2 font-mono text-13 text-ink"
          />
          <span className="text-warm-gray">–</span>
          <input
            type="time"
            value={minutesToTime(ex.end_minute)}
            onChange={(e) => {
              const m = timeToMinutes(e.target.value, true) // "00:00" as end = 1440
              if (!Number.isNaN(m) && m !== ex.end_minute) onPatch({ end_minute: m })
            }}
            className="flex-1 rounded-10 border border-warm-line bg-white px-2.5 py-2 font-mono text-13 text-ink"
          />
          <button
            onClick={() => { if (!wholeDay) onPatch({ start_minute: 0, end_minute: 1440 }) }}
            className="shrink-0 rounded-10 bg-chip px-2.5 py-2 text-xs font-semibold text-warm-gray"
          >
            Hela dagen
          </button>
        </div>
      )}
    </div>
  )
}

const DOW = ['M', 'T', 'O', 'T', 'F', 'L', 'S']

function PeriodOverview({ months }: { months: CalMonth[] }) {
  if (months.length === 0) return null
  return (
    <section className="px-6 pb-2 pt-6.5">
      <h2 className="m-0 mb-0.5 text-xl font-extrabold tracking-tight">Din period i överblick</h2>
      <p className="m-0 mb-2 text-13 text-warm-gray">Så här ser dina svar ut för hela perioden. Stämmer det? Spara längst ner.</p>
      {months.map((mo) => (
        <div key={mo.name}>
          <div className="mb-2 mt-3.5 px-0.5 text-19 font-extrabold tracking-tight text-ochre-deep">{mo.name}</div>
          <div className="grid grid-cols-[24px_repeat(7,1fr)] gap-0.5 px-0.5 pb-1">
            <div />
            {DOW.map((d, i) => (
              <div key={i} className={`text-center font-mono text-11 font-semibold ${i >= 5 ? 'text-mutedwarm' : 'text-warm-caption'}`}>
                {d}
              </div>
            ))}
          </div>
          {mo.weeks.map((wk) => (
            <div key={wk.cells[0]?.key} className="grid grid-cols-[24px_repeat(7,1fr)] items-center gap-0.5">
              <div className="pr-1.5 text-right font-mono text-10 text-mutedwarm">{wk.weekNo}</div>
              {wk.cells.map((cell) => <CalCellView key={cell.key} cell={cell} />)}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-4 flex flex-wrap gap-x-3.5 gap-y-2 px-0.5">
        <LegendItem bg="var(--color-ok-soft)" fg="var(--color-ok-strong)" label="Vill jobba" />
        <LegendItem bg="var(--color-stop-soft)" fg="var(--color-stop-strong)" label="Kan inte" />
        <LegendItem bg="var(--color-wait-soft)" fg="var(--color-wait-strong)" label="Kan extra" />
        <LegendItem bg="var(--color-ok-soft)" fg="var(--color-warm-caption)" label="Delvis" dot />
      </div>
    </section>
  )
}

function CalCellView({ cell }: { cell: CalCell }) {
  const s = cell.status
  let bg: string | null = null
  let fg = 'var(--color-ink)'
  let weight = 600
  if (s === 'adj') fg = 'var(--color-warm-border-strong)'
  else if (s === 'out') fg = 'var(--color-mutedwarm)'
  else if (s === 'want' || s === 'partial') { bg = 'var(--color-ok-soft)'; fg = 'var(--color-ok-strong)'; weight = 700 }
  else if (s === 'block') { bg = 'var(--color-stop-soft)'; fg = 'var(--color-stop-strong)'; weight = 700 }
  else if (s === 'extra') { bg = 'var(--color-wait-soft)'; fg = 'var(--color-wait-strong)'; weight = 700 }
  return (
    <div className="flex h-10 items-center justify-center">
      <div
        className="relative flex items-center justify-center text-sm"
        style={bg
          ? { width: 30, height: 30, borderRadius: '50%', background: bg, color: fg, fontWeight: weight }
          : { color: fg, fontWeight: weight }}
      >
        {cell.num}
        {s === 'partial' && (
          <span className="absolute bottom-1 left-1/2 h-1.25 w-1.25 -translate-x-1/2 rounded-full bg-stop" />
        )}
      </div>
    </div>
  )
}

function LegendItem({ bg, fg, label, dot }: { bg: string; fg: string; label: string; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-11 font-semibold" style={{ color: fg }}>
      <span className="relative inline-block h-3 w-3 rounded-full" style={{ background: bg }}>
        {dot && <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-stop" />}
      </span>
      {label}
    </span>
  )
}

function ScheduleSection({ context }: { context: SvarContext }) {
  const { org, schedule } = context
  return (
    <section className="px-6 pb-2 pt-6.5">
      <div className="mb-1 flex items-end justify-between">
        <h2 className="m-0 text-xl font-extrabold tracking-tight">Ditt schema</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1.5 text-11 font-semibold text-ok-strong">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Publicerat
        </span>
      </div>
      <p className="m-0 mb-3.5 font-mono text-xs text-warm-gray">
        {formatIsoDate(schedule.from)} – {formatIsoDate(schedule.to)}
      </p>
      {schedule.shifts.length === 0 ? (
        <div className="rounded-14 border border-dashed border-warm-border-strong bg-white/40 px-4 py-8 text-center text-13 text-warm-gray">
          Inga publicerade pass ännu.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {schedule.shifts.map((s) => {
              const start = wallClock(s.starts_at, org.timezone)
              const end = wallClock(s.ends_at, org.timezone)
              return (
                <div key={s.starts_at} className="flex items-center gap-3 rounded-14 border border-warm-line bg-white p-3.5">
                  <div className="flex w-11 shrink-0 flex-col items-center justify-center">
                    <span className="text-sm font-extrabold text-ink">{weekdayLabel(start.weekday).slice(0, 3)}</span>
                    <span className="font-mono text-11 text-warm-sand">{formatIsoDate(s.date).replace(/^\S+ /, '')}</span>
                  </div>
                  <div className="w-px self-stretch bg-warm-line" />
                  <div className="flex-1 font-mono text-15 font-semibold text-ink">
                    {minutesToTime(start.minuteOfDay)}–{minutesToTime(end.minuteOfDay)}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between px-1">
            <span className="text-13 text-warm-gray">{schedule.shift_count} pass</span>
            <span className="font-mono text-13 font-semibold text-ink-soft">{schedule.hours} h</span>
          </div>
        </>
      )}
    </section>
  )
}

/** Saving an all-empty week is legal (the engine treats zero wishes as
 * all-neutral) but easy to do by mistake — prompt before it goes out. */
function EmptyWeekNudge({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/40">
      <div className="w-full rounded-t-4xl bg-paper px-7 pb-8 pt-8">
        <h2 className="m-0 mb-2 text-center text-2xl font-extrabold tracking-tight">Inga dagar valda</h2>
        <p className="mx-auto mb-5 max-w-[32ch] text-center text-15 leading-normal text-ink-soft">
          Du har inte valt några dagar. Chefen ser inga önskemål från dig — men du kan fortfarande schemaläggas. Vill du spara ändå?
        </p>
        <button onClick={onConfirm} className="w-full rounded-14 bg-ink py-4 text-base font-bold text-honey">
          Spara ändå
        </button>
        <button onClick={onCancel} className="mt-3.5 flex w-full items-center justify-center gap-1 text-sm font-bold text-ochre-deep">
          Gå tillbaka
        </button>
      </div>
    </div>
  )
}

function Confirmation({ firstName, orgName, wantDays, perWeek, exCount, onClose }: {
  firstName: string
  orgName: string
  wantDays: number
  perWeek: number | null
  exCount: number
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/40">
      <div className="w-full rounded-t-4xl bg-paper px-7 pb-8 pt-8">
        <div className="mx-auto mb-4.5 flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft">
          <Check size={34} strokeWidth={2.4} className="text-ok" />
        </div>
        <h2 className="m-0 mb-2 text-center text-2xl font-extrabold tracking-tight">Tack {firstName}!</h2>
        <p className="mx-auto mb-5 max-w-[30ch] text-center text-15 leading-normal text-ink-soft">
          Din tillgänglighet är sparad. {orgName} ser den direkt.
        </p>
        <div className="mb-2 flex gap-2">
          <Stat value={wantDays} color="var(--color-ok)" label={<>önskade<br />dagar</>} />
          <Stat value={perWeek ?? '–'} color="var(--color-ink)" label={<>pass<br />per vecka</>} />
          <Stat value={exCount} color="var(--color-ink)" label={<>avvikelser<br />i perioden</>} />
        </div>
        <div className="my-3.5 flex items-center gap-2.5 rounded-xl bg-cream px-3.5 py-3 text-13 leading-normal text-ink-soft">
          <Lockup className="h-4.5 w-auto shrink-0" /> Du kan öppna länken igen när som helst för att ändra.
        </div>
        <button onClick={onClose} className="w-full rounded-14 bg-ink py-4 text-base font-bold text-honey">Klart</button>
        <button onClick={onClose} className="mt-3.5 flex w-full items-center justify-center gap-1 text-sm font-bold text-ochre-deep">
          Ändra mina svar <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

function Stat({ value, color, label }: { value: number | string; color: string; label: React.ReactNode }) {
  return (
    <div className="flex-1 rounded-14 border border-warm-line bg-white px-2 py-3.5 text-center">
      <div className="text-22 font-extrabold" style={{ color }}>{value}</div>
      <div className="text-11 leading-snug text-warm-gray">{label}</div>
    </div>
  )
}
