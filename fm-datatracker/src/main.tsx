import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app/styles/index.css'
import{applyAppearance,loadAppearance}from'./features/appearance/preferences'
applyAppearance(loadAppearance())
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
