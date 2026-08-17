import{useState,type ReactNode}from'react'
import{HashRouter,NavLink,Route,Routes}from'react-router-dom'
import{AuthGate}from'./features/auth/AuthGate'
import{SaveProvider,useSaves}from'./features/saves/SaveContext'
import{Dashboard}from'./pages/Dashboard'
import{AppVersion}from'./components/AppVersion'
import{SavesPage}from'./pages/SavesPage'
import{ImportsPage}from'./pages/ImportsPage'
import{SquadPage}from'./pages/SquadPage'
import{PlayerPage}from'./pages/PlayerPage'
import{QualityPage}from'./pages/QualityPage'
import{ModelLabPage}from'./pages/ModelLabPage'
import{PlanningPage}from'./pages/PlanningPage'
import{AppearanceSettings}from'./pages/AppearanceSettings'
import{TacticsPage}from'./pages/TacticsPage'
import{RequireSave}from'./components/RequireSave'
import{supabase}from'./lib/supabase'

function Protected({children}:{children:ReactNode}){return <RequireSave>{children}</RequireSave>}
function Resources(){return <section className="resources-page"><h2>Views para exportação</h2><p>Instale estas views no Football Manager 26 para exportar arquivos compatíveis com o DataTracker.</p><div className="resource-grid"><a className="card resource-download" href={`${import.meta.env.BASE_URL}views/PlayerExport Atributes.fmf`} download><strong>PlayerExport Attributes</strong><span>Atributos e informações do jogador</span><b>Baixar .fmf</b></a><a className="card resource-download" href={`${import.meta.env.BASE_URL}views/PlayerExport Stats.fmf`} download><strong>PlayerExport Stats</strong><span>Estatísticas de desempenho</span><b>Baixar .fmf</b></a></div></section>}
function SettingsModal({close}:{close:()=>void}){const[tab,setTab]=useState<'saves'|'imports'|'quality'|'resources'|'appearance'>('saves');return <div className="settings-overlay" onClick={close}><section className="settings-modal" onClick={event=>event.stopPropagation()}><header><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Configurações</h1></div><button className="close" onClick={close}>×</button></header><div className="settings-tabs"><button className={tab==='saves'?'active':''} onClick={()=>setTab('saves')}>Saves</button><button className={tab==='imports'?'active':''} onClick={()=>setTab('imports')}>Imports</button><button className={tab==='quality'?'active':''} onClick={()=>setTab('quality')}>Qualidade dos dados</button><button className={tab==='resources'?'active':''} onClick={()=>setTab('resources')}>Downloads</button><button className={tab==='appearance'?'active':''} onClick={()=>setTab('appearance')}>Aparência</button></div><div className="settings-content">{tab==='saves'?<SavesPage/>:tab==='imports'?<Protected><ImportsPage/></Protected>:tab==='quality'?<Protected><QualityPage/></Protected>:tab==='resources'?<Resources/>:<AppearanceSettings/>}</div></section></div>}
function Shell(){const{saves,selected,select}=useSaves(),[settings,setSettings]=useState(false);return <div className="shell"><aside><div className="brand"><span>FM</span><strong>DataTracker</strong></div>{saves.length>0&&<select className="save-select" value={selected?.id??''} onChange={event=>{const save=saves.find(item=>item.id===event.target.value);if(save)select(save)}}>{saves.map(save=><option key={save.id} value={save.id}>{save.name}</option>)}</select>}<nav><NavLink to="/">Visão Geral</NavLink><NavLink to="/squad">Elenco</NavLink><NavLink to="/planning">Planejamento</NavLink><NavLink to="/tactics">Táticas</NavLink><NavLink to="/scoring">Pontuação & Funções</NavLink></nav><div className="sidebar-footer"><div className="sidebar-actions"><button className="ghost" onClick={()=>setSettings(true)}>⚙ Configurações</button><button className="ghost" onClick={()=>void supabase?.auth.signOut()}>Sair</button></div><AppVersion/></div></aside><main><Routes><Route path="/" element={<Dashboard/>}/><Route path="/squad" element={<Protected><SquadPage/></Protected>}/><Route path="/players/:id" element={<Protected><PlayerPage/></Protected>}/><Route path="/planning" element={<Protected><PlanningPage/></Protected>}/><Route path="/tactics" element={<Protected><TacticsPage/></Protected>}/><Route path="/scoring" element={<Protected><ModelLabPage/></Protected>}/><Route path="/models" element={<Protected><ModelLabPage/></Protected>}/><Route path="*" element={<Dashboard/>}/></Routes></main>{settings&&<SettingsModal close={()=>setSettings(false)}/>}</div>}
export default function App(){return <AuthGate><SaveProvider><HashRouter><Shell/></HashRouter></SaveProvider></AuthGate>}
