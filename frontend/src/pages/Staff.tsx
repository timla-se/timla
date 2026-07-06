import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Flex, Heading, Spinner, Text } from '@radix-ui/themes'
import { Badge, Button, Callout, LabelledCheckbox, Modal, ConfirmModal, Table, TextField } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Copy, Link as LinkIcon, Pencil, Plus, RefreshCw } from 'lucide-react'

import { ApiError, archiveStaff, createStaff, listStaff, regenerateLink, type StaffPayload, updateStaff } from '../api'
import { EmptyState } from '../components/EmptyState'
import type { Staff as StaffRow } from '../types'

function shareUrl(token: string): string {
  return `${location.origin}/link/${token}`
}

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

function StaffFormModal({ open, title, initial, onClose, onSubmit, error, busy }: {
  open: boolean
  title: string
  initial: FormState
  onClose: () => void
  onSubmit: (form: FormState) => void
  error: string | null
  busy: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = () => {
    if (!form.name.trim()) { setLocalError('Namn krävs.'); return }
    const hours = parseMaxHours(form.maxHours)
    if (hours !== null && (Number.isNaN(hours) || hours <= 0 || hours > 168)) {
      setLocalError('Max timmar/vecka måste vara ett tal mellan 0 och 168.')
      return
    }
    setLocalError(null)
    onSubmit(form)
  }

  return (
    <Modal.Root open={open} onOpenChange={(o) => { if (!o) onClose() }} size="2">
      <Modal.Header title={title} closeButton onClose={onClose} />
      <Modal.Body>
        <Flex direction="column" gap="3">
          <label>
            <Text size="2" weight="medium">Namn *</Text>
            <TextField.Root value={form.name} onChange={set('name')} placeholder="Lisa Andersson" />
          </label>
          <label>
            <Text size="2" weight="medium">Roll</Text>
            <TextField.Root value={form.role} onChange={set('role')} placeholder="servis" />
          </label>
          <Flex gap="3">
            <label className="grow">
              <Text size="2" weight="medium">Telefon</Text>
              <TextField.Root value={form.phone} onChange={set('phone')} placeholder="070-123 45 67" />
            </label>
            <label className="grow">
              <Text size="2" weight="medium">E-post</Text>
              <TextField.Root value={form.email} onChange={set('email')} placeholder="lisa@example.se" />
            </label>
          </Flex>
          <label>
            <Text size="2" weight="medium">Max timmar/vecka (tomt = ingen egen gräns)</Text>
            <TextField.Root value={form.maxHours} onChange={set('maxHours')} placeholder="t.ex. 30" inputMode="decimal" />
          </label>
          {(localError ?? error) && <Callout semantic="error" message={localError ?? error} />}
        </Flex>
      </Modal.Body>
      <Modal.Footer>
        <Flex gap="2" justify="end">
          <Button semantic="neutral" variant="soft" text="Avbryt" onClick={onClose} />
          <Button semantic="action" text={busy ? 'Sparar…' : 'Spara'} disabled={busy} onClick={submit} />
        </Flex>
      </Modal.Footer>
    </Modal.Root>
  )
}

export default function Staff() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<StaffRow | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<StaffRow | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff', includeArchived],
    queryFn: () => listStaff(includeArchived),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['staff'] })
  const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Något gick fel.')

  const create = useMutation({
    mutationFn: createStaff,
    onSuccess: () => { invalidate(); setShowNew(false) },
  })
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StaffPayload }) => updateStaff(id, payload),
    onSuccess: () => { invalidate(); setEditTarget(null) },
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
    onSuccess: () => { invalidate(); setRegenerateTarget(null) },
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

  return (
    <Flex direction="column" gap="4">
      <Flex justify="between" align="center">
        <Heading size="6">Personal</Heading>
        <Flex gap="4" align="center">
          <LabelledCheckbox
            label="Visa arkiverade"
            checked={includeArchived}
            onCheckedChange={(v) => setIncludeArchived(v === true)}
          />
          <Button semantic="action" icon={Plus} text="Ny person" onClick={() => setShowNew(true)} />
        </Flex>
      </Flex>

      {isLoading ? (
        <Flex justify="center" py="8"><Spinner /></Flex>
      ) : staff.length === 0 ? (
        <EmptyState
          title="Ingen personal ännu"
          description="Lägg till din första medarbetare för att komma igång."
          action={<Button semantic="action" icon={Plus} text="Ny person" onClick={() => setShowNew(true)} />}
        />
      ) : (
        <Table.Root hoverable>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Namn</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Roll</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Kontakt</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Max h/v</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Delningslänk</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {staff.map((row) => (
              <Table.Row key={row.id} className={row.archived ? 'opacity-50' : undefined}>
                <Table.RowHeaderCell>
                  <button
                    className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline"
                    onClick={() => navigate(`/staff/${row.id}`)}
                  >
                    {row.name}
                  </button>
                  {row.archived && <Badge semantic="neutral" text="arkiverad" className="ml-2" />}
                </Table.RowHeaderCell>
                <Table.Cell>{row.role ?? '–'}</Table.Cell>
                <Table.Cell>
                  <Text size="2">{row.phone ?? row.email ?? '–'}</Text>
                </Table.Cell>
                <Table.Cell>{row.max_hours_per_week ?? '–'}</Table.Cell>
                <Table.Cell>
                  {row.share_token ? (
                    <Flex gap="2" align="center">
                      <Badge semantic="success" text="länk finns" />
                      <Button
                        semantic="neutral" variant="ghost" size="1"
                        icon={copiedId === row.id ? Check : Copy}
                        text={copiedId === row.id ? 'kopierad!' : 'kopiera'}
                        onClick={() => void copyLink(row)}
                      />
                      <Button
                        semantic="neutral" variant="ghost" size="1" icon={RefreshCw} text="regenerera"
                        onClick={() => setRegenerateTarget(row)}
                      />
                    </Flex>
                  ) : row.archived ? (
                    <Text size="2" color="gray">–</Text>
                  ) : (
                    <Button
                      semantic="neutral" variant="soft" size="1" icon={LinkIcon} text="Skapa länk"
                      disabled={regenerate.isPending}
                      onClick={() => regenerate.mutate(row.id)}
                    />
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Flex gap="2" justify="end">
                    <Button semantic="neutral" variant="ghost" size="1" icon={Pencil} text="Redigera"
                      onClick={() => setEditTarget(row)} />
                    {row.archived ? (
                      <Button semantic="neutral" variant="ghost" size="1" icon={ArchiveRestore} text="Återställ"
                        disabled={unarchive.isPending}
                        onClick={() => unarchive.mutate(row.id)} />
                    ) : (
                      <Button semantic="destructive" variant="ghost" size="1" icon={Archive} text="Arkivera"
                        onClick={() => setArchiveTarget(row)} />
                    )}
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {showNew && (
        <StaffFormModal
          open title="Ny person" initial={EMPTY_FORM}
          onClose={() => { setShowNew(false); create.reset() }}
          onSubmit={(form) => create.mutate(payloadFromForm(form))}
          error={create.isError ? errorText(create.error) : null}
          busy={create.isPending}
        />
      )}
      {editTarget && (
        <StaffFormModal
          open title={`Redigera ${editTarget.name}`} initial={formFromStaff(editTarget)}
          onClose={() => { setEditTarget(null); update.reset() }}
          onSubmit={(form) => update.mutate({ id: editTarget.id, payload: payloadFromForm(form) })}
          error={update.isError ? errorText(update.error) : null}
          busy={update.isPending}
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
          title={`Regenerera länk för ${regenerateTarget.name}?`}
          description="Den gamla länken slutar fungera direkt. Skicka den nya länken till personen."
          confirmText="Regenerera" cancelText="Avbryt" confirmSemantic="warning"
          onConfirm={() => regenerate.mutate(regenerateTarget.id)}
        />
      )}
    </Flex>
  )
}
