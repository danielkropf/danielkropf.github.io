import { lazy, Suspense, useState } from 'react'
import { RequireSave } from '../components/RequireSave'

const ImportsPage = lazy(() => import('../pages/ImportsPage').then(module => ({ default: module.ImportsPage })))

export function ImportModal({ close }: { close: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false)

  return <>
    <div className="settings-overlay import-overlay" onClick={close}>
      <section className="settings-modal import-modal" role="dialog" aria-modal="true" aria-label="Import" onClick={event => event.stopPropagation()}>
        <div className="import-modal-actions">
          <button className="ghost import-history-trigger" type="button" onClick={() => setHistoryOpen(true)}>Histórico</button>
          <button className="close import-modal-close" type="button" aria-label="Fechar import" onClick={close}>×</button>
        </div>
        <div className="import-modal-content">
          <Suspense fallback={<div className="route-loading" role="status">Carregando importação…</div>}><RequireSave><ImportsPage /></RequireSave></Suspense>
        </div>
      </section>
    </div>
    {historyOpen && <div className="settings-overlay import-history-overlay" onClick={() => setHistoryOpen(false)}>
      <section className="settings-modal import-history-modal" role="dialog" aria-modal="true" aria-label="Histórico de imports" onClick={event => event.stopPropagation()}>
        <button className="close import-history-close" type="button" aria-label="Fechar histórico" onClick={() => setHistoryOpen(false)}>×</button>
        <div className="import-history-modal-content">
          <Suspense fallback={<div className="route-loading" role="status">Carregando histórico…</div>}><RequireSave><ImportsPage mode="history" /></RequireSave></Suspense>
        </div>
      </section>
    </div>}
  </>
}
