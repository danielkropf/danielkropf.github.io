import { describe, expect, it } from 'vitest'
import { defaultPlanningSets, groupEquivalentSets, layoutsFor, movePlayerToSet, positionFamily, primarySetForPlayer, reorderPlanningSets, restoreDefaultPlanningSets, splitPlanningSet, type FlexiblePlanning } from './planningSets'

const slots = [
  { id: 'dc-l', position: 'DCL' },
  { id: 'dc-r', position: 'DCR' },
  { id: 'mc', position: 'MC' },
]
const base = (): FlexiblePlanning => ({ groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: { principal: { 'dc-l': ['a', 'b'], 'dc-r': ['c'], mc: ['d'] } } })

describe('flexible planning sets', () => {
  it('treats left/right central slots as equivalent without merging unrelated positions', () => {
    expect(positionFamily('DCL')).toBe('DC')
    expect(positionFamily('DCR')).toBe('DC')
    expect(positionFamily('MC')).toBe('MC')
  })

  it('groups repeated tactical positions without losing players and can split them again', () => {
    const sets = defaultPlanningSets(slots)
    const grouped = groupEquivalentSets(base(), 't1', 'principal', sets, 'dc-l', slots, 'centre-backs')
    const groupedSets = layoutsFor(grouped, 't1', 'principal', slots)
    expect(groupedSets[0]).toMatchObject({ id: 'centre-backs', slotIds: ['dc-l', 'dc-r'] })
    expect(grouped.slotAssignments.principal['centre-backs']).toEqual(['a', 'b', 'c'])
    const split = splitPlanningSet(grouped, 't1', 'principal', groupedSets, 'centre-backs', slots)
    expect(layoutsFor(split, 't1', 'principal', slots).map(set => set.id)).toEqual(['dc-l', 'dc-r', 'mc'])
    expect([...split.slotAssignments.principal['dc-l'], ...split.slotAssignments.principal['dc-r']].sort()).toEqual(['a', 'b', 'c'])
  })

  it('enforces one primary allocation when moving a player and preserves card order', () => {
    let planning = base()
    planning = movePlayerToSet(planning, 'principal', 'mc', 'a', 'd')
    expect(planning.slotAssignments.principal['dc-l']).toEqual(['b'])
    expect(planning.slotAssignments.principal.mc).toEqual(['a', 'd'])
    const sets = defaultPlanningSets(slots)
    expect(primarySetForPlayer(planning, 'principal', sets, 'a')?.id).toBe('mc')
  })

  it('persists custom row order and restores tactic order without dropping grouped players', () => {
    const sets = defaultPlanningSets(slots)
    let planning = reorderPlanningSets(base(), 't1', 'principal', sets, 'mc', 'dc-l')
    expect(layoutsFor(planning, 't1', 'principal', slots).map(set => set.id)).toEqual(['mc', 'dc-l', 'dc-r'])
    const grouped = groupEquivalentSets(planning, 't1', 'principal', layoutsFor(planning, 't1', 'principal', slots), 'dc-l', slots, 'cb')
    planning = restoreDefaultPlanningSets(grouped, 't1', 'principal', layoutsFor(grouped, 't1', 'principal', slots), slots)
    expect(layoutsFor(planning, 't1', 'principal', slots).map(set => set.id)).toEqual(['dc-l', 'dc-r', 'mc'])
    expect(Object.values(planning.slotAssignments.principal).flat().sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
