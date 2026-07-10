import { useState } from 'react'
import { Flex, Spinner } from '@radix-ui/themes'
import { Badge, Callout } from '@swedev/ui'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { computeLaborCost, getOrg } from '../api'
import { Avatar } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'
import { Mono } from '../components/Mono'
import { wallClock } from '../time'

/** Rapporter (issue #17): monthly labor cost from **scheduled** hours
 * ("schemalagda timmar" — published time reporting doesn't exist yet) ×
 * each staff member's current hourly wage. Staff without a wage show
 * hours but no cost, and the footer says so instead of overclaiming. */

const hoursFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 })
const wageFormat = new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const costFormat = new Intl.NumberFormat('sv-SE', {
  style: 'currency', currency: 'SEK', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

/** '2026-07' ± delta months, zero-padded. */
function addMonths(month: string, delta: number): string {
  const [y = 1970, m = 1] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  return `${year}-${String((total - year * 12) + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [y = 1970, m = 1] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' })
    .format(new Date(y, m - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const ROW_GRID = 'grid grid-cols-[2.3fr_1fr_1fr_1.2fr] items-center gap-3.5'

function ReportTable({ month }: { month: string }) {
  const { data: report, isLoading, isError } = useQuery({
    queryKey: ['labor-cost', month],
    queryFn: () => computeLaborCost(month),
  })

  if (isLoading) return <Flex justify="center" py="8"><Spinner /></Flex>
  if (isError || !report) {
    return <Callout semantic="error" title="Kunde inte hämta rapporten" message="Kontrollera anslutningen och försök igen." />
  }
  if (report.staff.length === 0) {
    return (
      <EmptyState
        title="Inga schemalagda pass den här månaden"
        description="Rapporten visar timmar och kostnad när det finns tilldelade pass i månaden."
      />
    )
  }

  const { totals } = report
  return (
    <div className="overflow-hidden rounded-2xl border border-warm-line bg-white">
      <div className={`${ROW_GRID} border-b border-warm-line bg-band px-5.5 py-3 font-mono text-11 uppercase tracking-wider text-warm-caption`}>
        <span>Namn</span>
        <span className="text-right">Schemalagda timmar</span>
        <span className="text-right">Timlön</span>
        <span className="text-right">Kostnad</span>
      </div>
      {report.staff.map((row) => (
        <div key={row.staff_id} className={`${ROW_GRID} border-b border-warm-line px-5.5 py-4 ${row.archived ? 'opacity-70' : ''}`}>
          <div className="flex items-center gap-3">
            <Avatar id={row.staff_id} name={row.name} muted={row.archived} />
            <span className="text-15 font-bold">{row.name}</span>
            {row.archived && <Badge dot semantic="neutral" text="Arkiverad" />}
          </div>
          <Mono className="text-right text-sm font-bold">{hoursFormat.format(row.hours)} h</Mono>
          <Mono className="text-right text-sm">
            {row.hourly_wage === null ? '—' : `${wageFormat.format(row.hourly_wage)} kr/h`}
          </Mono>
          {row.cost === null ? (
            <span className="text-right text-13 text-warm-sand">— <span className="text-11">ingen timlön angiven</span></span>
          ) : (
            <Mono className="text-right text-sm font-bold">{costFormat.format(row.cost)}</Mono>
          )}
        </div>
      ))}
      <div className={`${ROW_GRID} bg-band px-5.5 py-4`}>
        <span className="text-sm font-bold">
          {totals.cost_complete ? 'Totalt' : 'Känd kostnad'}
          {!totals.cost_complete && (
            <span className="ml-2 font-normal text-13 text-warm-gray">
              exklusive {hoursFormat.format(totals.uncosted_hours)} h utan timlön
            </span>
          )}
        </span>
        <Mono className="text-right text-sm font-extrabold">{hoursFormat.format(totals.hours)} h</Mono>
        <span />
        <Mono className="text-right text-sm font-extrabold">{costFormat.format(totals.cost)}</Mono>
      </div>
    </div>
  )
}

function ReportsView({ defaultMonth }: { defaultMonth: string }) {
  const [month, setMonth] = useState(defaultMonth)

  return (
    <div>
      <div className="mb-6.5 flex items-end justify-between gap-5">
        <div>
          <h1 className="m-0 mb-1.5 text-30 font-extrabold tracking-tight">Rapporter</h1>
          <p className="m-0 text-15 text-warm-gray">
            Schemalagda timmar och personalkostnad per månad — inte arbetad tid.
          </p>
        </div>
        <div className="mb-0.5 flex items-center gap-2">
          <button
            aria-label="Föregående månad"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-warm-border-strong bg-white"
          >
            <ChevronLeft size={16} strokeWidth={1.9} className="text-ink-soft" />
          </button>
          <label className="whitespace-nowrap text-15 font-bold">
            <span className="sr-only">Månad</span>
            <input
              type="month"
              value={month}
              onChange={(e) => { if (e.target.value) setMonth(e.target.value) }}
              className="field-shell cursor-pointer rounded-lg border border-warm-border-strong bg-white px-2.5 py-1.5 font-mono text-13 text-ink"
            />
          </label>
          <button
            aria-label="Nästa månad"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-warm-border-strong bg-white"
          >
            <ChevronRight size={16} strokeWidth={1.9} className="text-ink-soft" />
          </button>
          <Mono className="ml-2 rounded-lg bg-chip px-3 py-1.5 text-xs text-warm-gray">{monthLabel(month)}</Mono>
        </div>
      </div>

      <ReportTable month={month} />
    </div>
  )
}

export default function Reports() {
  // Default to the current month in the ORG timezone (same rule as
  // /schema's redirect): a manager abroad must land on the org's month.
  const { data: org, isError } = useQuery({ queryKey: ['org'], queryFn: getOrg })
  if (isError) {
    return <Callout semantic="error" title="Kunde inte hämta rapporten" message="Kontrollera anslutningen och ladda om sidan." />
  }
  if (!org) return <Flex justify="center" py="8"><Spinner /></Flex>
  const defaultMonth = wallClock(new Date().toISOString(), org.timezone).isoDate.slice(0, 7)
  return <ReportsView defaultMonth={defaultMonth} />
}
