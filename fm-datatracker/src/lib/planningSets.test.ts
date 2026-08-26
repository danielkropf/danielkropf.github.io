import { describe, expect, it } from 'vitest'
import { canGroupAdjacentPlanningSets, defaultPlanningSets, groupAdjacentPlanningSets, groupEquivalentSets, layoutsFor, movePlayerToSet, planningSetDisplayLabel, planningSlotDisplayLabel, positionFamily, primarySetForPlayer, renamePlanningSet, renamePlanningSlotLabel, reorderPlanningGroups, reorderPlanningSets, restoreDefaultPlanningSets, splitPlanningSet, type FlexiblePlanning } from './planningSets'

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
    planning = reorderPlanningSets(planning, 't1', 'principal', layoutsFor(planning, 't1', 'principal', slots), 'mc', null)
    expect(layoutsFor(planning, 't1', 'principal', slots).map(set => set.id)).toEqual(['dc-l', 'dc-r', 'mc'])
    planning = reorderPlanningSets(planning, 't1', 'principal', layoutsFor(planning, 't1', 'principal', slots), 'mc', 'dc-l')
    const grouped = groupEquivalentSets(planning, 't1', 'principal', layoutsFor(planning, 't1', 'principal', slots), 'dc-l', slots, 'cb')
    planning = restoreDefaultPlanningSets(grouped, 't1', 'principal', layoutsFor(grouped, 't1', 'principal', slots), slots)
    expect(layoutsFor(planning, 't1', 'principal', slots).map(set => set.id)).toEqual(['dc-l', 'dc-r', 'mc'])
    expect(Object.values(planning.slotAssignments.principal).flat().sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('numbers identical ungrouped positions until the user gives them a custom label', () => {
    const repeated = [
      { id: 'mc-1', position: 'M(C)' },
      { id: 'mc-2', position: 'M(C)' },
      { id: 'st', position: 'ST(C)' },
    ]
    const sets = defaultPlanningSets(repeated)
    expect(planningSetDisplayLabel(sets[0], sets, repeated)).toBe('M(C) 1')
    expect(planningSetDisplayLabel(sets[1], sets, repeated)).toBe('M(C) 2')
    const renamed = renamePlanningSet({ groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: {} }, 't1', 'principal', sets, 'mc-1', 'MC esquerdo')
    const renamedSets = layoutsFor(renamed, 't1', 'principal', repeated)
    expect(planningSetDisplayLabel(renamedSets[0], renamedSets, repeated)).toBe('MC esquerdo')
  })

  it('reorders squads without touching their assignments', () => {
    const planning: FlexiblePlanning = {
      groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'base', name: 'Base' }],
      slotAssignments: { principal: { dc: ['a'] }, b: { dc: ['b'] } },
    }
    const reordered = reorderPlanningGroups(planning, 'base', 'principal')
    expect(reordered.groups.map(group => group.id)).toEqual(['base', 'principal', 'b'])
    expect(reordered.slotAssignments).toEqual(planning.slotAssignments)
  })

  it('only offers the final grouping interaction for adjacent compatible tactical slots', () => {
    const tacticalSlots = [
      { id: 'dc1', position: 'D(C)', oopPosition: 'D(C)' },
      { id: 'dc2', position: 'D(C)', oopPosition: 'D(C)' },
      { id: 'mc', position: 'M(C)', oopPosition: 'DM(C)' },
    ]
    const sets = defaultPlanningSets(tacticalSlots)
    expect(canGroupAdjacentPlanningSets(sets[0], sets[1], tacticalSlots)).toBe(true)
    expect(canGroupAdjacentPlanningSets(sets[1], sets[2], tacticalSlots)).toBe(false)
    const planning: FlexiblePlanning = { groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: { principal: { dc1: ['a'], dc2: ['b'], mc: ['c'] } } }
    const grouped = groupAdjacentPlanningSets(planning, 't1', 'principal', sets, 'dc1', 'dc2', tacticalSlots, 'cbs')
    expect(layoutsFor(grouped, 't1', 'principal', tacticalSlots)[0].slotIds).toEqual(['dc1', 'dc2'])
    expect(grouped.slotAssignments.principal.cbs).toEqual(['a', 'b'])
  })

  it('keeps a general group name and editable individual labels inside a grouped block', () => {
    const tacticalSlots = [{ id: 'dc1', position: 'D(C)' }, { id: 'dc2', position: 'D(C)' }]
    const sets = defaultPlanningSets(tacticalSlots)
    let planning: FlexiblePlanning = { groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: { principal: { dc1: [], dc2: [] } } }
    planning = groupAdjacentPlanningSets(planning, 't1', 'principal', sets, 'dc1', 'dc2', tacticalSlots, 'cbs')
    let grouped = layoutsFor(planning, 't1', 'principal', tacticalSlots)
    expect(grouped[0].label).toBe('Zagueiros')
    planning = renamePlanningSlotLabel(planning, 't1', 'principal', grouped, 'cbs', 'dc1', 'DC esquerdo')
    grouped = layoutsFor(planning, 't1', 'principal', tacticalSlots)
    expect(planningSlotDisplayLabel(grouped[0], 'dc1', tacticalSlots)).toBe('DC esquerdo')
    expect(planningSlotDisplayLabel(grouped[0], 'dc2', tacticalSlots)).toBe('D(C) 2')
  })

})
