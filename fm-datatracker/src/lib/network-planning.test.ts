import { describe, expect, it } from 'vitest'
import { deriveNetworkBalance, globalPlannedClubIndex } from './network-planning'

describe('network planning', () => {
  const config = {
    planning_by_club: {
      a: { slotAssignments: { principal: { gk: ['p1'], st: ['p2', 'p3'] } } },
      b: { slotAssignments: { principal: { gk: ['p4'] }, loan: { market: ['p2'] } } },
    },
    tactics: [{ id: 't', name: 'Principal', ipAssignments: [{ nodeId: 'gk', position: 'GK' }, { nodeId: 'st', position: 'ST (C)' }] }],
    selected_tactic_id_by_club: { a: 't', b: 't' },
  }

  it('derives needs from actual tactic slots without treating market groups as depth', () => {
    const [a, b] = deriveNetworkBalance(['a', 'b'], config)
    expect(a.plannedPlayers).toBe(3)
    expect(a.balance).toBe(1)
    expect(a.needs.find(item => item.group === 'ST')?.balance).toBe(1)
    expect(b.plannedPlayers).toBe(1)
    expect(b.needs.find(item => item.group === 'ST')?.balance).toBe(-1)
  })

  it('keeps one global identity and exposes cross-club conflicts', () => {
    const index = globalPlannedClubIndex(config)
    expect(index.clubByPlayer.p1).toBe('a')
    expect(index.conflicts.p2).toEqual(['a', 'b'])
  })
})
