import { formatDayMonth, minutesToTime } from './time'
import type { SvarRecurring } from './types'

/**
 * Recurring availability as one time-range per weekday (issue #13). Day-first:
 * a day is off, or on with a single range. The worker canvas is 06:00–22:00
 * (DAY_MIN..DAY_MAX) — "Hela dagen" means the full canvas, not 00–24; nights
 * are a manager-UI concern. Presets (Hela dagen / Morgon / Dag / Kväll) are
 * quick shortcuts on top of a free 15-min slider — not fixed buckets.
 */
export interface DayRange {
  start: number // wall-clock minutes, org timezone
  end: number
}

export type WeekRanges = Record<number, DayRange | null>

export const DAY_MIN = 360 // 06:00
export const DAY_MAX = 1320 // 22:00
export const STEP = 15 // slider snap, minutes
export const GAP = 30 // minimum span between handles, minutes

export const WHOLE_DAY: DayRange = { start: DAY_MIN, end: DAY_MAX }

export const PRESETS: { label: string; start: number; end: number; whole?: boolean }[] = [
  { label: 'Hela dagen', start: 360, end: 1320, whole: true },
  { label: 'Morgon', start: 360, end: 660 },
  { label: 'Dag', start: 660, end: 960 },
  { label: 'Kväll', start: 960, end: 1320 },
]

export const WEEKDAYS = [
  { weekday: 1, short: 'Mån' },
  { weekday: 2, short: 'Tis' },
  { weekday: 3, short: 'Ons' },
  { weekday: 4, short: 'Tors' },
  { weekday: 5, short: 'Fre' },
  { weekday: 6, short: 'Lör' },
  { weekday: 7, short: 'Sön' },
] as const

export function emptyRanges(): WeekRanges {
  const r: WeekRanges = {}
  for (const { weekday } of WEEKDAYS) r[weekday] = null
  return r
}

/** Clamp a stored interval onto the worker canvas [DAY_MIN, DAY_MAX], keeping a
 * valid span. Data entirely outside the canvas (e.g. a 00:00–05:00 block) can't
 * be shown here — it lands on the nearest edge; the manager UI owns such rows. */
function clampToCanvas(start: number, end: number): DayRange {
  const s = Math.max(DAY_MIN, Math.min(start, DAY_MAX - GAP))
  const e = Math.min(DAY_MAX, Math.max(end, s + GAP))
  return { start: s, end: e }
}

/** Stored recurring rows → one range per weekday. Multiple intervals on a day
 * collapse to their bounding span (rare; the manager owns split intervals). */
export function intervalsToRanges(rows: SvarRecurring[]): WeekRanges {
  const out = emptyRanges()
  for (const r of rows) {
    if (r.weekday < 1 || r.weekday > 7) continue
    const c = clampToCanvas(r.start_minute, r.end_minute)
    const cur = out[r.weekday]
    out[r.weekday] = cur
      ? { start: Math.min(cur.start, c.start), end: Math.max(cur.end, c.end) }
      : c
  }
  return out
}

export function rangesToIntervals(ranges: WeekRanges): SvarRecurring[] {
  const out: SvarRecurring[] = []
  for (const { weekday } of WEEKDAYS) {
    const r = ranges[weekday]
    if (r) out.push({ weekday, start_minute: r.start, end_minute: r.end })
  }
  return out
}

export function countDays(ranges: WeekRanges): number {
  let n = 0
  for (const { weekday } of WEEKDAYS) if (ranges[weekday]) n += 1
  return n
}

export function isWholeDay(r: DayRange): boolean {
  return r.start === DAY_MIN && r.end === DAY_MAX
}

export function rangeLabel(r: DayRange): string {
  return isWholeDay(r) ? 'Hela dagen' : `${minutesToTime(r.start)}–${minutesToTime(r.end)}`
}

export function durationLabel(r: DayRange): string {
  const h = (r.end - r.start) / 60
  return `${Number.isInteger(h) ? String(h) : h.toFixed(1).replace('.', ',')} h`
}

/** Concrete date per weekday, anchored to the first week of the period (the ISO
 * week containing `fromIso`) — a reference week that grounds the recurring
 * normalvecka. weekday 1..7 (Mon..Sun) → "6 juli". */
export function weekdayDates(fromIso: string): Record<number, string> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso)
  const out: Record<number, string> = {}
  if (!m) return out
  const [, y, mo, d] = m.map(Number)
  const from = new Date(y!, mo! - 1, d!) // local, no tz shift
  const isoWeekday = ((from.getDay() + 6) % 7) + 1 // 1=Mon..7=Sun
  const monday = new Date(y!, mo! - 1, d! - (isoWeekday - 1))
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    out[i + 1] = formatDayMonth(day)
  }
  return out
}
