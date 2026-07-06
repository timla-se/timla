import { NavLink, Outlet } from 'react-router'
import { Box, Flex, Text } from '@radix-ui/themes'
import { cn } from '@swedev/ui'
import { CalendarDays, Settings, Users } from 'lucide-react'

import { clearOrgId, getOrgId } from '../api'

const NAV = [
  { to: '/staff', label: 'Personal', icon: Users, enabled: true },
  { to: '/schedule', label: 'Schema', icon: CalendarDays, enabled: false },
  { to: '/settings', label: 'Inställningar', icon: Settings, enabled: false },
]

export function Layout() {
  const orgId = getOrgId()

  return (
    <Flex style={{ minHeight: '100vh' }}>
      <Flex direction="column" justify="between" className="w-56 shrink-0 border-r border-[var(--gray-5)] p-4">
        <Box>
          <Text size="5" weight="bold" as="div" className="mb-6">Timla</Text>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon, enabled }) =>
              enabled ? (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2 rounded px-2 py-1.5 text-sm no-underline',
                    isActive ? 'bg-[var(--accent-4)] text-[var(--gray-12)]' : 'text-[var(--gray-11)] hover:bg-[var(--gray-3)]',
                  )}
                >
                  <Icon size={16} /> {label}
                </NavLink>
              ) : (
                <span
                  key={to}
                  title="Kommer senare"
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--gray-8)]"
                >
                  <Icon size={16} /> {label}
                </span>
              ),
            )}
          </nav>
        </Box>
        <Box>
          <Text size="1" color="gray" as="div" title={orgId ?? undefined}>
            org: {orgId ? `${orgId.slice(0, 8)}…` : '–'}
          </Text>
          <button
            className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--gray-10)] underline"
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
