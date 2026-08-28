import { supabase } from './supabase'
import type { PlayerRow } from '../types/domain'
import { createReferenceDatasetLoader } from './reference-cache'

type RichPlayer = PlayerRow & {
  player_snapshots: Array<PlayerRow['player_snapshots'][number] & {
    preferred_foot?: string | null
    height?: number | null
    weight?: number | null
  }>
}

export type CurrentPlayerSummary = Pick<PlayerRow, 'id' | 'current_name' | 'is_active'> & {
  player_snapshots: Array<Pick<PlayerRow['player_snapshots'][number], 'snapshot_date' | 'age' | 'club' | 'squad' | 'positions'>>
}

type CurrentPlayerOptions = { summary: true }

// The integrity hardening intentionally uses the composite player/save FK.
// Pin every PostgREST embed to that relationship instead of relying on
// relationship inference. This keeps the public shape named player_snapshots
// while making the ownership/save relationship explicit and unambiguous.
export const PLAYER_SNAPSHOT_EMBED = 'player_snapshots:player_snapshots!player_snapshots_player_save_fkey'

const players = new Map<string, Promise<RichPlayer[]>>()
const currentPlayers = new Map<string, Promise<RichPlayer[]>>()
const currentPlayerSummaries = new Map<string, Promise<CurrentPlayerSummary[]>>()
const referenceLoader = createReferenceDatasetLoader(() => `${import.meta.env.BASE_URL}reference/players.v1.json`)

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
    return (result.data ?? []) as unknown as RichPlayer[]
  })().catch(error => { players.delete(saveId); throw error })
  players.set(saveId, request)
  return request
}

export function loadCurrentPlayers(saveId: string): Promise<RichPlayer[]>
export function loadCurrentPlayers(saveId: string, options: CurrentPlayerOptions): Promise<CurrentPlayerSummary[]>
export function loadCurrentPlayers(saveId: string, options?: CurrentPlayerOptions) {
  if (options?.summary) {
    const cached = currentPlayerSummaries.get(saveId)
    if (cached) return cached
    const request = (async () => {
      if (!supabase) return []
      const result = await supabase
        .from('players')
        .select(`id,current_name,is_active,${PLAYER_SNAPSHOT_EMBED}(snapshot_date,age,club,squad,positions)`)
        .eq('save_id', saveId)
        .eq('is_active', true)
        .order('current_name')
        .order('snapshot_date', { referencedTable: 'player_snapshots', ascending: false })
        .limit(1, { referencedTable: 'player_snapshots' })
      if (result.error) throw result.error
      return (result.data ?? []) as unknown as CurrentPlayerSummary[]
    })().catch(error => { currentPlayerSummaries.delete(saveId); throw error })
    currentPlayerSummaries.set(saveId, request)
    return request
  }

  const cached = currentPlayers.get(saveId)
  if (cached) return cached
  const request = (async () => {
    if (!supabase) return []
    const result = await supabase
      .from('players')
      .select(`id,current_name,nationality,last_seen_date,is_active,${PLAYER_SNAPSHOT_EMBED}(id,snapshot_date,age,club,squad,positions,contract_expiry,preferred_foot,height,weight,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))`)
      .eq('save_id', saveId)
      .eq('is_active', true)
      .order('current_name')
      .order('snapshot_date', { referencedTable: 'player_snapshots', ascending: false })
      .limit(1, { referencedTable: 'player_snapshots' })
    if (result.error) throw result.error
    return (result.data ?? []) as unknown as RichPlayer[]
  })().catch(error => { currentPlayers.delete(saveId); throw error })
  currentPlayers.set(saveId, request)
  return request
}

export function preloadSave(saveId: string) { void loadCurrentPlayers(saveId).catch(() => undefined) }
export function invalidateSaveData(saveId: string) {
  players.delete(saveId)
  currentPlayers.delete(saveId)
  currentPlayerSummaries.delete(saveId)
}

export function loadReferenceDataset() {
  return referenceLoader()
}
