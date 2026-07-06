import { Navigate, Route, Routes } from 'react-router'

import { Layout } from './components/Layout'
import { OrgGate } from './components/OrgGate'
import Staff from './pages/Staff'
import StaffDetail from './pages/StaffDetail'

export default function App() {
  return (
    <OrgGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/staff" replace />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/staff/:staffId" element={<StaffDetail />} />
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </Route>
      </Routes>
    </OrgGate>
  )
}
