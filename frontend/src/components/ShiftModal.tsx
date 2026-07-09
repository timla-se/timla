import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, ConfirmModal, Select, TextField } from '@swedev/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react'

import { ApiError, computeConflicts, createShift, deleteShift, updateShift } from '../api'
import { FieldLabel, TimlaModal } from './TimlaModal'
import { formatIsoDate, localInstant, minutesToTime, parseWeekPeriod, timeToMinutes, wallClock } from '../time'
import type { ConflictItem, Shift, Staff } from '../types'

/** Sentinel Select value for an unassigned (öppet) shift — Radix Select
 * values must be non-empty strings, so null can't be one. */
const OPEN = '__open__'

/** type → klartext, per Ton & röst (Decision 5). Falls back to the server's
 * English message so an unknown future type stays visible. */
const CONFLICT_SV: Record<ConflictItem['type'], string> = {
  double_booking: 'Krockar med ett annat pass',
  blocked: 'Personen har markerat tiden som upptagen',
  max_hours: 'Över maxtimmar för veckan',
  insufficient_rest: 'För kort dygnsvila mot intilliggande pass',
  archived_staff: 'Personen är arkiverad',
  outside_wishes: 'Utanför önskade arbetstider',
}

function conflictText(item: ConflictItem): string {
  const base = CONFLICT_SV[item.type] ?? item.message
  if (item.type === 'max_hours' && item.total_hours !== undefined && item.effective_max !== undefined) {
    return `${base} (${item.total_hours} h / ${item.effective_max} h)`
  }
  if (item.type === 'insufficient_rest' && item.rest_hours !== undefined && item.min_rest_hours !== undefined) {
    return `${base} (${item.rest_hours} h vila, minst ${item.min_rest_hours} h)`
  }
  return base
}

/** The 7 ISO dates of the week that starts on `monday` (a local Date). */
function weekIsoDates(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
}

function ConflictList({ items }: { items: ConflictItem[] }) {
  return (
    <ul className="m-0 list-disc pl-4">
      {items.map((c, i) => <li key={i}>{conflictText(c)}</li>)}
    </ul>
  )
}

export type ShiftModalInitial =
  | { mode: 'create'; isoDate: string; startMinute?: number }
  | { mode: 'edit'; shift: Shift }

/** Create/edit a shift with live conflict feedback (issue #9). Mount fresh per
 * open (key by target) so the form initializes from `initial`. */
export function ShiftModal({ initial, period, tz, staff, onClose }: {
  initial: ShiftModalInitial
  period: string
  tz: string
  /** Full roster; filtered to active here (plus the edited shift's archived
   * assignee, if any). */
  staff: Staff[]
  onClose: () => void
}) {
  const editShift = initial.mode === 'edit' ? initial.shift : null
  const editingId = editShift?.id ?? null
  const queryClient = useQueryClient()
  // A shift's start day decides its ISO week, so a move can change the week —
  // invalidate the whole prefix, not just the current period.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shifts'] })

  const weekDays = useMemo(() => weekIsoDates(parseWeekPeriod(period)), [period])

  const [staffValue, setStaffValue] = useState<string>(() =>
    initial.mode === 'edit' ? initial.shift.staff_id ?? OPEN : OPEN)
  const [dayIso, setDayIso] = useState<string>(() =>
    initial.mode === 'edit' ? wallClock(initial.shift.starts_at, tz).isoDate : initial.isoDate)
  const [startTime, setStartTime] = useState<string>(() => {
    if (initial.mode === 'edit') return minutesToTime(wallClock(initial.shift.starts_at, tz).minuteOfDay)
    return initial.startMinute !== undefined ? minutesToTime(initial.startMinute) : '09:00'
  })
  const [endTime, setEndTime] = useState<string>(() => {
    if (initial.mode === 'edit') return minutesToTime(wallClock(initial.shift.ends_at, tz).minuteOfDay)
    return initial.startMinute !== undefined ? minutesToTime(Math.min(initial.startMinute + 60, 1440)) : '17:00'
  })
  const [note, setNote] = useState<string>(() => (initial.mode === 'edit' ? initial.shift.note ?? '' : ''))

  const staffId = staffValue === OPEN ? null : staffValue
  const activeStaff = useMemo(
    () => staff.filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name, 'sv')),
    [staff],
  )
  // Keep the current assignee selectable in edit mode even when archived, so a
  // note/time-only edit doesn't force an unassignment (the backend allows an
  // unchanged archived staff_id). Never offered for new shifts.
  const archivedCurrent = editShift?.staff_id
    ? staff.find((s) => s.id === editShift.staff_id && s.archived) ?? null
    : null

  const startMin = timeToMinutes(startTime)
  const endMin = timeToMinutes(endTime, true)
  const timesValid = !Number.isNaN(startMin) && !Number.isNaN(endMin)
  // end ≤ start rolls to the next day (Decision 3). end "00:00" parses to 1440
  // (isEnd), which is > start yet still lands on the next calendar day, so key
  // the hint on the normalized end, not the raw comparison.
  const endAbsolute = timesValid && endMin <= startMin ? endMin + 1440 : endMin
  const endsNextDay = timesValid && endAbsolute >= 1440
  const valid = timesValid

  const instants = useMemo(() => {
    if (!valid) return null
    return {
      starts_at: localInstant(dayIso, startMin, tz),
      ends_at: localInstant(dayIso, endAbsolute, tz),
    }
  }, [valid, dayIso, startMin, endAbsolute, tz])

  // --- live conflict check (debounced, stale-safe) ---
  const [live, setLive] = useState<{ conflicts: ConflictItem[]; warnings: ConflictItem[]; checked: boolean }>(
    { conflicts: [], warnings: [], checked: false })
  const seqRef = useRef(0)

  useEffect(() => {
    if (!instants) { setLive({ conflicts: [], warnings: [], checked: false }); return }
    if (staffId === null) {
      // Open shifts have no assignee, so the engine finds nothing — skip the call.
      setLive({ conflicts: [], warnings: [], checked: true })
      return
    }
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      computeConflicts([{ id: editingId ?? undefined, staff_id: staffId, starts_at: instants.starts_at, ends_at: instants.ends_at }])
        .then((res) => {
          if (seq !== seqRef.current) return
          setLive({ conflicts: res.conflicts, warnings: res.warnings, checked: true })
        })
        .catch(() => {
          // A failed live check must never block saving — the write-time check
          // is authoritative. Drop the stale preview.
          if (seq !== seqRef.current) return
          setLive({ conflicts: [], warnings: [], checked: false })
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [instants, staffId, editingId])

  // --- save / force / delete ---
  const [forceMode, setForceMode] = useState(false)
  const [serverResult, setServerResult] = useState<{ conflicts: ConflictItem[]; warnings: ConflictItem[] } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Any edit clears a pending force decision: the manager must re-see the
  // conflicts for the new values before overriding them.
  useEffect(() => {
    setForceMode(false)
    setServerResult(null)
    setFormError(null)
  }, [staffValue, dayIso, startTime, endTime, note])

  const save = useMutation({
    mutationFn: (force: boolean) => {
      const payload = { staff_id: staffId, starts_at: instants!.starts_at, ends_at: instants!.ends_at, note: note.trim() || null }
      return editingId ? updateShift(editingId, payload, force) : createShift(payload, force)
    },
    onSuccess: () => { invalidate(); onClose() },
    onError: (err) => {
      // The write-time check can 409 even when the live preview was clean (a
      // concurrent edit, or a forced-stale save) — surface it and offer force.
      if (err instanceof ApiError && err.status === 409 && err.code === 'conflict') {
        setServerResult({ conflicts: err.conflicts, warnings: err.warnings })
        setForceMode(true)
        return
      }
      setFormError(err instanceof ApiError ? err.message : 'Något gick fel. Försök igen.')
    },
  })

  const [confirmDelete, setConfirmDelete] = useState(false)
  const del = useMutation({
    mutationFn: () => deleteShift(editingId!),
    onSuccess: () => { invalidate(); onClose() },
    onError: (err) => {
      // Already deleted elsewhere — the shift is gone, which is the goal.
      if (err instanceof ApiError && err.status === 404) { invalidate(); onClose(); return }
      setFormError(err instanceof ApiError ? err.message : 'Kunde inte ta bort passet.')
    },
  })

  const displayed = forceMode && serverResult ? serverResult : live
  const clean = valid && staffId !== null && (forceMode || live.checked)
    && displayed.conflicts.length === 0 && displayed.warnings.length === 0
  const busy = save.isPending || del.isPending

  return (
    <>
      <TimlaModal
        open
        onClose={onClose}
        icon={editingId ? <Pencil size={20} strokeWidth={1.85} /> : <CalendarPlus size={22} strokeWidth={1.85} />}
        title={editingId ? 'Redigera pass' : 'Nytt pass'}
        subtitle={editingId ? 'Ändra person, tid eller anteckning.' : 'Lägg till ett pass i veckan.'}
        footer={
          <>
            {editingId && (
              <Button
                className="mr-auto" semantic="destructive" variant="ghost" icon={Trash2}
                text="Ta bort pass" disabled={busy} onClick={() => setConfirmDelete(true)}
              />
            )}
            <Button semantic="neutral" variant="surface" text="Avbryt" disabled={busy} onClick={onClose} />
            {forceMode ? (
              <Button
                semantic="destructive" text={save.isPending ? 'Sparar…' : 'Spara ändå'}
                disabled={!valid || busy} onClick={() => save.mutate(true)}
              />
            ) : (
              <Button
                className="btn-ink" semantic="action" text={save.isPending ? 'Sparar…' : 'Spara'}
                disabled={!valid || busy} onClick={() => save.mutate(false)}
              />
            )}
          </>
        }
      >
        <label className="mb-4.5 block">
          <FieldLabel>Personal</FieldLabel>
          <Select.Root value={staffValue} onValueChange={(v) => { if (v) setStaffValue(v) }}>
            <Select.Trigger className="w-full" />
            <Select.Content>
              <Select.Item value={OPEN}>Öppet pass</Select.Item>
              {activeStaff.map((s) => <Select.Item key={s.id} value={s.id}>{s.name}</Select.Item>)}
              {archivedCurrent && (
                <Select.Item value={archivedCurrent.id}>{archivedCurrent.name} (arkiverad)</Select.Item>
              )}
            </Select.Content>
          </Select.Root>
        </label>

        <label className="mb-4.5 block">
          <FieldLabel>Dag</FieldLabel>
          <Select.Root value={dayIso} onValueChange={(v) => { if (v) setDayIso(v) }}>
            <Select.Trigger className="w-full" />
            <Select.Content>
              {weekDays.map((d) => <Select.Item key={d} value={d}>{formatIsoDate(d)}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </label>

        <div className="flex items-end gap-2.5">
          <label className="min-w-0 flex-1">
            <FieldLabel>Börjar</FieldLabel>
            <TextField.Root type="time" className="font-mono" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <span className="mb-2.5 text-mutedwarm">–</span>
          <label className="min-w-0 flex-1">
            <FieldLabel>Slutar</FieldLabel>
            <TextField.Root type="time" className="font-mono" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <p className={`mt-1.5 text-12 text-warm-gray ${endsNextDay ? '' : 'invisible'}`}>Passet slutar nästa dag.</p>

        <label className="mb-2 mt-3 block">
          <FieldLabel>Anteckning (valfritt)</FieldLabel>
          <TextField.Root value={note} onChange={(e) => setNote(e.target.value)} placeholder="t.ex. öppning, stängning" />
        </label>

        <div className="mt-4 flex flex-col gap-2.5">
          {!valid && <Callout semantic="warning" message="Ange giltiga start- och sluttider." />}
          {valid && displayed.conflicts.length > 0 && (
            <Callout
              semantic="error"
              title={forceMode ? 'Passet krockar' : 'Konflikter'}
              message={<ConflictList items={displayed.conflicts} />}
            />
          )}
          {valid && displayed.warnings.length > 0 && (
            <Callout semantic="warning" title="Varningar" message={<ConflictList items={displayed.warnings} />} />
          )}
          {clean && <Callout semantic="success" message="Inga konflikter." />}
          {formError && <Callout semantic="error" message={formError} />}
        </div>
      </TimlaModal>

      {confirmDelete && (
        <ConfirmModal
          open
          onOpenChange={(o) => { if (!o) setConfirmDelete(false) }}
          title="Ta bort passet?"
          description="Passet tas bort från schemat. Det går inte att ångra."
          confirmText="Ta bort" cancelText="Avbryt" confirmSemantic="destructive"
          onConfirm={() => { setConfirmDelete(false); del.mutate() }}
        />
      )}
    </>
  )
}
