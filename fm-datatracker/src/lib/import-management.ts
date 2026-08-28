import { supabase } from './supabase'

type DbErrorLike = { message?: string; code?: string; details?: string; hint?: string } | null

type ImportMetaRow = { id: string; source_schema: Record<string, unknown> | null }
type ImportActivityRow = { id: string; file_type: string; snapshot_date: string; created_at: string; status: string }
type SnapshotDateRow = { player_id: string; snapshot_date: string; contract_expiry?: string | null; import_id?: string }
type StatDateRow = { player_id: string; snapshot_date: string }
type ContractRow = { id: string; player_id: string; snapshot_date: string }

const errorText = (error: DbErrorLike) => {
  if (!error) return 'erro desconhecido'
  return [error.message, error.details, error.hint].filter(Boolean).join(' — ') || error.code || 'erro desconhecido'
}

const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]
const chunks = <T,>(values: T[], size = 200) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))

export async function stampLatestImportVersion(saveId: string, appVersion: string): Promise<void> {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const { data, error } = await supabase.from('imports').select('id,source_schema').eq('save_id', saveId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(errorText(error))
  if (!data) return
  const row = data as ImportMetaRow
  const current = row.source_schema && typeof row.source_schema === 'object' && !Array.isArray(row.source_schema) ? row.source_schema : {}
  const { error: updateError } = await supabase.from('imports').update({ source_schema: { ...current, app_version: appVersion } }).eq('id', row.id).eq('save_id', saveId)
  if (updateError) throw new Error(errorText(updateError))
}

async function captureAffectedPlayers(importId: string): Promise<string[]> {
  if (!supabase) return []
  const [snapshots, stats] = await Promise.all([
    supabase.from('player_snapshots').select('player_id').eq('import_id', importId),
    supabase.from('player_stats').select('player_id').eq('import_id', importId),
  ])
  if (snapshots.error) throw new Error(errorText(snapshots.error))
  if (stats.error) throw new Error(errorText(stats.error))
  return unique([
    ...(snapshots.data ?? []).map((row: { player_id?: string }) => row.player_id),
    ...(stats.data ?? []).map((row: { player_id?: string }) => row.player_id),
  ])
}

async function cleanupAffectedPlayers(saveId: string, playerIds: string[]) {
  if (!supabase || !playerIds.length) return
  const [snapshotsResult, statsResult, contractsResult] = await Promise.all([
    supabase.from('player_snapshots').select('player_id,snapshot_date,contract_expiry').eq('save_id', saveId).in('player_id', playerIds),
    supabase.from('player_stats').select('player_id,snapshot_date').eq('save_id', saveId).in('player_id', playerIds),
    supabase.from('contracts').select('id,player_id,snapshot_date').in('player_id', playerIds),
  ])
  if (snapshotsResult.error) throw new Error(errorText(snapshotsResult.error))
  if (statsResult.error) throw new Error(errorText(statsResult.error))
  if (contractsResult.error) throw new Error(errorText(contractsResult.error))

  const snapshots = (snapshotsResult.data ?? []) as SnapshotDateRow[]
  const stats = (statsResult.data ?? []) as StatDateRow[]
  const supportedContracts = new Set(snapshots.filter(row => row.contract_expiry).map(row => `${row.player_id}|${row.snapshot_date}`))
  const orphanContractIds = ((contractsResult.data ?? []) as ContractRow[]).filter(row => !supportedContracts.has(`${row.player_id}|${row.snapshot_date}`)).map(row => row.id)
  for (const part of chunks(orphanContractIds)) {
    const { error } = await supabase.from('contracts').delete().in('id', part)
    if (error) throw new Error(errorText(error))
  }

  const datesByPlayer = new Map<string, string[]>()
  for (const row of [...snapshots, ...stats]) {
    const dates = datesByPlayer.get(row.player_id) ?? []
    dates.push(row.snapshot_date)
    datesByPlayer.set(row.player_id, dates)
  }

  for (const playerId of playerIds) {
    const dates = (datesByPlayer.get(playerId) ?? []).sort()
    if (!dates.length) {
      const { error } = await supabase.from('players').delete().eq('id', playerId).eq('save_id', saveId)
      if (error) throw new Error(errorText(error))
      continue
    }
    const { error } = await supabase.from('players').update({ first_seen_date: dates[0], last_seen_date: dates[dates.length - 1], updated_at: new Date().toISOString() }).eq('id', playerId).eq('save_id', saveId)
    if (error) throw new Error(errorText(error))
  }
}

async function recomputeActivePlayers(saveId: string) {
  if (!supabase) return
  const { data, error } = await supabase.from('imports').select('id,file_type,snapshot_date,created_at,status').eq('save_id', saveId).eq('status', 'imported').in('file_type', ['squad', 'intake'])
  if (error) throw new Error(errorText(error))
  const imports = (data ?? []) as ImportActivityRow[]
  const byNewest = [...imports].sort((left, right) => right.snapshot_date.localeCompare(left.snapshot_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
  const latestSquad = byNewest.find(item => item.file_type === 'squad') ?? null
  let activeImportIds: string[] = []
  if (latestSquad) {
    activeImportIds = unique([latestSquad.id, ...imports.filter(item => item.file_type === 'intake' && item.snapshot_date >= latestSquad.snapshot_date).map(item => item.id)])
  } else if (byNewest.length) {
    const latestDate = byNewest[0].snapshot_date
    activeImportIds = imports.filter(item => item.snapshot_date === latestDate).map(item => item.id)
  }

  const { error: deactivateError } = await supabase.from('players').update({ is_active: false, updated_at: new Date().toISOString() }).eq('save_id', saveId)
  if (deactivateError) throw new Error(errorText(deactivateError))
  if (!activeImportIds.length) return

  const { data: activeSnapshots, error: activeError } = await supabase.from('player_snapshots').select('player_id,import_id').eq('save_id', saveId).in('import_id', activeImportIds)
  if (activeError) throw new Error(errorText(activeError))
  const activePlayerIds = unique((activeSnapshots ?? []).map((row: { player_id?: string }) => row.player_id))
  for (const part of chunks(activePlayerIds)) {
    const { error: activateError } = await supabase.from('players').update({ is_active: true, updated_at: new Date().toISOString() }).eq('save_id', saveId).in('id', part)
    if (activateError) throw new Error(errorText(activateError))
  }
}

async function directDeleteImport(saveId: string, importId: string) {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const affectedPlayerIds = await captureAffectedPlayers(importId)
  const { data, error } = await supabase.from('imports').delete().eq('id', importId).eq('save_id', saveId).select('id')
  if (error) throw new Error(errorText(error))
  if (!(data ?? []).length) throw new Error('Importação não encontrada ou sem permissão para exclusão.')
  await cleanupAffectedPlayers(saveId, affectedPlayerIds)
  await recomputeActivePlayers(saveId)
}

export function isDeleteImportRpcMissing(error: DbErrorLike) {
  if (!error) return false
  const code = (error.code ?? '').toUpperCase()
  if (code !== 'PGRST202' && code !== '42883') return false
  const evidence = [error.message, error.details, error.hint].filter(Boolean).join(' ').toLowerCase()
  return evidence.includes('delete_fm_import')
}

export async function deleteWithRpcFallback(
  rpcDelete: () => Promise<{ error: DbErrorLike }>,
  fallbackDelete: () => Promise<void>,
): Promise<'rpc' | 'direct'> {
  const { error } = await rpcDelete()
  if (!error) return 'rpc'
  if (!isDeleteImportRpcMissing(error)) throw new Error(errorText(error))
  try {
    await fallbackDelete()
    return 'direct'
  } catch (fallbackError) {
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    throw new Error(`${errorText(error)}. A exclusão direta de compatibilidade também falhou: ${fallbackMessage}`)
  }
}

/**
 * Transactional RPC is the normal path. The destructive client-side fallback is
 * allowed only for a positively identified missing delete_fm_import RPC on an
 * older schema; network, auth, permission, server, constraint and unknown errors
 * fail closed without starting any direct deletion sequence.
 */
export async function deleteFmImportSafe(saveId: string, importId: string): Promise<'rpc' | 'direct'> {
  const client = supabase
  if (!client) throw new Error('Banco Mestre não configurado.')
  return deleteWithRpcFallback(
    async () => {
      const { error } = await client.rpc('delete_fm_import', { p_save_id: saveId, p_import_id: importId })
      return { error }
    },
    () => directDeleteImport(saveId, importId),
  )
}
