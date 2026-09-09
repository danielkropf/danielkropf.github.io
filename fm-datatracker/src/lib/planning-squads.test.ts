import { describe, expect, it } from 'vitest'
import type { FlexiblePlanning } from './planningSets'
import { effectivePlanningSquadGroupId, movePlayerToPlanningSquad, reconcilePlanningSquadGroups } from './planning-squads'

const base = (): FlexiblePlanning => ({
  groups: [{ id: 'principal', name: 'Principal' }, { id: 'b', name: 'Time B' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }],
  slotAssignments: { principal: { st: ['p1'] }, b: { st: ['p2'] }, loan: { market: ['p1'] }, sale: { market: [] } },
})

describe('planning squads', () => {
  it('uses factual squad as default without creating a manual override', () => {
    const planning = reconcilePlanningSquadGroups(base(), ['Numancia', 'Numancia B'])
    const target = effectivePlanningSquadGroupId(planning, 'new-player', 'Numancia B', 'reserve')
    expect(planning.groups.find(group => group.id === target)?.name).toBe('Numancia B')
    expect(planning.squadAssignments).toBeUndefined()
  })

  it('moves a player between squads while preserving market intent', () => {
    const planning = base()
    const moved = movePlayerToPlanningSquad(planning, 'p1', 'b')
    expect(moved.squadAssignments?.p1).toBe('b')
    expect(moved.slotAssignments.principal.st).toEqual([])
    expect(moved.slotAssignments.loan.market).toEqual(['p1'])
  })

  it('renames a legacy squad group in place when its players have one unequivocal factual squad', () => {
    const planning = base()
    const reconciled = reconcilePlanningSquadGroups(
      planning,
      ['Numancia', 'Numancia B'],
      new Map([['p1', 'Numancia'], ['p2', 'Numancia B']]),
    )
    expect(reconciled.groups.find(group => group.id === 'principal')?.name).toBe('Numancia')
    expect(reconciled.groups.find(group => group.id === 'b')?.name).toBe('Numancia B')
    expect(reconciled.slotAssignments.principal.st).toEqual(['p1'])
    expect(reconciled.slotAssignments.b.st).toEqual(['p2'])
  })

  it('does not rename a legacy group when factual squads are mixed or a manual squad override targets it', () => {
    const planning = base()
    planning.slotAssignments.principal.st = ['p1', 'p3']
    const mixed = reconcilePlanningSquadGroups(planning, ['Numancia', 'Numancia B'], new Map([['p1', 'Numancia'], ['p3', 'Numancia B']]))
    expect(mixed.groups.find(group => group.id === 'principal')?.name).toBe('Principal')

    const manual = { ...base(), squadAssignments: { p1: 'principal' } }
    const overridden = reconcilePlanningSquadGroups(manual, ['Numancia'], new Map([['p1', 'Numancia']]))
    expect(overridden.groups.find(group => group.id === 'principal')?.name).toBe('Principal')
  })

  it('reconciles factual squad names and removes only empty stale groups', () => {
    const planning = base()
    planning.slotAssignments.principal.st = []
    const reconciled = reconcilePlanningSquadGroups(planning, ['Numancia', 'Numancia B'])
    expect(reconciled.groups.map(group => group.name)).toContain('Numancia')
    expect(reconciled.groups.map(group => group.name)).toContain('Numancia B')
    expect(reconciled.groups.map(group => group.name)).not.toContain('Principal')
    expect(reconciled.groups.map(group => group.name)).toContain('Time B')
    expect(reconciled.groups.map(group => group.name)).toContain('Empréstimo')
  })
})
