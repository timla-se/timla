import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Flex, Heading, Spinner, Text } from '@radix-ui/themes'
import { Badge, Button, Callout, DatePicker, Select, TextArea, TextField } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, Plus, Trash2 } from 'lucide-react'

import { addException, ApiError, deleteException, getAvailability, listStaff, putAvailability, updateStaff } from '../api'
import { EmptyState } from '../components/EmptyState'
import { Mono } from '../components/Mono'
import { formatIsoDate, intervalLabel, minutesToTime, timeToMinutes, WEEKDAYS, weekdayLabel } from '../time'
import type { RecurringInterval } from '../types'

interface PatternRow {
  weekday: number
  start_minute: number
  end_minute: number
}

function toRows(intervals: RecurringInterval[]): PatternRow[] {
  return intervals.map(({ weekday, start_minute, end_minute }) => ({ weekday, start_minute, end_minute }))
}

/** Strict parse for "önskat antal pass/vecka": the server demands an int
 * 0–50 or null (data_staff.py), so unlike Staff.tsx's parseMaxHours this
 * rejects decimals and commas outright. Empty = null = unspecified. */
function parseDesiredShifts(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return 'invalid'
  const n = Number(trimmed)
  return n > 50 ? 'invalid' : n
}

/** Red "Kan inte" / green "Kan extra" inline pair — same interaction model
 * as the phone's ExceptionRow, and not SegmentedControl for its documented
 * reason: the control can't do per-item semantic colors. */
function KindToggle({ value, onChange }: {
  value: 'wish' | 'block'
  onChange: (kind: 'wish' | 'block') => void
}) {
  return (
    <Flex gap="1">
      <Button
        size="1" text="Kan inte"
        semantic={value === 'block' ? 'danger' : 'neutral'}
        variant={value === 'block' ? 'solid' : 'soft'}
        onClick={() => onChange('block')}
      />
      <Button
        size="1" text="Kan extra"
        semantic={value === 'wish' ? 'success' : 'neutral'}
        variant={value === 'wish' ? 'solid' : 'soft'}
        onClick={() => onChange('wish')}
      />
    </Flex>
  )
}

function PatternSection({ title, hint, rows, onChange }: {
  title: string
  hint: string
  rows: PatternRow[]
  onChange: (rows: PatternRow[]) => void
}) {
  const setRow = (index: number, patch: Partial<PatternRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Heading size="3">{title}</Heading>
        <Text size="1" color="gray">{hint}</Text>
      </Flex>
      {rows.map((row, i) => (
        <Flex key={i} gap="2" align="center">
          <Select.Root value={String(row.weekday)} onValueChange={(v) => { if (v) setRow(i, { weekday: Number(v) }) }}>
            <Select.Trigger style={{ width: 130 }} />
            <Select.Content>
              {WEEKDAYS.map((d) => <Select.Item key={d.value} value={d.value}>{d.label}</Select.Item>)}
            </Select.Content>
          </Select.Root>
          <TextField.Root
            type="time" className="font-mono" value={minutesToTime(row.start_minute)}
            onChange={(e) => setRow(i, { start_minute: timeToMinutes(e.target.value) })}
          />
          <Text size="2" color="gray">till</Text>
          <TextField.Root
            type="time" className="font-mono" value={minutesToTime(row.end_minute)}
            onChange={(e) => setRow(i, { end_minute: timeToMinutes(e.target.value, true) })}
          />
          <Button semantic="neutral" variant="ghost" size="1" icon={Trash2}
            onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </Flex>
      ))}
      <Button
        semantic="neutral" variant="soft" size="1" icon={Plus} text="Lägg till rad" className="self-start"
        onClick={() => onChange([...rows, { weekday: 1, start_minute: 540, end_minute: 1020 }])}
      />
    </Flex>
  )
}

export default function StaffDetail() {
  const { staffId = '' } = useParams()
  const queryClient = useQueryClient()

  // No GET /data/staff/:id exists — the roster is small, so fetch the list
  // (incl. archived) and pick the row.
  const { data: staffList, isLoading: staffLoading } = useQuery({
    queryKey: ['staff', true],
    queryFn: () => listStaff(true),
  })
  const staff = staffList?.find((s) => s.id === staffId)

  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ['availability', staffId],
    queryFn: () => getAvailability(staffId),
    enabled: !!staff,
  })

  const [wishes, setWishes] = useState<PatternRow[]>([])
  const [blocks, setBlocks] = useState<PatternRow[]>([])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    // Only sync from the server while the form is clean: the exceptions
    // mutations invalidate the same query, and a refetched doc must not
    // wipe unsaved pattern edits.
    if (doc && !dirty) {
      setWishes(toRows(doc.wishes))
      setBlocks(toRows(doc.blocks))
    }
  }, [doc, dirty])

  // Add-exception form: whole day by default; "Vissa tider" reveals the
  // time inputs (same model as the phone's ExceptionRow).
  const [newExceptionDate, setNewExceptionDate] = useState<Date | null>(null)
  const [newExceptionKind, setNewExceptionKind] = useState<'wish' | 'block'>('block')
  const [newExceptionNote, setNewExceptionNote] = useState('')
  const [newExceptionStart, setNewExceptionStart] = useState('00:00')
  const [newExceptionEnd, setNewExceptionEnd] = useState('00:00')
  const [showTimes, setShowTimes] = useState(false)

  // Önskemål: per-staff fields from /data/staff (not the availability doc) —
  // their own dirty flag + save so a failed request can't half-save the page.
  const [desiredShifts, setDesiredShifts] = useState('')
  const [prefsNote, setPrefsNote] = useState('')
  const [prefsDirty, setPrefsDirty] = useState(false)
  const [prefsFor, setPrefsFor] = useState<string | null>(null)
  useEffect(() => {
    if (!staff) return
    // Navigating between staff pages must never show (or save) the previous
    // person's values — reset unconditionally when the id changes; otherwise
    // follow the page's dirty-guard convention: only sync while clean.
    if (staff.id !== prefsFor || !prefsDirty) {
      setPrefsFor(staff.id)
      setDesiredShifts(staff.desired_shifts_per_week === null ? '' : String(staff.desired_shifts_per_week))
      setPrefsNote(staff.availability_note ?? '')
      setPrefsDirty(false)
    }
  }, [staff, prefsDirty, prefsFor])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['availability', staffId] })
  const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Något gick fel.')

  // One save for both sections: PUT replaces wishes AND blocks together, so
  // saving them separately from stale state could wipe the other section.
  const save = useMutation({
    mutationFn: () => putAvailability(staffId, { wishes, blocks }),
    onSuccess: () => { setDirty(false); invalidate() },
  })

  const createException = useMutation({
    mutationFn: () => {
      // Local date, not toISOString(): at UTC+2 the ISO string is yesterday.
      const d = newExceptionDate!
      const on_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const start = timeToMinutes(newExceptionStart)
      const end = timeToMinutes(newExceptionEnd, true)
      const note = newExceptionNote.trim()
      return addException(staffId, {
        on_date, start_minute: start, end_minute: end,
        kind: newExceptionKind, ...(note ? { note } : {}),
      })
    },
    onSuccess: () => {
      invalidate()
      setNewExceptionDate(null); setNewExceptionKind('block'); setNewExceptionNote('')
      setNewExceptionStart('00:00'); setNewExceptionEnd('00:00'); setShowTimes(false)
    },
  })

  const parsedDesired = parseDesiredShifts(desiredShifts)
  const savePrefs = useMutation({
    mutationFn: () => updateStaff(staffId, {
      // The save button is disabled while parsedDesired === 'invalid', so the
      // fallback here only satisfies the type checker.
      desired_shifts_per_week: parsedDesired === 'invalid' ? null : parsedDesired,
      availability_note: prefsNote.trim() || null,
    }),
    // Invalidate the whole ['staff'] family: this page and Staff.tsx share
    // the ['staff', true] list query.
    onSuccess: () => { setPrefsDirty(false); queryClient.invalidateQueries({ queryKey: ['staff'] }) },
  })

  const removeException = useMutation({
    mutationFn: (exceptionId: string) => deleteException(staffId, exceptionId),
    onSuccess: invalidate,
  })

  if (staffLoading) return <Flex justify="center" py="8"><Spinner /></Flex>
  if (!staff) {
    return (
      <EmptyState
        title="Personen hittades inte"
        action={<Link to="/staff">Tillbaka till personallistan</Link>}
      />
    )
  }

  // A cleared time input parses to NaN, which passes >= comparisons —
  // catch it explicitly so the friendly message shows instead of the API's.
  const invalidRows = [...wishes, ...blocks].some((r) =>
    Number.isNaN(r.start_minute) || Number.isNaN(r.end_minute) || r.start_minute >= r.end_minute)

  // Same NaN-aware guard for the add-exception times (whole day = 0–1440,
  // which always passes).
  const exceptionStart = timeToMinutes(newExceptionStart)
  const exceptionEnd = timeToMinutes(newExceptionEnd, true)
  const invalidExceptionTimes =
    Number.isNaN(exceptionStart) || Number.isNaN(exceptionEnd) || exceptionStart >= exceptionEnd

  return (
    <Flex direction="column" gap="5" style={{ maxWidth: 640 }}>
      <Flex align="center" gap="3">
        <Link to="/staff" className="flex items-center text-warm-gray"><ArrowLeft size={18} /></Link>
        <Heading size="6">{staff.name}</Heading>
        {staff.role && <Badge semantic="neutral" text={staff.role} />}
        {/* Inactive = lera-grå per the fixed status roles (see status.ts) */}
        {staff.archived && <Badge dot semantic="neutral" text="arkiverad" />}
      </Flex>

      <Text size="2" color="gray">
        Personalen fyller normalt i sin tillgänglighet själva via sin personliga
        länk. Här ser du samma uppgifter och kan justera dem — eller fylla i åt
        personal som hellre ringer in sina tider.
      </Text>

      {docLoading ? (
        <Flex justify="center" py="8"><Spinner /></Flex>
      ) : (
        <>
          <PatternSection
            title="Önskar jobba" hint="återkommande, per vecka"
            rows={wishes} onChange={(rows) => { setWishes(rows); setDirty(true) }}
          />
          <PatternSection
            title="Kan inte jobba" hint="återkommande, per vecka — kan bara ändras här, inte via personalens länk"
            rows={blocks} onChange={(rows) => { setBlocks(rows); setDirty(true) }}
          />
          <Flex gap="3" align="center">
            <Button
              semantic="action" text={save.isPending ? 'Sparar…' : 'Spara tillgänglighet'}
              disabled={!dirty || invalidRows || save.isPending}
              onClick={() => save.mutate()}
            />
            {invalidRows && <Text size="2" color="red">Ange giltiga tider — sluttid måste vara efter starttid.</Text>}
            {save.isError && <Callout semantic="error" message={errorText(save.error)} />}
            {!dirty && !save.isPending && doc && <Text size="2" color="gray">Sparat.</Text>}
          </Flex>

          <Flex direction="column" gap="2">
            <Flex align="center" gap="2">
              <Heading size="3">Önskemål</Heading>
              <Text size="1" color="gray">delas med personalens egen länk</Text>
            </Flex>
            <Flex align="center" gap="2">
              <Text size="2">Önskat antal pass/vecka</Text>
              <TextField.Root
                inputMode="numeric" placeholder="–" style={{ width: 72 }}
                value={desiredShifts}
                onChange={(e) => { setDesiredShifts(e.target.value); setPrefsDirty(true) }}
              />
            </Flex>
            <TextArea.Root
              placeholder="Anteckning om tillgänglighet — samma text som personalens &quot;Något chefen bör veta?&quot;"
              maxLength={1000} value={prefsNote}
              onChange={(e) => { setPrefsNote(e.target.value); setPrefsDirty(true) }}
            />
            <Flex gap="3" align="center">
              <Button
                semantic="action" text={savePrefs.isPending ? 'Sparar…' : 'Spara önskemål'}
                disabled={!prefsDirty || parsedDesired === 'invalid' || savePrefs.isPending}
                onClick={() => savePrefs.mutate()}
              />
              {parsedDesired === 'invalid' && <Text size="2" color="red">Önskat antal pass måste vara ett heltal 0–50.</Text>}
              {savePrefs.isError && <Callout semantic="error" message={errorText(savePrefs.error)} />}
            </Flex>
          </Flex>

          <Flex direction="column" gap="2">
            <Flex align="center" gap="2">
              <Heading size="3">Avvikelser</Heading>
              <Text size="1" color="gray">enstaka datum — kan inte, eller kan extra</Text>
            </Flex>
            {doc?.exceptions.length === 0 && <Text size="2" color="gray">Inga avvikelser.</Text>}
            {doc?.exceptions.map((exc) => (
              <Flex key={exc.id} gap="2" align="center" wrap="wrap">
                <Mono className="text-sm">{formatIsoDate(exc.on_date)}</Mono>
                <Badge
                  semantic={exc.kind === 'wish' ? 'success' : 'danger'}
                  text={exc.kind === 'wish' ? 'Kan extra' : 'Kan inte'}
                />
                <Badge semantic="neutral" className="font-mono" text={intervalLabel(exc.start_minute, exc.end_minute)} />
                {exc.source === 'staff' && <Badge semantic="neutral" text="Ifyllt av personalen" />}
                {exc.note && <Text size="2" color="gray">{exc.note}</Text>}
                <Button semantic="neutral" variant="ghost" size="1" icon={Trash2}
                  disabled={removeException.isPending}
                  onClick={() => removeException.mutate(exc.id)} />
              </Flex>
            ))}
            <Flex gap="2" align="center" wrap="wrap">
              <DatePicker value={newExceptionDate} onChange={setNewExceptionDate} placeholder="Datum" />
              <KindToggle value={newExceptionKind} onChange={setNewExceptionKind} />
              <Button
                semantic="neutral" variant={showTimes ? 'soft' : 'ghost'} size="1"
                icon={ChevronDown} text="Vissa tider" aria-expanded={showTimes}
                onClick={() => setShowTimes((v) => !v)}
              />
            </Flex>
            {showTimes && (
              <Flex gap="2" align="center">
                <TextField.Root type="time" className="font-mono" value={newExceptionStart} onChange={(e) => setNewExceptionStart(e.target.value)} />
                <Text size="2" color="gray">till</Text>
                <TextField.Root type="time" className="font-mono" value={newExceptionEnd} onChange={(e) => setNewExceptionEnd(e.target.value)} />
                <Button
                  semantic="neutral" variant="ghost" size="1" text="Hela dagen"
                  onClick={() => { setNewExceptionStart('00:00'); setNewExceptionEnd('00:00') }}
                />
              </Flex>
            )}
            <TextField.Root
              placeholder="Orsak (valfritt)" maxLength={500} value={newExceptionNote}
              onChange={(e) => setNewExceptionNote(e.target.value)}
            />
            <Flex gap="3" align="center">
              <Button
                semantic="neutral" variant="soft" size="1" icon={Plus} text="Lägg till avvikelse"
                disabled={!newExceptionDate || invalidExceptionTimes || createException.isPending}
                onClick={() => createException.mutate()}
              />
              {invalidExceptionTimes && <Text size="2" color="red">Ange giltiga tider — sluttid måste vara efter starttid.</Text>}
            </Flex>
            {createException.isError && <Callout semantic="error" message={errorText(createException.error)} />}
          </Flex>

          <Flex direction="column" gap="1">
            <Heading size="3">Sammanfattning</Heading>
            {wishes.length === 0 && blocks.length === 0 ? (
              <Text size="2" color="gray">Ingen tillgänglighet registrerad — all tid räknas som neutral.</Text>
            ) : (
              <>
                {wishes.map((r, i) => (
                  <Text key={`w${i}`} size="2">Önskar: {weekdayLabel(r.weekday)} <Mono>{intervalLabel(r.start_minute, r.end_minute)}</Mono></Text>
                ))}
                {blocks.map((r, i) => (
                  <Text key={`b${i}`} size="2">Blockerat: {weekdayLabel(r.weekday)} <Mono>{intervalLabel(r.start_minute, r.end_minute)}</Mono></Text>
                ))}
              </>
            )}
          </Flex>
        </>
      )}
    </Flex>
  )
}
