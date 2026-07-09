import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useAuth } from '@clerk/react'
import { Flex, Spinner, Text } from '@radix-ui/themes'
import { Button, Callout, Select, TextField } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, createOrg, getOrg } from '../api'
import { Lockup } from './Lockup'

const TIMEZONES = [
  { value: 'Europe/Stockholm', label: 'Stockholm' },
  { value: 'Europe/Oslo', label: 'Oslo' },
  { value: 'Europe/Copenhagen', label: 'Köpenhamn' },
  { value: 'Europe/Helsinki', label: 'Helsingfors' },
  { value: 'UTC', label: 'UTC' },
]

function Shell({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }} className="bg-paper">
      <Flex
        direction="column"
        gap="4"
        className="w-110 max-w-full rounded-2xl border border-warm-border bg-white p-8 shadow-[0_4px_20px_rgb(90_60_20/0.06)]"
      >
        <Lockup className="mb-2 h-8 w-auto self-center" />
        {children}
      </Flex>
    </Flex>
  )
}

function CreateOrgForm() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Europe/Stockholm')

  const createMut = useMutation({
    mutationFn: createOrg,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org'] })
    },
  })

  const canSubmit = name.trim().length > 0

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    createMut.mutate({ name: name.trim(), timezone })
  }

  return (
    <Shell>
      <Text size="3" weight="bold">Skapa din verksamhet</Text>
      <Text size="2" color="gray">
        Ett konto, en verksamhet. Du kan lägga till fler medarbetare sen.
      </Text>
      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="3">
          <div>
            <Text as="label" size="1" weight="medium" color="gray" className="mb-1 block uppercase tracking-wide">
              Namn
            </Text>
            <TextField.Root
              placeholder="Strandkiosken"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <Text as="label" size="1" weight="medium" color="gray" className="mb-1 block uppercase tracking-wide">
              Tidszon
            </Text>
            <Select.Root value={timezone} onValueChange={(v) => setTimezone(v ?? 'Europe/Stockholm')}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {TIMEZONES.map((tz) => <Select.Item key={tz.value} value={tz.value}>{tz.label}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          {createMut.isError && (
            <Callout
              semantic="error"
              message={createMut.error instanceof ApiError ? createMut.error.message : 'Något gick fel'}
            />
          )}
          <Button
            type="submit"
            semantic="action"
            text={createMut.isPending ? 'Skapar…' : 'Skapa verksamhet'}
            disabled={!canSubmit || createMut.isPending}
          />
        </Flex>
      </form>
    </Shell>
  )
}

/**
 * Replaces OrgGate's structural role (issue #3): gates the app behind a
 * confirmed organization. Handles all four states of the org query
 * explicitly rather than only flipping on success, so a loading/network
 * failure never falls through to rendering a broken app shell.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  // Clerk's isLoaded gates on the token bridge (main.tsx) being registered
  // before the first getOrg() fetch fires — otherwise that first request
  // races ahead with no Authorization header.
  const { isLoaded } = useAuth()
  const { isError, error, isSuccess } = useQuery({
    queryKey: ['org'],
    queryFn: getOrg,
    enabled: isLoaded,
    retry: (failureCount, err) => err instanceof ApiError && err.code === 'no_org' ? false : failureCount < 1,
  })

  if (!isLoaded || (!isError && !isSuccess)) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: '100vh' }}>
        <Spinner size="3" />
      </Flex>
    )
  }

  if (isError) {
    if (error instanceof ApiError && error.code === 'no_org') {
      return <CreateOrgForm />
    }
    return (
      <Shell>
        <Callout
          semantic="error"
          title="Kunde inte hämta din verksamhet"
          message={error instanceof ApiError ? error.message : 'Kontrollera anslutningen och ladda om sidan.'}
        />
        <Button semantic="neutral" text="Försök igen" onClick={() => window.location.reload()} />
      </Shell>
    )
  }

  return children
}
