import { isWholeDay, type WeekRanges } from './ranges'
import type { SvarRecurring } from './types'

/**
 * Builds the "Din period i överblick" mini-calendar model (issues #13, #41):
 * the worker's positive normalvecka, the manager-set recurring blocks
 * (read-only on the phone) and the dated exceptions ("Kan inte" / "Kan extra")
 * projected onto the real period, grouped by month like a wall calendar.
 * Derived live from the current selections so the overview updates as they
 * edit. `partial` means a want day with limited hours (not the whole canvas).
 */
export type DayStatus = 'want' | 'block' | 'extra' | 'partial' | 'ledig' | 'out' | 'adj'

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
  recurringBlocks: SvarRecurring[], // read-only here; manager-set standing "no"
  exceptions: { on_date: string; kind: 'wish' | 'block' }[],
): CalMonth[] {
  const start = parseIso(fromIso)
  const end = parseIso(toIsoStr)
  if (!start || !end) return []

  // A same-day "Kan inte" beats "Kan extra" — mirrors the engine, which
  // checks blocks first; never paint a day yellow the engine would refuse.
  const dated = new Map<string, 'block' | 'extra'>()
  for (const ex of exceptions) {
    if (ex.kind === 'block') dated.set(ex.on_date, 'block')
    else if (dated.get(ex.on_date) !== 'block') dated.set(ex.on_date, 'extra')
  }
  const blockedWeekdays = new Set(recurringBlocks.map((b) => b.weekday))

  const statusOf = (d: Date): DayStatus => {
    if (d < start || d > end) return 'out'
    const ex = dated.get(toIso(d))
    if (ex) return ex
    const wd = ((d.getDay() + 6) % 7) + 1
    if (blockedWeekdays.has(wd)) return 'block'
    const w = want[wd]
    if (w) return isWholeDay(w) ? 'want' : 'partial'
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
