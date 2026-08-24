import { describe, expect, it } from 'vitest'
import { normalizeOfflineFmResult } from './fm26-offline-normalizer'

describe('FM26 offline result normalizer', () => {
  it('keeps every decoded stat and maps the validated player fields without runtime data', () => {
    const result = normalizeOfflineFmResult({ save: { current_date: '2025-01-01' }, parser: { version: '0.22.0' }, humans_summary: { total_players_across_human_clubs: 1 }, human_managers: [{ manager: { display_name: 'Manager' }, players: [{ uid: 92039023, eid: 12630, display_name: 'Joshua Kimmich', identity_link_confidence: 'high', birth_date: '1995-02-08', nation: 'Germany', height_cm: 177, positions: { DM: 20, MC: 18 }, feet: { left: 14, right: 20 }, attributes_1_20: { Passing: 18, Stamina: 17, Teamwork: 16, 'Punching Tendency': 11 }, statistics: { minutes: 1234, goals: 3, contexts: [{ minutes: 900 }] }, tactic: { slot: 4, ip: { position: 'DM' } }, contract_team_id: 679, contract_offset: 1234, roster_group: { label: 'Principal', team_id: 1993 } }] }] })
    expect(result.players).toHaveLength(1)
    expect(result.players[0]).toMatchObject({ fm_player_id: '92039023', preferred_foot: 'Right', positions: ['DM', 'MC'], height: 177, age: 29, squad: 'Principal' })
    expect(result.players[0].attributes.map(attribute => attribute.attribute_key)).toEqual(['passing', 'stamina', 'team_work', 'punching'])
    expect(result.players[0].statistics).toMatchObject({ minutes: 1234, contexts: [{ minutes: 900 }] })
    expect(result.players[0].normalized_data).toMatchObject({ source: 'fm26-save-offline', ca_pa_status: 'candidate_with_provenance_not_universally_validated' })
    expect(result.players[0].normalized_data).toMatchObject({ contracted_club_team_id: 679, contracted_club_contract_offset: 1234, contracted_club_status: 'confirmed_binary_contract_shape', roster_team_id: 1993 })
  })

  it('fails closed for an identity the binary reader marked untrusted', () => {
    const result = normalizeOfflineFmResult({ human_managers: [{ players: [{ uid: 1, display_name: 'Nearby name', identity_link_confidence: 'low' }] }] })
    expect(result.players).toEqual([])
  })
})
