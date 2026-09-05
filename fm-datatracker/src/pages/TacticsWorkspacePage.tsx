import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'

const TacticsPage = lazy(() => import('./TacticsPage').then(module => ({ default: module.TacticsPage })))
const PlanningPage = lazy(() => import('./PlanningPage').then(module => ({ default: module.PlanningPage })))

type WorkspaceMode = 'structure' | 'planning'

const MODES: { id: WorkspaceMode; label: string }[] = [
  { id: 'structure', label: 'Estrutura' },
  { id: 'planning', label: 'Planejamento' },
]

function resolveMode(value: string | null): WorkspaceMode {
  return value === 'planning' ? 'planning' : 'structure'
}

/**
 * TacticsPage still owns its historical Structure/Jogadores tab state. The
 * unified workspace is now the only navigation authority, so keep the legacy
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

  function selectMode(nextMode: WorkspaceMode) {
    const next = new URLSearchParams(searchParams)
    if (nextMode === 'structure') next.delete('mode')
    else next.set('mode', nextMode)
    setSearchParams(next)
  }

  return <div className={`tactics-workspace-page tactics-workspace-mode-${mode}`}>
    <header className="tactics-workspace-header">
      <h1>Táticas</h1>
      <nav className="tactics-workspace-tabs" role="tablist" aria-label="Área de Táticas">
        {MODES.map(item => <button
          type="button"
          role="tab"
          aria-selected={mode === item.id}
          className={mode === item.id ? 'active' : ''}
          onClick={() => selectMode(item.id)}
          key={item.id}
        >{item.label}</button>)}
      </nav>
    </header>

    <div className="tactics-workspace-body">
      <div ref={tacticsHost} className="tactics-workspace-surface tactics-workspace-tactics" hidden={mode !== 'structure'}>
        <TacticsModeBridge host={tacticsHost} />
        <Suspense fallback={<div className="route-loading" role="status">Carregando Táticas…</div>}><TacticsPage /></Suspense>
      </div>

      {planningMounted && <div className="tactics-workspace-surface tactics-workspace-planning" hidden={mode !== 'planning'}>
        <Suspense fallback={<div className="route-loading" role="status">Carregando Planejamento…</div>}><PlanningPage /></Suspense>
      </div>}
    </div>
  </div>
}
