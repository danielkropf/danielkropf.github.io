export type PlanningTrackedClub = {
  club_id: string
  tracking_role: 'primary' | 'tracked'
  is_active: boolean
  display_order: number
  club: { id: string; name: string }
}

export type ClubScopedPlanningConfig<TPlanning> = {
  planning?: TPlanning
  planning_by_club?: Record<string, TPlanning>
  selected_tactic_id?: string | null
  selected_tactic_id_by_club?: Record<string, string | null>
}

export type AssignableClubPlanning = {
  slotAssignments: Record<string, Record<string, string[]>>
}

export type PlanningClubIndex = {
  clubByPlayer: Record<string, string>
  conflicts: Record<string, string[]>
}

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

export function activePlanningClubs(rows: PlanningTrackedClub[]): PlanningTrackedClub[] {
  return [...rows]
    .filter(item => item.is_active)
    .sort((a, b) => {
      const role = Number(b.tracking_role === 'primary') - Number(a.tracking_role === 'primary')
      if (role) return role
      return a.display_order - b.display_order || a.club.name.localeCompare(b.club.name, 'pt-BR')
    })
}

export function primaryPlanningClubId(rows: PlanningTrackedClub[]): string | null {
  return activePlanningClubs(rows).find(item => item.tracking_role === 'primary')?.club_id ?? null
}

export function resolvePlanningClubId(rows: PlanningTrackedClub[], rememberedClubId: string | null | undefined): string | null {
  const active = activePlanningClubs(rows)
  if (rememberedClubId && active.some(item => item.club_id === rememberedClubId)) return rememberedClubId
  return active.find(item => item.tracking_role === 'primary')?.club_id ?? active[0]?.club_id ?? null
}

export function resolveClubPlanning<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  clubId: string | null,
  primaryClubId: string | null,
  createDefault: () => TPlanning,
): TPlanning {
  if (!clubId) return createDefault()
  const scoped = config.planning_by_club ?? {}
  if (hasOwn(scoped, clubId)) return scoped[clubId]
  if (clubId === primaryClubId && config.planning !== undefined) return config.planning
  return createDefault()
}

export function promoteLegacyPrimaryPlanning<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  primaryClubId: string | null,
): Record<string, TPlanning> {
  const scoped = { ...(config.planning_by_club ?? {}) }
  if (primaryClubId && !hasOwn(scoped, primaryClubId) && config.planning !== undefined) scoped[primaryClubId] = config.planning
  return scoped
}

export function patchClubPlanning<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  clubId: string,
  primaryClubId: string | null,
  planning: TPlanning,
): Pick<ClubScopedPlanningConfig<TPlanning>, 'planning' | 'planning_by_club'> {
  const planningByClub = { ...(config.planning_by_club ?? {}), [clubId]: planning }
  return clubId === primaryClubId
    ? { planning, planning_by_club: planningByClub }
    : { planning_by_club: planningByClub }
}

export function resolveClubTacticId<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  clubId: string | null,
  primaryClubId: string | null,
  validTacticIds: readonly string[],
): string | null {
  if (!clubId) return null
  const valid = new Set(validTacticIds)
  const scoped = config.selected_tactic_id_by_club ?? {}
  if (hasOwn(scoped, clubId)) {
    const value = scoped[clubId]
    return value && valid.has(value) ? value : null
  }
  if (clubId === primaryClubId) {
    const legacy = config.selected_tactic_id ?? null
    return legacy && valid.has(legacy) ? legacy : null
  }
  return null
}


export function promoteLegacyPrimaryTacticId<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  primaryClubId: string | null,
): Record<string, string | null> {
  const scoped = { ...(config.selected_tactic_id_by_club ?? {}) }
  if (primaryClubId && !hasOwn(scoped, primaryClubId) && config.selected_tactic_id !== undefined) scoped[primaryClubId] = config.selected_tactic_id ?? null
  return scoped
}

export function patchClubTacticId<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  clubId: string,
  primaryClubId: string | null,
  tacticId: string | null,
): Pick<ClubScopedPlanningConfig<TPlanning>, 'selected_tactic_id' | 'selected_tactic_id_by_club'> {
  const selectedByClub = { ...(config.selected_tactic_id_by_club ?? {}), [clubId]: tacticId }
  return clubId === primaryClubId
    ? { selected_tactic_id: tacticId, selected_tactic_id_by_club: selectedByClub }
    : { selected_tactic_id_by_club: selectedByClub }
}

export function sanitizeClubTacticSelections<TPlanning>(
  config: ClubScopedPlanningConfig<TPlanning>,
  validTacticIds: readonly string[],
): Pick<ClubScopedPlanningConfig<TPlanning>, 'selected_tactic_id' | 'selected_tactic_id_by_club'> {
  const valid = new Set(validTacticIds)
  const selectedByClub = Object.fromEntries(Object.entries(config.selected_tactic_id_by_club ?? {}).map(([clubId, tacticId]) => [clubId, tacticId && valid.has(tacticId) ? tacticId : null]))
  const legacy = config.selected_tactic_id
  return {
    selected_tactic_id: legacy && valid.has(legacy) ? legacy : null,
    selected_tactic_id_by_club: selectedByClub,
  }
}

function withoutPlayer<TPlanning extends AssignableClubPlanning>(planning: TPlanning, playerId: string): TPlanning {
  return {
    ...planning,
    slotAssignments: Object.fromEntries(Object.entries(planning.slotAssignments).map(([groupId, rows]) => [
      groupId,
      Object.fromEntries(Object.entries(rows).map(([setId, ids]) => [setId, ids.filter(id => id !== playerId)])),
    ])),
  }
}

export function derivePlanningClubIndex<TPlanning extends AssignableClubPlanning>(
  planningByClub: Record<string, TPlanning>,
): PlanningClubIndex {
  const candidates = new Map<string, Set<string>>()
  for (const [clubId, planning] of Object.entries(planningByClub)) {
    for (const playerId of Object.values(planning.slotAssignments).flatMap(rows => Object.values(rows).flat())) {
      if (!playerId) continue
      const clubs = candidates.get(playerId) ?? new Set<string>()
      clubs.add(clubId)
      candidates.set(playerId, clubs)
    }
  }

  const clubByPlayer: Record<string, string> = {}
  const conflicts: Record<string, string[]> = {}
  for (const [playerId, clubs] of candidates) {
    const values = [...clubs].sort()
    if (values.length === 1) clubByPlayer[playerId] = values[0]
    else conflicts[playerId] = values
  }
  return { clubByPlayer, conflicts }
}

/** Makes a player unique across club plans without changing unrelated state. */
export function movePlayerAcrossClubPlans<TPlanning extends AssignableClubPlanning>(
  planningByClub: Record<string, TPlanning>,
  targetClubId: string,
  playerId: string,
  targetPlanning: TPlanning,
): Record<string, TPlanning> {
  return Object.fromEntries(Object.entries({ ...planningByClub, [targetClubId]: targetPlanning }).map(([clubId, planning]) => [
    clubId,
    clubId === targetClubId ? planning : withoutPlayer(planning, playerId),
  ]))
}
