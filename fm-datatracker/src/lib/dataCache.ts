import { supabase } from './supabase'
import type { Club, PlayerRow } from '../types/domain'
import { createReferenceDatasetLoader } from './reference-cache'
import { resolveCurrentCheckpointDate, resolveSameDateSnapshotGroup } from './current-checkpoint'
import { loadFactualMembershipContexts } from './factual-membership-service'
import type { FactualMembershipContext, FactualResolvedField } from './factual-membership'

type RichSnapshot = PlayerRow['player_snapshots'][number] & { source_snapshot_ids?: string[] }
export type CurrentFactualPlayerState = {
  checkpointDate: string | null
  observedAtCheckpoint: boolean
  membership: FactualMembershipContext | null
  currentClubName: string | null
  ownerClubName: string | null
  loanFromClubName: string | null
  loanToClubName: string | null
  currentClubSource: 'membership' | 'snapshot-label' | 'unknown'
}
export type RichPlayer = Omit<PlayerRow, 'player_snapshots'> & {
  player_snapshots: RichSnapshot[]
  current_factual: CurrentFactualPlayerState
}

type SnapshotQueryRow = RichSnapshot & { player_id: string }
type IdentityRow = Pick<PlayerRow, 'id' | 'current_name' | 'nationality' | 'last_seen_date' | 'is_active'>

export type CurrentPlayerSummary = Pick<PlayerRow, 'id' | 'current_name' | 'is_active'> & {
  player_snapshots: Array<Pick<RichSnapshot, 'id' | 'snapshot_date' | 'age' | 'club' | 'squad' | 'positions' | 'source_snapshot_ids'>>
}

type CurrentPlayerOptions = { summary: true }

export const PLAYER_SNAPSHOT_EMBED = 'player_snapshots:player_snapshots!player_snapshots_player_save_fkey'
export const SAVE_FACTS_INVALIDATED_EVENT = 'fm-datatracker:save-facts-invalidated'

const players = new Map<string, Promise<RichPlayer[]>>()
const checkpoints = new Map<string, Promise<string | null>>()
const currentPlayers = new Map<string, Promise<RichPlayer[]>>()
const currentPlayerSummaries = new Map<string, Promise<CurrentPlayerSummary[]>>()
const referenceLoader = createReferenceDatasetLoader(() => `${import.meta.env.BASE_URL}reference/players.v1.json`)

function portraitKey(saveId: string, checkpointDate: string | null) {
  return `${saveId}|${checkpointDate ?? 'none'}`
}

function clearPortraitKeys(saveId: string) {
  for (const key of [...currentPlayers.keys()]) if (key.startsWith(`${saveId}|`)) currentPlayers.delete(key)
  for (const key of [...currentPlayerSummaries.keys()]) if (key.startsWith(`${saveId}|`)) currentPlayerSummaries.delete(key)
}

function emptyCurrentState(checkpointDate: string | null, observedAtCheckpoint = false): CurrentFactualPlayerState {
  return {
    checkpointDate,
    observedAtCheckpoint,
    membership: null,
    currentClubName: null,
    ownerClubName: null,
    loanFromClubName: null,
    loanToClubName: null,
    currentClubSource: 'unknown',
  }
}

export function loadPlayers(saveId: string) {
  const cached = players.get(saveId)
  if (cached) return cached
  const request = (async () => {
    if (!supabase) return []
    const result = await supabase
      .from('players')
      .select(`id,current_name,nationality,last_seen_date,is_active,${PLAYER_SNAPSHOT_EMBED}(id,snapshot_date,age,club,squad,positions,contract_expiry,preferred_foot,height,weight,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))`)
      .eq('save_id', saveId)
      .order('current_name')
    if (result.error) throw result.error
    return (result.data ?? []).map(row => ({
      ...(row as unknown as Omit<RichPlayer, 'current_factual'>),
      current_factual: emptyCurrentState(null),
    }))
  })().catch(error => { players.delete(saveId); throw error })
  players.set(saveId, request)
  return request
}

export function loadCurrentCheckpoint(saveId: string): Promise<string | null> {
  const cached = checkpoints.get(saveId)
  if (cached) return cached
  const request = (async () => {
    if (!supabase) return null
    const result = await supabase
      .from('imports')
      .select('status,snapshot_date')
      .eq('save_id', saveId)
      .eq('status', 'imported')
      .not('snapshot_date', 'is', null)
      .order('snapshot_date', { ascending: false })
      .limit(1)
    if (result.error) throw result.error
    return resolveCurrentCheckpointDate((result.data ?? []) as Array<{ status: string; snapshot_date: string | null }>)
  })().catch(error => { checkpoints.delete(saveId); throw error })
  checkpoints.set(saveId, request)
  return request
}

async function loadCurrentIdentities(saveId: string): Promise<IdentityRow[]> {
  if (!supabase) return []
  const result = await supabase.from('players').select('id,current_name,nationality,last_seen_date,is_active').eq('save_id', saveId).order('current_name')
  if (result.error) throw result.error
  return (result.data ?? []) as unknown as IdentityRow[]
}

async function loadExactSnapshots(saveId: string, checkpointDate: string): Promise<SnapshotQueryRow[]> {
  if (!supabase) return []
  const result = await supabase
    .from('player_snapshots')
    .select('id,player_id,snapshot_date,age,club,squad,positions,contract_expiry,preferred_foot,height,weight,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category)')
    .eq('save_id', saveId)
    .eq('snapshot_date', checkpointDate)
  if (result.error) throw result.error
  return (result.data ?? []) as unknown as SnapshotQueryRow[]
}

function isFmSnapshot(snapshot: SnapshotQueryRow) {
  const normalized = snapshot.normalized_data ?? {}
  const source = typeof normalized.source === 'string' ? normalized.source : ''
  const importSource = typeof normalized.import_source === 'string' ? normalized.import_source : ''
  return source === 'fm26-save-offline' || importSource.includes('fm26-offline') || importSource.includes('csv+fm26')
}

function uniqueExactCsvLabel(snapshots: SnapshotQueryRow[], key: 'club' | 'squad'): string | null {
  const values = [...new Set(snapshots
    .filter(snapshot => !isFmSnapshot(snapshot))
    .map(snapshot => snapshot[key]?.trim() ?? '')
    .filter(Boolean))]
  return values.length === 1 ? values[0] : null
}

function confirmedValue<T>(field: FactualResolvedField<T> | undefined): T | null {
  return field?.status === 'confirmed' ? field.value : null
}

async function hydrateClubNames(saveId: string, contexts: Map<string, FactualMembershipContext>): Promise<Map<string, Club>> {
  if (!supabase) return new Map()
  const ids = [...new Set([...contexts.values()].flatMap(context => [
    confirmedValue(context.current.currentClubId),
    confirmedValue(context.current.ownerClubId),
    confirmedValue(context.current.loanFromClubId),
    confirmedValue(context.current.loanToClubId),
  ]).filter((value): value is string => Boolean(value)))]
  if (!ids.length) return new Map()
  const result = await supabase.from('clubs').select('*').eq('save_id', saveId).in('id', ids)
  if (result.error) throw result.error
  return new Map(((result.data ?? []) as unknown as Club[]).map(club => [club.id, club]))
}

function factualState(
  checkpointDate: string | null,
  snapshots: SnapshotQueryRow[],
  context: FactualMembershipContext | null,
  clubs: Map<string, Club>,
): CurrentFactualPlayerState {
  const currentClubId = confirmedValue(context?.current.currentClubId)
  const ownerClubId = confirmedValue(context?.current.ownerClubId)
  const loanFromId = confirmedValue(context?.current.loanFromClubId)
  const loanToId = confirmedValue(context?.current.loanToClubId)
  const snapshotLabel = uniqueExactCsvLabel(snapshots, 'club')
  const currentClubName = currentClubId ? clubs.get(currentClubId)?.name ?? null : snapshotLabel
  return {
    checkpointDate,
    observedAtCheckpoint: snapshots.length > 0,
    membership: context,
    currentClubName,
    ownerClubName: ownerClubId ? clubs.get(ownerClubId)?.name ?? null : null,
    loanFromClubName: loanFromId ? clubs.get(loanFromId)?.name ?? null : null,
    loanToClubName: loanToId ? clubs.get(loanToId)?.name ?? null : null,
    currentClubSource: currentClubId ? 'membership' : snapshotLabel ? 'snapshot-label' : 'unknown',
  }
}

function applyFactualSnapshotFields(snapshot: RichSnapshot | null, rawSnapshots: SnapshotQueryRow[], context: FactualMembershipContext | null, clubs: Map<string, Club>) {
  if (!snapshot) return null
  const currentClubField = context?.current.currentClubId
  const squadField = context?.current.squadName
  const confirmedClubId = confirmedValue(currentClubField)
  const confirmedSquad = confirmedValue(squadField)
  const exactCsvClub = uniqueExactCsvLabel(rawSnapshots, 'club')
  const exactCsvSquad = uniqueExactCsvLabel(rawSnapshots, 'squad')

  let club: string | null = null
  if (confirmedClubId) club = clubs.get(confirmedClubId)?.name ?? null
  else if (currentClubField?.status === 'conflicting' || currentClubField?.status === 'ambiguous') club = null
  else club = exactCsvClub

  let squad: string | null = null
  if (confirmedSquad) squad = confirmedSquad
  else if (squadField?.status === 'conflicting' || squadField?.status === 'ambiguous') squad = null
  else squad = exactCsvSquad

  return { ...snapshot, club, squad }
}

async function resolvePortrait(saveId: string, identities: IdentityRow[], snapshots: SnapshotQueryRow[], checkpointDate: string | null): Promise<RichPlayer[]> {
  const byPlayer = new Map<string, SnapshotQueryRow[]>()
  for (const snapshot of snapshots) byPlayer.set(snapshot.player_id, [...(byPlayer.get(snapshot.player_id) ?? []), snapshot])
  const contexts = checkpointDate
    ? await loadFactualMembershipContexts(saveId, checkpointDate, { playerIds: identities.map(identity => identity.id), includeLastConfirmed: false })
    : new Map<string, FactualMembershipContext>()
  const clubs = await hydrateClubNames(saveId, contexts)

  return identities.map(identity => {
    const raw = byPlayer.get(identity.id) ?? []
    const merged = checkpointDate ? resolveSameDateSnapshotGroup(raw, checkpointDate) as RichSnapshot | null : null
    const context = contexts.get(identity.id) ?? null
    const exact = applyFactualSnapshotFields(merged, raw, context, clubs)
    return {
      ...identity,
      player_snapshots: exact ? [exact] : [],
      current_factual: factualState(checkpointDate, raw, context, clubs),
    }
  })
}

export function loadCurrentPlayers(saveId: string): Promise<RichPlayer[]>
export function loadCurrentPlayers(saveId: string, options: CurrentPlayerOptions): Promise<CurrentPlayerSummary[]>
export async function loadCurrentPlayers(saveId: string, options?: CurrentPlayerOptions): Promise<RichPlayer[] | CurrentPlayerSummary[]> {
  const checkpointDate = await loadCurrentCheckpoint(saveId)
  const key = portraitKey(saveId, checkpointDate)

  if (options?.summary) {
    const cached = currentPlayerSummaries.get(key)
    if (cached) return cached
    const request = (async () => {
      if (!checkpointDate) return []
      const snapshots = await loadExactSnapshots(saveId, checkpointDate)
      const observedIds = [...new Set(snapshots.map(snapshot => snapshot.player_id))]
      if (!observedIds.length || !supabase) return []
      const identitiesResult = await supabase.from('players').select('id,current_name,is_active,nationality,last_seen_date').eq('save_id', saveId).in('id', observedIds).order('current_name')
      if (identitiesResult.error) throw identitiesResult.error
      const portrait = await resolvePortrait(saveId, (identitiesResult.data ?? []) as unknown as IdentityRow[], snapshots, checkpointDate)
      return portrait.flatMap(player => {
        const exact = player.player_snapshots[0]
        return exact ? [{
          id: player.id,
          current_name: player.current_name,
          is_active: player.is_active,
          player_snapshots: [{ id: exact.id, snapshot_date: exact.snapshot_date, age: exact.age, club: exact.club, squad: exact.squad, positions: exact.positions, source_snapshot_ids: exact.source_snapshot_ids }],
        }] : []
      })
    })().catch(error => { currentPlayerSummaries.delete(key); throw error })
    currentPlayerSummaries.set(key, request)
    return request
  }

  const cached = currentPlayers.get(key)
  if (cached) return cached
  const request = (async () => {
    const [identities, snapshots] = await Promise.all([
      loadCurrentIdentities(saveId),
      checkpointDate ? loadExactSnapshots(saveId, checkpointDate) : Promise.resolve([] as SnapshotQueryRow[]),
    ])
    return resolvePortrait(saveId, identities, snapshots, checkpointDate)
  })().catch(error => { currentPlayers.delete(key); throw error })
  currentPlayers.set(key, request)
  return request
}

export function preloadSave(saveId: string) { void loadCurrentPlayers(saveId).catch(() => undefined) }

export function invalidateSaveData(saveId: string) {
  players.delete(saveId)
  checkpoints.delete(saveId)
  clearPortraitKeys(saveId)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SAVE_FACTS_INVALIDATED_EVENT, { detail: { saveId } }))
}

export function loadReferenceDataset() {
  return referenceLoader()
}
