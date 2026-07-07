import { NavLink, Outlet } from 'react-router'
import { Box, Flex } from '@radix-ui/themes'
import { cn } from '@swedev/ui'
import { CalendarDays, Settings, Users } from 'lucide-react'

import { clearOrgId, getOrgId } from '../api'
import { Mono } from './Mono'

const NAV = [
  { to: '/staff', label: 'Personal', icon: Users, enabled: true },
  { to: '/schedule', label: 'Schema', icon: CalendarDays, enabled: false },
  { to: '/settings', label: 'Inställningar', icon: Settings, enabled: false },
]

export function Layout() {
  const orgId = getOrgId()

  return (
    <Flex style={{ minHeight: '100vh' }}>
      <Flex direction="column" justify="between" className="w-56 shrink-0 border-r border-warm-border bg-white p-4">
        <Box>
          <img src="/timla-lockup.svg" alt="Timla" className="mb-8 mt-1 h-7" />
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon, enabled }) =>
              enabled ? (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm font-medium no-underline',
                    isActive ? 'bg-cream text-ink' : 'text-ink-soft hover:bg-paper',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} className={isActive ? 'text-ochre' : undefined} /> {label}
                    </>
                  )}
                </NavLink>
              ) : (
                <span
                  key={to}
                  title="Kommer senare"
                  className="flex cursor-default items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm text-mutedwarm"
                >
                  <Icon size={16} /> {label}
                </span>
              ),
            )}
          </nav>
        </Box>
        <Box>
          <Mono className="block text-xs text-warm-sand" title={orgId ?? undefined}>
            org: {orgId ? `${orgId.slice(0, 8)}…` : '–'}
          </Mono>
          <button
            className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs text-warm-gray underline"
            onClick={() => { clearOrgId(); location.reload() }}
          >
            Byt organisation
          </button>
        </Box>
      </Flex>
      <Box className="grow p-6">
        <Outlet />
      </Box>
    </Flex>
  )
}
