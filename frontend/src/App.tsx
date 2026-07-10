import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { Flex, Spinner } from '@radix-ui/themes'

import { getOrg } from './api'
import { Layout } from './components/Layout'
import { OnboardingGate } from './components/OnboardingGate'
import SignInScreen from './components/SignInScreen'
import SignUpScreen from './components/SignUpScreen'
import Schedule from './pages/Schedule'
import Settings from './pages/Settings'
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
  // @clerk/react has no <SignedIn>/<SignedOut> control-flow components (that's
  // @clerk/clerk-react) — check isLoaded/isSignedIn directly, same as openvera.
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return <Flex justify="center" align="center" style={{ minHeight: '100vh' }}><Spinner size="3" /></Flex>
  }
  if (!isSignedIn) {
    return (
      <Routes>
        <Route path="/sign-up" element={<SignUpScreen />} />
        <Route path="*" element={<SignInScreen />} />
      </Routes>
    )
  }

  return (
    <OnboardingGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/staff" replace />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/staff/:staffId" element={<StaffDetail />} />
          <Route path="/schema" element={<ScheduleRedirect />} />
          <Route path="/schema/:week" element={<Schedule />} />
          <Route path="/installningar" element={<Settings />} />
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </Route>
      </Routes>
    </OnboardingGate>
  )
}
