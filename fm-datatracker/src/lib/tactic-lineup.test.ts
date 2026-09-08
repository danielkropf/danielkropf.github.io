import { describe, expect, it } from 'vitest'
import { assignPlayerToTacticSlot, tacticSlotForPlayer } from './tactic-lineup'

const tactic = {
  id: 't1', name: 'Principal',
  ipAssignments: [
    { playerId: 'p0', nodeId: 'gk', position: 'GK', roleCode: 'GK' },
    { playerId: 'p1', nodeId: 'stc', position: 'ST (C)', roleCode: 'CF' },
  ],
  oopAssignments: [],
  lineup: { p0: 'keeper', p1: 'striker' },
}

describe('tactic lineup helpers', () => {
  it('finds the slot occupied by a player', () => {
    expect(tacticSlotForPlayer(tactic, 'striker')).toBe('p1')
    expect(tacticSlotForPlayer(tactic, 'missing')).toBeNull()
  })

  it('moves a player without allowing the same player in two slots', () => {
    const moved = assignPlayerToTacticSlot(tactic, 'striker', 'p0')
    expect(moved.lineup).toEqual({ p0: 'striker', p1: null })
  })

  it('unassigns the player when slot is null', () => {
    const moved = assignPlayerToTacticSlot(tactic, 'striker', null)
    expect(moved.lineup).toEqual({ p0: 'keeper', p1: null })
  })
})
