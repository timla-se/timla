import type { WeekRanges } from './ranges'

/**
 * Builds the "Din period i överblick" mini-calendar model (issue #13): the
 * worker's recurring normalvecka + dated blocks projected onto the real
 * period, grouped by month like a wall calendar. Derived live from the current
 * selections so the overview updates as they edit.
 */
export type DayStatus = 'want' | 'block' | 'partial' | 'ledig' | 'out' | 'adj'

export interface CalCell { key: string; num: number; status: DayStatus }
export interface CalWeek { weekNo: number; cells: CalCell[] }
export interface CalMonth { name: string; weeks: CalWeek[] }

const MONTHS = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
]

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO 8601 week number (Monday start, week 1 holds the first Thursday).
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)
}

export function buildOverview(
  fromIso: string,
  toIsoStr: string,
  want: WeekRanges,
  cannot: WeekRanges,
  blockedDates: Set<string>,
): CalMonth[] {
  const start = parseIso(fromIso)
  const end = parseIso(toIsoStr)
  if (!start || !end) return []

  const statusOf = (d: Date): DayStatus => {
    if (d < start || d > end) return 'out'
    if (blockedDates.has(toIso(d))) return 'block'
    const wd = ((d.getDay() + 6) % 7) + 1
    const w = Boolean(want[wd])
    const c = Boolean(cannot[wd])
    if (w && c) return 'partial'
    if (c) return 'block'
    if (w) return 'want'
    return 'ledig'
  }

  const months: CalMonth[] = []
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1)
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
  for (let cur = startMonth; cur <= endMonth; cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
    const y = cur.getFullYear()
    const m = cur.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const lead = (new Date(y, m, 1).getDay() + 6) % 7 // Mon=0 offset of the 1st
    const rows = Math.ceil((lead + daysInMonth) / 7)
    const weeks: CalWeek[] = []
    for (let wi = 0; wi < rows; wi++) {
      const cells: CalCell[] = []
      const monday = new Date(y, m, 1 - lead + wi * 7)
      for (let di = 0; di < 7; di++) {
        const dd = new Date(y, m, 1 - lead + wi * 7 + di)
        const inMonth = dd.getMonth() === m
        cells.push({ key: toIso(dd), num: dd.getDate(), status: inMonth ? statusOf(dd) : 'adj' })
      }
      weeks.push({ weekNo: isoWeek(monday), cells })
    }
    months.push({ name: MONTHS[m] ?? '', weeks })
  }
  return months
}
