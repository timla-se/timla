import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Flex, Spinner } from '@radix-ui/themes'
import { Button, Callout, ConfirmModal } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'

import { ApiError, createShift, getOrg, getPublications, getStaffingNeeds, listShiftsRange, listStaff, publishSchedule, suggestSchedule } from '../api'
import { EmptyState } from '../components/EmptyState'
import { useTopbarSearch } from '../components/Layout'
import { Mono } from '../components/Mono'
import { ShiftModal, type ShiftModalInitial } from '../components/ShiftModal'
import { addWeeks, formatDayDate, formatIsoDate, formatWeekLabel, minutesToTime, parseWeekPeriod, wallClock } from '../time'
import type { NeedsExpansion, Publication, Shift } from '../types'

/** Arbetsschema week view (issue #8), per
 * design/Timla App - Arbetsschema Strandkiosken.dc.html. Editing is #9,
 * publishing #10; coverage reads the staffing-needs curve and
 * "Auto-schemalägg" fills it (#11). */

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

/** The week's publish badge, derived from the publications overlapping it
 * (#10). Publications are arbitrary date ranges, so a week can be covered by
 * none, part, one, or several of them:
 * - no day covered → draft ("Utkast")
 * - every day covered, none diverged → published (latest published_at)
 * - every day covered, some diverged → "Ändringar sedan publicering"
 * - some days covered → "Delvis publicerad" (distinct wording — "changed
 *   since publish" would be a lie about days that were never published) */
export type PublishState =
  | { kind: 'draft' }
  | { kind: 'published'; publishedAt: string }
  | { kind: 'diverged' }
  | { kind: 'partial' }

export function publishState(isoDates: string[], pubs: Publication[]): PublishState {
  // Inclusive from/to; ISO date strings compare correctly as strings.
  const covered = isoDates.filter((d) => pubs.some((p) => p.from <= d && d <= p.to))
  if (covered.length === 0) return { kind: 'draft' }
  if (covered.length < isoDates.length) return { kind: 'partial' }
  if (pubs.some((p) => p.diverged)) return { kind: 'diverged' }
  // pubs is non-empty here (some day was covered), so a latest stamp exists.
  const publishedAt = pubs.map((p) => p.published_at).sort()[pubs.length - 1]!
  return { kind: 'published', publishedAt }
}

/** One positive-headcount segment of a day's demand curve, in day-local
 * wall-clock minutes (issue #11). */
export interface NeedSeg {
  start: number
  end: number
  headcount: number
}

/** Positive-headcount need segments per local date. The headcount-0 "closed"
 * sentinel contributes nothing to needed(t) — closed time is neutral. */
export function needsByDate(needs: NeedsExpansion | undefined, tz: string): Map<string, NeedSeg[]> {
  const map = new Map<string, NeedSeg[]>()
  for (const n of needs?.intervals ?? []) {
    if (n.headcount <= 0) continue
    const start = wallClock(n.starts_at, tz)
    const end = wallClock(n.ends_at, tz)
    const seg = {
      start: start.minuteOfDay,
      // A stored need never crosses midnight; end minute 1440 shows up as
      // next-day 00:00 after the UTC round-trip.
      end: end.isoDate !== start.isoDate ? 1440 : end.minuteOfDay,
      headcount: n.headcount,
    }
    map.set(start.isoDate, [...(map.get(start.isoDate) ?? []), seg])
  }
  return map
}

/** The worst point of staffed(t) − needed(t) inside [cellStart, cellEnd),
 * evaluated at the exact event boundaries (shifts and needs both start at
 * arbitrary minutes — "any overlap counts as the whole hour" would falsely
 * mark covered). Null when the cell has no positive demand: neutral time,
 * never "covered". */
export function worstPoint(
  staffed: { start: number; end: number }[],
  needs: NeedSeg[],
  cellStart: number,
  cellEnd: number,
): { minute: number; staffed: number; needed: number } | null {
  const points = new Set<number>([cellStart])
  for (const seg of [...staffed, ...needs]) {
    if (seg.start > cellStart && seg.start < cellEnd) points.add(seg.start)
    if (seg.end > cellStart && seg.end < cellEnd) points.add(seg.end)
  }
  let worst: { minute: number; staffed: number; needed: number } | null = null
  for (const t of [...points].sort((a, b) => a - b)) {
    const needed = needs.reduce((sum, n) => sum + (n.start <= t && t < n.end ? n.headcount : 0), 0)
    if (needed === 0) continue
    const have = staffed.filter((s) => s.start <= t && t < s.end).length
    if (worst === null || have - needed < worst.staffed - worst.needed) {
      worst = { minute: t, staffed: have, needed }
    }
  }
  return worst
}

/** Merged "Öppet 10–20" label from a day's positive-need segments; disjoint
 * windows list out ("Öppet 10–12, 14–18") rather than faking a span. */
export function openLabel(segs: NeedSeg[]): string | null {
  if (segs.length === 0) return null
  const merged: { start: number; end: number }[] = []
  for (const s of [...segs].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({ start: s.start, end: s.end })
  }
  const compact = (m: number) => (m % 60 === 0 ? String(m === 1440 ? 24 : m / 60) : minutesToTime(m))
  return `Öppet ${merged.map((w) => `${compact(w.start)}–${compact(w.end)}`).join(', ')}`
}

function hourSpan(days: Day[], needs: Map<string, NeedSeg[]>): { firstHour: number; lastHour: number } {
  // The axis derives from shifts AND positive-headcount needs: an empty week
  // with unmet needs must still show where the demand is.
  const starts: number[] = []
  const ends: number[] = []
  for (const d of days) {
    for (const s of d.shifts) { starts.push(s.startMinute); ends.push(s.endMinute) }
    for (const n of needs.get(d.isoDate) ?? []) { starts.push(n.start); ends.push(n.end) }
  }
  if (starts.length === 0) return { firstHour: 8, lastHour: 20 }
  let first = Math.floor(Math.min(...starts) / 60)
  let last = Math.ceil(Math.max(...ends) / 60)
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
  const [modal, setModal] = useState<ShiftModalInitial | null>(null)

  const validPeriod = useMemo(() => {
    try { parseWeekPeriod(period); return true } catch { return false }
  }, [period])

  const { data: org } = useQuery({ queryKey: ['org'], queryFn: getOrg })
  const { data: staff = [], isError: staffError } = useQuery({
    queryKey: ['staff', true],
    queryFn: () => listStaff(true),
  })
  // Fetch [monday−1, sunday]: /data/shifts filters on where a shift STARTS,
  // so Monday coverage would otherwise miss a previous-Sunday overnight tail.
  const { data: fetchedShifts = [], isLoading: shiftsLoading, isError: shiftsError } = useQuery({
    queryKey: ['shifts', period],
    queryFn: () => {
      const monday = parseWeekPeriod(period)
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const prev = new Date(monday)
      prev.setDate(monday.getDate() - 1)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return listShiftsRange(iso(prev), iso(sunday))
    },
    enabled: validPeriod,
  })
  const { data: needs, isLoading: needsLoading, isError: needsError } = useQuery({
    queryKey: ['staffing-needs', period],
    queryFn: () => getStaffingNeeds(period),
    enabled: validPeriod,
  })
  const isLoading = shiftsLoading || needsLoading
  const { data: publications = [], isSuccess: publicationLoaded } = useQuery({
    queryKey: ['publication', period],
    queryFn: () => getPublications(period),
    enabled: validPeriod,
  })

  const queryClient = useQueryClient()
  const publish = useMutation({
    mutationFn: () => publishSchedule({ period }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['publication'] }),
  })

  // "Auto-schemalägg" (#11): pure suggest, then each shift through the normal
  // enforced create path — server-side enforcement re-runs per write, so a
  // suggestion gone stale between compute and apply can't save a hard
  // conflict. Per-shift failures don't abort the batch; the week is refetched
  // afterwards so remaining luckor derive from PERSISTED shifts (the suggest
  // response is not authoritative after a partial failure).
  const [confirmAuto, setConfirmAuto] = useState(false)
  const autoSchedule = useMutation({
    mutationFn: async () => {
      const result = await suggestSchedule(period)
      let created = 0
      let rejected = 0
      for (const s of result.shifts) {
        try {
          await createShift({ staff_id: s.staff_id, starts_at: s.starts_at, ends_at: s.ends_at })
          created++
        } catch {
          rejected++
        }
      }
      return { created, rejected, suggested: result.shifts.length }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] })
      void queryClient.invalidateQueries({ queryKey: ['publication'] })
    },
  })

  const tz = org?.timezone ?? 'Europe/Stockholm'
  // The week's own shifts (header counts, empty state); the extra monday−1
  // fetch day only feeds buildDays' carry-in.
  const shifts = useMemo(() => {
    if (!validPeriod) return []
    const monday = parseWeekPeriod(period)
    const mondayIso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
    return fetchedShifts.filter((s) => wallClock(s.starts_at, tz).isoDate >= mondayIso)
  }, [fetchedShifts, tz, period, validPeriod])
  const days = useMemo(
    () => (validPeriod ? buildDays(fetchedShifts, tz, period) : []),
    [fetchedShifts, tz, period, validPeriod],
  )
  // Fallback gate (issue #11): with a needs curve configured, needs are the
  // only lucka source; without one (or when the fetch failed) the strip keeps
  // the interim semantics where an open shift marks the gap.
  const configured = !needsError && (needs?.configured ?? false)
  const needSegs = useMemo(() => needsByDate(needs, tz), [needs, tz])
  const { firstHour, lastHour } = useMemo(
    () => hourSpan(days, configured ? needSegs : new Map()),
    [days, configured, needSegs],
  )
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const spanMinutes = (lastHour - firstHour) * 60

  if (!validPeriod) return <Navigate to="/schema" replace />

  const staffById = new Map(staff.map((s) => [s.id, s]))
  const today = wallClock(new Date().toISOString(), tz).isoDate
  const label = formatWeekLabel(period)
  const pubState = publishState(days.map((d) => d.isoDate), publications)
  // The issue's contract fills the DRAFT week; a published (or partially
  // published) week still works but only after an explicit confirm. Until
  // the publications query has resolved, pubState derives from its []
  // default and would read every week as draft — an unknown publish state
  // must go through the confirm dialog too, never bypass the gate.
  const runAutoSchedule = () => {
    if (publicationLoaded && pubState.kind === 'draft') autoSchedule.mutate()
    else setConfirmAuto(true)
  }
  const scheduledStaff = new Set(shifts.map((s) => s.staff_id).filter(Boolean)).size
  const needle = query.trim().toLowerCase()

  // "Nytt pass" defaults to today when this week is shown, else its Monday.
  const defaultCreateDate = days.find((d) => d.isoDate === today)?.isoDate ?? days[0]?.isoDate ?? ''
  const openCreate = (isoDate: string, startMinute?: number) =>
    setModal({ mode: 'create', isoDate, startMinute })

  const pct = (minute: number) => ((minute - firstHour * 60) / spanMinutes) * 100

  // Inverse of pct: the clicked point on a day row → the whole hour it lands in
  // (clamped to the visible span), for prefilling a new shift.
  const hourFromClick = (e: { clientX: number; currentTarget: HTMLElement }): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const minute = firstHour * 60 + ((e.clientX - rect.left) / rect.width) * spanMinutes
    return Math.max(firstHour, Math.min(lastHour - 1, Math.floor(minute / 60))) * 60
  }

  const coverageFor = (day: Day, hour: number): { color: string; title: string } => {
    const hourStart = hour * 60, hourEnd = hourStart + 60
    const hourLabel = `${String(hour).padStart(2, '0')}:00`
    if (configured) {
      // Real coverage (issue #11): staffed(t) − needed(t) at exact minute
      // boundaries; the cell is a lucka if it dips below the need anywhere
      // inside the hour. Open shifts (utannonserade pass) cover no one and
      // no longer force the gap color. needed = 0 time stays neutral.
      const staffed = [
        ...day.shifts
          .filter((s) => s.shift.staff_id)
          .map((s) => ({ start: s.startMinute, end: s.endMinute })),
        ...day.carryIn.filter((c) => c.staffId).map((c) => ({ start: 0, end: c.endMinute })),
      ]
      const worst = worstPoint(staffed, needSegs.get(day.isoDate) ?? [], hourStart, hourEnd)
      if (worst === null) return { color: COVERAGE.outside, title: `${hourLabel} · inget behov` }
      return {
        color: worst.staffed < worst.needed ? COVERAGE.gap : COVERAGE.ok,
        title: `${minutesToTime(worst.minute)} · ${worst.staffed} av ${worst.needed}`,
      }
    }
    const overlaps = (s: DayShift) => s.startMinute < hourEnd && s.endMinute > hourStart
    // carryIn covers [0, endMinute) of this day, wrapped from a shift that
    // started the previous day — it overlaps whenever the hour starts
    // before the tail ends.
    const carryOverlaps = (c: { endMinute: number }) => hourStart < c.endMinute
    const count =
      day.shifts.filter((s) => s.shift.staff_id && overlaps(s)).length +
      day.carryIn.filter((c) => c.staffId && carryOverlaps(c)).length
    const title = `${hourLabel} · ${count} i tjänst`
    // Interim semantics (pre-needs): lucka = an open shift (staff_id null)
    // covers the hour. It takes priority over count-based tiers so a
    // manager-created gap is never masked by unrelated coverage. Hours
    // with no shifts at all are neutral — without a needs curve we can't
    // know they're gaps rather than closed.
    const openHere =
      day.shifts.some((s) => !s.shift.staff_id && overlaps(s)) ||
      day.carryIn.some((c) => !c.staffId && carryOverlaps(c))
    if (openHere) return { color: COVERAGE.gap, title }
    if (count >= 3) return { color: COVERAGE.ok, title }
    if (count === 2) return { color: COVERAGE.two, title }
    if (count === 1) return { color: COVERAGE.one, title }
    return { color: COVERAGE.outside, title }
  }

  if (isLoading) return <Flex justify="center" py="8"><Spinner /></Flex>
  if (shiftsError || staffError) {
    return <Callout semantic="error" title="Kunde inte hämta schemat" message="Kontrollera anslutningen och ladda om sidan." />
  }

  // An empty week with unmet needs is the most important gap state — the
  // grid must render (all-lucka strip) rather than hide behind EmptyState.
  const weekHasNeeds = configured && days.some((d) => (needSegs.get(d.isoDate) ?? []).length > 0)
  const empty = shifts.length === 0 && !weekHasNeeds

  // Remaining luckor derive from the REFETCHED persisted shifts on screen,
  // not from the suggest response (stale after any per-shift rejection).
  const gapHours = configured
    ? days.reduce((sum, d) => sum + hours.filter((h) => coverageFor(d, h).color === COVERAGE.gap).length, 0)
    : 0
  const autoSummary = (r: { created: number; rejected: number; suggested: number }): string => {
    const luckor = gapHours === 0 ? 'inga luckor kvar' : gapHours === 1 ? '1 lucka kvar' : `${gapHours} luckor kvar`
    if (r.suggested === 0) return `Inga nya pass att föreslå · ${luckor}`
    const rejected = r.rejected > 0 ? `, ${r.rejected} avvisades` : ''
    return `${r.created} pass skapade${rejected} · ${luckor}`
  }

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
        <div className="mb-0.5 flex items-center gap-3">
          {publicationLoaded && (
            pubState.kind === 'published' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-13 font-semibold text-ok-strong">
                <span className="h-1.75 w-1.75 rounded-full bg-ok" />
                Publicerad {formatDayDate(new Date(pubState.publishedAt))}
              </span>
            ) : pubState.kind === 'diverged' || pubState.kind === 'partial' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-wait-soft px-3 py-1.5 text-13 font-semibold text-wait-strong">
                <span className="h-1.75 w-1.75 rounded-full bg-wait" />
                {pubState.kind === 'diverged' ? 'Ändringar sedan publicering' : 'Delvis publicerad'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-13 font-semibold text-warm-gray">
                <span className="h-1.75 w-1.75 rounded-full bg-warm-sand" />
                Utkast
              </span>
            )
          )}
          <Button
            semantic="action" variant="surface" icon={Sparkles}
            text={autoSchedule.isPending ? 'Schemalägger…' : 'Auto-schemalägg'}
            disabled={autoSchedule.isPending} onClick={runAutoSchedule}
          />
          <Button
            semantic="action" variant="surface" text={publish.isPending ? 'Publicerar…' : 'Publicera schema'}
            disabled={publish.isPending} onClick={() => publish.mutate()}
          />
          <Button
            className="btn-ink" semantic="action" icon={CalendarPlus} text="Nytt pass"
            onClick={() => openCreate(defaultCreateDate)}
          />
        </div>
      </div>

      {publish.isError && (
        <div className="mb-3.5">
          <Callout
            semantic="error"
            title="Kunde inte publicera"
            message={publish.error instanceof ApiError && publish.error.status === 409
              ? 'Publiceringen krockade med en annan publicering — försök igen.'
              : 'Något gick fel — försök igen.'}
          />
        </div>
      )}

      {autoSchedule.isError && (
        <div className="mb-3.5">
          <Callout
            semantic="error"
            title="Kunde inte auto-schemalägga"
            message="Något gick fel — försök igen."
          />
        </div>
      )}
      {autoSchedule.isSuccess && (
        <div className="mb-3.5">
          <Callout
            semantic={autoSchedule.data.rejected > 0 ? 'warning' : 'success'}
            title="Auto-schemaläggning klar"
            message={autoSummary(autoSchedule.data)}
            dismissible
            onDismiss={() => autoSchedule.reset()}
          />
        </div>
      )}

      {needsError && (
        <div className="mb-3.5">
          <Callout
            semantic="warning"
            title="Kunde inte hämta bemanningsbehovet"
            message="Luckor visas tills vidare utifrån öppna pass."
          />
        </div>
      )}

      {/* Legend (Erfarenhet group joins via #27). With a needs curve the
          strip means staffed vs needed; without one, the interim
          count-per-hour tiers. Öppet pass = utannonserat pass (#11) — it
          covers no one. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-4 text-13">
        <Mono className="text-10 uppercase text-warm-caption">Täckning / h</Mono>
        {(configured
          ? ([['Lucka (under behov)', COVERAGE.gap, 'var(--color-stop-strong)'], ['Täckt', COVERAGE.ok, 'var(--color-ok-strong)']] as const)
          : ([['Lucka', COVERAGE.gap, 'var(--color-stop-strong)'], ['1 (tunt)', COVERAGE.one, 'var(--color-wait-strong)'], ['2', COVERAGE.two, 'var(--color-ok-strong)'], ['3+ (ok)', COVERAGE.ok, 'var(--color-ok-strong)']] as const)
        ).map(([text, bg, fg]) => (
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
          description="Skapa det första passet för veckan."
          action={
            <Button
              className="btn-ink" semantic="action" icon={CalendarPlus} text="Skapa första passet"
              onClick={() => openCreate(defaultCreateDate)}
            />
          }
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
                    {configured && openLabel(needSegs.get(day.isoDate) ?? []) && (
                      <Mono className="mt-1 inline-block rounded-md bg-chip px-1.5 py-0.5 text-10 text-warm-gray">
                        {openLabel(needSegs.get(day.isoDate) ?? [])}
                      </Mono>
                    )}
                  </div>
                  <div
                    className="relative cursor-pointer"
                    onClick={(e) => openCreate(day.isoDate, hourFromClick(e))}
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
                        const { color, title } = coverageFor(day, h)
                        return (
                          <span
                            key={h}
                            title={title}
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
                        <button
                          key={s.shift.id}
                          type="button"
                          title={s.shift.note ?? undefined}
                          aria-label={`Redigera pass, ${name} ${timeLabel(s)}`}
                          onClick={(e) => { e.stopPropagation(); setModal({ mode: 'edit', shift: s.shift }) }}
                          className="absolute flex cursor-pointer items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border px-2.25 text-left text-11 hover:brightness-95"
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
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {confirmAuto && (
        <ConfirmModal
          open
          onOpenChange={(o) => { if (!o) setConfirmAuto(false) }}
          title={publicationLoaded ? 'Auto-schemalägga en publicerad vecka?' : 'Auto-schemalägga veckan?'}
          description={publicationLoaded
            ? 'Veckan är redan publicerad — nya pass blir ändringar sedan publiceringen tills du publicerar igen.'
            : 'Publiceringsstatusen har inte kunnat läsas ännu — om veckan är publicerad blir nya pass ändringar sedan publiceringen.'}
          confirmText="Schemalägg" cancelText="Avbryt"
          onConfirm={() => { setConfirmAuto(false); autoSchedule.mutate() }}
        />
      )}

      {modal && (
        <ShiftModal
          key={modal.mode === 'edit' ? modal.shift.id : `create-${modal.isoDate}-${modal.startMinute ?? ''}`}
          initial={modal}
          period={period}
          tz={tz}
          staff={staff}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
