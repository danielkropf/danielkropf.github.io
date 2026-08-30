import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig({
  base: '/fm-datatracker/',
  plugins: [react()],
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.displayVersion ?? packageJson.version),
    __BUILD_ID__: JSON.stringify(process.env.VITE_BUILD_ID?.slice(0, 7) || 'local'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
