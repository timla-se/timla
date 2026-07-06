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

/** "00:00" as an end time means end-of-day (minute 1440). */
export function timeToMinutes(time: string, isEnd = false): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const minutes = h * 60 + m
  return isEnd && minutes === 0 ? 1440 : minutes
}

export function intervalLabel(startMinute: number, endMinute: number): string {
  if (startMinute === 0 && endMinute === 1440) return 'hela dagen'
  return `${minutesToTime(startMinute)}–${endMinute === 1440 ? '24:00' : minutesToTime(endMinute)}`
}
