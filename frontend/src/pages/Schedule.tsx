import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Flex, Spinner } from '@radix-ui/themes'
import { Callout } from '@swedev/ui'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { getOrg, getPublication, listShifts, listStaff } from '../api'
import { EmptyState } from '../components/EmptyState'
import { useTopbarSearch } from '../components/Layout'
import { Mono } from '../components/Mono'
import { addWeeks, formatDayDate, formatIsoDate, formatWeekLabel, minutesToTime, parseWeekPeriod, wallClock } from '../time'
import type { Shift } from '../types'

/** Read-only Arbetsschema week view (issue #8), per
 * design/Timla App - Arbetsschema Strandkiosken.dc.html. Editing is #9,
 * publishing #10, auto-scheduling #11. */

const WEEKDAY_LABELS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag']

// Neutral bar tint until #27 (org-defined custom fields) supplies a real
// color key. The Erfarenhet legend group joins with it.
const NEUTRAL_TINT = { bg: 'var(--color-ok-soft)', border: 'var(--color-ok-line)', text: 'var(--color-ok-strong)' }
const OPEN_TINT = { border: 'var(--color-stop)', text: 'var(--color-stop-strong)' }

/** #27 plugs the designated custom field in here. */
function colorKey(_staffId: string | null): typeof NEUTRAL_TINT {
  return NEUTRAL_TINT
}

/** Coverage levels per the design legend (Täckning / h) — the
 * --color-cover-* data-viz ramp in index.css. */
const COVERAGE = {
  outside: 'var(--color-cover-outside)',
  gap: 'var(--color-cover-gap)',
  one: 'var(--color-cover-thin)',
  two: 'var(--color-cover-two)',
  ok: 'var(--color-cover-ok)',
}

interface DayShift {
  shift: Shift
  startMinute: number
  /** Effective end for geometry: 1440 when the shift runs past midnight. */
  endMinute: number
  overnight: boolean
  lane: number
}

interface Day {
  weekday: number
  isoDate: string
  shifts: DayShift[]
  lanes: number
  /** Tail (00:00–endMinute) of shifts that started the previous day and
   * wrap past midnight — coverage-only, already rendered as a bar on the
   * day they start. */
  carryIn: { staffId: string | null; endMinute: number }[]
}

/** Greedy lane stacking: first lane whose last bar ends at/before start. */
function assignLanes(shifts: Omit<DayShift, 'lane'>[]): DayShift[] {
  const laneEnds: number[] = []
  return [...shifts]
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
    .map((s) => {
      let lane = laneEnds.findIndex((end) => end <= s.startMinute)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(s.endMinute)
      } else {
        laneEnds[lane] = s.endMinute
      }
      return { ...s, lane }
    })
}

function buildDays(shifts: Shift[], tz: string, period: string): Day[] {
  const monday = parseWeekPeriod(period)
  const isoDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const byDate = new Map<string, Omit<DayShift, 'lane'>[]>(isoDates.map((d) => [d, []]))
  const carryByDate = new Map<string, { staffId: string | null; endMinute: number }[]>(isoDates.map((d) => [d, []]))
  for (const shift of shifts) {
    const start = wallClock(shift.starts_at, tz)
    const end = wallClock(shift.ends_at, tz)
    const overnight = end.isoDate !== start.isoDate
    byDate.get(start.isoDate)?.push({
      shift,
      startMinute: start.minuteOfDay,
      endMinute: overnight ? 1440 : end.minuteOfDay,
      overnight,
    })
    if (overnight) {
      carryByDate.get(end.isoDate)?.push({ staffId: shift.staff_id, endMinute: end.minuteOfDay })
    }
  }
  return isoDates.map((isoDate, i) => {
    const stacked = assignLanes(byDate.get(isoDate) ?? [])
    return {
      weekday: i + 1,
      isoDate,
      shifts: stacked,
      lanes: Math.max(1, ...stacked.map((s) => s.lane + 1)),
      carryIn: carryByDate.get(isoDate) ?? [],
    }
  })
}

function hourSpan(days: Day[]): { firstHour: number; lastHour: number } {
  const all = days.flatMap((d) => d.shifts)
  if (all.length === 0) return { firstHour: 8, lastHour: 20 }
  let first = Math.floor(Math.min(...all.map((s) => s.startMinute)) / 60)
  let last = Math.ceil(Math.max(...all.map((s) => s.endMinute)) / 60)
  while (last - first < 8) {
    if (first > 0) first--
    if (last - first < 8 && last < 24) last++
  }
  return { firstHour: first, lastHour: last }
}

function timeLabel(s: DayShift): string {
  return `${minutesToTime(s.startMinute)}–${s.overnight ? '24:00 →' : minutesToTime(s.endMinute === 1440 ? 1440 : s.endMinute)}`
}

export default function Schedule() {
  const navigate = useNavigate()
  const { week: period = '' } = useParams()
  const { query } = useTopbarSearch()

  const validPeriod = useMemo(() => {
    try { parseWeekPeriod(period); return true } catch { return false }
  }, [period])

  const { data: org } = useQuery({ queryKey: ['org'], queryFn: getOrg })
  const { data: staff = [], isError: staffError } = useQuery({
    queryKey: ['staff', true],
    queryFn: () => listStaff(true),
  })
  const { data: shifts = [], isLoading, isError: shiftsError } = useQuery({
    queryKey: ['shifts', period],
    queryFn: () => listShifts(period),
    enabled: validPeriod,
  })
  const { data: publication, isSuccess: publicationLoaded } = useQuery({
    queryKey: ['publication', period],
    queryFn: () => getPublication(period),
    enabled: validPeriod,
  })

  const tz = org?.timezone ?? 'Europe/Stockholm'
  const days = useMemo(
    () => (validPeriod ? buildDays(shifts, tz, period) : []),
    [shifts, tz, period, validPeriod],
  )
  const { firstHour, lastHour } = useMemo(() => hourSpan(days), [days])
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const spanMinutes = (lastHour - firstHour) * 60

  if (!validPeriod) return <Navigate to="/schema" replace />

  const staffById = new Map(staff.map((s) => [s.id, s]))
  const today = wallClock(new Date().toISOString(), tz).isoDate
  const label = formatWeekLabel(period)
  const scheduledStaff = new Set(shifts.map((s) => s.staff_id).filter(Boolean)).size
  const needle = query.trim().toLowerCase()

  const pct = (minute: number) => ((minute - firstHour * 60) / spanMinutes) * 100

  const coverageFor = (day: Day, hour: number): { color: string; count: number } => {
    const hourStart = hour * 60, hourEnd = hourStart + 60
    const overlaps = (s: DayShift) => s.startMinute < hourEnd && s.endMinute > hourStart
    // carryIn covers [0, endMinute) of this day, wrapped from a shift that
    // started the previous day — it overlaps whenever the hour starts
    // before the tail ends.
    const carryOverlaps = (c: { endMinute: number }) => hourStart < c.endMinute
    const count =
      day.shifts.filter((s) => s.shift.staff_id && overlaps(s)).length +
      day.carryIn.filter((c) => c.staffId && carryOverlaps(c)).length
    // Lucka = an open shift (staff_id null: an explicit, unstaffed need)
    // covers the hour. It takes priority over count-based tiers so a
    // manager-created gap is never masked by unrelated coverage. Hours
    // with no shifts at all are neutral — without opening-hours data we
    // can't know they're gaps rather than closed.
    const openHere =
      day.shifts.some((s) => !s.shift.staff_id && overlaps(s)) ||
      day.carryIn.some((c) => !c.staffId && carryOverlaps(c))
    if (openHere) return { color: COVERAGE.gap, count }
    if (count >= 3) return { color: COVERAGE.ok, count }
    if (count === 2) return { color: COVERAGE.two, count }
    if (count === 1) return { color: COVERAGE.one, count }
    return { color: COVERAGE.outside, count }
  }

  if (isLoading) return <Flex justify="center" py="8"><Spinner /></Flex>
  if (shiftsError || staffError) {
    return <Callout semantic="error" title="Kunde inte hämta schemat" message="Kontrollera anslutningen och ladda om sidan." />
  }

  const empty = shifts.length === 0

  return (
    <div>
      {/* Page header */}
      <div className="mb-6.5 flex items-end justify-between gap-5">
        <div className="flex items-end gap-4.5">
          <h1 className="m-0 text-30 font-extrabold tracking-tight">Arbetsschema</h1>
          <div className="mb-0.5 flex items-center gap-2">
            <button
              aria-label="Föregående vecka"
              onClick={() => navigate(`/schema/${addWeeks(period, -1)}`)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-warm-border-strong bg-white"
            >
              <ChevronLeft size={16} strokeWidth={1.9} className="text-ink-soft" />
            </button>
            <span className="whitespace-nowrap text-15 font-bold">
              {label.week} <span className="font-semibold text-warm-sand">· {label.range}</span>
            </span>
            <button
              aria-label="Nästa vecka"
              onClick={() => navigate(`/schema/${addWeeks(period, 1)}`)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-warm-border-strong bg-white"
            >
              <ChevronRight size={16} strokeWidth={1.9} className="text-ink-soft" />
            </button>
          </div>
          <Mono className="mb-1 rounded-lg bg-chip px-3 py-1.5 text-xs text-warm-gray">
            {shifts.length} pass · {scheduledStaff} i personal
          </Mono>
        </div>
        {/* "Publicera schema" (#10) and "Auto-schemalägg" (#11) land here */}
        <div className="mb-0.5">
          {publicationLoaded && (publication ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-13 font-semibold text-ok-strong">
              <span className="h-1.75 w-1.75 rounded-full bg-ok" />
              Publicerad {formatDayDate(new Date(publication.published_at))}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-13 font-semibold text-warm-gray">
              <span className="h-1.75 w-1.75 rounded-full bg-warm-sand" />
              Utkast
            </span>
          ))}
        </div>
      </div>

      {/* Legend (Erfarenhet group joins via #27) */}
      <div className="mb-3.5 flex flex-wrap items-center gap-4 text-13">
        <Mono className="text-10 uppercase text-warm-caption">Täckning / h</Mono>
        {([['Lucka', COVERAGE.gap, 'var(--color-stop-strong)'], ['1 (tunt)', COVERAGE.one, 'var(--color-wait-strong)'], ['2', COVERAGE.two, 'var(--color-ok-strong)'], ['3+ (ok)', COVERAGE.ok, 'var(--color-ok-strong)']] as const).map(([text, bg, fg]) => (
          <span key={text} className="flex items-center gap-1.5" style={{ color: fg }}>
            <span className="h-2 w-4 rounded-xs" style={{ background: bg }} /> {text}
          </span>
        ))}
        <span className="mx-1 h-4 w-px bg-warm-line-strong" />
        <span className="flex items-center gap-1.5 text-stop-strong">
          <span className="h-2 w-4 rounded-xs border border-dashed border-stop bg-cover-gap/35" /> Öppet pass
        </span>
      </div>

      {empty ? (
        <EmptyState
          title="Inga pass den här veckan ännu"
          description="Passläggning kommer med schemaredigeraren (#9)."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-warm-line bg-white">
          <div className="min-w-215">
            {/* Hour axis header */}
            <div className="grid grid-cols-[96px_1fr] border-b border-warm-line bg-band">
              <Mono className="px-4 py-2.5 text-10 uppercase tracking-wider text-warm-caption">Dag</Mono>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}>
                {hours.map((h) => (
                  <Mono key={h} className="border-l border-warm-line pb-2 pl-1.5 pt-2.5 text-10 text-warm-sand">
                    {String(h).padStart(2, '0')}
                  </Mono>
                ))}
              </div>
            </div>

            {/* Day rows */}
            {days.map((day, dayIndex) => {
              const isToday = day.isoDate === today
              const rowHeight = 24 + day.lanes * 36 + 8
              return (
                <div
                  key={day.isoDate}
                  className={`grid grid-cols-[96px_1fr] ${dayIndex < 6 ? 'border-b-2 border-warm-line-strong' : ''} ${isToday ? 'bg-paper-warm' : ''}`}
                >
                  <div className="border-r border-warm-line p-3.5">
                    <div className={`flex items-center gap-1.5 text-15 font-extrabold tracking-tight ${isToday ? 'text-ochre-deep' : ''}`}>
                      {WEEKDAY_LABELS[day.weekday - 1]}
                      {isToday && <span className="h-1.25 w-1.25 rounded-full bg-ochre" />}
                    </div>
                    <Mono className={`text-11 ${isToday ? 'text-wait-strong' : 'text-warm-sand'}`}>
                      {formatIsoDate(day.isoDate).replace(/^\S+ /, '')}
                    </Mono>
                  </div>
                  <div
                    className="relative"
                    style={{
                      height: rowHeight,
                      // f6ead0/f4ead2 both snapped onto warm-line — the
                      // 1px hour hairlines; the today column keeps its
                      // bg-paper-warm + ochre labels distinction.
                      background: `repeating-linear-gradient(to right, var(--color-warm-line) 0, var(--color-warm-line) 1px, transparent 1px, transparent calc(100% / ${hours.length}))`,
                    }}
                  >
                    {/* Coverage heat-strip */}
                    <div
                      className="absolute inset-x-0 top-1.5 z-0 grid gap-px px-px"
                      style={{ height: 7, gridTemplateColumns: `repeat(${hours.length}, 1fr)` }}
                    >
                      {hours.map((h) => {
                        const { color, count } = coverageFor(day, h)
                        return (
                          <span
                            key={h}
                            title={`${String(h).padStart(2, '0')}:00 · ${count} i tjänst`}
                            className="rounded-xs"
                            style={{ background: color }}
                          />
                        )
                      })}
                    </div>

                    {/* Shift bars */}
                    {day.shifts.map((s) => {
                      const person = s.shift.staff_id ? staffById.get(s.shift.staff_id) : null
                      const open = !s.shift.staff_id
                      const name = open ? 'Öppet pass' : person?.name ?? 'Okänd'
                      const tint = colorKey(s.shift.staff_id)
                      const dimmed = needle !== '' && !name.toLowerCase().includes(needle)
                      return (
                        <div
                          key={s.shift.id}
                          title={s.shift.note ?? undefined}
                          className="absolute flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border px-2.25 text-11"
                          style={{
                            left: `${pct(s.startMinute)}%`,
                            width: `${pct(s.endMinute) - pct(s.startMinute)}%`,
                            top: 24 + s.lane * 36,
                            height: 30,
                            background: open ? 'color-mix(in srgb, var(--color-cover-gap) 35%, transparent)' : tint.bg,
                            borderColor: open ? OPEN_TINT.border : tint.border,
                            borderStyle: open ? 'dashed' : 'solid',
                            color: open ? OPEN_TINT.text : tint.text,
                            opacity: dimmed ? 0.35 : 1,
                          }}
                        >
                          <span className="font-bold">{name}</span>
                          <Mono className="text-10 opacity-80">{timeLabel(s)}</Mono>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
