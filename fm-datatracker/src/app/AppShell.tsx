import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AppVersion } from '../components/AppVersion'
import { CurrentCheckpointCalendar } from '../components/CurrentCheckpointCalendar'
import { usePotential } from '../features/potential/PotentialContext'
import { useSaves } from '../features/saves/SaveContext'
import { supabase } from '../lib/supabase'
import { AppRoutes } from './AppRoutes'
import { SettingsModal } from './SettingsModal'
import { preloadSave } from '../lib/dataCache'
import { flushAllModelConfigPatches } from '../lib/model-config'

const navigation = [['/', 'Visão Geral'], ['/squad', 'Elenco'], ['/planning', 'Planejamento'], ['/network', 'Rede'], ['/academy', 'Academia'], ['/history', 'História'], ['/tactics', 'Táticas'], ['/scoring', 'Pontuação & Funções']] as const

export function AppShell() {
  const { saves, selected, select, currentCheckpoint } = useSaves()
  const location = useLocation()
  const potential = usePotential()
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
      <nav>{navigation.slice(0, 2).map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}<NavLink to={compareTo}>Comparar</NavLink>{navigation.slice(2).map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}</nav>
      <div className="sidebar-footer">
        <div className="sidebar-actions">
          <Link className="ghost sidebar-import" to="/imports">↥ Novo import</Link>
          <button className="ghost" onClick={() => setSettings(true)}>⚙ Configurações</button>
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
    {settings && <SettingsModal close={() => setSettings(false)} />}
  </div>
}
