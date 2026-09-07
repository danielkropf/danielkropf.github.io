import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'

const TacticsPage = lazy(() => import('./TacticsPage').then(module => ({ default: module.TacticsPage })))
const PlanningPage = lazy(() => import('./PlanningPage').then(module => ({ default: module.PlanningPage })))

type WorkspaceMode = 'structure' | 'planning'

function resolveMode(value: string | null): WorkspaceMode {
  return value === 'planning' ? 'planning' : 'structure'
}

/**
 * TacticsPage still owns its historical Structure/Jogadores tab state. The
 * Elenco sidebar group is now the navigation authority, so keep the legacy
 * page pinned to Structure while its duplicated tab strip remains hidden.
 */
function TacticsModeBridge({ host }: { host: RefObject<HTMLDivElement | null> }) {
  useLayoutEffect(() => {
    const root = host.current
    if (!root || typeof MutationObserver === 'undefined') return
    const sync = () => {
      const tabs = [...root.querySelectorAll<HTMLButtonElement>('.tactic-tabs button[role="tab"]')]
      const target = tabs.find(button => button.textContent?.trim() === 'Estrutura')
      if (target && target.getAttribute('aria-selected') !== 'true') target.click()
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [host])
  return null
}

export function TacticsWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode = searchParams.get('mode')
  const mode = resolveMode(requestedMode)
  const tacticsHost = useRef<HTMLDivElement>(null)
  const [planningMounted, setPlanningMounted] = useState(mode === 'planning')

  useEffect(() => {
    if (mode === 'planning') setPlanningMounted(true)
  }, [mode])

  useEffect(() => {
    if (requestedMode && requestedMode !== 'planning') {
      const next = new URLSearchParams(searchParams)
      next.delete('mode')
      setSearchParams(next, { replace: true })
    }
  }, [requestedMode, searchParams, setSearchParams])

  return <div className={`tactics-workspace-page tactics-workspace-mode-${mode}`}>
    <div className="tactics-workspace-body">
      <div ref={tacticsHost} className="tactics-workspace-surface tactics-workspace-tactics" hidden={mode !== 'structure'}>
        <TacticsModeBridge host={tacticsHost} />
        <Suspense fallback={<div className="route-loading" role="status">Carregando Táticas…</div>}><TacticsPage active={mode === 'structure'} /></Suspense>
      </div>

      {planningMounted && <div className="tactics-workspace-surface tactics-workspace-planning" hidden={mode !== 'planning'}>
        <Suspense fallback={<div className="route-loading" role="status">Carregando Planejamento…</div>}><PlanningPage active={mode === 'planning'} /></Suspense>
      </div>}
    </div>
  </div>
}
