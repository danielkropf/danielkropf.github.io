export type PlanningGroup = { id: string; name: string }
export type SlotAssignments = Record<string, Record<string, string[]>>
export type PlanningDistributionSource = {
  groups?: PlanningGroup[]
  slotAssignments?: SlotAssignments
}

export type PlanningDistributionGroup = {
  id: string
  name: string
  count: number
  playerIds: string[]
  kind: 'squad' | 'loan' | 'sale'
}

const REQUIRED_TRANSFER_GROUPS: PlanningGroup[] = [
  { id: 'loan', name: 'Empréstimo' },
  { id: 'sale', name: 'Venda' },
]

function groupKind(id: string): PlanningDistributionGroup['kind'] {
  if (id === 'loan') return 'loan'
  if (id === 'sale') return 'sale'
  return 'squad'
}

export function derivePlanningAssignmentIndex(slotAssignments: SlotAssignments = {}) {
  const index: Record<string, string> = {}
  for (const [groupId, rows] of Object.entries(slotAssignments)) {
    for (const playerId of Object.values(rows).flat()) {
      if (!playerId || index[playerId]) continue
      index[playerId] = groupId
    }
  }
  return index
}

export function derivePlanningDistribution(
  activePlayerIds: string[],
  planning?: PlanningDistributionSource,
) {
  const activeIds = [...new Set(activePlayerIds.filter(Boolean))]
  const activeSet = new Set(activeIds)
  const configuredGroups = planning?.groups ?? []
  const groups = [
    ...configuredGroups,
    ...REQUIRED_TRANSFER_GROUPS.filter(required => !configuredGroups.some(group => group.id === required.id)),
  ]

  const globallyAssigned = new Set<string>()
  const duplicatePlayerIds = new Set<string>()
  const slotAssignments = planning?.slotAssignments ?? {}

  const distributionGroups: PlanningDistributionGroup[] = groups.map(group => {
    const groupIds = new Set<string>()
    const rows = slotAssignments[group.id] ?? {}

    for (const playerId of Object.values(rows).flat()) {
      if (!playerId || !activeSet.has(playerId)) continue
      groupIds.add(playerId)
    }

    const uniqueIds: string[] = []
    for (const playerId of groupIds) {
      if (globallyAssigned.has(playerId)) {
        duplicatePlayerIds.add(playerId)
        continue
      }
      globallyAssigned.add(playerId)
      uniqueIds.push(playerId)
    }

    return {
      id: group.id,
      name: group.name,
      count: uniqueIds.length,
      playerIds: uniqueIds,
      kind: groupKind(group.id),
    }
  })

  const unassignedPlayerIds = activeIds.filter(playerId => !globallyAssigned.has(playerId))

  return {
    active: activeIds.length,
    assigned: globallyAssigned.size,
    unassigned: unassignedPlayerIds.length,
    unassignedPlayerIds,
    duplicatePlayerIds: [...duplicatePlayerIds],
    groups: distributionGroups,
  }
}
