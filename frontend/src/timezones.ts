/** Curated timezone choices shared by onboarding and settings (#14). The API
 * accepts any IANA zone, so a stored off-list value must be appended (not
 * silently swapped) when rendering a select — see selectableTimezones. */
export const TIMEZONES = [
  { value: 'Europe/Stockholm', label: 'Stockholm' },
  { value: 'Europe/Oslo', label: 'Oslo' },
  { value: 'Europe/Copenhagen', label: 'Köpenhamn' },
  { value: 'Europe/Helsinki', label: 'Helsingfors' },
  { value: 'UTC', label: 'UTC' },
]

/** The curated list plus the org's current zone when it is off-list, so the
 * select can always render the saved value. */
export function selectableTimezones(current: string) {
  if (TIMEZONES.some((tz) => tz.value === current)) return TIMEZONES
  return [...TIMEZONES, { value: current, label: current }]
}
