import { togglePlayerMarketFlag } from './planningSets'
import { describe, expect, it } from 'vitest'
import { canGroupAdjacentPlanningSets, defaultPlanningSets, groupAdjacentPlanningSets, groupEquivalentSets, layoutsFor, movePlanningSetVisualGrid, movePlayerToSet, PLANNING_VISUAL_GOALKEEPER_Y, PLANNING_VISUAL_GRID_ROWS, planningSetDisplayLabel, planningSlotDisplayLabel, planningVisualGridCellForSet, positionFamily, primarySetForPlayer, renamePlanningSet, renamePlanningSlotLabel, reorderPlanningGroups, reorderPlanningSets, restoreDefaultPlanningSets, restorePlanningSetVisualGrid, splitPlanningSet, type FlexiblePlanning } from './planningSets'

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


  it('updates an automatic single-set label and numbering from the current tactic structure', () => {
    const original = [{ id: 'moving', position: 'DM(C)', x: 50 }]
    const stored = defaultPlanningSets(original)
    expect(stored[0].label).toBe('DM(C)')

    const moved = [
      { id: 'left', position: 'M(C)', x: 29 },
      { id: 'moving', position: 'M(C)', x: 50 },
      { id: 'right', position: 'M(C)', x: 71 },
    ]
    const reconciled = layoutsFor({ groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: {}, setLayouts: { t1: { principal: stored } } }, 't1', 'principal', moved)
    expect(planningSetDisplayLabel(reconciled.find(set => set.id === 'moving')!, reconciled, moved)).toBe('M(C) 2')
  })

  it('preserves an explicit custom set label when the tactic position moves', () => {
    const original = [{ id: 'moving', position: 'DM(C)', x: 29 }]
    const sets = defaultPlanningSets(original)
    const renamed = renamePlanningSet({ groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: {} }, 't1', 'principal', sets, 'moving', 'Volante construtor')
    const stored = layoutsFor(renamed, 't1', 'principal', original)
    const moved = [{ id: 'moving', position: 'M(C)', x: 50 }]
    expect(planningSetDisplayLabel(stored[0], stored, moved)).toBe('Volante construtor')
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


  it('moves a set freely across the 5x5 visual grid and swaps an occupied cell without changing tactical slots or allocations', () => {
    const tacticalSlots = [
      { id: 'left', position: 'D(C)', x: 29 },
      { id: 'centre', position: 'D(C)', x: 50 },
      { id: 'right', position: 'D(C)', x: 71 },
    ]
    const sets = defaultPlanningSets(tacticalSlots)
    const planning: FlexiblePlanning = {
      groups: [{ id: 'principal', name: 'Principal' }],
      slotAssignments: { principal: { left: ['a'], centre: ['b'], right: ['c'] } },
    }
    const moved = movePlanningSetVisualGrid(planning, 't1', 'principal', sets, 'left', { row: 2, column: 3 }, {
      left: { row: 5, column: 2 }, centre: { row: 2, column: 3 }, right: { row: 5, column: 4 },
    })
    const movedSets = layoutsFor(moved, 't1', 'principal', tacticalSlots)
    expect(movedSets.find(set => set.id === 'left')).toMatchObject({ slotIds: ['left'], visualGridRow: 2, visualGridColumn: 3 })
    expect(movedSets.find(set => set.id === 'centre')).toMatchObject({ slotIds: ['centre'], visualGridRow: 5, visualGridColumn: 2 })
    expect(moved.slotAssignments).toEqual(planning.slotAssignments)
  })

  it('clamps visual grid moves, migrates a legacy horizontal anchor, and restores tactic-derived cells independently', () => {
    const tacticalSlots = [{ id: 'dm', position: 'DM(C)', x: 50 }, { id: 'mc', position: 'M(C)', x: 50 }]
    const sets = [{ ...defaultPlanningSets(tacticalSlots)[0], visualAnchorX: 90 }, defaultPlanningSets(tacticalSlots)[1]]
    expect(planningVisualGridCellForSet(sets[0], 50, 'dm')).toEqual({ row: 4, column: 5 })
    const planning: FlexiblePlanning = { groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: { principal: { dm: ['a'], mc: ['b'] } } }
    const moved = movePlanningSetVisualGrid(planning, 't1', 'principal', sets, 'dm', { row: 99, column: -2 }, {
      dm: { row: 4, column: 5 }, mc: { row: 3, column: 3 },
    })
    const movedSets = layoutsFor(moved, 't1', 'principal', tacticalSlots)
    expect(movedSets.find(set => set.id === 'dm')).toMatchObject({ visualGridRow: 5, visualGridColumn: 1 })
    expect(movedSets.find(set => set.id === 'dm')?.visualAnchorX).toBeUndefined()
    const restored = restorePlanningSetVisualGrid(moved, 't1', 'principal', movedSets)
    const restoredSets = layoutsFor(restored, 't1', 'principal', tacticalSlots)
    expect(restoredSets.map(set => ({ id: set.id, row: set.visualGridRow, column: set.visualGridColumn, legacy: set.visualAnchorX }))).toEqual([
      { id: 'dm', row: undefined, column: undefined, legacy: undefined },
      { id: 'mc', row: undefined, column: undefined, legacy: undefined },
    ])
    expect(restored.slotAssignments).toEqual(planning.slotAssignments)
  })

  it('reserves an equal sixth visual row for the goalkeeper without expanding the free outfield grid', () => {
    const centres = [...PLANNING_VISUAL_GRID_ROWS, PLANNING_VISUAL_GOALKEEPER_Y]
    expect(centres).toHaveLength(6)
    expect(centres[0]).toBeCloseTo(100 / 12, 3)
    expect(centres[5]).toBeCloseTo(1100 / 12, 3)
    for (let index = 1; index < centres.length; index += 1) {
      expect(centres[index] - centres[index - 1]).toBeCloseTo(100 / 6, 3)
    }
    expect(planningVisualGridCellForSet(defaultPlanningSets([{ id: 'st', position: 'ST(C)', x: 50 }])[0], 50, 'st').row).toBe(1)
  })

})

it('keeps market intent independent from tactical placement in both directions', () => {
  let planning: FlexiblePlanning = { groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'B' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: { principal: { st: ['p'] } } }
  planning = movePlayerToSet(planning, 'sale', 'market', 'p')
  expect(planning.slotAssignments.principal.st).toEqual(['p'])
  expect(planning.slotAssignments.sale.market).toEqual(['p'])
  planning = movePlayerToSet(planning, 'b', 'mc', 'p')
  expect(planning.slotAssignments.principal.st).toEqual([])
  expect(planning.slotAssignments.b.mc).toEqual(['p'])
  expect(planning.slotAssignments.sale.market).toEqual(['p'])
  planning = movePlayerToSet(planning, 'loan', 'market', 'p')
  expect(planning.slotAssignments.b.mc).toEqual(['p'])
  expect(planning.slotAssignments.sale.market).toEqual(['p'])
  expect(planning.slotAssignments.loan.market).toEqual(['p'])
})

it('toggles sale and loan independently without losing the tactical set', () => {
  const original: FlexiblePlanning = { groups: [{ id: 'principal', name: 'Principal' }], slotAssignments: { principal: { st: ['p'] } } }
  let next = togglePlayerMarketFlag(original, 'p', 'sale')
  next = togglePlayerMarketFlag(next, 'p', 'loan')
  expect(next.slotAssignments.sale.market).toEqual(['p'])
  expect(next.slotAssignments.loan.market).toEqual(['p'])
  next = togglePlayerMarketFlag(next, 'p', 'sale')
  expect(next.slotAssignments.sale.market).toEqual([])
  expect(next.slotAssignments.loan.market).toEqual(['p'])
  expect(next.slotAssignments.principal.st).toEqual(['p'])
  next = togglePlayerMarketFlag(next, 'p', 'loan')
  expect(next.slotAssignments.loan.market).toEqual([])
  expect(next.slotAssignments.principal.st).toEqual(['p'])
})
