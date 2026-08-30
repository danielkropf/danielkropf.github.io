import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RequireSave } from '../components/RequireSave'
import { Dashboard } from '../pages/Dashboard'
import { ImportsPage } from '../pages/ImportsPage'
import { ModelLabPage } from '../pages/ModelLabPage'
import { PlanningPage } from '../pages/PlanningPage'
import { SavesPage } from '../pages/SavesPage'
import { PlayerComparisonPage } from '../pages/PlayerComparisonPage'
import { PlayerPage } from '../pages/PlayerPage'
import { SquadPage } from '../pages/SquadPage'
import { TacticsPage } from '../pages/TacticsPage'

function Protected({ children }: { children: ReactNode }) { return <RequireSave>{children}</RequireSave> }

export function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/saves" element={<SavesPage />} />
    <Route path="/imports" element={<Protected><ImportsPage /></Protected>} />
    <Route path="/squad" element={<Protected><SquadPage /></Protected>} />
    <Route path="/compare" element={<Protected><PlayerComparisonPage /></Protected>} />
    <Route path="/players/:id" element={<Protected><PlayerPage /></Protected>} />
    <Route path="/planning" element={<Protected><PlanningPage /></Protected>} />
    <Route path="/tactics" element={<Protected><TacticsPage /></Protected>} />
    <Route path="/scoring" element={<Protected><ModelLabPage /></Protected>} />
    <Route path="/models" element={<Protected><ModelLabPage /></Protected>} />
    <Route path="*" element={<Dashboard />} />
  </Routes>
}
