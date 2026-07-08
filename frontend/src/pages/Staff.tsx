import type { ChangeEvent, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Flex, Spinner } from '@radix-ui/themes'
import { Badge, Button, Callout, ConfirmModal, Dropdown, Switch, TextField } from '@swedev/ui'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArchiveRestore, Check, Copy, ListFilter, MoreHorizontal, Pencil,
  RefreshCw, UserPlus,
} from 'lucide-react'

import {
  ApiError, archiveStaff, createStaff, getAvailability, listShifts, listStaff,
  putAvailability, regenerateLink, type StaffPayload, updateStaff,
} from '../api'
import { Avatar } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'
import { useTopbarSearch } from '../components/Layout'
import { Mono } from '../components/Mono'
import { FieldLabel, TimlaModal } from '../components/TimlaModal'
import { isoWeek, isoWeekPeriod, summarizeWishes, timeToMinutes } from '../time'
import type { Shift, Staff as StaffRow } from '../types'

function shareUrl(token: string): string {
  return `${location.origin}/svar/${token}`
}

const WEEKDAY_CHIPS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön']

interface FormState {
  name: string
  phone: string
  email: string
  role: string
  maxHours: string
}

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', role: '', maxHours: '' }

function formFromStaff(staff: StaffRow): FormState {
  return {
    name: staff.name,
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    role: staff.role ?? '',
    maxHours: staff.max_hours_per_week === null ? '' : String(staff.max_hours_per_week),
  }
}

/** '' → null, otherwise a number; NaN reported by the caller. */
function parseMaxHours(value: string): number | null {
  if (value.trim() === '') return null
  return Number(value.replace(',', '.'))
}

function payloadFromForm(form: FormState): StaffPayload {
  return {
    name: form.name.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    role: form.role.trim() || null,
    max_hours_per_week: parseMaxHours(form.maxHours),
  }
}

function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return 'Namn krävs.'
  const hours = parseMaxHours(form.maxHours)
  if (hours !== null && (Number.isNaN(hours) || hours <= 0 || hours > 168)) {
    return 'Max timmar/vecka måste vara ett tal mellan 0 och 168.'
  }
  return null
}

/** Modal form fields shared by "Ny medarbetare" and "Redigera". */
function StaffFields({ form, set }: {
  form: FormState
  set: (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      <label className="mb-[18px] block">
        <FieldLabel>Namn</FieldLabel>
        <TextField.Root value={form.name} onChange={set('name')} placeholder="För- och efternamn" />
      </label>
      <label className="mb-[18px] block">
        <FieldLabel>E-post</FieldLabel>
        <TextField.Root type="email" value={form.email} onChange={set('email')} placeholder="namn@example.se" />
      </label>
      <div className="mb-[22px] flex gap-3.5">
        <label className="min-w-0 flex-1">
          <FieldLabel>Roll</FieldLabel>
          <TextField.Root value={form.role} onChange={set('role')} placeholder="t.ex. servis" />
        </label>
        <label className="min-w-0 flex-1">
          <FieldLabel>Telefon</FieldLabel>
          <TextField.Root value={form.phone} onChange={set('phone')} placeholder="070-123 45 67" />
        </label>
      </div>
    </>
  )
}

function MaxHoursField({ form, set }: {
  form: FormState
  set: (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="mb-[22px] block">
      <FieldLabel>Max timmar/vecka (tomt = ingen egen gräns)</FieldLabel>
      <TextField.Root value={form.maxHours} onChange={set('maxHours')} placeholder="t.ex. 30" inputMode="decimal" />
    </label>
  )
}

function NewStaffModal({ onClose, onError, busy, error, onSubmit }: {
  onClose: () => void
  onError: (message: string | null) => void
  busy: boolean
  error: string | null
  onSubmit: (payload: StaffPayload, wishes: { weekday: number; start_minute: number; end_minute: number }[], createLink: boolean) => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, false, false])
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('17:00')
  const [createLink, setCreateLink] = useState(true)
  const set = (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = () => {
    const problem = validateForm(form)
    if (problem) { onError(problem); return }
    const start = timeToMinutes(from)
    const end = timeToMinutes(to, true)
    const anyDay = days.some(Boolean)
    if (anyDay && (Number.isNaN(start) || Number.isNaN(end) || start >= end)) {
      onError('Ange giltiga arbetstider — sluttid måste vara efter starttid.')
      return
    }
    onError(null)
    const wishes = anyDay
      ? days.flatMap((on, i) => (on ? [{ weekday: i + 1, start_minute: start, end_minute: end }] : []))
      : []
    onSubmit(payloadFromForm(form), wishes, createLink)
  }

  return (
    <TimlaModal
      open
      onClose={onClose}
      icon={<UserPlus size={22} strokeWidth={1.85} />}
      title="Ny medarbetare"
      subtitle="Lägg till i verksamheten och sätt arbetstider."
      footer={
        <>
          <Button semantic="neutral" variant="surface" text="Avbryt" onClick={onClose} />
          <Button
            className="btn-ink"
            semantic="action"
            text={busy ? 'Sparar…' : createLink ? 'Lägg till & skapa länk' : 'Lägg till medarbetare'}
            disabled={busy}
            onClick={submit}
          />
        </>
      }
    >
      <StaffFields form={form} set={set} />

      <div className="mb-[22px]">
        <FieldLabel>Arbetsdagar (önskemål, per vecka)</FieldLabel>
        <div className="mb-3 mt-1 flex flex-wrap gap-[7px]">
          {WEEKDAY_CHIPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setDays((d) => d.map((on, j) => (j === i ? !on : on)))}
              className={
                days[i]
                  ? 'w-[46px] cursor-pointer rounded-[9px] border-0 bg-ink py-[9px] text-center font-mono text-[12.5px] font-semibold text-honey'
                  : 'w-[46px] cursor-pointer rounded-[9px] border border-[#e4d9c2] bg-white py-2 text-center font-mono text-[12.5px] font-semibold text-warm-gray'
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <label className="min-w-0 flex-1">
            <Mono className="text-[11px] text-warm-sand">Från</Mono>
            <TextField.Root type="time" className="mt-1 font-mono" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <span className="mt-5 text-[#c2b291]">–</span>
          <label className="min-w-0 flex-1">
            <Mono className="text-[11px] text-warm-sand">Till</Mono>
            <TextField.Root type="time" className="mt-1 font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <MaxHoursField form={form} set={set} />

      <div className="flex items-center gap-3 rounded-xl border border-[#ecdfc8] bg-[#faf3e6] px-4 py-[15px]">
        <Switch semantic="success" checked={createLink} onCheckedChange={(v) => setCreateLink(v === true)} />
        <div>
          <div className="text-sm font-bold">Skapa delningslänk</div>
          <div className="text-[12.5px] text-warm-gray">Personlig länk där medarbetaren fyller i sin tillgänglighet.</div>
        </div>
      </div>

      {error && <div className="mt-4"><Callout semantic="error" message={error} /></div>}
    </TimlaModal>
  )
}

function EditStaffModal({ staff, onClose, busy, error, onError, onSubmit }: {
  staff: StaffRow
  onClose: () => void
  busy: boolean
  error: string | null
  onError: (message: string | null) => void
  onSubmit: (payload: StaffPayload) => void
}) {
  const [form, setForm] = useState(() => formFromStaff(staff))
  const set = (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = () => {
    const problem = validateForm(form)
    if (problem) { onError(problem); return }
    onError(null)
    onSubmit(payloadFromForm(form))
  }

  return (
    <TimlaModal
      open
      onClose={onClose}
      icon={<Pencil size={20} strokeWidth={1.85} />}
      title={`Redigera ${staff.name}`}
      subtitle="Arbetstider och undantag ändras på personens sida."
      footer={
        <>
          <Button semantic="neutral" variant="surface" text="Avbryt" onClick={onClose} />
          <Button className="btn-ink" semantic="action" text={busy ? 'Sparar…' : 'Spara'} disabled={busy} onClick={submit} />
        </>
      }
    >
      <StaffFields form={form} set={set} />
      <MaxHoursField form={form} set={set} />
      {error && <Callout semantic="error" message={error} />}
    </TimlaModal>
  )
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-[#ecdfc8] bg-white p-5">
      <Mono className="mb-3 block text-[11px] tracking-[.06em] text-warm-sand">{label}</Mono>
      {children}
    </div>
  )
}

function FilterTab({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'cursor-pointer rounded-lg border-0 bg-white px-[15px] py-2 text-[13.5px] font-bold text-ink shadow-[0_1px_3px_rgb(90_60_20/0.1)]'
          : 'cursor-pointer rounded-lg border-0 bg-transparent px-[15px] py-2 text-[13.5px] font-semibold text-warm-gray'
      }
    >
      {label} · {count}
    </button>
  )
}

const ROW_GRID = 'grid grid-cols-[2.3fr_1.5fr_1.6fr_1fr_1.1fr_40px] items-center gap-3.5'

type Tab = 'alla' | 'aktiva' | 'arkiverade'

export default function Staff() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { query } = useTopbarSearch()
  const [tab, setTab] = useState<Tab>('aktiva')
  const [sortBy, setSortBy] = useState<'namn' | 'roll'>('namn')
  const [showNew, setShowNew] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<StaffRow | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<StaffRow | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const now = new Date()
  const thisWeek = isoWeekPeriod(now)
  const lastWeek = isoWeekPeriod(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7))
  const weekNumber = isoWeek(now).week

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff', true],
    queryFn: () => listStaff(true),
  })
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts', thisWeek],
    queryFn: () => listShifts(thisWeek),
  })
  const { data: prevShifts = [] } = useQuery({
    queryKey: ['shifts', lastWeek],
    queryFn: () => listShifts(lastWeek),
  })

  // Arbetstider column: the roster is small (MVP ~10 people), so one
  // availability fetch per row is fine.
  const active = useMemo(() => staff.filter((s) => !s.archived), [staff])
  const availability = useQueries({
    queries: active.map((s) => ({
      queryKey: ['availability', s.id],
      queryFn: () => getAvailability(s.id),
      staleTime: 60_000,
    })),
  })
  const wishSummaryById = new Map<string, string | null>()
  active.forEach((s, i) => {
    const doc = availability[i]?.data
    wishSummaryById.set(s.id, doc ? summarizeWishes(doc.wishes) : null)
  })

  const hoursByStaff = useMemo(() => {
    const m = new Map<string, number>()
    for (const shift of shifts) {
      if (!shift.staff_id) continue
      const h = (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 3_600_000
      m.set(shift.staff_id, (m.get(shift.staff_id) ?? 0) + h)
    }
    return m
  }, [shifts])

  const staffedShare = (list: Shift[]) =>
    list.length === 0 ? null : (list.filter((s) => s.staff_id).length / list.length) * 100
  const plannedHours = shifts.reduce(
    (sum, s) => sum + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3_600_000, 0)
  const openShifts = shifts.filter((s) => !s.staff_id).length
  const share = staffedShare(shifts)
  const prevShare = staffedShare(prevShifts)
  const shareDelta = share !== null && prevShare !== null ? Math.round(share - prevShare) : null
  const activeThisWeek = new Set(shifts.map((s) => s.staff_id).filter(Boolean)).size

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff'] })
  const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Något gick fel.')

  const create = useMutation({
    mutationFn: async ({ payload, wishes, createLink }: {
      payload: StaffPayload
      wishes: { weekday: number; start_minute: number; end_minute: number }[]
      createLink: boolean
    }) => {
      const created = await createStaff(payload)
      if (wishes.length > 0) await putAvailability(created.id, { wishes, blocks: [] })
      if (createLink && !created.share_token) await regenerateLink(created.id)
      return created
    },
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      setShowNew(false)
      setFormError(null)
    },
    onError: (err) => setFormError(errorText(err)),
  })
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StaffPayload }) => updateStaff(id, payload),
    onSuccess: () => { invalidate(); setEditTarget(null); setFormError(null) },
    onError: (err) => setFormError(errorText(err)),
  })
  const archive = useMutation({
    mutationFn: (id: string) => archiveStaff(id),
    onSuccess: () => { invalidate(); setArchiveTarget(null) },
  })
  const unarchive = useMutation({
    mutationFn: (id: string) => updateStaff(id, { archived: false }),
    onSuccess: invalidate,
  })
  const regenerate = useMutation({
    mutationFn: (id: string) => regenerateLink(id),
    onSuccess: (updated) => {
      // Write the fresh token straight into the cache: the old token is
      // already dead server-side, so the table must not keep offering it
      // while the refetch is in flight.
      queryClient.setQueryData<StaffRow[]>(['staff', true], (old) =>
        old?.map((s) => (s.id === updated.id ? updated : s)))
      invalidate()
      setRegenerateTarget(null)
    },
  })

  const copyLink = async (row: StaffRow) => {
    if (!row.share_token) return
    const url = shareUrl(row.share_token)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard can be denied — native prompt lets the user copy manually.
      window.prompt('Kopiera länken manuellt:', url)
    }
  }

  const needle = query.trim().toLowerCase()
  const rows = staff
    .filter((s) => (tab === 'alla' ? true : tab === 'aktiva' ? !s.archived : s.archived))
    .filter((s) => !needle
      || s.name.toLowerCase().includes(needle)
      || (s.role ?? '').toLowerCase().includes(needle)
      || (s.email ?? '').toLowerCase().includes(needle))
    .sort((a, b) => (sortBy === 'roll'
      ? (a.role ?? 'ö').localeCompare(b.role ?? 'ö', 'sv') || a.name.localeCompare(b.name, 'sv')
      : a.name.localeCompare(b.name, 'sv')))

  if (isLoading) return <Flex justify="center" py="8"><Spinner /></Flex>

  return (
    <div>
      {/* Page header */}
      <div className="mb-[26px] flex items-end justify-between gap-5">
        <div>
          <h1 className="m-0 mb-1.5 text-[32px] font-extrabold tracking-[-.03em]">Personal</h1>
          <p className="m-0 text-[14.5px] text-warm-gray">
            {active.length} medarbetare · {activeThisWeek} aktiva den här veckan
          </p>
        </div>
        <Button
          className="btn-ink"
          semantic="action"
          icon={UserPlus}
          text="Ny medarbetare"
          onClick={() => { setFormError(null); setShowNew(true) }}
        />
      </div>

      {/* Stat cards */}
      <div className="mb-[26px] grid grid-cols-4 gap-4">
        <StatCard label="AKTIVA">
          <div className="flex items-baseline gap-1">
            <span className="text-[30px] font-extrabold tracking-[-.03em]">{active.length}</span>
            <span className="text-[15px] font-semibold text-warm-sand">/ {staff.length}</span>
          </div>
        </StatCard>
        <StatCard label={`PLANERADE TIMMAR · V.${weekNumber}`}>
          <div className="flex items-baseline gap-[5px]">
            <span className="text-[30px] font-extrabold tracking-[-.03em]">{Math.round(plannedHours)}</span>
            <span className="text-sm font-semibold text-warm-sand">h</span>
          </div>
        </StatCard>
        <StatCard label="BEMANNING">
          <div className="flex items-center gap-2.5">
            <span className="text-[30px] font-extrabold tracking-[-.03em] text-[#3c5a44]">
              {share === null ? '–' : `${Math.round(share)}%`}
            </span>
            {shareDelta !== null && shareDelta !== 0 && (
              <span className={shareDelta > 0
                ? 'rounded-[20px] bg-[#e7efe8] px-2 py-[3px] text-xs font-bold text-ok'
                : 'rounded-[20px] bg-[#f7e6df] px-2 py-[3px] text-xs font-bold text-stop'}>
                {shareDelta > 0 ? '▲' : '▼'} {Math.abs(shareDelta)}
              </span>
            )}
          </div>
        </StatCard>
        <StatCard label="ÖPPNA PASS">
          <div className="flex items-center gap-2.5">
            <span className={`text-[30px] font-extrabold tracking-[-.03em] ${openShifts > 0 ? 'text-[#a44227]' : ''}`}>
              {openShifts}
            </span>
            {openShifts > 0 && (
              <span className="rounded-[20px] bg-[#f7e6df] px-2 py-[3px] text-xs font-bold text-stop">
                behöver bemanning
              </span>
            )}
          </div>
        </StatCard>
      </div>

      {/* Filter tabs + sort */}
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex gap-1.5 rounded-[11px] bg-[#f2e8d5] p-1">
          <FilterTab label="Alla" count={staff.length} active={tab === 'alla'} onClick={() => setTab('alla')} />
          <FilterTab label="Aktiva" count={active.length} active={tab === 'aktiva'} onClick={() => setTab('aktiva')} />
          <FilterTab label="Arkiverade" count={staff.length - active.length} active={tab === 'arkiverade'} onClick={() => setTab('arkiverade')} />
        </div>
        <button
          onClick={() => setSortBy((s) => (s === 'namn' ? 'roll' : 'namn'))}
          className="flex cursor-pointer items-center gap-2 border-0 bg-transparent font-mono text-[12.5px] text-warm-gray"
        >
          <ListFilter size={15} strokeWidth={1.85} /> Sortera: {sortBy === 'namn' ? 'Namn' : 'Roll'}
        </button>
      </div>

      {regenerate.isError && (
        <div className="mb-3.5">
          <Callout
            semantic="error" title="Kunde inte hantera länken"
            message={errorText(regenerate.error)}
            dismissible onDismiss={() => regenerate.reset()}
          />
        </div>
      )}

      {/* Staff table */}
      {rows.length === 0 ? (
        <EmptyState
          title={staff.length === 0 ? 'Ingen personal ännu' : 'Inga träffar'}
          description={staff.length === 0
            ? 'Lägg till din första medarbetare för att komma igång.'
            : 'Prova en annan flik eller sökning.'}
          action={staff.length === 0
            ? <Button className="btn-ink" semantic="action" icon={UserPlus} text="Ny medarbetare" onClick={() => setShowNew(true)} />
            : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#ecdfc8] bg-white">
          <div className={`${ROW_GRID} border-b border-[#ecdfc8] bg-[#faf3e6] px-[22px] py-[13px] font-mono text-[10.5px] uppercase tracking-[.06em] text-[#a5936f]`}>
            <span>Medarbetare</span><span>Roll</span><span>Arbetstider</span>
            <span className="text-right">Timmar v.{weekNumber}</span><span>Status</span><span />
          </div>
          {rows.map((row, i) => {
            const hours = hoursByStaff.get(row.id)
            const wishSummary = wishSummaryById.get(row.id)
            return (
              <div
                key={row.id}
                onClick={() => navigate(`/staff/${row.id}`)}
                className={`${ROW_GRID} cursor-pointer px-[22px] py-4 hover:bg-[#fffaf0] hover:shadow-[inset_3px_0_0_var(--ochre)] ${
                  i < rows.length - 1 ? 'border-b border-[#f4ead2]' : ''
                } ${row.archived ? 'opacity-70' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar id={row.id} name={row.name} muted={row.archived} />
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-bold">{row.name}</div>
                    <Mono className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#a5936f]">
                      {row.email ?? row.phone ?? '—'}
                    </Mono>
                  </div>
                </div>
                <div className="text-sm text-[#3a2f22]">{row.role ?? '—'}</div>
                <Mono className="text-[12.5px] text-ink-soft">{row.archived ? '—' : wishSummary ?? '—'}</Mono>
                <Mono className={`text-right text-sm font-bold ${hours === undefined ? 'text-warm-sand' : ''}`}>
                  {hours === undefined ? '—' : `${Math.round(hours * 10) / 10} h`}
                </Mono>
                <div>
                  {row.archived
                    ? <Badge dot semantic="neutral" text="Arkiverad" />
                    : <Badge dot semantic="success" text="Aktiv" />}
                </div>
                <div className="text-center" onClick={(e) => e.stopPropagation()}>
                  <Dropdown.Root>
                    <Dropdown.Trigger>
                      <button
                        aria-label={`Åtgärder för ${row.name}`}
                        className="cursor-pointer border-0 bg-transparent font-extrabold text-[#c2b291]"
                      >
                        {copiedId === row.id ? <Check size={18} className="text-ok" /> : <MoreHorizontal size={18} />}
                      </button>
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.Item icon={Pencil} onSelect={() => { setFormError(null); setEditTarget(row) }}>Redigera</Dropdown.Item>
                      {row.share_token && (
                        <Dropdown.Item icon={Copy} onSelect={() => void copyLink(row)}>Kopiera delningslänk</Dropdown.Item>
                      )}
                      {!row.archived && (
                        <Dropdown.Item icon={RefreshCw} onSelect={() => setRegenerateTarget(row)}>
                          {row.share_token ? 'Regenerera delningslänk' : 'Skapa delningslänk'}
                        </Dropdown.Item>
                      )}
                      {row.archived ? (
                        <Dropdown.Item icon={ArchiveRestore} onSelect={() => unarchive.mutate(row.id)}>Återställ</Dropdown.Item>
                      ) : (
                        <Dropdown.Item icon={Archive} semantic="destructive" onSelect={() => setArchiveTarget(row)}>Arkivera</Dropdown.Item>
                      )}
                    </Dropdown.Content>
                  </Dropdown.Root>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNew && (
        <NewStaffModal
          onClose={() => { setShowNew(false); create.reset(); setFormError(null) }}
          onError={setFormError}
          error={formError}
          busy={create.isPending}
          onSubmit={(payload, wishes, createLink) => create.mutate({ payload, wishes, createLink })}
        />
      )}
      {editTarget && (
        <EditStaffModal
          staff={editTarget}
          onClose={() => { setEditTarget(null); update.reset(); setFormError(null) }}
          onError={setFormError}
          error={formError}
          busy={update.isPending}
          onSubmit={(payload) => update.mutate({ id: editTarget.id, payload })}
        />
      )}
      {archiveTarget && (
        <ConfirmModal
          open onOpenChange={(o) => { if (!o) setArchiveTarget(null) }}
          title={`Arkivera ${archiveTarget.name}?`}
          description="Personen döljs från listan och kan inte tilldelas nya pass. Passhistoriken finns kvar och arkiveringen kan ångras."
          confirmText="Arkivera" cancelText="Avbryt" confirmSemantic="destructive"
          onConfirm={() => archive.mutate(archiveTarget.id)}
        />
      )}
      {regenerateTarget && (
        <ConfirmModal
          open onOpenChange={(o) => { if (!o) setRegenerateTarget(null) }}
          title={regenerateTarget.share_token
            ? `Regenerera länk för ${regenerateTarget.name}?`
            : `Skapa länk för ${regenerateTarget.name}?`}
          description={regenerateTarget.share_token
            ? 'Den gamla länken slutar fungera direkt. Skicka den nya länken till personen.'
            : 'En personlig länk skapas där personen kan fylla i sin tillgänglighet.'}
          confirmText={regenerateTarget.share_token ? 'Regenerera' : 'Skapa länk'}
          cancelText="Avbryt"
          confirmSemantic={regenerateTarget.share_token ? 'warning' : 'action'}
          onConfirm={() => regenerate.mutate(regenerateTarget.id)}
        />
      )}
    </div>
  )
}
