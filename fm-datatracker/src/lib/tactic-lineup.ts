export type TacticLineupAssignment = {
  playerId: string
  nodeId: string
  position: string
  roleCode: string
  roleName?: string
}

export type TacticWithLineup = {
  id: string
  name: string
  ipAssignments: TacticLineupAssignment[]
  oopAssignments?: TacticLineupAssignment[]
  lineup?: Record<string, string | null>
}

export function tacticSlotForPlayer(tactic: TacticWithLineup | null | undefined, playerId: string) {
  if (!tactic?.lineup) return null
  return Object.entries(tactic.lineup).find(([, assignedPlayerId]) => assignedPlayerId === playerId)?.[0] ?? null
}

export function assignPlayerToTacticSlot<T extends TacticWithLineup>(tactic: T, playerId: string, slotId: string | null): T {
  const lineup = { ...(tactic.lineup ?? {}) }
  for (const [currentSlot, assignedPlayerId] of Object.entries(lineup)) {
    if (assignedPlayerId === playerId) lineup[currentSlot] = null
  }
  if (slotId) lineup[slotId] = playerId
  return { ...tactic, lineup }
}

export function tacticSlotAssignments(tactic: TacticWithLineup | null | undefined) {
  if (!tactic) return []
  return tactic.ipAssignments.map(ip => ({
    slotId: ip.playerId,
    ip,
    oop: tactic.oopAssignments?.find(item => item.playerId === ip.playerId) ?? ip,
  }))
}
