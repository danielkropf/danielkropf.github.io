import { lazy, Suspense, useState, type ReactNode } from 'react'
import { RequireSave } from '../components/RequireSave'
import { Resources } from './Resources'

const AppearanceSettings = lazy(() => import('../pages/AppearanceSettings').then(module => ({ default: module.AppearanceSettings })))
const ImportsPage = lazy(() => import('../pages/ImportsPage').then(module => ({ default: module.ImportsPage })))
const QualityPage = lazy(() => import('../pages/QualityPage').then(module => ({ default: module.QualityPage })))
const SavesPage = lazy(() => import('../pages/SavesPage').then(module => ({ default: module.SavesPage })))

type SettingsTab = 'saves' | 'imports' | 'quality' | 'resources' | 'appearance'
const tabs: Array<{ id: SettingsTab; label: string }> = [{ id: 'saves', label: 'Saves' }, { id: 'imports', label: 'Imports' }, { id: 'quality', label: 'Qualidade dos dados' }, { id: 'resources', label: 'Downloads' }, { id: 'appearance', label: 'Aparência' }]
function Protected({ children }: { children: ReactNode }) { return <RequireSave>{children}</RequireSave> }

export function SettingsModal({ close }: { close: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('saves')
  const content: Record<SettingsTab, ReactNode> = { saves: <SavesPage />, imports: <Protected><ImportsPage mode="history" /></Protected>, quality: <Protected><QualityPage /></Protected>, resources: <Resources />, appearance: <AppearanceSettings /> }
  return <div className="settings-overlay" onClick={close}><section className="settings-modal" onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Configurações</h1></div><button className="close" aria-label="Fechar configurações" onClick={close}>×</button></header><div className="settings-tabs">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><div className="settings-content"><Suspense fallback={<div className="route-loading" role="status">Carregando configuração…</div>}>{content[tab]}</Suspense></div></section></div>
}
