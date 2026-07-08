/** Minute-of-day helpers shared with the availability views (#7 reuses these).
 * Convention: end minute 1440 renders as "00:00" and means end-of-day. */

export const WEEKDAYS = [
  { value: '1', label: 'Måndag' },
  { value: '2', label: 'Tisdag' },
  { value: '3', label: 'Onsdag' },
  { value: '4', label: 'Torsdag' },
  { value: '5', label: 'Fredag' },
  { value: '6', label: 'Lördag' },
  { value: '7', label: 'Söndag' },
]

export function weekdayLabel(weekday: number): string {
  return WEEKDAYS[weekday - 1]?.label ?? String(weekday)
}

export function minutesToTime(minutes: number): string {
  const m = minutes === 1440 ? 0 : minutes
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "00:00" as an end time means end-of-day (minute 1440).
 * A cleared/incomplete input ('' from the browser) returns NaN so callers
 * can flag the row as invalid instead of silently treating it as 00:00. */
export function timeToMinutes(time: string, isEnd = false): number {
  if (!/^\d{2}:\d{2}$/.test(time)) return NaN
  const [h = 0, m = 0] = time.split(':').map(Number)
  const minutes = h * 60 + m
  return isEnd && minutes === 0 ? 1440 : minutes
}

export function intervalLabel(startMinute: number, endMinute: number): string {
  if (startMinute === 0 && endMinute === 1440) return 'hela dagen'
  return `${minutesToTime(startMinute)}–${endMinute === 1440 ? '24:00' : minutesToTime(endMinute)}`
}

/** Klartext dates per Ton & röst: always weekday + date ("tors 8 maj"),
 * never "8/5" or "imorgon". Hand-rolled names because Intl's sv-SE short
 * forms add periods ("okt.") the design doesn't use. Render date/time
 * strings in mono (<Mono>). */

const WEEKDAY_SHORT = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön']
const MONTH_SHORT = ['jan', 'feb', 'mars', 'april', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec']

export function formatDayDate(date: Date): string {
  // getDay(): 0 = Sunday; WEEKDAY_SHORT is Monday-first (ISO)
  const weekday = WEEKDAY_SHORT[(date.getDay() + 6) % 7]
  // Year only when it isn't the current one — "mån 6 juli" is ambiguous
  // across a year boundary (availability exceptions can be any date).
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${weekday} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}${year}`
}

/** Date without weekday — "6 juli" — for places that already show the weekday
 * (e.g. the /svar day rows, issue #13). Year only across a year boundary. */
export function formatDayMonth(date: Date): string {
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}${year}`
}

export function formatDayDateTime(date: Date): string {
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${formatDayDate(date)} · ${hm}`
}

/** For the API's local date strings. new Date('YYYY-MM-DD') parses as UTC
 * midnight and can render as the previous day — parse the parts instead.
 * Invalid input is returned untouched so bad data stays visible. */
export function formatIsoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const [, y, m, d] = match
  return formatDayDate(new Date(Number(y), Number(m) - 1, Number(d)))
}

/** ISO 8601 week (Monday start, week 1 holds the first Thursday) — same
 * semantics as app/weeks.py. Uses the browser's local date, which matches
 * the org week for managers working in their own timezone. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3) // nearest Thursday
  const year = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return { year, week }
}

/** '2026-W28' — the API's period format. */
export function isoWeekPeriod(date: Date): string {
  const { year, week } = isoWeek(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Compact hour for schedule summaries: 540 → "09", 570 → "09:30". */
function compactHour(minute: number): string {
  const time = minute === 1440 ? '24:00' : minutesToTime(minute)
  return time.endsWith(':00') ? time.slice(0, 2) : time
}

/** '2026-W28' → the Monday that starts it (local Date, midnight). ISO
 * semantics mirror app/weeks.py. Throws on malformed input. */
export function parseWeekPeriod(period: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(period)
  if (!match) throw new Error(`invalid week period: ${period}`)
  const year = Number(match[1]), week = Number(match[2])
  // Jan 4 is always in ISO week 1; walk back to its Monday, then forward.
  const jan4 = new Date(year, 0, 4)
  const week1Monday = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7))
  const monday = new Date(week1Monday)
  monday.setDate(week1Monday.getDate() + (week - 1) * 7)
  if (week < 1 || isoWeek(monday).week !== week) throw new Error(`invalid week period: ${period}`)
  return monday
}

export function addWeeks(period: string, delta: number): string {
  const monday = parseWeekPeriod(period)
  monday.setDate(monday.getDate() + delta * 7)
  return isoWeekPeriod(monday)
}

/** "Vecka 28" + "7–13 juli" per the Arbetsschema design; ranges crossing a
 * month render both ("28 juli–3 aug"), crossing a year also the year. */
export function formatWeekLabel(period: string): { week: string; range: string } {
  const monday = parseWeekPeriod(period)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const { week } = isoWeek(monday)
  const sameMonth = monday.getMonth() === sunday.getMonth() && monday.getFullYear() === sunday.getFullYear()
  const year = sunday.getFullYear() === new Date().getFullYear() ? '' : ` ${sunday.getFullYear()}`
  const range = sameMonth
    ? `${monday.getDate()}–${sunday.getDate()} ${MONTH_SHORT[monday.getMonth()]}${year}`
    : `${monday.getDate()} ${MONTH_SHORT[monday.getMonth()]}–${sunday.getDate()} ${MONTH_SHORT[sunday.getMonth()]}${year}`
  return { week: `Vecka ${week}`, range }
}

/** Wall-clock parts of an instant in a named timezone. The API returns
 * timestamptz instants; all day grouping and minute-of-day math for the
 * schedule MUST go through this — browser-local Date getters would shift
 * shifts across days for managers travelling outside the org timezone. */
export function wallClock(isoInstant: string, timeZone: string): {
  isoDate: string
  weekday: number // 1 = Monday … 7 = Sunday
  minuteOfDay: number
} {
  const date = new Date(isoInstant)
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // Some ICU versions add a trailing period to short weekdays — strip it.
  const weekdayIndex = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön']
    .indexOf(get('weekday').replace('.', ''))
  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdayIndex + 1,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/** One-line summary of weekly wishes per the Personal design:
 * "Mån–Fre · 09–17" when all days share one window, a day list when
 * non-contiguous, "Varierar" when windows differ, null when empty. */
export function summarizeWishes(
  wishes: { weekday: number; start_minute: number; end_minute: number }[],
): string | null {
  const sample = wishes[0]
  if (!sample) return null
  const windows = new Set(wishes.map((w) => `${w.start_minute}-${w.end_minute}`))
  if (windows.size > 1) return 'Varierar'
  const days = [...new Set(wishes.map((w) => w.weekday))].sort((a, b) => a - b)
  const first = days[0] ?? 1, last = days[days.length - 1] ?? first
  const contiguous = days.length > 1 && last - first === days.length - 1
  // Each day capitalized in schedule labels ("Mån–Fre"), per the design.
  const cap = (d: number) => {
    const s = WEEKDAY_SHORT[d - 1] ?? ''
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  const dayLabel = contiguous ? `${cap(first)}–${cap(last)}` : days.map(cap).join(', ')
  return `${dayLabel} · ${compactHour(sample.start_minute)}–${compactHour(sample.end_minute)}`
}
