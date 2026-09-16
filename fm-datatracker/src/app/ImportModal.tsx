import { lazy, Suspense } from 'react'
import { RequireSave } from '../components/RequireSave'
const ImportsPage = lazy(() => import('../pages/ImportsPage').then(module => ({ default: module.ImportsPage })))
export function ImportModal({ close }: { close: () => void }) {
  return <div className="settings-overlay import-overlay" onClick={close}>
    <section className="settings-modal import-modal" role="dialog" aria-modal="true" aria-label="Import" onClick={event => event.stopPropagation()}>
      <div className="import-modal-actions"><button className="close import-modal-close" type="button" aria-label="Fechar import" onClick={close}>×</button></div>
      <div className="import-modal-content"><Suspense fallback={<div className="route-loading" role="status">Carregando importações…</div>}><RequireSave><ImportsPage /></RequireSave></Suspense></div>
    </section>
  </div>
}
