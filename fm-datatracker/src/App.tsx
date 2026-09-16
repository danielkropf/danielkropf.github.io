import { ImportQueueProvider } from './features/imports/ImportQueue'
import { HashRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { AuthGate } from './features/auth/AuthGate'
import { PotentialProvider } from './features/potential/PotentialContext'
import { SaveProvider } from './features/saves/SaveContext'
import { AppErrorBoundary } from './components/AppErrorBoundary'

export default function App() {
  return <AppErrorBoundary><AuthGate><PotentialProvider><SaveProvider><HashRouter><ImportQueueProvider><AppShell /></ImportQueueProvider></HashRouter></SaveProvider></PotentialProvider></AuthGate></AppErrorBoundary>
}
