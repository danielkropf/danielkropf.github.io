import { describe, expect, it } from 'vitest'
import { normalizeOracleRoster, parseOracleRosterJson } from './fm26-reader'

describe('FM26 Oracle roster normalizer', () => {
  it('uses UniqueId rather than the untrusted reference Identifier', () => {
    const [player] = normalizeOracleRoster({ oracleVersion: '0.4.9', players: [{ rosterIndex: 0, reference: { uid: 'stale', identifier: 'stale' }, identity: { UniqueId: { value: '92039023' }, Name: { value: 'Joshua Kimmich' }, Height: { value: '177' }, PositionCombinedString: { value: 'DM, M (C)' }, Footedness: { value: 'Right' } }, attributes: { AttributePassing: { value: '18' }, AttributeStamina: { value: '17' } }, abilities: { AbilityDefensiveMidfielder: { value: '18' } }, otherProperties: { ClubAppearancesThisSeason: { value: '20' }, Minutes: { value: '1234' }, ExpectedGoals: { value: '1.2' } } }] })
    expect(player.fm_player_id).toBe('92039023')
    expect(player.height).toBe(177)
    expect(player.attributes.map(attribute => attribute.attribute_key)).toEqual(['passing', 'stamina'])
    expect(player.normalized_data.club_appearances_this_season).toBe(20)
    expect(player.normalized_data.season_stats).toMatchObject({ club_appearances_this_season: 20, minutes: 1234, expected_goals: 1.2 })
    expect(player.normalized_data.positional_abilities).toEqual({ defensive_midfielder: 18 })
    expect(player.normalized_data.current_ability_status).toBe('unsupported')
  })

  it('does not invent an identity when UniqueId is absent', () => {
    expect(normalizeOracleRoster({ players: [{ rosterIndex: 0, identity: { Name: { value: 'Unknown' } } }] })).toEqual([])
  })

  it('parses the PascalCase JSON emitted by the C# Oracle', () => {
    const batch = parseOracleRosterJson(JSON.stringify({ OracleVersion: '0.4.9', PlayerCountRead: 1, Players: [{ RosterIndex: 0, Reference: { UID: '92039023', Identifier: 'stale' }, Identity: { UniqueId: { Value: '92039023' }, Name: { Value: 'Joshua Kimmich' } }, Attributes: { AttributeStrength: { Value: '16' } }, Abilities: {}, OtherProperties: {} }] }))
    expect(normalizeOracleRoster(batch)[0].fm_player_id).toBe('92039023')
    expect(normalizeOracleRoster(batch)[0].attributes[0].source_column).toBe('Oracle:AttributeStrength')
  })

  it('rejects a partial roster rather than silently importing it', () => {
    expect(() => parseOracleRosterJson(JSON.stringify({ OracleVersion: '0.4.9', PlayerCountExpected: 2, PlayerCountRead: 1, Players: [{ RosterIndex: 0 }] }))).toThrow('incompleto')
  })

  it('maps runtime-only international, personality, wage and value fields without treating them as binary mappings', () => {
    const [player] = normalizeOracleRoster({ players: [{ rosterIndex: 0, identity: { UniqueId: { value: '1' }, Name: { value: 'Ana' }, InternationalCapsAndGoalsString: { value: '31 caps / 4 goals' }, InternationalU21Caps: { value: '5' }, InternationalU21Goals: { value: '2' } }, otherProperties: { Personality: { value: 'Professional' }, TransferValueRange: { value: '€10M - €12M' }, ContextContractWeeklyWage: { value: '€50K p/w' } } }] })
    expect(player.normalized_data).toMatchObject({ personality: 'Professional', international: { senior: { caps: 31, goals: 4 }, u21_caps: 5, u21_goals: 2 }, transfer_value_range: '€10M - €12M', context_contract_weekly_wage: '€50K p/w' })
  })
})
