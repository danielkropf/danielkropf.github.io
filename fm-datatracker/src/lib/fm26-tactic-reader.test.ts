import { describe, expect, it } from 'vitest'
import { normalizeOracleTactic, parseOracleTacticJson } from './fm26-tactic-reader'

describe('FM26 Oracle tactic normalizer', () => {
  it('maps only the controlled Tempo values and preserves IP/OOP as unsupported', () => {
    const tactic = normalizeOracleTactic(parseOracleTacticJson(JSON.stringify({ OracleVersion: '0.4.9', SourceType: 'FM.UI.TeamTacticReference', BatchId: 'controlled', Results: [
      { PropertyName: 'Name', ResolvedValue: 'Positive 4-2-2-2' }, { PropertyName: 'MentalityString', ResolvedValue: 'Positive' },
      { PropertyName: 'CurrentTacticSlot', ResolvedValue: '0' }, { PropertyName: 'Tempo', PropertyId: 925972812, ResolvedValue: '1496610426' },
      { PropertyName: 'PassingDirectness', ResolvedValue: 'unknown-key' },
    ] })))
    expect(tactic.name).toBe('Positive 4-2-2-2')
    expect(tactic.instructions.tempo).toEqual({ status: 'confirmed', rawValue: '1496610426', value: 'standard' })
    expect(tactic.ip.status).toBe('unsupported')
    expect(tactic.raw_data.results).toHaveLength(5)
  })

  it('rejects a non-tactic channel batch', () => {
    expect(() => parseOracleTacticJson(JSON.stringify({ SourceType: 'FM.UI.PersonReference', Results: [] }))).toThrow('TeamTacticReference')
  })

  it('maps the controlled Much Lower Tempo value', () => {
    const tactic = normalizeOracleTactic(parseOracleTacticJson(JSON.stringify({ SourceType: 'FM.UI.TeamTacticReference', Results: [{ PropertyName: 'Tempo', ResolvedValue: '1498756423' }] })))
    expect(tactic.instructions.tempo).toEqual({ status: 'confirmed', rawValue: '1498756423', value: 'much_lower' })
  })

  it('preserves raw IP/OOP assignments only when every row carries a PlayerIndex', () => {
    const tactic = normalizeOracleTactic(parseOracleTacticJson(JSON.stringify({ SourceType: 'FM.UI.TeamTacticReference', Results: [{
      PropertyName: 'TacticalPositionsCombined',
      Collection: { Items: [{ Index: 0, DynamicReference: { Properties: [
        { PropertyName: 'PlayerIndex', ResolvedValue: '12630' },
        { PropertyName: 'TeamSelectionIndex', ResolvedValue: '3' },
        { PropertyName: 'IPPosition', ResolvedValue: '1024' }, { PropertyName: 'IPRole', ResolvedValue: '32' },
        { PropertyName: 'OOPPosition', ResolvedValue: '2097168' }, { PropertyName: 'OOPRole', ResolvedValue: '128' },
        { PropertyName: 'TacticalPositionShiftVertical', ResolvedValue: '0' }, { PropertyName: 'TacticalPositionShiftHorizontal', ResolvedValue: '-1' },
        { PropertyName: 'IsGoalkeeper', ResolvedValue: 'False' },
      ] } }] },
    }] })))
    expect(tactic.ip).toMatchObject({ status: 'raw_confirmed', assignments: [{ playerIndex: 12630, position: 1024, role: 32, horizontalShift: -1, isGoalkeeper: false }] })
    expect(tactic.oop.assignments).toEqual([{ playerIndex: 12630, teamSelectionIndex: 3, position: 2097168, role: 128, verticalShift: 0, horizontalShift: -1, isGoalkeeper: false }])
  })
})
