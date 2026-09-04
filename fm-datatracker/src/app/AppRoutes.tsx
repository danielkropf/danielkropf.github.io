import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { RequireSave } from '../components/RequireSave'

const Dashboard = lazy(() => import('../pages/Dashboard').then(module => ({ default: module.Dashboard })))
const PlanningPage = lazy(() => import('../pages/PlanningPage').then(module => ({ default: module.PlanningPage })))
const SavesPage = lazy(() => import('../pages/SavesPage').then(module => ({ default: module.SavesPage })))
const PlayerComparisonPage = lazy(() => import('../pages/PlayerComparisonPage').then(module => ({ default: module.PlayerComparisonPage })))
const PlayerPage = lazy(() => import('../pages/PlayerPage').then(module => ({ default: module.PlayerPage })))
const SquadPage = lazy(() => import('../pages/SquadPage').then(module => ({ default: module.SquadPage })))
const TacticsPage = lazy(() => import('../pages/TacticsPage').then(module => ({ default: module.TacticsPage })))
const NetworkPage = lazy(() => import('../pages/NetworkPage').then(module => ({ default: module.NetworkPage })))
const AcademyPage = lazy(() => import('../pages/AcademyPage').then(module => ({ default: module.AcademyPage })))
const HistoryPage = lazy(() => import('../pages/HistoryPage').then(module => ({ default: module.HistoryPage })))

function Protected({ children }: { children: ReactNode }) { return <RequireSave>{children}</RequireSave> }

export function AppRoutes() {
  return <Suspense fallback={<div className="route-loading" role="status">Carregando módulo…</div>}><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/saves" element={<SavesPage />} />
    <Route path="/squad" element={<Protected><SquadPage /></Protected>} />
    <Route path="/compare" element={<Protected><PlayerComparisonPage /></Protected>} />
    <Route path="/players/:id" element={<Protected><PlayerPage /></Protected>} />
    <Route path="/planning" element={<Protected><PlanningPage /></Protected>} />
    <Route path="/network" element={<Protected><NetworkPage /></Protected>} />
    <Route path="/academy" element={<Protected><AcademyPage /></Protected>} />
    <Route path="/history" element={<Protected><HistoryPage /></Protected>} />
    <Route path="/tactics" element={<Protected><TacticsPage /></Protected>} />
    <Route path="*" element={<Dashboard />} />
  </Routes></Suspense>
}
