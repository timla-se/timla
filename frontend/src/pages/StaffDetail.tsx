import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Flex, Heading, Spinner, Text } from '@radix-ui/themes'
import { Badge, Button, Callout, DatePicker, Select, TextField } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

import { addException, ApiError, deleteException, getAvailability, listStaff, putAvailability } from '../api'
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

  const [newExceptionDate, setNewExceptionDate] = useState<Date | null>(null)
  const [newExceptionStart, setNewExceptionStart] = useState('00:00')
  const [newExceptionEnd, setNewExceptionEnd] = useState('00:00')

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
      return addException(staffId, { on_date, start_minute: start, end_minute: end })
    },
    onSuccess: () => { invalidate(); setNewExceptionDate(null); setNewExceptionStart('00:00'); setNewExceptionEnd('00:00') },
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
            title="Kan inte jobba" hint="återkommande, per vecka"
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
            <Heading size="3">Undantag (datum personen inte kan)</Heading>
            {doc?.exceptions.length === 0 && <Text size="2" color="gray">Inga undantag.</Text>}
            {doc?.exceptions.map((exc) => (
              <Flex key={exc.id} gap="3" align="center">
                <Mono className="text-sm">{formatIsoDate(exc.on_date)}</Mono>
                <Badge semantic="neutral" className="font-mono" text={intervalLabel(exc.start_minute, exc.end_minute)} />
                <Button semantic="neutral" variant="ghost" size="1" icon={Trash2}
                  disabled={removeException.isPending}
                  onClick={() => removeException.mutate(exc.id)} />
              </Flex>
            ))}
            <Flex gap="2" align="center" wrap="wrap">
              <DatePicker value={newExceptionDate} onChange={setNewExceptionDate} placeholder="Datum" />
              <TextField.Root type="time" className="font-mono" value={newExceptionStart} onChange={(e) => setNewExceptionStart(e.target.value)} />
              <Text size="2" color="gray">till</Text>
              <TextField.Root type="time" className="font-mono" value={newExceptionEnd} onChange={(e) => setNewExceptionEnd(e.target.value)} />
              <Text size="1" color="gray">(00:00–00:00 = hela dagen)</Text>
              <Button
                semantic="neutral" variant="soft" size="1" icon={Plus} text="Lägg till undantag"
                disabled={!newExceptionDate || createException.isPending}
                onClick={() => createException.mutate()}
              />
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
