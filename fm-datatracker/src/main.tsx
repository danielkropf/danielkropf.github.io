import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './version.css'
import './planning.css'
import './tactics-fixes.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
