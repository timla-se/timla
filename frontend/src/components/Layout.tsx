import { createContext, useContext, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@swedev/ui'
import {
  BarChart3, Bell, CalendarDays, ChevronDown, ClipboardList, LayoutGrid,
  Package, Search, Settings, Users,
} from 'lucide-react'

import { clearOrgId, getOrg, listStaff } from '../api'
import { initials } from './Avatar'
import { Mono } from './Mono'

/** App shell per design/Timla App - Personal.dc.html: dark ink sidebar with
 * ochre active state, paper main column with breadcrumb topbar. Nav items
 * without a route yet are rendered per design but inert. */

const NAV: { to?: string; label: string; icon: typeof Users }[] = [
  { label: 'Översikt', icon: LayoutGrid },
  { label: 'Kalender', icon: CalendarDays },
  { label: 'Bokningar', icon: ClipboardList },
  { to: '/staff', label: 'Personal', icon: Users },
  { label: 'Resurser', icon: Package },
  { label: 'Rapporter', icon: BarChart3 },
]

/** Topbar search ("Sök medarbetare…") — owned by the shell, consumed by the
 * Personal table filter. */
const TopbarSearchContext = createContext<{ query: string; setQuery: (q: string) => void }>({
  query: '',
  setQuery: () => {},
})

export function useTopbarSearch() {
  return useContext(TopbarSearchContext)
}

function SidebarLockup() {
  return (
    <svg viewBox="0 0 166 48" height="27" fill="none" className="block" role="img" aria-label="Timla">
      <g transform="rotate(-90 24 24)">
        <rect x="12" y="14" width="5.5" height="24" rx="2.75" fill="#fbf1dc" />
        <rect x="21.25" y="23" width="5.5" height="15" rx="2.75" fill="#e69a2e" />
        <circle cx="24" cy="17" r="2.9" fill="#e69a2e" />
        <rect x="30.5" y="19" width="5.5" height="19" rx="2.75" fill="#fbf1dc" />
      </g>
      <text x="47" y="36" fontWeight="800" fontSize="40" letterSpacing="-1.2" fill="#fbf1dc" fontFamily="var(--font-sans)">
        timla
      </text>
    </svg>
  )
}

/** Nav count chip per the design (mono pill; ink/honey when the item is
 * active so it reads on the ochre pill). */
function NavBadge({ value, active }: { value: number; active: boolean }) {
  return (
    <Mono
      className={cn(
        'ml-auto rounded-[20px] px-[7px] py-[2px] text-[10px] font-semibold',
        active ? 'bg-ink text-honey' : 'bg-[#3a3126] text-[#e0d4bd]',
      )}
    >
      {value}
    </Mono>
  )
}

function NavItem({ to, label, icon: Icon, badge }: {
  to?: string
  label: string
  icon: typeof Users
  badge?: number
}) {
  const base = 'flex items-center gap-3 rounded-[10px] px-3 py-[11px] text-[14.5px] no-underline'
  if (!to) {
    return (
      <span title="Kommer senare" className={cn(base, 'cursor-default font-semibold text-[#b6a98f]')}>
        <Icon size={19} strokeWidth={1.75} className="text-[#8a7c64]" /> {label}
      </span>
    )
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        base,
        isActive
          ? 'bg-ochre font-bold text-ink shadow-[0_4px_14px_rgb(230_154_46/0.28)]'
          : 'font-semibold text-[#b6a98f] hover:bg-[#2f271c]',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={19} strokeWidth={1.85} className={isActive ? 'text-ink' : 'text-[#8a7c64]'} /> {label}
          {badge !== undefined && <NavBadge value={badge} active={isActive} />}
        </>
      )}
    </NavLink>
  )
}

function pageLabel(pathname: string): string {
  if (pathname.startsWith('/staff')) return 'Personal'
  return ''
}

export function Layout() {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const { data: org } = useQuery({ queryKey: ['org'], queryFn: getOrg })
  const orgName = org?.name ?? '…'
  // Same query key as the Personal table, so the badge rides on its cache.
  const { data: staff } = useQuery({ queryKey: ['staff', true], queryFn: () => listStaff(true) })
  const activeStaff = staff?.filter((s) => !s.archived).length

  return (
    <TopbarSearchContext.Provider value={{ query, setQuery }}>
      {/* Fixed app frame: only the main content area scrolls — the sidebar
          and topbar stay put. */}
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[246px] shrink-0 flex-col overflow-y-auto bg-ink px-4 py-6">
          <div className="px-2.5 pb-[26px] pt-1.5"><SidebarLockup /></div>
          <Mono className="px-3 pb-2.5 text-[10px] tracking-[.14em] text-[#6b5f4c]">MENY</Mono>
          <nav className="flex flex-col gap-[3px]">
            {NAV.map((item) => (
              <NavItem key={item.label} {...item} badge={item.to === '/staff' ? activeStaff : undefined} />
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-[3px]">
            <NavItem label="Inställningar" icon={Settings} />
            <button
              title="Byt organisation"
              onClick={() => {
                // Easy to hit by accident — and "logging out" of the dev-
                // interim org gate mid-task is annoying enough to confirm.
                if (window.confirm('Byt organisation? Du får klistra in ett organisations-id igen.')) {
                  clearOrgId()
                  window.location.assign('/')
                }
              }}
              className="mt-2.5 flex cursor-pointer items-center gap-[11px] rounded-xl border-0 bg-[#2f271c] p-2.5 text-left"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-ok text-xs font-extrabold tracking-[.02em] text-white">
                {org ? initials(orgName) : '–'}
              </div>
              <div className="min-w-0">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-bold text-white">{orgName}</div>
                <Mono className="text-[10.5px] text-[#8a7c64]">Verksamhet</Mono>
              </div>
              <ChevronDown size={15} strokeWidth={1.9} className="ml-auto shrink-0 text-[#8a7c64]" />
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col bg-paper">
          <header className="flex items-center gap-5 border-b border-[#ecdfc8] px-[30px] py-4">
            <Mono className="text-xs text-warm-sand">
              {orgName} <span className="text-[#d8c8a6]">/</span> <span className="text-ink-soft">{pageLabel(location.pathname)}</span>
            </Mono>
            <div className="ml-auto flex items-center gap-3.5">
              <div className="field-shell flex w-60 items-center gap-2 rounded-[10px] border border-[#e4d9c2] bg-white px-3 py-2">
                <Search size={16} strokeWidth={1.75} className="shrink-0 text-warm-sand" />
                <input
                  placeholder="Sök medarbetare…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-warm-sand"
                />
              </div>
              <button
                title="Notiser — kommer senare"
                className="flex h-10 w-10 cursor-default items-center justify-center rounded-[10px] border border-[#e4d9c2] bg-white"
              >
                <Bell size={18} strokeWidth={1.75} className="text-ink-soft" />
              </button>
              <div
                title="Konto — inloggning kommer med issue #3"
                className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-ink text-[13px] font-extrabold text-honey"
              >
                {org ? initials(orgName) : '–'}
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-[30px]">
            <Outlet />
          </div>
        </div>
      </div>
    </TopbarSearchContext.Provider>
  )
}
