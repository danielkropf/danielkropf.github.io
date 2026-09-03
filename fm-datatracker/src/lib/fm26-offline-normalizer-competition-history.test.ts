import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('E-TC-01 normalizer sidecar fence', () => {
  it('exposes competition_history top-level while preserving membership sidecar and player persistence fences', () => {
    const competitionHistory = {
      version: 'fm26-competition-history-v1',
      status: 'partial',
      seasons: [{ season_end_year: 2028, competition_id_raw: 51 }],
      diagnostics: { warnings: ['synthetic'] },
    }
    const membershipFacts = {
      schema: 'membership_facts_v1',
      version: 'e-mc-01-v1',
      resolved: {},
    }

    const result = normalizeOfflineFmResult({
      competition_history: competitionHistory,
      save: { current_date: '2028-06-30' },
      human_managers: [{
        manager: { display_name: 'Manager' },
        players: [{
          eid: 1,
          uid: 100001,
          display_name: 'Fixture Player',
          identity_link_confidence: 'high',
          birth_date: '2000-01-01',
          positions: {},
          feet: {},
          attributes_1_20: {},
          roster_group: { label: 'Principal' },
          membership_facts_v1: membershipFacts,
        }],
      }],
    })

    expect(result.competition_history).toEqual(competitionHistory)
    expect(result.players[0].membership_facts_v1).toEqual(membershipFacts)
    expect(result.players[0].raw_data).not.toHaveProperty('membership_facts_v1')
    expect(result.players[0].normalized_data).not.toHaveProperty('membership_facts_v1')
    expect(result.players[0].raw_data).not.toHaveProperty('competition_history')
    expect(result.players[0].normalized_data).not.toHaveProperty('competition_history')
  })


  it('fails closed for an unversioned or incompatible competition_history object', () => {
    const result = normalizeOfflineFmResult({
      competition_history: {
        version: 'fm26-competition-history-v0',
        status: 'confirmed',
        seasons: [],
        diagnostics: { warnings: [] },
      },
      human_managers: [],
    })

    expect(result.competition_history).toBeNull()
  })

})
