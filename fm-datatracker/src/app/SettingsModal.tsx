import { useState, type ReactNode } from 'react'
import { RequireSave } from '../components/RequireSave'
import { AppearanceSettings } from '../pages/AppearanceSettings'
import { ImportsPage } from '../pages/ImportsPage'
import { QualityPage } from '../pages/QualityPage'
import { SavesPage } from '../pages/SavesPage'
import { Resources } from './Resources'

type SettingsTab = 'saves' | 'imports' | 'quality' | 'resources' | 'appearance'
const tabs: Array<{ id: SettingsTab; label: string }> = [{ id: 'saves', label: 'Saves' }, { id: 'imports', label: 'Imports' }, { id: 'quality', label: 'Qualidade dos dados' }, { id: 'resources', label: 'Downloads' }, { id: 'appearance', label: 'Aparência' }]
function Protected({ children }: { children: ReactNode }) { return <RequireSave>{children}</RequireSave> }

export function SettingsModal({ close }: { close: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('saves')
  const content: Record<SettingsTab, ReactNode> = { saves: <SavesPage />, imports: <Protected><ImportsPage /></Protected>, quality: <Protected><QualityPage /></Protected>, resources: <Resources />, appearance: <AppearanceSettings /> }
  return <div className="settings-overlay" onClick={close}><section className="settings-modal" onClick={event => event.stopPropagation()}><header><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Configurações</h1></div><button className="close" onClick={close}>×</button></header><div className="settings-tabs">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><div className="settings-content">{content[tab]}</div></section></div>
}
