import { supabase } from './supabase'
import type { PlayerRow } from '../types/domain'
import type { ReferenceDataset } from './reference'

type RichPlayer = PlayerRow & {
  player_snapshots: Array<PlayerRow['player_snapshots'][number] & {
    preferred_foot?: string | null
    height?: number | null
    weight?: number | null
  }>
}

const players = new Map<string, Promise<RichPlayer[]>>()
const currentPlayers = new Map<string, Promise<RichPlayer[]>>()
let reference: Promise<ReferenceDataset | null> | null = null

export function loadPlayers(saveId: string) {
  const cached = players.get(saveId)
  if (cached) return cached
  const request = (async () => {
    if (!supabase) return []
    const result = await supabase.from('players').select('id,current_name,nationality,last_seen_date,is_active,player_snapshots(id,snapshot_date,age,club,squad,positions,contract_expiry,preferred_foot,height,weight,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))').eq('save_id', saveId).order('current_name')
    if (result.error) throw result.error
    return (result.data ?? []) as unknown as RichPlayer[]
  })().catch(error => { players.delete(saveId); throw error })
  players.set(saveId, request)
  return request
}

export function loadCurrentPlayers(saveId: string) {
  const cached = currentPlayers.get(saveId)
  if (cached) return cached
  const request = (async () => {
    if (!supabase) return []
    const result = await supabase
      .from('players')
      .select('id,current_name,nationality,last_seen_date,is_active,player_snapshots(id,snapshot_date,age,club,squad,positions,contract_expiry,preferred_foot,height,weight,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))')
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
export function invalidateSaveData(saveId: string) { players.delete(saveId); currentPlayers.delete(saveId) }

export function loadReferenceDataset() {
  if (!reference) reference = fetch(`${import.meta.env.BASE_URL}reference/players.v1.json`).then(response => {
    if (!response.ok) throw new Error('Base de referência indisponível')
    return response.json() as Promise<ReferenceDataset>
  }).catch(() => null)
  return reference
}
