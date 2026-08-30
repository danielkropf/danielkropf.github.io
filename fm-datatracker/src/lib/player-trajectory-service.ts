import { supabase } from './supabase'
import type { SaveEvent } from '../types/domain'

export type PlayerSaveEventData = {
  events: SaveEvent[]
  diagnostic: string | null
}

function dbError(error: { message?: string; details?: string; hint?: string } | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' — ') || 'Falha ao carregar eventos longitudinais.'
}

export async function loadPlayerSaveEvents(saveId: string, playerId: string): Promise<PlayerSaveEventData> {
  if (!supabase) return { events: [], diagnostic: 'Banco Mestre não configurado.' }
  try {
    const result = await supabase
      .from('save_events')
      .select('*')
      .eq('save_id', saveId)
      .eq('player_id', playerId)
      .order('event_date')
      .order('created_at')
    if (result.error) throw new Error(dbError(result.error))
    return { events: (result.data ?? []) as SaveEvent[], diagnostic: null }
  } catch (cause) {
    return {
      events: [],
      diagnostic: cause instanceof Error ? cause.message : 'Falha desconhecida ao carregar eventos longitudinais.',
    }
  }
}
