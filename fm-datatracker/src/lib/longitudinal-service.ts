import { supabase } from './supabase'
import { buildSaveStructure, withLegacySaveStructure } from './longitudinal-domain'
import type {
  Club,
  PlayerMembership,
  PlayerMembershipWithClubs,
  Save,
  SaveClub,
  Season,
  TrackedClub,
} from '../types/domain'

function client() {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  return supabase
}

function dbError(error: { message?: string; details?: string; hint?: string } | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' — ') || 'Falha ao carregar domínio longitudinal.'
}

export async function loadTrackedClubs(saveId: string): Promise<TrackedClub[]> {
  const db = client()
  const memberships = await db.from('save_clubs').select('*').eq('save_id', saveId).order('display_order')
  if (memberships.error) throw new Error(dbError(memberships.error))
  const rows = (memberships.data ?? []) as SaveClub[]
  const clubIds = [...new Set(rows.map(row => row.club_id))]
  if (!clubIds.length) return []
  const clubsResult = await db.from('clubs').select('*').eq('save_id', saveId).in('id', clubIds)
  if (clubsResult.error) throw new Error(dbError(clubsResult.error))
  const clubs = new Map(((clubsResult.data ?? []) as Club[]).map(club => [club.id, club]))
  return rows.flatMap(row => {
    const club = clubs.get(row.club_id)
    return club ? [{ ...row, club }] : []
  })
}

export async function loadSeasons(saveId: string): Promise<Season[]> {
  const result = await client().from('seasons').select('*').eq('save_id', saveId).order('ordinal').order('label')
  if (result.error) throw new Error(dbError(result.error))
  return (result.data ?? []) as Season[]
}

export async function resolvePrimaryClub(saveId: string): Promise<Club | null> {
  const tracked = await loadTrackedClubs(saveId)
  return tracked.find(item => item.is_active && item.tracking_role === 'primary')?.club ?? null
}

export async function loadSaveStructure(save: Save): Promise<Save> {
  try {
    const [trackedClubs, seasons] = await Promise.all([loadTrackedClubs(save.id), loadSeasons(save.id)])
    return { ...save, structure: buildSaveStructure(save, trackedClubs, seasons) }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Falha desconhecida ao carregar domínio longitudinal.'
    return withLegacySaveStructure(save, message)
  }
}

export async function loadSaveStructures(saves: Save[]): Promise<Save[]> {
  if (!saves.length) return []
  const db = client()
  const saveIds = saves.map(save => save.id)
  try {
    const [saveClubsResult, clubsResult, seasonsResult] = await Promise.all([
      db.from('save_clubs').select('*').in('save_id', saveIds).order('display_order'),
      db.from('clubs').select('*').in('save_id', saveIds),
      db.from('seasons').select('*').in('save_id', saveIds).order('ordinal').order('label'),
    ])
    if (saveClubsResult.error) throw new Error(dbError(saveClubsResult.error))
    if (clubsResult.error) throw new Error(dbError(clubsResult.error))
    if (seasonsResult.error) throw new Error(dbError(seasonsResult.error))

    const saveClubs = (saveClubsResult.data ?? []) as SaveClub[]
    const clubs = (clubsResult.data ?? []) as Club[]
    const seasons = (seasonsResult.data ?? []) as Season[]
    const clubById = new Map(clubs.map(club => [club.id, club]))

    return saves.map(save => {
      const trackedClubs: TrackedClub[] = saveClubs
        .filter(row => row.save_id === save.id)
        .flatMap(row => {
          const club = clubById.get(row.club_id)
          return club ? [{ ...row, club }] : []
        })
      return {
        ...save,
        structure: buildSaveStructure(save, trackedClubs, seasons.filter(season => season.save_id === save.id)),
      }
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Falha desconhecida ao carregar domínio longitudinal.'
    return saves.map(save => withLegacySaveStructure(save, message))
  }
}

export async function loadPlayerMembershipHistory(
  saveId: string,
  playerId: string,
): Promise<PlayerMembershipWithClubs[]> {
  const db = client()
  const membershipsResult = await db
    .from('player_memberships')
    .select('*')
    .eq('save_id', saveId)
    .eq('player_id', playerId)
    .order('observed_date')
    .order('created_at')

  if (membershipsResult.error) throw new Error(dbError(membershipsResult.error))
  const memberships = (membershipsResult.data ?? []) as PlayerMembership[]
  const clubIds = [...new Set(memberships.flatMap(row => [
    row.current_club_id,
    row.owner_club_id,
    row.loan_from_club_id,
    row.loan_to_club_id,
  ]).filter((value): value is string => Boolean(value)))]

  let clubs = new Map<string, Club>()
  if (clubIds.length) {
    const clubsResult = await db.from('clubs').select('*').eq('save_id', saveId).in('id', clubIds)
    if (clubsResult.error) throw new Error(dbError(clubsResult.error))
    clubs = new Map(((clubsResult.data ?? []) as Club[]).map(club => [club.id, club]))
  }

  return memberships.map(row => ({
    ...row,
    currentClub: row.current_club_id ? clubs.get(row.current_club_id) ?? null : null,
    ownerClub: row.owner_club_id ? clubs.get(row.owner_club_id) ?? null : null,
    loanFromClub: row.loan_from_club_id ? clubs.get(row.loan_from_club_id) ?? null : null,
    loanToClub: row.loan_to_club_id ? clubs.get(row.loan_to_club_id) ?? null : null,
  }))
}
