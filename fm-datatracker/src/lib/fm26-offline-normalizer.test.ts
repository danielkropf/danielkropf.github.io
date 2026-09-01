import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('FM26 offline result normalizer', () => {
  it('reports whether a human manager club was structurally resolved', () => {
    const safe = normalizeOfflineFmResult({ human_managers: [{ human_club: { root_team_id: 679 }, players: [] }] })
    const unsafe = normalizeOfflineFmResult({ human_managers: [{ human_club: {}, players: [] }] })
    expect(safe.diagnostics).toMatchObject({ human_manager_count: 1, resolved_human_club_count: 1 })
    expect(unsafe.diagnostics).toMatchObject({ human_manager_count: 1, resolved_human_club_count: 0 })
  })

  it('keeps every decoded stat and maps the validated player fields without runtime data', () => {
    const result = normalizeOfflineFmResult({ save: { current_date: '2025-01-01' }, parser: { version: '0.22.0' }, humans_summary: { total_players_across_human_clubs: 1 }, human_managers: [{ manager: { display_name: 'Manager' }, players: [{ uid: 92039023, eid: 12630, display_name: 'Joshua Kimmich', identity_link_confidence: 'high', birth_date: '1995-02-08', nation: 'Germany', height_cm: 177, positions: { DM: 20, MC: 18 }, feet: { left: 14, right: 20 }, attributes_1_20: { Passing: 18, Stamina: 17, Teamwork: 16, 'Punching Tendency': 11 }, statistics: { minutes: 1234, goals: 3, contexts: [{ minutes: 900 }] }, tactic: { slot: 4, ip: { position: 'DM' } }, contract_team_id: 679, contract_offset: 1234, contract_team_name: 'FC Bayern München', contract_team_name_resolution: { status: 'confirmed', team_id: 679, team_key: 913 }, roster_group: { label: 'Principal', team_id: 1993, team_name: 'FC Bayern München II', team_name_resolution: { status: 'confirmed', team_id: 1993, team_key: 103286 } } }] }] })
    expect(result).toMatchObject({ snapshot_date: '2025-01-01', snapshot_date_precision: 'day' })
    expect(result.players).toHaveLength(1)
    expect(result.players[0]).toMatchObject({ fm_player_id: '92039023', preferred_foot: 'Right', positions: ['DM', 'MC'], height: 177, age: 29, squad: 'Principal' })
    expect(result.players[0].attributes.map(attribute => attribute.attribute_key)).toEqual(['passing', 'stamina', 'team_work', 'punching'])
    expect(result.players[0].statistics).toMatchObject({ minutes: 1234, contexts: [{ minutes: 900 }] })
    expect(result.players[0].normalized_data).toMatchObject({ source: 'fm26-save-offline', ca_pa_status: 'candidate_with_provenance_not_universally_validated' })
    expect(result.players[0].normalized_data).toMatchObject({ contracted_club_team_id: 679, contracted_club_contract_offset: 1234, contracted_club_status: 'confirmed_binary_contract_shape', roster_team_id: 1993 })
    expect(result.players[0].normalized_data).toMatchObject({ contract_team_name: 'FC Bayern München', contract_team_semantics_status: 'owner_unresolved_person_team_relation', roster_team_name: 'FC Bayern München II' })
  })

  it('normalizes the resolved current contract and preserves future/relationship/loan data separately', () => {
    const result = normalizeOfflineFmResult({ save: { current_date: '2025-07-21' }, human_managers: [{ players: [{ uid: 101, eid: 1, display_name: 'Contract Player', identity_link_confidence: 'high', current_contract: { team_id: 449, team_name: 'Chelsea', weekly_wage: 120000, joined_date: '2023-07-01', signed_or_effective_date: '2023-07-01', expiry_date: '2031-06-30', terms_status: 'resolved', terms: [{ type_id: 0x26, semantic_label: null }] }, future_contracts: [{ team_id: 777, signed_or_effective_date: '2032-07-01' }], contract_relationships: [{ team_id: 679, classification: 'loan_current' }], loan: { status: 'current', from_team_id: 449, from_team_name: 'Chelsea', to_team_id: 679, to_team_name: 'FC Bayern München', start_date: '2025-07-21', end_date: '2026-06-30' }, roster_group: { label: 'Principal', team_id: 679 } }] }] })
    expect(result.players[0]).toMatchObject({ club: 'Chelsea', contract_expiry: '2031-06-30' })
    expect(result.players[0].normalized_data).toMatchObject({
      contract_current_team_id: 449,
      contract_current_team_name: 'Chelsea',
      contract_weekly_wage: 120000,
      contract_joined_date: '2023-07-01',
      contract_signed_or_effective_date: '2023-07-01',
      contract_expiry_date: '2031-06-30',
      loan_status: 'current',
      loan_from_team_id: 449,
      loan_to_team_id: 679,
      market_value: null,
      market_value_status: 'unresolved',
    })
    expect(result.players[0].normalized_data.future_contracts).toHaveLength(1)
    expect(result.players[0].normalized_data.contract_relationships).toHaveLength(1)
    expect(result.players[0].normalized_data.contract_terms).toHaveLength(1)
  })

  it('fails closed for an identity the binary reader marked untrusted', () => {
    const result = normalizeOfflineFmResult({ human_managers: [{ players: [{ uid: 1, display_name: 'Nearby name', identity_link_confidence: 'low' }] }] })
    expect(result.players).toEqual([])
  })

  it('does not invent day precision or age from a year-only fallback', () => {
    const result = normalizeOfflineFmResult({ human_managers: [{ human_club: { roster_groups: [{ league_history: { latest_year: 2025 } }] }, players: [{ uid: 7, display_name: 'Player', identity_link_confidence: 'high', birth_date: '2000-12-31' }] }] })
    expect(result).toMatchObject({ snapshot_date: '2025-01-01', snapshot_date_precision: 'year' })
    expect(result.players[0].age).toBeNull()
  })
})
