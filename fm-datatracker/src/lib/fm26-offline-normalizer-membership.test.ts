import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('E-MC-01A normalizer persistence fence', () => {
  it('exposes membership_facts_v1 as a reader sidecar without leaking it into persisted JSON payloads', () => {
    const envelope = {
      schema: 'membership_facts_v1',
      version: 'e-mc-01-v1',
      resolved: { owner_organization: { status: 'confirmed', value: { organization_key: 'org:1' } } },
    }
    const player: Record<string, unknown> = {
      eid: 123,
      uid: 900123,
      display_name: 'Fixture Player',
      identity_link_confidence: 'high',
      birth_date: '2000-01-01',
      positions: { MC: 20 },
      feet: { left: 50, right: 100, left_raw: 50, right_raw: 100 },
      roster_group: { label: 'Principal', team_id: 679, primary: true },
      current_contract: { team_id: 679, team_name: 'Legacy Team', expiry_date: '2029-06-30', terms: [] },
      loan: { status: 'none', from_team_id: 679, from_team_name: 'Legacy Team' },
      membership_facts_v1: envelope,
      arbitrary_legacy_key: { preserved: true },
    }

    const read = normalizeOfflineFmResult({
      save: { current_date: '2025-08-01' },
      human_managers: [{
        manager: { display_name: 'Manager' },
        human_club: { root_team_id: 679, roster_groups: [] },
        players: [player],
      }],
    })

    expect(read.players).toHaveLength(1)
    const [row] = read.players
    expect(row.membership_facts_v1).toEqual(envelope)
    expect(row.raw_data).not.toHaveProperty('membership_facts_v1')
    expect(row.normalized_data).not.toHaveProperty('membership_facts_v1')
    expect(row.raw_data.arbitrary_legacy_key).toEqual({ preserved: true })
    expect(row.club).toBe('Legacy Team')
    expect(row.normalized_data.contract_current_team_id).toBe(679)
    expect(row.normalized_data.loan_status).toBe('none')
  })
})
