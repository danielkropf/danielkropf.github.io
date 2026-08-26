export type PlanningGroup = { id: string; name: string }
export type TacticSlotDescriptor = { id: string; position: string }
export type PlanningSetLayout = { id: string; label: string; slotIds: string[] }
export type PlanningSetLayouts = Record<string, Record<string, PlanningSetLayout[]>>
export type FlexiblePlanning = {
  groups: PlanningGroup[]
  slotAssignments: Record<string, Record<string, string[]>>
  setLayouts?: PlanningSetLayouts
}

const compactPosition = (position: string) => position.toUpperCase().replace(/[^A-Z]/g, '')
const positionIdentity = (position: string) => position.toUpperCase().replace(/\s+/g, '')

/** Positional family used only for the user's optional visual grouping. */
export function positionFamily(position: string): string {
  const value = compactPosition(position)
  if (/^DC[LR]?$/.test(value)) return 'DC'
  if (/^MC[LR]?$/.test(value)) return 'MC'
  if (/^DM[LR]?$/.test(value)) return 'DM'
  if (/^AMC[LR]?$/.test(value)) return 'AMC'
  if (/^GK/.test(value)) return 'GK'
  if (/^ST[CLR]?$/.test(value)) return 'ST'
  return value
}

export function defaultSetLabel(position: string, count = 1): string {
  const family = positionFamily(position)
  if (count > 1) {
    const labels: Record<string, string> = { GK: 'Goleiros', DC: 'Zagueiros', DM: 'Volantes', MC: 'Meio-campistas', AMC: 'Meias ofensivos', ST: 'Atacantes', DL: 'Laterais esquerdos', DR: 'Laterais direitos', WBL: 'Alas esquerdos', WBR: 'Alas direitos', AML: 'Pontas esquerdas', AMR: 'Pontas direitas' }
    return labels[family] ?? `${position} · ${count} posições`
  }
  return position
}


export function planningSetDisplayLabel(set: PlanningSetLayout, sets: PlanningSetLayout[], slots: TacticSlotDescriptor[]): string {
  if (set.slotIds.length > 1) return set.label
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const position = slotById.get(set.slotIds[0])?.position
  if (!position) return set.label
  const base = defaultSetLabel(position)
  const stored = set.label.trim()
  if (stored && stored !== base) return stored
  const identity = positionIdentity(position)
  const peers = sets.filter(candidate => {
    if (candidate.slotIds.length !== 1) return false
    const candidatePosition = slotById.get(candidate.slotIds[0])?.position
    return Boolean(candidatePosition && positionIdentity(candidatePosition) === identity)
  })
  if (peers.length < 2) return stored || base
  const index = peers.findIndex(candidate => candidate.id === set.id)
  return `${base} ${Math.max(0, index) + 1}`
}

export function reorderPlanningGroups(planning: FlexiblePlanning, draggedId: string, beforeId: string | null): FlexiblePlanning {
  if (draggedId === beforeId) return planning
  const dragged = planning.groups.find(group => group.id === draggedId)
  if (!dragged) return planning
  const rest = planning.groups.filter(group => group.id !== draggedId)
  const insertion = beforeId === null ? rest.length : rest.findIndex(group => group.id === beforeId)
  if (beforeId !== null && insertion < 0) return planning
  rest.splice(insertion, 0, dragged)
  if (rest.every((group, index) => group.id === planning.groups[index]?.id)) return planning
  return { ...planning, groups: rest }
}

export function defaultPlanningSets(slots: TacticSlotDescriptor[]): PlanningSetLayout[] {
  return slots.map(slot => ({ id: slot.id, label: defaultSetLabel(slot.position), slotIds: [slot.id] }))
}

function validSlotIds(slots: TacticSlotDescriptor[]) { return new Set(slots.map(slot => slot.id)) }

/**
 * Reconciles persisted visual sets with the selected tactic. Removed tactic slots
 * disappear; new slots are appended without disturbing the user's saved order.
 */
export function reconcilePlanningSets(stored: PlanningSetLayout[] | undefined, slots: TacticSlotDescriptor[]): PlanningSetLayout[] {
  if (!stored?.length) return defaultPlanningSets(slots)
  const valid = validSlotIds(slots)
  const seen = new Set<string>()
  const kept = stored.flatMap(set => {
    const slotIds = [...new Set(set.slotIds.filter(id => valid.has(id) && !seen.has(id)))]
    slotIds.forEach(id => seen.add(id))
    return slotIds.length ? [{ ...set, slotIds }] : []
  })
  for (const slot of slots) if (!seen.has(slot.id)) kept.push({ id: slot.id, label: defaultSetLabel(slot.position), slotIds: [slot.id] })
  return kept
}

export function layoutsFor(planning: FlexiblePlanning, tacticId: string, groupId: string, slots: TacticSlotDescriptor[]): PlanningSetLayout[] {
  return reconcilePlanningSets(planning.setLayouts?.[tacticId]?.[groupId], slots)
}

function withLayouts(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[]): FlexiblePlanning {
  return {
    ...planning,
    setLayouts: {
      ...(planning.setLayouts ?? {}),
      [tacticId]: { ...(planning.setLayouts?.[tacticId] ?? {}), [groupId]: sets },
    },
  }
}

export function renamePlanningSet(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], setId: string, label: string): FlexiblePlanning {
  const next = sets.map(set => set.id === setId ? { ...set, label: label.trim() || set.label } : set)
  return withLayouts(planning, tacticId, groupId, next)
}

export function reorderPlanningSets(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], draggedId: string, beforeId: string | null): FlexiblePlanning {
  if (draggedId === beforeId) return planning
  const dragged = sets.find(set => set.id === draggedId)
  if (!dragged) return planning
  const rest = sets.filter(set => set.id !== draggedId)
  const insertion = beforeId === null ? rest.length : rest.findIndex(set => set.id === beforeId)
  if (beforeId !== null && insertion < 0) return planning
  rest.splice(insertion, 0, dragged)
  if (rest.every((set, index) => set.id === sets[index]?.id)) return planning
  return withLayouts(planning, tacticId, groupId, rest)
}

export function movePlanningSet(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], setId: string, direction: -1 | 1): FlexiblePlanning {
  const index = sets.findIndex(set => set.id === setId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sets.length) return planning
  const next = [...sets]
  ;[next[index], next[target]] = [next[target], next[index]]
  return withLayouts(planning, tacticId, groupId, next)
}

export function groupEquivalentSets(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], setId: string, slots: TacticSlotDescriptor[], newId: string): FlexiblePlanning {
  const source = sets.find(set => set.id === setId)
  if (!source) return planning
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const sourcePosition = slotById.get(source.slotIds[0])?.position
  if (!sourcePosition) return planning
  const family = positionFamily(sourcePosition)
  const equivalents = sets.filter(set => set.slotIds.some(id => positionFamily(slotById.get(id)?.position ?? '') === family))
  if (equivalents.length < 2) return planning
  const equivalentIds = new Set(equivalents.map(set => set.id))
  const firstIndex = sets.findIndex(set => equivalentIds.has(set.id))
  const slotIds = equivalents.flatMap(set => set.slotIds)
  const players = equivalents.flatMap(set => planning.slotAssignments[groupId]?.[set.id] ?? []).filter(Boolean)
  const uniquePlayers = [...new Set(players)]
  const grouped: PlanningSetLayout = { id: newId, label: defaultSetLabel(sourcePosition, slotIds.length), slotIds }
  const nextSets = sets.filter(set => !equivalentIds.has(set.id))
  nextSets.splice(firstIndex, 0, grouped)
  const groupAssignments = { ...(planning.slotAssignments[groupId] ?? {}) }
  equivalents.forEach(set => { delete groupAssignments[set.id] })
  groupAssignments[grouped.id] = uniquePlayers
  return {
    ...withLayouts(planning, tacticId, groupId, nextSets),
    slotAssignments: { ...planning.slotAssignments, [groupId]: groupAssignments },
  }
}

export function splitPlanningSet(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], setId: string, slots: TacticSlotDescriptor[]): FlexiblePlanning {
  const source = sets.find(set => set.id === setId)
  if (!source || source.slotIds.length < 2) return planning
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const sourceIndex = sets.findIndex(set => set.id === setId)
  const replacements = source.slotIds.map(id => ({ id, label: defaultSetLabel(slotById.get(id)?.position ?? id), slotIds: [id] }))
  const nextSets = [...sets]
  nextSets.splice(sourceIndex, 1, ...replacements)
  const previousPlayers = planning.slotAssignments[groupId]?.[setId] ?? []
  const groupAssignments = { ...(planning.slotAssignments[groupId] ?? {}) }
  delete groupAssignments[setId]
  replacements.forEach((set, index) => { groupAssignments[set.id] = previousPlayers.filter((_, playerIndex) => playerIndex % replacements.length === index) })
  return {
    ...withLayouts(planning, tacticId, groupId, nextSets),
    slotAssignments: { ...planning.slotAssignments, [groupId]: groupAssignments },
  }
}

export function restoreDefaultPlanningSets(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], slots: TacticSlotDescriptor[]): FlexiblePlanning {
  const defaults = defaultPlanningSets(slots)
  const groupAssignments = { ...(planning.slotAssignments[groupId] ?? {}) }
  for (const set of sets) {
    if (set.slotIds.length <= 1 && set.id === set.slotIds[0]) continue
    const players = groupAssignments[set.id] ?? []
    delete groupAssignments[set.id]
    set.slotIds.forEach((slotId, index) => {
      const existing = groupAssignments[slotId] ?? []
      groupAssignments[slotId] = [...existing, ...players.filter((_, playerIndex) => playerIndex % set.slotIds.length === index)].filter((id, pos, all) => all.indexOf(id) === pos)
    })
  }
  return {
    ...withLayouts(planning, tacticId, groupId, defaults),
    slotAssignments: { ...planning.slotAssignments, [groupId]: groupAssignments },
  }
}

export function movePlayerToSet(planning: FlexiblePlanning, groupId: string, setId: string, playerId: string, beforePlayerId?: string | null): FlexiblePlanning {
  const cleaned: Record<string, Record<string, string[]>> = {}
  for (const [id, rows] of Object.entries(planning.slotAssignments)) {
    cleaned[id] = Object.fromEntries(Object.entries(rows).map(([key, ids]) => [key, ids.filter(value => value && value !== playerId)]))
  }
  const group = { ...(cleaned[groupId] ?? {}) }
  const target = [...(group[setId] ?? [])]
  const targetIndex = beforePlayerId ? target.indexOf(beforePlayerId) : -1
  target.splice(targetIndex >= 0 ? targetIndex : target.length, 0, playerId)
  group[setId] = target
  return { ...planning, slotAssignments: { ...cleaned, [groupId]: group } }
}

export function removePlayerFromPlanning(planning: FlexiblePlanning, playerId: string): FlexiblePlanning {
  return {
    ...planning,
    slotAssignments: Object.fromEntries(Object.entries(planning.slotAssignments).map(([groupId, rows]) => [
      groupId,
      Object.fromEntries(Object.entries(rows).map(([setId, ids]) => [setId, ids.filter(id => id !== playerId)])),
    ])),
  }
}

export function primarySetForPlayer(planning: FlexiblePlanning, groupId: string, sets: PlanningSetLayout[], playerId: string): PlanningSetLayout | null {
  return sets.find(set => (planning.slotAssignments[groupId]?.[set.id] ?? []).includes(playerId)) ?? null
}
