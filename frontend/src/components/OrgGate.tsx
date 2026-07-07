import type { ReactNode } from 'react'
import { useState } from 'react'
import { Flex, Text } from '@radix-ui/themes'
import { Button, Callout, TextField } from '@swedev/ui'

import { ApiError, clearOrgId, getOrgId, getRules, setOrgId } from '../api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Dev-interim org selection until auth lands (#3): paste the org UUID once
 * (the seed script prints it), validated against /data/rules and stored in
 * localStorage. #3 deletes this component in favor of real sign-in.
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => getOrgId() !== null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready) return children

  const submit = async () => {
    const candidate = value.trim()
    if (!UUID_RE.test(candidate)) {
      setError('Det där ser inte ut som ett organisations-id (UUID).')
      return
    }
    setBusy(true)
    setOrgId(candidate)
    try {
      await getRules()
      setReady(true)
    } catch (err) {
      clearOrgId()
      setError(err instanceof ApiError && err.status === 404
        ? 'Ingen organisation med det id:t hittades.'
        : 'Kunde inte nå servern. Kör backend och postgres?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex direction="column" align="center" justify="center" gap="4" style={{ minHeight: '100vh' }}>
      <Flex
        direction="column" gap="3"
        className="w-[420px] rounded-2xl border border-warm-border bg-white p-8 shadow-[0_4px_20px_rgb(90_60_20/0.06)]"
      >
        <img src="/timla-lockup.svg" alt="Timla" className="mb-2 h-8 self-center" />
        <Text size="2" color="gray">
          Utvecklingsläge: inloggning kommer med issue #3. Klistra in ditt
          organisations-id så länge (seed-scriptet skriver ut det).
        </Text>
        <TextField.Root
          className="font-mono"
          placeholder="00000000-0000-0000-0000-000000000000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
        {error && <Callout semantic="error" message={error} />}
        <Button semantic="action" text={busy ? 'Kontrollerar…' : 'Fortsätt'} disabled={busy} onClick={() => void submit()} />
      </Flex>
    </Flex>
  )
}
