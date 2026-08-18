import { HashRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { AuthGate } from './features/auth/AuthGate'
import { SaveProvider } from './features/saves/SaveContext'

export default function App() {
  return <AuthGate><SaveProvider><HashRouter><AppShell /></HashRouter></SaveProvider></AuthGate>
}
