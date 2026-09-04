import { supabase } from './supabase'
import { buildSaveStructure, withLegacySaveStructure } from './longitudinal-domain'
import type {
  Club,
  PlayerMembership,
  PlayerMembershipWithClubs,
  Save,
  SaveClub,
  Season,
  IntakeClass,
  IntakeClassMember,
  SaveEvent,
  TrackedClub,
} from '../types/domain'

function client() {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  return supabase
}

export type IntakeArchiveMember = IntakeClassMember & {
  player: { id: string; current_name: string } | null
}
export type IntakeArchiveClass = IntakeClass & { club: Club | null; season: Season | null; members: IntakeArchiveMember[] }

export async function loadIntakeArchive(saveId: string): Promise<IntakeArchiveClass[]> {
  const db = client()
  const [classesResult, membersResult, clubsResult, seasonsResult] = await Promise.all([
    db.from('intake_classes').select('*').eq('save_id', saveId).order('intake_date', { ascending: false }).order('label'),
    db.from('intake_class_members').select('*').eq('save_id', saveId),
    db.from('clubs').select('*').eq('save_id', saveId),
    db.from('seasons').select('*').eq('save_id', saveId),
  ])
  for (const result of [classesResult, membersResult, clubsResult, seasonsResult]) if (result.error) throw new Error(dbError(result.error))
  const classes = (classesResult.data ?? []) as IntakeClass[]
  const members = (membersResult.data ?? []) as IntakeClassMember[]
  const playerIds = [...new Set(members.map(member => member.player_id))]
  const playersResult = playerIds.length
    ? await db.from('players').select('id,current_name').eq('save_id', saveId).in('id', playerIds)
    : { data: [], error: null }
  if (playersResult.error) throw new Error(dbError(playersResult.error))
  const clubs = new Map(((clubsResult.data ?? []) as Club[]).map(row => [row.id, row]))
  const seasons = new Map(((seasonsResult.data ?? []) as Season[]).map(row => [row.id, row]))
  type PlayerResult = { id: string; current_name: string }
  const players = new Map(((playersResult.data ?? []) as unknown as PlayerResult[]).map(row => [row.id, row]))
  const membersByClass = new Map<string, IntakeClassMember[]>()
  for (const member of members) membersByClass.set(member.intake_class_id, [...(membersByClass.get(member.intake_class_id) ?? []), member])
  return classes.map(row => ({
    ...row,
    club: clubs.get(row.club_id) ?? null,
    season: row.season_id ? seasons.get(row.season_id) ?? null : null,
    members: (membersByClass.get(row.id) ?? []).map(member => {
      const player = players.get(member.player_id) ?? null
      return { ...member, player: player ? { id: player.id, current_name: player.current_name } : null }
    }),
  }))
}

export async function createManualIntakeClass(saveId: string, clubId: string, label: string, intakeDate: string | null) {
  const db = client()
  const { data: auth, error: authError } = await db.auth.getUser()
  if (authError || !auth.user) throw new Error(authError ? dbError(authError) : 'Sessão inválida.')
  const normalized = label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
  const classKey = `manual:${clubId}:${intakeDate ?? normalized}`
  const { error } = await db.from('intake_classes').insert({ save_id: saveId, owner_id: auth.user.id, club_id: clubId, class_key: classKey, label: label.trim(), intake_date: intakeDate, source_kind: 'manual', provenance: { created_by: 'fm-datatracker', version: '0.29.0' } })
  if (error) throw new Error(dbError(error))
}

export type SaveHistoryEvent = SaveEvent & { club: Club | null; season: Season | null; player: { id: string; current_name: string } | null; intakeClass: IntakeClass | null }

export async function loadSaveHistory(saveId: string): Promise<SaveHistoryEvent[]> {
  const db = client()
  const [eventsResult, clubsResult, seasonsResult] = await Promise.all([
    db.from('save_events').select('*').eq('save_id', saveId).order('event_date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('clubs').select('*').eq('save_id', saveId),
    db.from('seasons').select('*').eq('save_id', saveId),
  ])
  for (const result of [eventsResult, clubsResult, seasonsResult]) if (result.error) throw new Error(dbError(result.error))
  const eventRows = (eventsResult.data ?? []) as SaveEvent[]
  const playerIds = [...new Set(eventRows.map(row => row.player_id).filter((value): value is string => Boolean(value)))]
  const classIds = [...new Set(eventRows.map(row => row.intake_class_id).filter((value): value is string => Boolean(value)))]
  const [playersResult, classesResult] = await Promise.all([
    playerIds.length ? db.from('players').select('id,current_name').eq('save_id', saveId).in('id', playerIds) : Promise.resolve({ data: [], error: null }),
    classIds.length ? db.from('intake_classes').select('*').eq('save_id', saveId).in('id', classIds) : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [playersResult, classesResult]) if (result.error) throw new Error(dbError(result.error))
  const clubs = new Map(((clubsResult.data ?? []) as Club[]).map(row => [row.id, row]))
  const seasons = new Map(((seasonsResult.data ?? []) as Season[]).map(row => [row.id, row]))
  const players = new Map(((playersResult.data ?? []) as Array<{ id: string; current_name: string }>).map(row => [row.id, row]))
  const classes = new Map(((classesResult.data ?? []) as IntakeClass[]).map(row => [row.id, row]))
  return eventRows.map(row => ({ ...row, club: row.club_id ? clubs.get(row.club_id) ?? null : null, season: row.season_id ? seasons.get(row.season_id) ?? null : null, player: row.player_id ? players.get(row.player_id) ?? null : null, intakeClass: row.intake_class_id ? classes.get(row.intake_class_id) ?? null : null }))
}

export async function createManualSaveEvent(saveId: string, input: { eventDate: string; clubId?: string | null; title: string; detail?: string | null }) {
  const db = client()
  const { data: auth, error: authError } = await db.auth.getUser()
  if (authError || !auth.user) throw new Error(authError ? dbError(authError) : 'Sessão inválida.')
  const { error } = await db.from('save_events').insert({ save_id: saveId, owner_id: auth.user.id, event_type: 'manual_fact', event_date: input.eventDate, club_id: input.clubId ?? null, source_kind: 'manual', provenance: { created_by: 'fm-datatracker', version: '0.29.0' }, payload: { title: input.title.trim(), detail: input.detail?.trim() || null } })
  if (error) throw new Error(dbError(error))
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

export async function loadClubCatalog(saveId: string): Promise<Club[]> {
  const result = await client().from('clubs').select('*').eq('save_id', saveId).order('name')
  if (result.error) throw new Error(dbError(result.error))
  return (result.data ?? []) as Club[]
}

export async function trackSaveClub(saveId: string, clubId: string): Promise<void> {
  const { error } = await client().rpc('track_save_club', { p_save_id: saveId, p_club_id: clubId })
  if (error) throw new Error(dbError(error))
}

export async function createTrackedClub(saveId: string, input: { name: string; country?: string | null }): Promise<void> {
  const { error } = await client().rpc('create_tracked_club', {
    p_save_id: saveId,
    p_name: input.name.trim(),
    p_country: input.country?.trim() || null,
  })
  if (error) throw new Error(dbError(error))
}

export async function setTrackedClubActive(saveId: string, clubId: string, active: boolean): Promise<void> {
  const { error } = await client().rpc('set_tracked_club_active', {
    p_save_id: saveId,
    p_club_id: clubId,
    p_is_active: active,
  })
  if (error) throw new Error(dbError(error))
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
  return hydrateMembershipClubs(saveId, memberships)
}

async function hydrateMembershipClubs(
  saveId: string,
  memberships: PlayerMembership[],
): Promise<PlayerMembershipWithClubs[]> {
  const db = client()
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

function expandCurrentSnapshotIds(snapshotIds: string[]) {
  return [...new Set(snapshotIds.flatMap(value => {
    if (!value.startsWith('current:')) return [value]
    const parts = value.split(':')
    return parts.length >= 3 ? parts.slice(2).join(':').split('+').filter(Boolean) : [value]
  }).filter(Boolean))]
}

/**
 * Loads only memberships explicitly linked to the supplied current snapshots.
 * Synthetic same-date checkpoint IDs are expanded to every source snapshot so
 * the caller can reconcile coverage/conflicts without upload-order precedence.
 */
export async function loadPlanningMemberships(
  saveId: string,
  snapshotIds: string[],
): Promise<PlayerMembershipWithClubs[]> {
  const db = client()
  const ids = expandCurrentSnapshotIds(snapshotIds)
  if (!ids.length) return []

  const memberships: PlayerMembership[] = []
  const chunkSize = 400
  for (let index = 0; index < ids.length; index += chunkSize) {
    const result = await db
      .from('player_memberships')
      .select('*')
      .eq('save_id', saveId)
      .in('source_snapshot_id', ids.slice(index, index + chunkSize))
      .order('observed_date')
      .order('created_at')
    if (result.error) throw new Error(dbError(result.error))
    memberships.push(...((result.data ?? []) as PlayerMembership[]))
  }
  return hydrateMembershipClubs(saveId, memberships)
}

export type PlayerEvolutionContextData = {
  memberships: PlayerMembershipWithClubs[]
  seasons: Season[]
  diagnostic: string | null
}

export async function loadPlayerEvolutionContext(
  saveId: string,
  playerId: string,
): Promise<PlayerEvolutionContextData> {
  try {
    const [memberships, seasons] = await Promise.all([
      loadPlayerMembershipHistory(saveId, playerId),
      loadSeasons(saveId),
    ])
    return { memberships, seasons, diagnostic: null }
  } catch (cause) {
    return {
      memberships: [],
      seasons: [],
      diagnostic: cause instanceof Error ? cause.message : 'Falha desconhecida ao carregar contexto longitudinal do jogador.',
    }
  }
}
