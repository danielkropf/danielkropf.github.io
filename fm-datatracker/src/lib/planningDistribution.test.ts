import { describe, expect, it } from 'vitest'
import { derivePlanningDistribution } from './planningDistribution'

function ids(prefix: string, start: number, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}${start + index}`)
}

describe('derivePlanningDistribution', () => {
  it('uses slotAssignments as the only source of truth', () => {
    const active = ids('p', 1, 65)
    const principal = ids('p', 1, 25)
    const b = ids('p', 26, 20)
    const base = ids('p', 46, 10)
    const loan = ids('p', 56, 3)
    const sale = ids('p', 59, 2)

    const result = derivePlanningDistribution(active, {
      groups: [
        { id: 'principal', name: 'Principal' },
        { id: 'b', name: 'Time B' },
        { id: 'base', name: 'Base' },
        { id: 'loan', name: 'Empréstimo' },
        { id: 'sale', name: 'Venda' },
      ],
      slotAssignments: {
        principal: { a: principal },
        b: { a: b },
        base: { a: base },
        loan: { market: loan },
        sale: { market: sale },
      },
    })

    expect(result.active).toBe(65)
    expect(result.assigned).toBe(60)
    expect(result.unassigned).toBe(5)
    expect(Object.fromEntries(result.groups.map(group => [group.id, group.count]))).toEqual({
      principal: 25,
      b: 20,
      base: 10,
      loan: 3,
      sale: 2,
    })
  })

  it('never counts one player twice', () => {
    const result = derivePlanningDistribution(['p1', 'p2', 'p3'], {
      groups: [
        { id: 'principal', name: 'Principal' },
        { id: 'b', name: 'Time B' },
      ],
      slotAssignments: {
        principal: { a: ['p1', 'p1', 'p2'] },
        b: { a: ['p2', 'p3'] },
      },
    })

    expect(result.assigned).toBe(3)
    expect(result.unassigned).toBe(0)
    expect(result.groups.find(group => group.id === 'principal')?.count).toBe(2)
    expect(result.groups.find(group => group.id === 'b')?.count).toBe(1)
    expect(result.duplicatePlayerIds).toEqual(['p2'])
  })
})
