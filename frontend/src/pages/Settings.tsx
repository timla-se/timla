import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Flex, Spinner } from '@radix-ui/themes'
import { Button, Callout, Select, TextField } from '@swedev/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, getOrg, getRules, putRules, updateOrg } from '../api'
import { FieldLabel } from '../components/TimlaModal'
import { Mono } from '../components/Mono'
import { selectableTimezones } from '../timezones'
import type { Org, Rules } from '../types'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Något gick fel.')

function SettingsCard({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-warm-line bg-white p-6">
      <h2 className="m-0 mb-1 text-lg font-extrabold tracking-tight">{title}</h2>
      <p className="m-0 mb-5 text-13 text-warm-gray">{description}</p>
      {children}
    </section>
  )
}

/** Footer row shared by both cards: save button + brief success feedback. */
function SaveRow({ pending, pristine, saved }: { pending: boolean; pristine: boolean; saved: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-3">
      <Button
        className="btn-ink"
        semantic="action"
        type="submit"
        text={pending ? 'Sparar…' : 'Spara'}
        disabled={pristine || pending}
      />
      {saved && <Mono className="text-13 text-ok">Sparat ✓</Mono>}
    </div>
  )
}

/** Brief "Sparat ✓" confirmation — the page stays open, unlike the modals. */
function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2500)
    return () => clearTimeout(t)
  }, [saved])
  return [saved, () => setSaved(true)]
}

/** Seeded once from the loaded org (the parent only mounts this when the
 * query has data), so a background refetch never clobbers in-progress edits. */
function OrgCard({ org }: { org: Org }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(org.name)
  const [timezone, setTimezone] = useState(org.timezone)
  // Baseline of the last-saved state — drives the pristine check.
  const [savedOrg, setSavedOrg] = useState(org)
  const [saved, flashSaved] = useSavedFlash()

  const mutation = useMutation({
    mutationFn: updateOrg,
    onSuccess: (updated) => {
      queryClient.setQueryData(['org'], updated)
      // A timezone change moves period boundaries and publication coverage
      // (everything local-time is reinterpreted in the new zone) — force
      // those caches to re-fetch.
      if (updated.timezone !== savedOrg.timezone) {
        void queryClient.invalidateQueries({ queryKey: ['shifts'] })
        void queryClient.invalidateQueries({ queryKey: ['publication'] })
      }
      setSavedOrg(updated)
      setName(updated.name)
      setTimezone(updated.timezone)
      flashSaved()
    },
  })

  const pristine = name.trim() === savedOrg.name && timezone === savedOrg.timezone
  const canSubmit = !pristine && name.trim().length > 0

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit || mutation.isPending) return
    if (timezone !== savedOrg.timezone
      && !window.confirm('Byta tidszon? Passens tider, veckogränser och publicerade scheman tolkas om i den nya tidszonen.')) {
      return
    }
    mutation.mutate({ name: name.trim(), timezone })
  }

  return (
    <SettingsCard
      title="Verksamhet"
      description="Namn och tidszon. Alla tider i schemat tolkas i verksamhetens tidszon."
    >
      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <label className="block">
            <FieldLabel>Namn</FieldLabel>
            <TextField.Root
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="Strandkiosken"
            />
          </label>
          <div>
            <FieldLabel>Tidszon</FieldLabel>
            <Select.Root value={timezone} onValueChange={(v) => setTimezone(v ?? timezone)}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {selectableTimezones(savedOrg.timezone).map((tz) => (
                  <Select.Item key={tz.value} value={tz.value}>{tz.label}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <p className="m-0 mt-2 text-13 text-warm-gray">
              Vid byte tolkas alla tider om i den nya tidszonen — pass nära midnatt
              kan flytta till en annan dag eller vecka, och publicerade scheman
              utvärderas om.
            </p>
          </div>
          {mutation.isError && <Callout semantic="error" message={errorText(mutation.error)} />}
          <SaveRow pending={mutation.isPending} pristine={!canSubmit} saved={saved} />
        </Flex>
      </form>
    </SettingsCard>
  )
}

/** '' → null (rule unset), comma decimals accepted; NaN reported by caller. */
function parseRule(value: string): number | null {
  if (value.trim() === '') return null
  return Number(value.trim().replace(',', '.'))
}

function ruleToInput(value: number | null): string {
  return value === null ? '' : String(value)
}

function validateRule(value: string, label: string): string | null {
  const parsed = parseRule(value)
  if (parsed !== null && (Number.isNaN(parsed) || parsed <= 0 || parsed > 168)) {
    return `${label} måste vara ett tal mellan 0 och 168, eller tomt.`
  }
  return null
}

function RulesCard({ rules }: { rules: Rules }) {
  const queryClient = useQueryClient()
  const [maxHours, setMaxHours] = useState(ruleToInput(rules.max_hours_per_week))
  const [minRest, setMinRest] = useState(ruleToInput(rules.min_rest_hours))
  const [savedRules, setSavedRules] = useState(rules)
  const [clientError, setClientError] = useState<string | null>(null)
  const [saved, flashSaved] = useSavedFlash()

  const mutation = useMutation({
    mutationFn: putRules,
    onSuccess: (updated) => {
      // Trust the canonical PUT response — numeric(4,1) may round the input.
      queryClient.setQueryData(['rules'], updated)
      setSavedRules(updated)
      setMaxHours(ruleToInput(updated.max_hours_per_week))
      setMinRest(ruleToInput(updated.min_rest_hours))
      flashSaved()
    },
  })

  const pristine = parseRule(maxHours) === savedRules.max_hours_per_week
    && parseRule(minRest) === savedRules.min_rest_hours

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (pristine || mutation.isPending) return
    const problem = validateRule(maxHours, 'Max timmar/vecka')
      ?? validateRule(minRest, 'Min vila mellan pass')
    setClientError(problem)
    if (problem) return
    // PUT is a full replace — always send both fields.
    mutation.mutate({ max_hours_per_week: parseRule(maxHours), min_rest_hours: parseRule(minRest) })
  }

  return (
    <SettingsCard
      title="Schemaregler"
      description="Gränser som konfliktkontrollen bevakar. Tomt fält = ingen regel."
    >
      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <div className="flex gap-3.5">
            <label className="min-w-0 flex-1">
              <FieldLabel>Max timmar/vecka</FieldLabel>
              <TextField.Root
                value={maxHours}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxHours(e.target.value)}
                placeholder="t.ex. 40"
                inputMode="decimal"
              />
            </label>
            <label className="min-w-0 flex-1">
              <FieldLabel>Min vila mellan pass, timmar</FieldLabel>
              <TextField.Root
                value={minRest}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setMinRest(e.target.value)}
                placeholder="t.ex. 11"
                inputMode="decimal"
              />
            </label>
          </div>
          <p className="m-0 text-13 text-warm-gray">
            En regeländring gäller konfliktkontrollen från och med nu — redan
            sparade pass påverkas inte, men kontrolleras mot de nya reglerna
            nästa gång de redigeras.
          </p>
          {(clientError ?? (mutation.isError ? errorText(mutation.error) : null)) && (
            <Callout semantic="error" message={clientError ?? errorText(mutation.error)} />
          )}
          <SaveRow pending={mutation.isPending} pristine={pristine} saved={saved} />
        </Flex>
      </form>
    </SettingsCard>
  )
}

export default function Settings() {
  const org = useQuery({ queryKey: ['org'], queryFn: getOrg })
  const rules = useQuery({ queryKey: ['rules'], queryFn: getRules })

  if (org.isLoading || rules.isLoading) {
    return <Flex justify="center" py="8"><Spinner /></Flex>
  }

  return (
    <div>
      <div className="mb-6.5">
        <h1 className="m-0 mb-1.5 text-30 font-extrabold tracking-tight">Inställningar</h1>
        <p className="m-0 text-15 text-warm-gray">Verksamhetens uppgifter och schemaregler.</p>
      </div>
      <div className="grid max-w-260 grid-cols-2 items-start gap-4">
        {org.data
          ? <OrgCard org={org.data} />
          : <Callout semantic="error" title="Kunde inte hämta verksamheten" message={errorText(org.error)} />}
        {rules.data
          ? <RulesCard rules={rules.data} />
          : <Callout semantic="error" title="Kunde inte hämta schemareglerna" message={errorText(rules.error)} />}
      </div>
    </div>
  )
}
