import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { AppVersion } from '../components/AppVersion'
import { CurrentCheckpointCalendar } from '../components/CurrentCheckpointCalendar'
import { usePotential } from '../features/potential/PotentialContext'
import { useSaves } from '../features/saves/SaveContext'
import { supabase } from '../lib/supabase'
import { AppRoutes } from './AppRoutes'
import { ImportModal } from './ImportModal'
import { SettingsModal } from './SettingsModal'
import { preloadSave } from '../lib/dataCache'
import { flushAllModelConfigPatches } from '../lib/model-config'

const primaryNavigation = [['/', 'Visão Geral'], ['/squad', 'Elenco'], ['/tactics', 'Táticas']] as const
const secondaryNavigation = [['/network', 'Rede'], ['/academy', 'Academia'], ['/history', 'História']] as const

export function AppShell() {
  const { saves, selected, select, currentCheckpoint } = useSaves()
  const location = useLocation()
  const potential = usePotential()
  const [importOpen, setImportOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  useEffect(() => { if (selected) preloadSave(selected.id) }, [selected?.id])
  useEffect(() => {
    const flush = () => { void flushAllModelConfigPatches() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [])
  const currentPlayerId = /^\/players\/([^/]+)$/.exec(location.pathname)?.[1] ?? null
  const compareTo = currentPlayerId ? `/compare?a=${encodeURIComponent(currentPlayerId)}` : '/compare'
  const potentialTitle = potential.available
    ? 'Mostra os melhores scores plausíveis em um cenário positivo de carreira, na Nota Geral e por função. Não é a evolução mais provável e o PA/CP do Football Manager não é exibido.'
    : potential.detail
  const checkpointMatchesSave = !selected || currentCheckpoint.saveId === selected.id
  const checkpointReady = !selected || (checkpointMatchesSave && currentCheckpoint.status === 'ready')
  const checkpointError = Boolean(selected && checkpointMatchesSave && currentCheckpoint.status === 'error')
  const routeKey = selected ? `${selected.id}:${currentCheckpoint.date ?? 'none'}:${currentCheckpoint.revision}` : 'no-save'

  return <div className="shell">
    <aside>
      <div className="brand"><span>FM</span><strong>DataTracker</strong></div>
      {saves.length > 0 && <div className="save-context">
        <span className="save-context-label">Save ativo</span>
        <select className="save-select" aria-label="Save ativo" value={selected?.id ?? ''} onChange={(event: { target: { value: string } }) => {
          const save = saves.find(item => item.id === event.target.value)
          if (save) select(save)
        }}>
          {saves.map(save => <option key={save.id} value={save.id}>{save.name}</option>)}
        </select>
      </div>}
      {selected && <CurrentCheckpointCalendar checkpoint={checkpointMatchesSave ? currentCheckpoint : { ...currentCheckpoint, saveId: selected.id, status: 'loading', date: null, error: null }} />}
      <button type="button" className={`potential-toggle ${potential.showPotential ? 'is-on' : ''} ${!potential.available ? 'has-load-error' : ''}`} onClick={() => potential.setShowPotential(!potential.showPotential)} title={potentialTitle} aria-pressed={potential.showPotential}>
        <span><b aria-hidden="true">↗</b> Mostrar potencial</span><span className="potential-switch" aria-hidden="true" />
      </button>
      <nav>{primaryNavigation.map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}<NavLink to={compareTo}>Comparar</NavLink><div className="sidebar-nav-divider" aria-hidden="true" />{secondaryNavigation.map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}</nav>
      <div className="sidebar-footer">
        <div className="sidebar-actions">
          <button className="ghost sidebar-import" type="button" onClick={() => { setSettings(false); setImportOpen(true) }}>↥ Import</button>
          <button className="ghost" type="button" onClick={() => { setImportOpen(false); setSettings(true) }}>⚙ Configurações</button>
          <button className="ghost" onClick={() => void supabase?.auth.signOut()}>Sair</button>
        </div>
        <AppVersion />
      </div>
    </aside>
    <main>
      <div className="shell-page-frame">
        {checkpointError
          ? <section className="card checkpoint-route-state"><span className="eyebrow">CHECKPOINT ATUAL</span><h1>Não foi possível sincronizar a fotografia atual</h1><p>{currentCheckpoint.error ?? 'Tente recarregar o save.'}</p></section>
          : checkpointReady
            ? <AppRoutes key={routeKey} />
            : <section className="checkpoint-route-state is-loading" aria-live="polite"><span className="checkpoint-route-spinner" aria-hidden="true"/><strong>Sincronizando checkpoint atual…</strong><small>Os dados do save serão exibidos juntos com a data correta.</small></section>}
      </div>
    </main>
    {importOpen && <ImportModal close={() => setImportOpen(false)} />}
    {settings && <SettingsModal close={() => setSettings(false)} />}
  </div>
}
