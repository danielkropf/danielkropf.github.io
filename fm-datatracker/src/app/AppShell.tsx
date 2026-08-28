import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { AppVersion } from '../components/AppVersion'
import { usePotential } from '../features/potential/PotentialContext'
import { useSaves } from '../features/saves/SaveContext'
import { supabase } from '../lib/supabase'
import { AppRoutes } from './AppRoutes'
import { SettingsModal } from './SettingsModal'
import { preloadSave } from '../lib/dataCache'

const navigation = [['/', 'Visão Geral'], ['/squad', 'Elenco'], ['/planning', 'Planejamento'], ['/tactics', 'Táticas'], ['/scoring', 'Pontuação & Funções']] as const

export function AppShell() {
  const { saves, selected, select } = useSaves()
  const potential = usePotential()
  const [settings, setSettings] = useState(false)
  useEffect(() => { if (selected) preloadSave(selected.id) }, [selected?.id])
  const potentialTitle = potential.experimental
    ? `${potential.detail} O CP do Football Manager não é exibido.`
    : potential.available
      ? 'Mostra a projeção média estimada pelo DataTracker. O CP do Football Manager não é exibido.'
      : potential.detail

  return <div className="shell">
    <aside>
      <div className="brand"><span>FM</span><strong>DataTracker</strong></div>
      {saves.length > 0 && <div className="save-context">
        <span className="save-context-label">Save ativo</span>
        <select className="save-select" aria-label="Save ativo" value={selected?.id ?? ''} onChange={event => {
          const save = saves.find(item => item.id === event.target.value)
          if (save) select(save)
        }}>
          {saves.map(save => <option key={save.id} value={save.id}>{save.name}</option>)}
        </select>
      </div>}
      <button type="button" className={`potential-toggle ${potential.showPotential ? 'is-on' : ''} ${!potential.available ? 'is-disabled' : ''}`} aria-disabled={!potential.available} onClick={() => { if (potential.available) potential.setShowPotential(!potential.showPotential) }} title={potentialTitle} aria-pressed={potential.showPotential}>
        <span><b aria-hidden="true">↗</b> Mostrar potencial</span><span className="potential-switch" aria-hidden="true" />
      </button>
      <nav>{navigation.map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}</nav>
      <div className="sidebar-footer">
        <div className="sidebar-actions">
          <Link className="ghost sidebar-import" to="/imports">↥ Novo import</Link>
          <button className="ghost" onClick={() => setSettings(true)}>⚙ Configurações</button>
          <button className="ghost" onClick={() => void supabase?.auth.signOut()}>Sair</button>
        </div>
        <AppVersion />
      </div>
    </aside>
    <main><AppRoutes /></main>
    {settings && <SettingsModal close={() => setSettings(false)} />}
  </div>
}
