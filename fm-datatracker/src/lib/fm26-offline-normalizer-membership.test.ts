import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('E-MC-01B normalizer persistence fence', () => {
  it('exposes factual + compact persistence sidecars without leaking either into snapshot JSON payloads', () => {
    const fact = (status: string, value: unknown, reason_code = 'fixture') => ({ status, reason_code, value, evidence_refs: ['game_db.dat@42'] })
    const organization = {
      organization_ref: 'game_db.dat@100',
      organization_team_ids: [679, 16125, 1993],
      record_offset: 100,
      evidence_team_id_raw: 679,
      evidence_team_name_raw: 'Legacy Team',
      evidence_team_name_status: 'confirmed',
    }
    const envelope = {
      schema: 'membership_facts_v1',
      version: 'e-mc-01-v1',
      provenance: { checkpoint_date: '2025-08-01' },
      raw_structural_membership: {
        team_id_raw: 679, team_name_raw: 'Legacy Team', roster_group_label_raw: 'Principal',
        roster_group_index_raw: 0, roster_group_primary_raw: true,
      },
      resolved_membership_facts: {
        structural_team: fact('confirmed', { team_id_raw: 679, team_name_raw: 'Legacy Team', roster_group_label_raw: 'Principal' }),
        structural_squad: fact('confirmed', { label_raw: 'Principal', index_raw: 0 }),
        organization_identity: fact('confirmed', organization),
        team_level: fact('confirmed', 'first_team'),
        current_organization: fact('confirmed', organization),
        owner_organization: fact('confirmed', organization),
        is_loan: fact('confirmed', false),
        loan_from_organization: fact('unknown', null),
        loan_to_organization: fact('unknown', null),
        current_standard_contract: fact('confirmed', { team_id_raw: 679 }),
        future_standard_contracts: fact('confirmed', []),
        contract_expiry: fact('confirmed', '2029-06-30'),
        joined_or_start_date: fact('unknown', null),
        signed_or_effective_date: fact('unknown', null),
      },
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
    expect(row.membership_persistence_v1).toMatchObject({
      facts_schema: 'membership_facts_v1', facts_version: 'e-mc-01-v1', sync_version: 'e-mc-01b-v1',
      fm_player_id: '900123', checkpoint_date: '2025-08-01',
    })
    expect(row.membership_persistence_v1?.organization_identity.value?.organization_team_ids).toEqual([679, 1993, 16125])
    expect(row.raw_data).not.toHaveProperty('membership_facts_v1')
    expect(row.raw_data).not.toHaveProperty('membership_persistence_v1')
    expect(row.normalized_data).not.toHaveProperty('membership_facts_v1')
    expect(row.normalized_data).not.toHaveProperty('membership_persistence_v1')
    expect(row.raw_data.arbitrary_legacy_key).toEqual({ preserved: true })
    expect(row.club).toBe('Legacy Team')
    expect(row.normalized_data.contract_current_team_id).toBe(679)
    expect(row.normalized_data.loan_status).toBe('none')
  })
})
