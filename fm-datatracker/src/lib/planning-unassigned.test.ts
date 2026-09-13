import { expect, it } from 'vitest'
import { bestEligibleTacticPosition, unassignedSquadPlayerIds } from './planning-unassigned'

it('chooses the highest known score among eligible tactic slots, with stable ties', () => {
  const candidates = [
    { slotId: 'striker', position: 'ST', familiar: false, score: 20 },
    { slotId: 'midfield', position: 'MC', familiar: true, score: 13 },
    { slotId: 'defence', position: 'DC', familiar: true, score: 11 },
    { slotId: 'tie', position: 'DM', familiar: true, score: 13 },
    { slotId: 'unknown', position: 'GK', familiar: true, score: null },
  ]
  expect(bestEligibleTacticPosition(candidates)).toBe(candidates[1])
  expect(bestEligibleTacticPosition([candidates[0], candidates[4]])).toBeNull()
  expect(bestEligibleTacticPosition([{ ...candidates[1], score: NaN }])).toBeNull()
})

it('includes only observed members of this squad without a set allocation', () => {
  expect(unassignedSquadPlayerIds([
    { id: 'free', squadId: 'A', observed: true },
    { id: 'allocated', squadId: 'A', observed: true },
    { id: 'other', squadId: 'B', observed: true },
    { id: 'old', squadId: 'A', observed: false },
    { id: 'unknown', squadId: null, observed: true },
  ], 'A', { defence: ['allocated'] })).toEqual(['free'])
})
