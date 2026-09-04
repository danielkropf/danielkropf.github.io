import { formatCheckpointDate, formatCheckpointWeekday } from '../lib/current-checkpoint'
import type { CurrentCheckpointState } from '../features/saves/SaveContext'

export function CurrentCheckpointCalendar({ checkpoint }: { checkpoint: CurrentCheckpointState }) {
  const readyDate = checkpoint.status === 'ready' ? checkpoint.date : null
  const date = formatCheckpointDate(readyDate)
  const weekday = formatCheckpointWeekday(readyDate)
  const state = checkpoint.status === 'loading'
    ? { eyebrow: 'CHECKPOINT ATUAL', primary: 'Carregando…', detail: 'Sincronizando fotografia factual' }
    : checkpoint.status === 'error'
      ? { eyebrow: 'CHECKPOINT ATUAL', primary: 'Indisponível', detail: checkpoint.error ?? 'Não foi possível resolver a data atual' }
      : date
        ? { eyebrow: 'CHECKPOINT ATUAL', primary: date, detail: weekday ?? 'Fotografia factual atual' }
        : { eyebrow: 'CHECKPOINT ATUAL', primary: 'Sem snapshot', detail: 'Nenhuma fotografia autoritativa importada' }

  return <div className={`current-checkpoint-calendar is-${checkpoint.status}`} aria-live="polite" title={state.detail}>
    <span className="checkpoint-calendar-icon" aria-hidden="true"><i /><b /></span>
    <span className="checkpoint-calendar-copy"><small>{state.eyebrow}</small><strong>{state.primary}</strong><em>{state.detail}</em></span>
  </div>
}
