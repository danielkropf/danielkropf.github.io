import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('FM26 offline tactic normalization', () => {
  it('exposes only resolved human-manager tactics with source identity fields', () => {
    const result = normalizeOfflineFmResult({ human_managers: [
      { manager: { display_name: 'Manager' }, human_eid: 111, human_record_offset: 222, human_club: { root_team_id: 333 }, tactic: { resolved: true, name: '4-2-3-1', record_start: 444, slots: [] }, players: [] },
      { manager: { display_name: 'Other' }, human_eid: 555, human_club: { root_team_id: 666 }, tactic: { resolved: false }, players: [] },
    ] })
    expect(result.tactics).toHaveLength(1)
    expect(result.tactics[0]).toMatchObject({ manager_index: 0, manager_name: 'Manager', human_eid: 111, human_record_offset: 222, root_team_id: 333, resolved: true, name: '4-2-3-1', record_start: 444 })
  })
})
