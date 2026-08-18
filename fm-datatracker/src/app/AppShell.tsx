import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { AppVersion } from '../components/AppVersion'
import { useSaves } from '../features/saves/SaveContext'
import { supabase } from '../lib/supabase'
import { AppRoutes } from './AppRoutes'
import { SettingsModal } from './SettingsModal'

const navigation = [['/', 'Visão Geral'], ['/squad', 'Elenco'], ['/planning', 'Planejamento'], ['/tactics', 'Táticas'], ['/scoring', 'Pontuação & Funções']] as const

export function AppShell() {
  const { saves, selected, select } = useSaves()
  const [settings, setSettings] = useState(false)
  return <div className="shell"><aside><div className="brand"><span>FM</span><strong>DataTracker</strong></div>{saves.length > 0 && <select className="save-select" value={selected?.id ?? ''} onChange={event => { const save = saves.find(item => item.id === event.target.value); if (save) select(save) }}>{saves.map(save => <option key={save.id} value={save.id}>{save.name}</option>)}</select>}<nav>{navigation.map(([to, label]) => <NavLink to={to} key={to}>{label}</NavLink>)}</nav><div className="sidebar-footer"><div className="sidebar-actions"><button className="ghost" onClick={() => setSettings(true)}>⚙ Configurações</button><button className="ghost" onClick={() => void supabase?.auth.signOut()}>Sair</button></div><AppVersion /></div></aside><main><AppRoutes /></main>{settings && <SettingsModal close={() => setSettings(false)} />}</div>
}
