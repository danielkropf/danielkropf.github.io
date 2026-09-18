import { marketPlanningGroupKind } from './current-roster'
import { removePlayerFromPlanning, type FlexiblePlanning } from './planningSets'
import { loadModelConfig, patchModelConfig, flushAllModelConfigPatches } from './model-config'
import { invalidateSaveData, loadCurrentPlayers } from './dataCache'
import { loadPlanningMemberships } from './longitudinal-service'
import { resolveCurrentSnapshotMembership } from './planning-membership'
import { primaryPlanningClubId } from './multiclub-planning'
import type { Save, PlayerMembershipWithClubs } from '../types/domain'
import { assertPrivateSession, privateSessionGeneration } from './private-session'

export function clearMarketLists(plan: FlexiblePlanning): FlexiblePlanning {
  const market = new Set(plan.groups.filter(group=>marketPlanningGroupKind(group)).map(group=>group.id))
  return {...plan, squadAssignments:Object.fromEntries(Object.entries(plan.squadAssignments ?? {}).filter(([,group])=>!market.has(group))), slotAssignments:Object.fromEntries(Object.entries(plan.slotAssignments).map(([group,rows])=>[group,market.has(group)?{}:rows]))}
}
export function pruneDepartedPlayers(plan: FlexiblePlanning, departed: Set<string>) {
  return [...departed].reduce((next,id)=>removePlayerFromPlanning(next,id),plan)
}
export function hasConfirmedDeparture(membership: Pick<PlayerMembershipWithClubs,'current_club_id'|'owner_club_id'|'is_loan'> | null, clubId: string): boolean {
  if (!membership) return false
  const current=membership.current_club_id, owner=membership.owner_club_id
  return Boolean(current && current!==clubId && owner!==clubId && (owner || membership.is_loan===false))
}
export async function startPlanningSeason(saveId: string, date: string | null) {
  const generation=privateSessionGeneration()
  await flushAllModelConfigPatches()
  const config=await loadModelConfig(saveId)
  assertPrivateSession(generation)
  const patch: Record<string,unknown>={season_start_snapshot_date:date,season_started_at:new Date().toISOString()}
  if(config.planning) patch.planning=clearMarketLists(config.planning as FlexiblePlanning)
  if(config.planning_by_club) patch.planning_by_club=Object.fromEntries(Object.entries(config.planning_by_club as Record<string,FlexiblePlanning>).map(([id,plan])=>[id,clearMarketLists(plan)]))
  await patchModelConfig(saveId,__APP_VERSION__,patch)
  assertPrivateSession(generation)
  invalidateSaveData(saveId)
}
/** Only authoritative current-checkpoint evidence can remove a plan. Historical imports cannot roll it back. */
export async function reconcileImportedPlanning(save: Save): Promise<void> {
  const generation=privateSessionGeneration()
  invalidateSaveData(save.id, false)
  const players=await loadCurrentPlayers(save.id)
  const rows=await loadPlanningMemberships(save.id,players.flatMap(p=>p.player_snapshots.map(s=>s.id)))
  await flushAllModelConfigPatches()
  const config=await loadModelConfig(save.id)
  assertPrivateSession(generation)
  const primary=primaryPlanningClubId(save.structure?.trackedClubs ?? [])
  const clean=(plan:FlexiblePlanning,clubId:string)=>{
    const departed=new Set<string>()
    for(const p of players){
      const membership=resolveCurrentSnapshotMembership(rows.filter(row=>row.player_id===p.id),p.player_snapshots[0]?.id).membership
      if(!membership) continue
      if(hasConfirmedDeparture(membership,clubId)) departed.add(p.id)
    }
    return pruneDepartedPlayers(plan,departed)
  }
  const patch:Record<string,unknown>={}
  if(primary && config.planning) patch.planning=clean(config.planning as FlexiblePlanning,primary)
  if(config.planning_by_club) patch.planning_by_club=Object.fromEntries(Object.entries(config.planning_by_club as Record<string,FlexiblePlanning>).map(([id,plan])=>[id,clean(plan,id)]))
  if(Object.entries(patch).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(config[key]))) await patchModelConfig(save.id,__APP_VERSION__,patch)
}
