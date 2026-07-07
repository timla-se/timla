import { Navigate, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Flex, Spinner } from '@radix-ui/themes'

import { getOrg } from './api'
import { Layout } from './components/Layout'
import { OrgGate } from './components/OrgGate'
import Schedule from './pages/Schedule'
import Staff from './pages/Staff'
import StaffDetail from './pages/StaffDetail'
import { isoWeekPeriod, wallClock } from './time'

/** /schema → the current week, evaluated in the org timezone (a manager
 * abroad must land on the org's "this week", not the browser's). */
function ScheduleRedirect() {
  const { data: org } = useQuery({ queryKey: ['org'], queryFn: getOrg })
  if (!org) return <Flex justify="center" py="8"><Spinner /></Flex>
  const localToday = wallClock(new Date().toISOString(), org.timezone).isoDate
  const [y = 1970, m = 1, d = 1] = localToday.split('-').map(Number)
  return <Navigate to={`/schema/${isoWeekPeriod(new Date(y, m - 1, d))}`} replace />
}

export default function App() {
  return (
    <OrgGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/staff" replace />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/staff/:staffId" element={<StaffDetail />} />
          <Route path="/schema" element={<ScheduleRedirect />} />
          <Route path="/schema/:week" element={<Schedule />} />
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </Route>
      </Routes>
    </OrgGate>
  )
}
