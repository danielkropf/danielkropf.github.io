import { derivePlanningClubIndex } from './multiclub-planning'
import { positionGroup } from './tactics'

export type NetworkPlanning = { groups?: Array<{ id: string; name: string }>; slotAssignments: Record<string, Record<string, string[]>> }
export type NetworkTactic = { id: string; name: string; ipAssignments: Array<{ nodeId: string; position: string }> }
export type NetworkConfig = {
  planning_by_club?: Record<string, NetworkPlanning>
  tactics?: NetworkTactic[]
  selected_tactic_id_by_club?: Record<string, string | null>
}
export type NetworkNeed = { group: string; required: number; filled: number; balance: number }
export type NetworkClubBalance = {
  clubId: string
  tacticName: string | null
  plannedPlayers: number
  requiredSlots: number
  balance: number
  needs: NetworkNeed[]
}

const MARKET_GROUPS = new Set(['loan', 'sale'])

export function deriveNetworkBalance(clubIds: string[], config: NetworkConfig): NetworkClubBalance[] {
  return clubIds.map(clubId => {
    const planning = config.planning_by_club?.[clubId]
    const tacticId = config.selected_tactic_id_by_club?.[clubId] ?? null
    const tactic = config.tactics?.find(item => item.id === tacticId) ?? null
    const plannedIds = new Set<string>()
    const filledBySlot = new Map<string, number>()
    for (const [groupId, slots] of Object.entries(planning?.slotAssignments ?? {})) {
      if (MARKET_GROUPS.has(groupId)) continue
      for (const [slotId, ids] of Object.entries(slots)) {
        const unique = [...new Set(ids.filter(Boolean))]
        unique.forEach(id => plannedIds.add(id))
        filledBySlot.set(slotId, (filledBySlot.get(slotId) ?? 0) + unique.length)
      }
    }
    const requirements = new Map<string, { required: number; filled: number }>()
    for (const assignment of tactic?.ipAssignments ?? []) {
      const group = positionGroup(assignment.position)
      const value = requirements.get(group) ?? { required: 0, filled: 0 }
      value.required += 1
      value.filled += filledBySlot.get(assignment.nodeId) ?? 0
      requirements.set(group, value)
    }
    const needs = [...requirements].map(([group, value]) => ({ group, ...value, balance: value.filled - value.required }))
    const requiredSlots = tactic?.ipAssignments.length ?? 0
    return { clubId, tacticName: tactic?.name ?? null, plannedPlayers: plannedIds.size, requiredSlots, balance: plannedIds.size - requiredSlots, needs }
  })
}

export function globalPlannedClubIndex(config: NetworkConfig) {
  return derivePlanningClubIndex(config.planning_by_club ?? {})
}
