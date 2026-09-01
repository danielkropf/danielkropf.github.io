import { describe, expect, it } from 'vitest'
import { historyEventText, historyYear, summarizeHistory } from './save-history'
import type { SaveHistoryEvent } from './longitudinal-service'

function event(overrides: Partial<SaveHistoryEvent> = {}): SaveHistoryEvent {
  return {
    id: 'e', save_id: 's', owner_id: 'o', event_type: 'player_first_seen', event_date: '2026-09-01',
    season_id: 'season', club_id: 'club', player_id: 'p', intake_class_id: null, source_kind: 'derived',
    source_import_id: null, source_snapshot_id: null, derivation_version: '1', provenance: {}, payload: {},
    created_at: '2026-09-01', club: null, season: { id: 'season', save_id: 's', owner_id: 'o', season_key: '2026-27', label: '2026/27', ordinal: 1, start_date: null, end_date: null, source_kind: 'derived', source_import_id: null, provenance: {}, created_at: '', updated_at: '' },
    player: { id: 'p', current_name: 'Ana' }, intakeClass: null, ...overrides,
  }
}

describe('save history', () => {
  it('summarizes provenance without inventing narrative', () => {
    const rows = [event(), event({ id: 'm', source_kind: 'manual', season_id: null, club_id: null })]
    expect(summarizeHistory(rows)).toEqual({ total: 2, derived: 1, manual: 1, seasons: 1, clubs: 1 })
  })
  it('uses an explicit manual title and stable derived labels', () => {
    expect(historyEventText(event()).title).toBe('Ana apareceu no save')
    expect(historyEventText(event({ payload: { title: 'Campeão', detail: 'Final' } }))).toEqual({ title: 'Campeão', detail: 'Final' })
    expect(historyYear(event())).toBe('2026/27')
  })
})
