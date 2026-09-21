import { supabase } from './supabase'
import { currentLeague, isLeagueReference, leaguePopulation, type LeagueReference } from './league-reference'
import { fileHash } from './importer'

/** Validate both the .fm fingerprint and the enclosing CSV+.fm import fingerprint. */
export async function persistLeagueReference(args: { saveId: string; importId: string; importHash: string; fmFileHash: string; date: string; value: unknown; mode: string }) {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  if (!['fm-beta', 'validated'].includes(args.mode) || !isLeagueReference(args.value) || args.value.checkpoint !== args.date || await fileHash(args.value.sourceSha256) !== args.fmFileHash) throw new Error('A referência não corresponde ao arquivo .fm validado e à data da importação.')
  const { data: row, error } = await supabase.from('imports').select('id,file_hash,snapshot_date,source_schema,status').eq('save_id', args.saveId).eq('id', args.importId).maybeSingle()
  if (error) throw error
  if (!row || row.file_hash !== args.importHash || row.snapshot_date !== args.date || row.status !== 'imported') throw new Error('Importação de referência não confirmada neste save.')
  const schema = row.source_schema && typeof row.source_schema === 'object' && !Array.isArray(row.source_schema) ? row.source_schema : {}
  const payload = { save_id: args.saveId, import_id: args.importId, import_hash: args.importHash, fm_file_hash: args.fmFileHash, data: args.value }
  const { data: updated, error: writeError } = await supabase.from('imports').update({ source_schema: { ...schema, league_reference: payload } }).eq('save_id', args.saveId).eq('id', args.importId).eq('file_hash', args.importHash).eq('snapshot_date', args.date).eq('status', 'imported').select('id').maybeSingle()
  if (writeError) throw writeError
  if (!updated) throw new Error('A referência não foi gravada; confira a permissão da importação.')
}

export async function loadLeagueReference(saveId: string, date: string): Promise<LeagueReference | null> {
  if (!supabase) return null
  // Latest accepted import at the exact current checkpoint. No previous-date fallback.
  const { data: row, error } = await supabase.from('imports').select('id,file_hash,reference:source_schema->league_reference').eq('save_id', saveId).eq('snapshot_date', date).eq('status', 'imported').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const p = row?.reference as unknown as { save_id?: string; import_id?: string; import_hash?: string; fm_file_hash?: string; data?: unknown } | null
  if (!row || !p || p.save_id !== saveId || p.import_id !== row?.id || p.import_hash !== row.file_hash || !isLeagueReference(p.data) || p.data.checkpoint !== date || await fileHash(p.data.sourceSha256) !== p.fm_file_hash) return null
  return p.data
}


export type LeagueReferenceSelection = {
  data: LeagueReference | null
  requestedDate: string
  sourceDate: string | null
  fallback: boolean
}

function soleHumanTeam(data: LeagueReference | null) {
  return data?.humanTeams.length === 1 ? data.humanTeams[0].team : null
}

export function hasUsableLeagueComparison(data: LeagueReference | null, preferredTeam?: number | null) {
  if (!data) return false
  const team = preferredTeam ?? soleHumanTeam(data)
  if (team === null || !data.humanTeams.some(item => item.team === team)) return false
  const league = currentLeague(data, team)
  if (!league.cohort || league.cohort.uid === null) return false
  return leaguePopulation(data, league.cohort.uid).status === 'available_partial'
}

/**
 * Resolve the freshest usable league comparison at or before the requested checkpoint.
 * Exact-checkpoint data always wins. When that reference cannot produce a current/latest
 * completed league population, walk backward through this save only until the first
 * usable reference for the same human team is found.
 */
export async function loadBestLeagueReference(saveId: string, date: string): Promise<LeagueReferenceSelection> {
  const exact = await loadLeagueReference(saveId, date)
  const preferredTeam = soleHumanTeam(exact)
  if (hasUsableLeagueComparison(exact, preferredTeam)) return { data: exact, requestedDate: date, sourceDate: date, fallback: false }
  if (!supabase) return { data: exact, requestedDate: date, sourceDate: exact ? date : null, fallback: false }

  let before = date
  while (true) {
    const { data: row, error } = await supabase.from('imports').select('snapshot_date').eq('save_id', saveId).eq('status', 'imported').lt('snapshot_date', before).order('snapshot_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    const previousDate = typeof row?.snapshot_date === 'string' ? row.snapshot_date : null
    if (!previousDate || previousDate >= before) break
    before = previousDate
    const candidate = await loadLeagueReference(saveId, previousDate)
    const candidateTeam = preferredTeam ?? soleHumanTeam(candidate)
    if (hasUsableLeagueComparison(candidate, candidateTeam)) return { data: candidate, requestedDate: date, sourceDate: previousDate, fallback: true }
  }
  return { data: exact, requestedDate: date, sourceDate: exact ? date : null, fallback: false }
}
