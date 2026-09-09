import { marketPlanningGroupKind } from './current-roster'
export type PlanningGroup = { id: string; name: string }
export type TacticSlotDescriptor = { id: string; position: string; oopPosition?: string; nodeId?: string; x?: number }
export type PlanningSetLayout = {
  id: string
  label: string
  slotIds: string[]
  slotLabels?: Record<string, string>
  customLabel?: boolean
  /** Legacy v0.31.13 horizontal-only visual preference. Read for compatibility, no longer written. */
  visualAnchorX?: number
  /** Visual-only 5x5 Planning grid coordinates. They never change the tactical slot/role. */
  visualGridRow?: number
  visualGridColumn?: number
}
export type PlanningSetLayouts = Record<string, Record<string, PlanningSetLayout[]>>
export type FlexiblePlanning = {
  groups: PlanningGroup[]
  slotAssignments: Record<string, Record<string, string[]>>
  /** Manual planned-squad overrides. When absent, factual squad membership remains the default. */
  squadAssignments?: Record<string, string>
  setLayouts?: PlanningSetLayouts
}


export const PLANNING_VISUAL_GRID_SIZE = 5 as const
export const PLANNING_VISUAL_GRID_COLUMNS = [10, 30, 50, 70, 90] as const
export const PLANNING_VISUAL_GRID_ROWS = [8.3333, 25, 41.6667, 58.3333, 75] as const
/** Sixth equal-height Planning row reserved for the goalkeeper. */
export const PLANNING_VISUAL_GOALKEEPER_Y = 91.6667 as const
/** Backward-compatible name used by the v0.31.13 horizontal preference. */
export const PLANNING_VISUAL_ANCHORS = PLANNING_VISUAL_GRID_COLUMNS

export type PlanningVisualGridCell = { row: number; column: number }

function clampGridIndex(value: number) {
  return Math.max(1, Math.min(PLANNING_VISUAL_GRID_SIZE, Math.round(value)))
}

export function planningVisualGridColumnFromX(value: number): number {
  const index = PLANNING_VISUAL_GRID_COLUMNS.reduce((best, candidate, candidateIndex) =>
    Math.abs(candidate - value) < Math.abs(PLANNING_VISUAL_GRID_COLUMNS[best] - value) ? candidateIndex : best, 0)
  return index + 1
}

export function planningVisualGridRowForLine(line: string): number {
  if (line === 'st') return 1
  if (line === 'am') return 2
  if (line === 'm') return 3
  if (line === 'dm') return 4
  return 5
}

export function planningVisualGridCellForSet(set: PlanningSetLayout, fallbackX: number, fallbackLine: string): PlanningVisualGridCell {
  const persistedRow = Number(set.visualGridRow)
  const persistedColumn = Number(set.visualGridColumn)
  if (Number.isFinite(persistedRow) && Number.isFinite(persistedColumn)) {
    return { row: clampGridIndex(persistedRow), column: clampGridIndex(persistedColumn) }
  }
  const legacyX = Number.isFinite(set.visualAnchorX) ? Number(set.visualAnchorX) : fallbackX
  return { row: planningVisualGridRowForLine(fallbackLine), column: planningVisualGridColumnFromX(legacyX) }
}

function withVisualGridCell(set: PlanningSetLayout, cell: PlanningVisualGridCell): PlanningSetLayout {
  const { visualAnchorX: _legacyAnchor, ...rest } = set
  return { ...rest, visualGridRow: clampGridIndex(cell.row), visualGridColumn: clampGridIndex(cell.column) }
}

/**
 * Moves a non-goalkeeper set freely inside the visual 5x5 Planning grid.
 * Tactical slot ids, positions, functions and player allocations are untouched.
 * An occupied target cell swaps with the source cell, so sets never overlap.
 */
export function movePlanningSetVisualGrid(
  planning: FlexiblePlanning,
  tacticId: string,
  groupId: string,
  sets: PlanningSetLayout[],
  setId: string,
  requested: PlanningVisualGridCell,
  currentCells: Record<string, PlanningVisualGridCell>,
): FlexiblePlanning {
  const source = sets.find(set => set.id === setId)
  const sourceCell = currentCells[setId]
  if (!source || !sourceCell) return planning

  const target = { row: clampGridIndex(requested.row), column: clampGridIndex(requested.column) }
  if (target.row === sourceCell.row && target.column === sourceCell.column) return planning

  const occupant = sets.find(set => {
    if (set.id === setId) return false
    const cell = currentCells[set.id]
    return cell?.row === target.row && cell?.column === target.column
  })

  const next = sets.map(set => {
    if (set.id === setId) return withVisualGridCell(set, target)
    if (occupant && set.id === occupant.id) return withVisualGridCell(set, sourceCell)
    return set
  })
  return withLayouts(planning, tacticId, groupId, next)
}

/** Restores tactic-derived pitch cells without changing grouping/order/labels. */
export function restorePlanningSetVisualGrid(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[]): FlexiblePlanning {
  let changed = false
  const next = sets.map(set => {
    if (!Number.isFinite(set.visualAnchorX) && !Number.isFinite(set.visualGridRow) && !Number.isFinite(set.visualGridColumn)) return set
    changed = true
    const { visualAnchorX: _visualAnchorX, visualGridRow: _visualGridRow, visualGridColumn: _visualGridColumn, ...rest } = set
    return rest
  })
  return changed ? withLayouts(planning, tacticId, groupId, next) : planning
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

function looksLikeGeneratedSingleLabel(label: string): boolean {
  const value = label.trim().toUpperCase().replace(/\s+/g, '')
  return /^(GK|D(?:\([LCR]\)|[LCR])|WB(?:\([LR]\)|[LR])|DM(?:\([LCR]\)|[LCR])|M(?:\([LCR]\)|[LCR]|C)|AM(?:\([LCR]\)|[LCR])|ST(?:\([LCR]\)|[LCR])?)(?:\d+)?$/.test(value)
}

function slotHorizontalOrder(slot: TacticSlotDescriptor | undefined, fallback: number): number {
  return typeof slot?.x === 'number' && Number.isFinite(slot.x) ? slot.x : 1000 + fallback
}


export function planningSetDisplayLabel(set: PlanningSetLayout, sets: PlanningSetLayout[], slots: TacticSlotDescriptor[]): string {
  if (set.slotIds.length > 1) return set.label
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const position = slotById.get(set.slotIds[0])?.position
  if (!position) return set.label
  const base = defaultSetLabel(position)
  const stored = set.label.trim()
  // Old automatic labels were persisted as plain text. When the tactic slot moves,
  // they must follow the new position instead of masquerading as a custom rename.
  // Explicit renames (and legacy free-text labels) remain untouched.
  if (set.customLabel || (stored && !looksLikeGeneratedSingleLabel(stored))) return stored
  const identity = positionIdentity(position)
  const peers = sets.filter(candidate => {
    if (candidate.slotIds.length !== 1) return false
    const candidatePosition = slotById.get(candidate.slotIds[0])?.position
    return Boolean(candidatePosition && positionIdentity(candidatePosition) === identity)
  }).map((candidate, fallback) => ({ candidate, fallback, slot: slotById.get(candidate.slotIds[0]) }))
    .sort((a, b) => slotHorizontalOrder(a.slot, a.fallback) - slotHorizontalOrder(b.slot, b.fallback))
  if (peers.length < 2) return base
  const index = peers.findIndex(({ candidate }) => candidate.id === set.id)
  return `${base} ${Math.max(0, index) + 1}`
}


export function planningSlotDisplayLabel(set: PlanningSetLayout, slotId: string, slots: TacticSlotDescriptor[]): string {
  const custom = set.slotLabels?.[slotId]?.trim()
  if (custom) return custom
  const slot = slots.find(item => item.id === slotId)
  if (!slot) return slotId
  const peers = set.slotIds.filter(id => {
    const candidate = slots.find(item => item.id === id)
    return candidate && positionIdentity(candidate.position) === positionIdentity(slot.position)
  }).map((id, fallback) => ({ id, fallback, slot: slots.find(item => item.id === id) }))
    .sort((a, b) => slotHorizontalOrder(a.slot, a.fallback) - slotHorizontalOrder(b.slot, b.fallback))
  if (peers.length < 2) return defaultSetLabel(slot.position)
  return `${defaultSetLabel(slot.position)} ${peers.findIndex(peer => peer.id === slotId) + 1}`
}

export function planningSlotCompatibilityKey(slot: TacticSlotDescriptor): string {
  return `${positionFamily(slot.position)}>${positionFamily(slot.oopPosition ?? slot.position)}`
}

export function canGroupAdjacentPlanningSets(first: PlanningSetLayout, second: PlanningSetLayout, slots: TacticSlotDescriptor[]): boolean {
  if (first.slotIds.length !== 1 || second.slotIds.length !== 1) return false
  const firstSlot = slots.find(slot => slot.id === first.slotIds[0])
  const secondSlot = slots.find(slot => slot.id === second.slotIds[0])
  return Boolean(firstSlot && secondSlot && planningSlotCompatibilityKey(firstSlot) === planningSlotCompatibilityKey(secondSlot))
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
  const next = sets.map(set => set.id === setId ? { ...set, label: label.trim() || set.label, customLabel: true } : set)
  return withLayouts(planning, tacticId, groupId, next)
}


export function renamePlanningSlotLabel(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], setId: string, slotId: string, label: string): FlexiblePlanning {
  const next = sets.map(set => set.id === setId ? { ...set, slotLabels: { ...(set.slotLabels ?? {}), [slotId]: label.trim() } } : set)
  return withLayouts(planning, tacticId, groupId, next)
}

export function groupAdjacentPlanningSets(planning: FlexiblePlanning, tacticId: string, groupId: string, sets: PlanningSetLayout[], firstId: string, secondId: string, slots: TacticSlotDescriptor[], newId: string): FlexiblePlanning {
  const firstIndex = sets.findIndex(set => set.id === firstId)
  const secondIndex = sets.findIndex(set => set.id === secondId)
  if (firstIndex < 0 || secondIndex !== firstIndex + 1) return planning
  const first = sets[firstIndex], second = sets[secondIndex]
  if (!canGroupAdjacentPlanningSets(first, second, slots)) return planning
  const slotIds = [...first.slotIds, ...second.slotIds]
  const firstPosition = slots.find(slot => slot.id === slotIds[0])?.position ?? first.label
  const slotLabels = Object.fromEntries(slotIds.map(slotId => { const sourceSet = first.slotIds.includes(slotId) ? first : second; return [slotId, planningSetDisplayLabel(sourceSet, sets, slots)] }))
  const grouped: PlanningSetLayout = { id: newId, label: defaultSetLabel(firstPosition, slotIds.length), slotIds, slotLabels, ...(Number.isFinite(first.visualGridRow) && Number.isFinite(first.visualGridColumn) ? { visualGridRow: first.visualGridRow, visualGridColumn: first.visualGridColumn } : Number.isFinite(first.visualAnchorX) ? { visualAnchorX: first.visualAnchorX } : {}) }
  const nextSets = [...sets]
  nextSets.splice(firstIndex, 2, grouped)
  const groupAssignments = { ...(planning.slotAssignments[groupId] ?? {}) }
  const players = [...(groupAssignments[first.id] ?? []), ...(groupAssignments[second.id] ?? [])].filter(Boolean)
  delete groupAssignments[first.id]; delete groupAssignments[second.id]
  groupAssignments[newId] = [...new Set(players)]
  return { ...withLayouts(planning, tacticId, groupId, nextSets), slotAssignments: { ...planning.slotAssignments, [groupId]: groupAssignments } }
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
  const replacements: PlanningSetLayout[] = source.slotIds.map((id, index) => ({ id, label: source.slotLabels?.[id]?.trim() || defaultSetLabel(slotById.get(id)?.position ?? id), slotIds: [id], ...(index === 0 && Number.isFinite(source.visualGridRow) && Number.isFinite(source.visualGridColumn) ? { visualGridRow: source.visualGridRow, visualGridColumn: source.visualGridColumn } : index === 0 && Number.isFinite(source.visualAnchorX) ? { visualAnchorX: source.visualAnchorX } : {}) }))
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
  const targetKind = marketPlanningGroupKind(planning.groups.find(group => group.id === groupId))
  const cleaned: Record<string, Record<string, string[]>> = {}
  for (const [id, rows] of Object.entries(planning.slotAssignments)) {
    const sameDomain = marketPlanningGroupKind(planning.groups.find(group => group.id === id)) === targetKind
    cleaned[id] = sameDomain ? Object.fromEntries(Object.entries(rows).map(([key, ids]) => [key, ids.filter(value => value && value !== playerId)])) : rows
  }
  const group = { ...(cleaned[groupId] ?? {}) }
  const target = [...(group[setId] ?? [])]
  const targetIndex = beforePlayerId ? target.indexOf(beforePlayerId) : -1
  target.splice(targetIndex >= 0 ? targetIndex : target.length, 0, playerId)
  group[setId] = target
  return { ...planning, slotAssignments: { ...cleaned, [groupId]: group } }
}

export function removePlayerFromPlanning(planning: FlexiblePlanning, playerId: string): FlexiblePlanning {
  const squadAssignments = { ...(planning.squadAssignments ?? {}) }
  delete squadAssignments[playerId]
  return {
    ...planning,
    slotAssignments: Object.fromEntries(Object.entries(planning.slotAssignments).map(([groupId, rows]) => [
      groupId,
      Object.fromEntries(Object.entries(rows).map(([setId, ids]) => [setId, ids.filter(id => id !== playerId)])),
    ])),
    squadAssignments,
  }
}

export function primarySetForPlayer(planning: FlexiblePlanning, groupId: string, sets: PlanningSetLayout[], playerId: string): PlanningSetLayout | null {
  return sets.find(set => (planning.slotAssignments[groupId]?.[set.id] ?? []).includes(playerId)) ?? null
}

export function hasPlayerMarketFlag(planning: FlexiblePlanning, playerId: string, kind: 'loan' | 'sale'): boolean {
  return planning.groups.some(group => marketPlanningGroupKind(group) === kind && Object.values(planning.slotAssignments[group.id] ?? {}).some(ids => ids.includes(playerId)))
}

export function togglePlayerMarketFlag(planning: FlexiblePlanning, playerId: string, kind: 'loan' | 'sale'): FlexiblePlanning {
  if (!hasPlayerMarketFlag(planning, playerId, kind)) {
    const group = planning.groups.find(group => marketPlanningGroupKind(group) === kind)
    const target = group ? planning : { ...planning, groups: [...planning.groups, { id: kind, name: kind === 'loan' ? 'Empréstimo' : 'Venda' }] }
    return movePlayerToSet(target, group?.id ?? kind, 'market', playerId)
  }
  return { ...planning, slotAssignments: Object.fromEntries(Object.entries(planning.slotAssignments).map(([id, rows]) => [id, marketPlanningGroupKind(planning.groups.find(group => group.id === id)) === kind ? Object.fromEntries(Object.entries(rows).map(([set, ids]) => [set, ids.filter(value => value !== playerId)])) : rows])) }
}
