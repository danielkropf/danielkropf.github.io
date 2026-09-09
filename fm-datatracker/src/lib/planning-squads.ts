import { preferredTacticalPlanningGroupId, type PlanningTeamLevel } from './current-roster'
import type { FlexiblePlanning, PlanningGroup } from './planningSets'

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function isMarketPlanningGroup(group: PlanningGroup | null | undefined) {
  const value = normalize(`${group?.id ?? ''} ${group?.name ?? ''}`)
  return value.includes('loan') || value.includes('emprest') || value.includes('sale') || value.includes('vend')
}

function tacticalGroupForPlayer(planning: FlexiblePlanning, playerId: string): string | null {
  for (const group of planning.groups) {
    if (isMarketPlanningGroup(group)) continue
    if (Object.values(planning.slotAssignments[group.id] ?? {}).some(ids => ids.includes(playerId))) return group.id
  }
  return null
}

export function effectivePlanningSquadGroupId(planning: FlexiblePlanning, playerId: string, factualSquadName?: string | null, teamLevel?: PlanningTeamLevel): string | null {
  const explicit = planning.squadAssignments?.[playerId]
  if (explicit && planning.groups.some(group => group.id === explicit && !isMarketPlanningGroup(group))) return explicit
  const tactical = tacticalGroupForPlayer(planning, playerId)
  if (tactical) return tactical
  if (factualSquadName?.trim()) {
    const exact = planning.groups.find(group => !isMarketPlanningGroup(group) && normalize(group.name) === normalize(factualSquadName))
    return exact?.id ?? null
  }
  return preferredTacticalPlanningGroupId(planning.groups, null, teamLevel ?? null, null)
}

export function movePlayerToPlanningSquad(planning: FlexiblePlanning, playerId: string, groupId: string): FlexiblePlanning {
  const target = planning.groups.find(group => group.id === groupId)
  if (!target || isMarketPlanningGroup(target)) return planning
  const slotAssignments = Object.fromEntries(Object.entries(planning.slotAssignments).map(([currentGroupId, rows]) => {
    const currentGroup = planning.groups.find(group => group.id === currentGroupId)
    if (currentGroupId === groupId || isMarketPlanningGroup(currentGroup)) return [currentGroupId, rows]
    return [currentGroupId, Object.fromEntries(Object.entries(rows).map(([setId, ids]) => [setId, ids.filter(id => id !== playerId)]))]
  }))
  return { ...planning, slotAssignments, squadAssignments: { ...(planning.squadAssignments ?? {}), [playerId]: groupId } }
}

export function clearPlanningSquadOverride(planning: FlexiblePlanning, playerId: string): FlexiblePlanning {
  if (!planning.squadAssignments?.[playerId]) return planning
  const squadAssignments = { ...planning.squadAssignments }
  delete squadAssignments[playerId]
  return { ...planning, squadAssignments }
}

function stableGroupId(name: string, occupied: Set<string>) {
  const base = `squad-${normalize(name).replace(/\s+/g, '-').replace(/^-|-$/g, '') || 'grupo'}`
  if (!occupied.has(base)) return base
  let index = 2
  while (occupied.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export function reconcilePlanningSquadGroups(
  planning: FlexiblePlanning,
  factualSquadNames: Array<string | null | undefined>,
  factualSquadByPlayer?: ReadonlyMap<string, string | null | undefined>,
): FlexiblePlanning {
  const factual = [...new Set(factualSquadNames.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (!factual.length) return planning

  const canonicalByName = new Map(factual.map(name => [normalize(name), name]))
  const market = planning.groups.filter(isMarketPlanningGroup)
  const rawInternal = planning.groups.filter(group => !isMarketPlanningGroup(group))
  const explicitTargets = new Set(Object.values(planning.squadAssignments ?? {}))
  const claimedNames = new Set(rawInternal.map(group => normalize(group.name)).filter(name => canonicalByName.has(name)))

  // Legacy groups such as Principal/Time B used to stand in for squads. Rename
  // them in-place only when their current positional population points to one
  // and only one factual squad, and no manual squad override targets the group.
  // Keeping the group id preserves setLayouts and slotAssignments byte-for-byte.
  const existingInternal = rawInternal.map(group => {
    const currentName = normalize(group.name)
    if (canonicalByName.has(currentName) || explicitTargets.has(group.id) || !factualSquadByPlayer) return group
    const playerIds = [...new Set(Object.values(planning.slotAssignments[group.id] ?? {}).flat())]
      .filter(playerId => !planning.squadAssignments?.[playerId])
    const candidateNames = [...new Set(playerIds
      .map(playerId => factualSquadByPlayer.get(playerId)?.trim())
      .filter((name): name is string => Boolean(name))
      .map(name => normalize(name)))]
    if (candidateNames.length !== 1) return group
    const candidate = candidateNames[0]
    const canonical = canonicalByName.get(candidate)
    if (!canonical || claimedNames.has(candidate)) return group
    claimedNames.add(candidate)
    return { ...group, name: canonical }
  })

  const byName = new Map(existingInternal.map(group => [normalize(group.name), group]))
  const occupied = new Set(planning.groups.map(group => group.id))
  const factualGroups = factual.map(name => {
    const existing = byName.get(normalize(name))
    if (existing) return existing
    const id = stableGroupId(name, occupied)
    occupied.add(id)
    return { id, name }
  })

  const factualIds = new Set(factualGroups.map(group => group.id))
  const referencedIds = new Set<string>([
    ...Object.entries(planning.slotAssignments).filter(([, rows]) => Object.values(rows).some(ids => ids.length > 0)).map(([groupId]) => groupId),
    ...Object.values(planning.squadAssignments ?? {}),
  ])
  const preserved = existingInternal.filter(group => !factualIds.has(group.id) && referencedIds.has(group.id))
  const groups = [...factualGroups, ...preserved, ...market]
  if (groups.length === planning.groups.length && groups.every((group, index) => group.id === planning.groups[index]?.id && group.name === planning.groups[index]?.name)) return planning
  return { ...planning, groups }
}

export function planningSquadLabel(planning: FlexiblePlanning, groupId: string | null | undefined) {
  return planning.groups.find(group => group.id === groupId)?.name ?? null
}
