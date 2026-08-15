import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { AuthGate } from './features/auth/AuthGate'
import { SaveProvider } from './features/saves/SaveContext'
import { Dashboard } from './pages/Dashboard'
import { AppVersion } from './components/AppVersion'

export default function App() { return <AuthGate><SaveProvider><HashRouter><div className="shell"><aside><div className="brand"><span>FM</span><strong>DataTracker</strong></div><nav><NavLink to="/">Visão geral</NavLink><NavLink to="/squad">Elenco</NavLink><NavLink to="/imports">Imports</NavLink><NavLink to="/models">Model Lab</NavLink><NavLink to="/quality">Data Quality</NavLink></nav><AppVersion /></aside><main><Routes><Route path="*" element={<Dashboard/>}/></Routes></main></div></HashRouter></SaveProvider></AuthGate> }
