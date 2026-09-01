import type { SaveHistoryEvent } from './longitudinal-service'

export type HistorySummary = {
  total: number
  derived: number
  manual: number
  seasons: number
  clubs: number
}

export function summarizeHistory(events: SaveHistoryEvent[]): HistorySummary {
  return {
    total: events.length,
    derived: events.filter(event => event.source_kind !== 'manual').length,
    manual: events.filter(event => event.source_kind === 'manual').length,
    seasons: new Set(events.map(event => event.season_id).filter(Boolean)).size,
    clubs: new Set(events.map(event => event.club_id).filter(Boolean)).size,
  }
}

export function historyEventText(event: SaveHistoryEvent): { title: string; detail: string | null } {
  const payload = event.payload ?? {}
  const manualTitle = typeof payload.title === 'string' ? payload.title.trim() : ''
  const manualDetail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
  if (manualTitle) return { title: manualTitle, detail: manualDetail || null }

  const player = event.player?.current_name ?? 'Jogador'
  const titles: Record<string, string> = {
    player_first_seen: `${player} apareceu no save`,
    player_inactive: `${player} deixou a base ativa`,
    membership_changed: `${player} mudou de vínculo`,
    intake_entry: `${player} entrou na academia`,
    contract_changed: `Contrato de ${player} foi alterado`,
    planning_status_changed: `Planejamento de ${player} foi alterado`,
    transfer: `Transferência de ${player}`,
    loan: `Empréstimo de ${player}`,
    manual_fact: 'Fato registrado manualmente',
  }
  return { title: titles[event.event_type] ?? event.event_type, detail: null }
}

export function historyYear(event: SaveHistoryEvent) {
  const year = /^\d{4}/.exec(event.event_date)?.[0]
  return event.season?.label ?? year ?? 'Sem período'
}
