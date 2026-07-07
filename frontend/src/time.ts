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
