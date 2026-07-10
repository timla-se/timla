import { createContext, useContext, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { UserButton, useClerk } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@swedev/ui'
import {
  BarChart3, Bell, CalendarDays, CalendarRange, ChevronDown, ClipboardList,
  LayoutGrid, Package, Search, Settings, Users,
} from 'lucide-react'

import { getOrg, listStaff } from '../api'
import { initials } from './Avatar'
import { Mono } from './Mono'

/** App shell per design/Timla App - Personal.dc.html: dark ink sidebar with
 * ochre active state, paper main column with breadcrumb topbar. Nav items
 * without a route yet are rendered per design but inert. */

const NAV: { to?: string; label: string; icon: typeof Users }[] = [
  { label: 'Översikt', icon: LayoutGrid },
  { label: 'Kalender', icon: CalendarDays },
  { to: '/schema', label: 'Arbetsschema', icon: CalendarRange },
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
        <rect x="12" y="14" width="5.5" height="24" rx="2.75" fill="var(--cream)" />
        <rect x="21.25" y="23" width="5.5" height="15" rx="2.75" fill="var(--ochre)" />
        <circle cx="24" cy="17" r="2.9" fill="var(--ochre)" />
        <rect x="30.5" y="19" width="5.5" height="19" rx="2.75" fill="var(--cream)" />
      </g>
      <text x="47" y="36" fontWeight="800" fontSize="40" letterSpacing="-1.2" fill="var(--cream)" fontFamily="var(--font-sans)">
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
        'ml-auto rounded-full px-2 py-0.5 text-10 font-semibold',
        active ? 'bg-ink text-honey' : 'bg-ink-raised-2 text-sidebar-muted',
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
  const base = 'flex items-center gap-3 rounded-10 px-3 py-3 text-15 no-underline'
  if (!to) {
    return (
      <span title="Kommer senare" className={cn(base, 'cursor-default font-semibold text-sidebar-muted')}>
        <Icon size={19} strokeWidth={1.75} className="text-sidebar-faint" /> {label}
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
          : 'font-semibold text-sidebar-muted hover:bg-ink-raised',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={19} strokeWidth={1.85} className={isActive ? 'text-ink' : 'text-sidebar-faint'} /> {label}
          {badge !== undefined && <NavBadge value={badge} active={isActive} />}
        </>
      )}
    </NavLink>
  )
}

function pageLabel(pathname: string): string {
  if (pathname.startsWith('/staff')) return 'Personal'
  if (pathname.startsWith('/schema')) return 'Arbetsschema'
  if (pathname.startsWith('/installningar')) return 'Inställningar'
  return ''
}

/** Only these pages consume the topbar search (Personal table filter and the
 * schedule board) — elsewhere the field would be nonfunctional and misleading. */
const SEARCH_PAGES = new Set(['Personal', 'Arbetsschema'])

export function Layout() {
  const location = useLocation()
  const { signOut } = useClerk()
  const [query, setQuery] = useState('')
  // The search state is shell-global; a query typed on one page must not
  // silently keep filtering the next one.
  useEffect(() => { setQuery('') }, [location.pathname])
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
        <aside className="flex w-61.5 shrink-0 flex-col overflow-y-auto bg-ink px-4 py-6">
          <div className="px-2.5 pb-6.5 pt-1.5"><SidebarLockup /></div>
          <Mono className="px-3 pb-2.5 text-10 tracking-[.14em] text-sidebar-faint">MENY</Mono>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <NavItem key={item.label} {...item} badge={item.to === '/staff' ? activeStaff : undefined} />
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-1">
            <NavItem to="/installningar" label="Inställningar" icon={Settings} />
            <button
              title="Logga ut"
              onClick={() => {
                // Signing out mid-task is annoying enough to confirm.
                if (window.confirm('Logga ut?')) void signOut()
              }}
              className="mt-2.5 flex cursor-pointer items-center gap-3 rounded-xl border-0 bg-ink-raised p-2.5 text-left"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-10 bg-ok text-xs font-extrabold tracking-wide text-white">
                {org ? initials(orgName) : '–'}
              </div>
              <div className="min-w-0">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-13 font-bold text-white">{orgName}</div>
                <Mono className="text-11 text-sidebar-faint">Verksamhet</Mono>
              </div>
              <ChevronDown size={15} strokeWidth={1.9} className="ml-auto shrink-0 text-sidebar-faint" />
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col bg-paper">
          <header className="flex items-center gap-5 border-b border-warm-line px-7.5 py-4">
            <Mono className="text-xs text-warm-sand">
              {orgName} <span className="text-warm-sand">/</span> <span className="text-ink-soft">{pageLabel(location.pathname)}</span>
            </Mono>
            <div className="ml-auto flex items-center gap-3.5">
              {SEARCH_PAGES.has(pageLabel(location.pathname)) && (
                <div className="field-shell flex w-60 items-center gap-2 rounded-10 border border-warm-line-strong bg-white px-3 py-2">
                  <Search size={16} strokeWidth={1.75} className="shrink-0 text-warm-sand" />
                  <input
                    placeholder={pageLabel(location.pathname) === 'Arbetsschema' ? 'Sök personal…' : 'Sök medarbetare…'}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-warm-sand"
                  />
                </div>
              )}
              <button
                title="Notiser — kommer senare"
                className="flex h-10 w-10 cursor-default items-center justify-center rounded-10 border border-warm-line-strong bg-white"
              >
                <Bell size={18} strokeWidth={1.75} className="text-ink-soft" />
              </button>
              <div className="flex h-10 w-10 items-center justify-center rounded-10 bg-ink">
                <UserButton appearance={{ elements: { userButtonAvatarBox: 'h-7 w-7' } }} />
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-7.5">
            <Outlet />
          </div>
        </div>
      </div>
    </TopbarSearchContext.Provider>
  )
}
