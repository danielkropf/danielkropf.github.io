import { supabase } from './supabase'
import {
  resolveFactualMembershipContext,
  type FactualMembershipContext,
  type FactualMembershipObservation,
} from './factual-membership'

type LoadOptions = {
  playerIds?: string[]
  includeLastConfirmed?: boolean
}

function db() {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  return supabase
}

/**
 * Shared E-MC-01B loader. It scopes by save + explicit checkpoint and performs
 * one membership query (chunked only when a caller provides a large player-id
 * set). It never consults players.is_active and never substitutes another date.
 */
export async function loadFactualMembershipContexts(
  saveId: string,
  checkpointDate: string,
  options: LoadOptions = {},
): Promise<Map<string, FactualMembershipContext>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkpointDate)) throw new Error('Checkpoint factual inválido.')
  const client = db()
  const ids = [...new Set((options.playerIds ?? []).filter(Boolean))]
  const chunks = ids.length ? Array.from({ length: Math.ceil(ids.length / 400) }, (_, index) => ids.slice(index * 400, index * 400 + 400)) : [null]
  const rows: FactualMembershipObservation[] = []

  for (const chunk of chunks) {
    let query = client
      .from('player_memberships')
      .select('id,player_id,observed_date,current_club_id,owner_club_id,team_level,squad_name,is_loan,loan_from_club_id,loan_to_club_id,provenance')
      .eq('save_id', saveId)
      .order('observed_date', { ascending: false })
    query = options.includeLastConfirmed === false ? query.eq('observed_date', checkpointDate) : query.lte('observed_date', checkpointDate)
    if (chunk) query = query.in('player_id', chunk)
    const result = await query
    if (result.error) throw new Error(result.error.message)
    rows.push(...((result.data ?? []) as unknown as FactualMembershipObservation[]))
  }

  const playerIds = ids.length ? ids : [...new Set(rows.map(row => row.player_id))]
  return new Map(playerIds.map(playerId => [playerId, resolveFactualMembershipContext(rows, playerId, checkpointDate)]))
}
