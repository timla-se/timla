import { useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Calendar, Check, ChevronDown, ChevronRight, Lock, Plus, Sparkles, X } from 'lucide-react'

import { ApiError } from '../api'
import { getSvarContext, putSvarAvailability } from '../svarApi'
import {
  countDays, DAY_MAX, DAY_MIN, durationLabel, GAP, intervalsToRanges, isWholeDay,
  PRESETS, rangeLabel, STEP, weekdayDates, WEEKDAYS, WHOLE_DAY,
  type DayRange, type WeekRanges,
} from '../ranges'
import { buildOverview, type CalCell, type CalMonth } from '../overview'
import { Lockup } from '../components/Lockup'
import type { SvarContext, SvarException, SvarRecurring } from '../types'
import { formatIsoDate, minutesToTime, weekdayLabel, wallClock } from '../time'

/**
 * The login-free staff share-link page (issue #13), mobile-first, per
 * design/Timla App - Tillgänglighet länk.dc.html.
 *
 * The worker fills in their *normalvecka* (normal week) once — it applies to
 * the whole planning period. Availability is day-first: tap a day to mark the
 * whole day, or open "Vissa tider" for quick presets + a free 06:00–22:00
 * range slider. Individual dates that differ are added as avvikelser (dated
 * blocks). The recurring layer is fully replaced on save; exceptions are an
 * add/remove delta.
 *
 * MVP subset (deferred, all schema-touching): "Önskat antal pass / vecka",
 * the free-text note, "Kan extra" (dated positive availability), the
 * "Inlagt av <chef>" provenance badge, and split (multi-range) days.
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

type LocalException = SvarException & { isNew?: boolean }

/** The complete recurring payload for one kind: weekdays the worker edited use
 * the editor's chosen range; untouched weekdays keep their exact stored rows
 * (split intervals, times outside the 06–22 canvas) so a save never rewrites
 * what the worker didn't touch. */
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
  const [tab, setTab] = useState<'want' | 'cannot'>('want')
  const [want, setWant] = useState<WeekRanges>(() => intervalsToRanges(context.availability.wishes))
  const [cannot, setCannot] = useState<WeekRanges>(() => intervalsToRanges(context.availability.blocks))
  const [openWant, setOpenWant] = useState<Set<number>>(() => new Set())
  const [openCannot, setOpenCannot] = useState<Set<number>>(() => new Set())
  const [exceptions, setExceptions] = useState<LocalException[]>(() => context.availability.exceptions)
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  // The mobile editor's per-day range is a lossy projection of the stored rows
  // (it clamps to 06:00–22:00 and collapses split days). To avoid rewriting
  // manager-entered rows the worker never touched, keep the originals and only
  // replace weekdays the worker actually edited — untouched weekdays round-trip
  // verbatim (review: no-op save must be a no-op).
  const [origWishes, setOrigWishes] = useState<SvarRecurring[]>(() => context.availability.wishes)
  const [origBlocks, setOrigBlocks] = useState<SvarRecurring[]>(() => context.availability.blocks)
  const [dirtyWant, setDirtyWant] = useState<Set<number>>(() => new Set())
  const [dirtyCannot, setDirtyCannot] = useState<Set<number>>(() => new Set())

  const save = useMutation({
    mutationFn: () =>
      putSvarAvailability(token, {
        wishes: mergedRecurring(dirtyWant, want, origWishes),
        blocks: mergedRecurring(dirtyCannot, cannot, origBlocks),
        add_exceptions: exceptions
          .filter((e) => e.isNew)
          .map((e) => ({ on_date: e.on_date, start_minute: e.start_minute, end_minute: e.end_minute })),
        remove_exception_ids: removedIds,
      }),
    // Reconcile local state with the persisted truth: exceptions get real ids
    // and lose isNew, removedIds/dirty reset. Without this a second save in the
    // same session ("Ändra mina svar") re-sends stale remove_exception_ids
    // (→ 400) or re-inserts still-isNew exceptions as duplicates (review).
    onSuccess: (data) => {
      setWant(intervalsToRanges(data.availability.wishes))
      setCannot(intervalsToRanges(data.availability.blocks))
      setOrigWishes(data.availability.wishes)
      setOrigBlocks(data.availability.blocks)
      setExceptions(data.availability.exceptions)
      setRemovedIds([])
      setDirtyWant(new Set())
      setDirtyCannot(new Set())
      setSubmitted(true)
    },
  })

  const toggleDay = (ranges: WeekRanges, set: (r: WeekRanges) => void, markDirty: (wd: number) => void, weekday: number) => {
    set({ ...ranges, [weekday]: ranges[weekday] ? null : { ...WHOLE_DAY } })
    markDirty(weekday)
  }
  const setRange = (ranges: WeekRanges, set: (r: WeekRanges) => void, markDirty: (wd: number) => void, weekday: number, range: DayRange) => {
    set({ ...ranges, [weekday]: range })
    markDirty(weekday)
  }
  const markWant = (wd: number) => setDirtyWant((s) => new Set(s).add(wd))
  const markCannot = (wd: number) => setDirtyCannot((s) => new Set(s).add(wd))
  const toggleOpen = (open: Set<number>, set: (s: Set<number>) => void, weekday: number) => {
    const next = new Set(open)
    if (next.has(weekday)) next.delete(weekday)
    else next.add(weekday)
    set(next)
  }

  const overview = useMemo(
    () => buildOverview(schedule.from, schedule.to, want, cannot, new Set(exceptions.map((e) => e.on_date))),
    [schedule.from, schedule.to, want, cannot, exceptions],
  )

  const removeException = (ex: LocalException) => {
    setExceptions((xs) => xs.filter((x) => x !== ex))
    if (ex.id && !ex.isNew) setRemovedIds((ids) => [...ids, ex.id])
  }
  const addException = (onDate: string) => {
    if (!onDate) return
    setExceptions((xs) => [...xs, { id: `new-${onDate}-${xs.length}`, on_date: onDate, start_minute: 0, end_minute: 1440, isNew: true }])
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-115 flex-col bg-paper">
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

        {/* Availability */}
        <section className="px-6 pb-2 pt-1.5">
          <h2 className="m-0 mb-0.5 text-xl font-extrabold tracking-tight">Din tillgänglighet</h2>
          <p className="m-0 mb-4 text-13 text-warm-gray">Din normalvecka — den gäller alla veckor i perioden.</p>

          <div className="mb-4.5 flex gap-1.5 rounded-14 bg-chip p-1.5">
            <TabButton active={tab === 'want'} onClick={() => setTab('want')} icon={<Sparkles size={15} />}>Vill jobba</TabButton>
            <TabButton active={tab === 'cannot'} onClick={() => setTab('cannot')} icon={<X size={15} />}>Kan inte</TabButton>
          </div>

          {tab === 'want' ? (
            <>
              <TabHeader
                kind="want"
                title="Vilka dagar vill du jobba?"
                subtitle={'Tryck på dagarna. Bara vissa tider? Öppna "Vissa tider".'}
              />
              <DayList
                kind="want"
                ranges={want}
                dates={dates}
                open={openWant}
                onToggleDay={(wd) => toggleDay(want, setWant, markWant, wd)}
                onSetRange={(wd, r) => setRange(want, setWant, markWant, wd, r)}
                onToggleOpen={(wd) => toggleOpen(openWant, setOpenWant, wd)}
              />
            </>
          ) : (
            <>
              <TabHeader
                kind="cannot"
                title="Vilka dagar kan du inte jobba?"
                subtitle="Hårda block — här schemaläggs du aldrig."
              />
              <div className="mb-2.5 font-mono text-10 uppercase tracking-widest text-warm-caption">Varje vecka</div>
              <DayList
                kind="cannot"
                ranges={cannot}
                dates={dates}
                open={openCannot}
                onToggleDay={(wd) => toggleDay(cannot, setCannot, markCannot, wd)}
                onSetRange={(wd, r) => setRange(cannot, setCannot, markCannot, wd, r)}
                onToggleOpen={(wd) => toggleOpen(openCannot, setOpenCannot, wd)}
              />
              <ExceptionList exceptions={exceptions} onRemove={removeException} onAdd={addException} />
            </>
          )}
        </section>

        {/* Period overview — the recurring week + exceptions projected onto real dates */}
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
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-14 bg-ink py-4 text-base font-bold text-honey disabled:opacity-70"
        >
          <Check size={18} strokeWidth={2.2} className="text-ochre" />
          {save.isPending ? 'Sparar…' : 'Spara min tillgänglighet'}
        </button>
      </footer>

      {submitted && (
        <Confirmation
          firstName={context.staff.first_name}
          orgName={context.org.name}
          wantDays={countDays(want)}
          cannotDays={countDays(cannot)}
          exCount={exceptions.length}
          onClose={() => setSubmitted(false)}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-10 px-1.5 py-3 text-13 font-bold ${
        active ? 'bg-white text-ink shadow-[0_1px_3px_rgb(90_60_20/0.12)]' : 'bg-transparent text-warm-gray'
      }`}
    >
      {icon} {children}
    </button>
  )
}

function TabHeader({ kind, title, subtitle }: { kind: 'want' | 'cannot'; title: string; subtitle: string }) {
  const badge = kind === 'want'
    ? { bg: 'var(--color-ok-soft)', icon: <Sparkles size={15} className="text-ok" /> }
    : { bg: 'var(--color-stop-soft)', icon: <X size={15} className="text-stop" /> }
  return (
    <div className="mb-4 flex items-start gap-2">
      <span className="mt-px flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg" style={{ background: badge.bg }}>
        {badge.icon}
      </span>
      <div>
        <div className="text-15 font-bold leading-snug">{title}</div>
        <div className="text-13 text-warm-gray">{subtitle}</div>
      </div>
    </div>
  )
}

const TINT = {
  want: { accent: 'var(--color-ok)', bg: 'var(--color-ok-soft)', border: 'var(--color-ok-line)' },
  cannot: { accent: 'var(--color-stop)', bg: 'var(--color-stop-soft)', border: 'var(--color-stop-line)' },
} as const

function DayList({ kind, ranges, dates, open, onToggleDay, onSetRange, onToggleOpen }: {
  kind: 'want' | 'cannot'
  ranges: WeekRanges
  dates: Record<number, string>
  open: Set<number>
  onToggleDay: (weekday: number) => void
  onSetRange: (weekday: number, range: DayRange) => void
  onToggleOpen: (weekday: number) => void
}) {
  const { accent, bg, border } = TINT[kind]
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
              style={on ? { background: bg, borderColor: border } : { background: 'white', borderColor: 'var(--color-warm-line-strong)' }}
            >
              <button onClick={() => onToggleDay(weekday)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border-2"
                  style={on ? { background: accent, borderColor: accent, color: 'white' } : { borderColor: 'var(--color-warm-border-strong)' }}
                >
                  {on && (kind === 'want'
                    ? <Check size={14} strokeWidth={2.6} />
                    : <X size={14} strokeWidth={2.6} />)}
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
              <RangeControl range={range} accent={accent} onChange={(r) => onSetRange(weekday, r)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function RangeControl({ range, accent, onChange }: { range: DayRange; accent: string; onChange: (r: DayRange) => void }) {
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
      <RangeSlider from={range.start} to={range.end} accent={accent} onChange={(s, e) => onChange({ start: s, end: e })} />
      <div className="mt-2 flex justify-between font-mono text-10 text-warm-sand">
        <span>06</span><span>10</span><span>14</span><span>18</span><span>22</span>
      </div>
    </div>
  )
}

/** Dual-handle range slider on the 06:00–22:00 canvas. Click/drag anywhere;
 * the nearer handle follows, snapping to STEP with a GAP-minute minimum span.
 * Handles are pointer-events:none so the track owns the gesture. */
function RangeSlider({ from, to, accent, onChange }: {
  from: number
  to: number
  accent: string
  onChange: (from: number, to: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = (m: number) => ((m - DAY_MIN) / (DAY_MAX - DAY_MIN)) * 100
  const calc = (clientX: number) => {
    const el = trackRef.current
    if (!el) return from
    const rect = el.getBoundingClientRect()
    const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round((DAY_MIN + r * (DAY_MAX - DAY_MIN)) / STEP) * STEP
  }
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startFrom = from
    const startTo = to
    const m0 = calc(e.clientX)
    const which = Math.abs(m0 - startFrom) <= Math.abs(m0 - startTo) ? 'from' : 'to'
    const apply = (m: number) => {
      if (which === 'from') onChange(Math.min(m, startTo - GAP), startTo)
      else onChange(startFrom, Math.max(m, startFrom + GAP))
    }
    apply(m0)
    const move = (ev: PointerEvent) => apply(calc(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const handle = 'pointer-events-none absolute top-1/2 h-7.5 w-5.5 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white'
  const handleStyle = { border: `1.5px solid ${accent}`, boxShadow: '0 2px 6px rgba(90,60,20,.28)' }
  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      className="relative h-8.5 cursor-pointer touch-none select-none rounded-full border border-warm-line-strong bg-chip"
    >
      <div
        className="pointer-events-none absolute inset-y-1 rounded-14"
        style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%`, background: accent }}
      />
      <div className={handle} style={{ ...handleStyle, left: `${pct(from)}%` }} />
      <div className={handle} style={{ ...handleStyle, left: `${pct(to)}%` }} />
    </div>
  )
}

function ExceptionList({ exceptions, onRemove, onAdd }: {
  exceptions: LocalException[]
  onRemove: (ex: LocalException) => void
  onAdd: (onDate: string) => void
}) {
  return (
    <div className="mt-6.5">
      <h3 className="m-0 mb-0.5 text-15 font-bold">Avvikelser i perioden</h3>
      <p className="m-0 mb-3 text-13 leading-normal text-warm-gray">
        Skiljer sig en vecka från din normalvecka? Lägg till ett datum du inte kan.
      </p>
      <div className="flex flex-col gap-2">
        {exceptions.map((ex) => (
          <div key={ex.id} className="flex items-center gap-3 rounded-xl border border-warm-line bg-white py-3 px-3">
            <div className="min-w-0 flex-1">
              <span className="font-mono text-13 font-semibold text-ink">{formatIsoDate(ex.on_date)}</span>
              {(ex.start_minute !== 0 || ex.end_minute !== 1440) && (
                <span className="ml-2 font-mono text-xs text-warm-gray">
                  {minutesToTime(ex.start_minute)}–{ex.end_minute === 1440 ? '24:00' : minutesToTime(ex.end_minute)}
                </span>
              )}
            </div>
            <button
              onClick={() => onRemove(ex)}
              aria-label="Ta bort"
              className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-chip text-warm-gray"
            >
              <X size={14} strokeWidth={2.2} />
            </button>
          </div>
        ))}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-warm-border-strong py-3 text-sm font-bold text-ochre-deep">
          <Plus size={16} strokeWidth={2} /> Lägg till datum
          <input
            type="date"
            className="sr-only"
            onChange={(e) => { onAdd(e.target.value); e.target.value = '' }}
          />
        </label>
      </div>
    </div>
  )
}

const DOW = ['M', 'T', 'O', 'T', 'F', 'L', 'S']

function PeriodOverview({ months }: { months: CalMonth[] }) {
  if (months.length === 0) return null
  return (
    <section className="px-6 pb-2 pt-6.5">
      <h2 className="m-0 mb-0.5 text-xl font-extrabold tracking-tight">Din period i överblick</h2>
      <p className="m-0 mb-2 text-13 text-warm-gray">Så här ser dina svar ut för hela perioden.</p>
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

function Confirmation({ firstName, orgName, wantDays, cannotDays, exCount, onClose }: {
  firstName: string
  orgName: string
  wantDays: number
  cannotDays: number
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
          <Stat value={wantDays} color="var(--color-ok)" label={<>dagar du<br />vill jobba</>} />
          <Stat value={cannotDays} color="var(--color-stop)" label={<>dagar du<br />inte kan</>} />
          <Stat value={exCount} color="var(--color-ink)" label={<>avvikande<br />datum</>} />
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

function Stat({ value, color, label }: { value: number; color: string; label: React.ReactNode }) {
  return (
    <div className="flex-1 rounded-14 border border-warm-line bg-white px-2 py-3.5 text-center">
      <div className="text-22 font-extrabold" style={{ color }}>{value}</div>
      <div className="text-11 leading-snug text-warm-gray">{label}</div>
    </div>
  )
}
