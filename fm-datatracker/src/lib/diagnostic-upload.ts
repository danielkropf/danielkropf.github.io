import { supabase } from './supabase'
import { checkDatabaseCompatibility } from './database-compatibility'

const BUCKET = 'fm-reader-samples'
const PARSER_VERSION = 'offline-v0.22'

type Reservation = { id: string; storagePrefix: string }
type DiagnosticFile = { name: string }

export type DiagnosticUploadAdapter = {
  reserve: () => Promise<Reservation>
  setPaths: (id: string, fmPath: string, csvPath: string) => Promise<void>
  upload: (path: string, file: DiagnosticFile) => Promise<void>
  complete: (id: string) => Promise<void>
  remove: (paths: string[]) => Promise<void>
  deleteReservation: (id: string) => Promise<void>
}

function safeFileName(name: string) {
  const normalized = name.replace(/[\\/]+/g, '_').replace(/[^a-zA-Z0-9._ -]+/g, '_').trim()
  return normalized || 'sample.bin'
}

export async function runDiagnosticReservationUpload(adapter: DiagnosticUploadAdapter, fmFile: DiagnosticFile, csvFile: DiagnosticFile) {
  const reservation = await adapter.reserve()
  const fmPath = `${reservation.storagePrefix}/fm-${safeFileName(fmFile.name)}`
  const csvPath = `${reservation.storagePrefix}/csv-${safeFileName(csvFile.name)}`
  const intendedPaths = [fmPath, csvPath]

  try {
    // Paths are persisted before object upload. If the page closes immediately
    // after an upload, retention cleanup still knows exactly what to remove.
    await adapter.setPaths(reservation.id, fmPath, csvPath)
    await adapter.upload(fmPath, fmFile)
    await adapter.upload(csvPath, csvFile)
    await adapter.complete(reservation.id)
    return { id: reservation.id, fmPath, csvPath }
  } catch (cause) {
    try {
      await adapter.remove(intendedPaths)
    } catch (cleanupCause) {
      const original = cause instanceof Error ? cause.message : String(cause)
      const cleanup = cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause)
      throw new Error(`${original}. O upload falhou e a limpeza imediata também falhou; a reserva foi preservada para retry/retention cleanup: ${cleanup}`)
    }
    try {
      await adapter.deleteReservation(reservation.id)
    } catch (cleanupCause) {
      console.error('Objetos diagnósticos removidos, mas a reserva não pôde ser apagada.', cleanupCause)
    }
    throw cause
  }
}

function isReservation(value: unknown): value is { id: string; storage_prefix: string } {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'id' in value
    && 'storage_prefix' in value
    && typeof value.id === 'string'
    && typeof value.storage_prefix === 'string'
}
function isExpiredRow(value: unknown): value is { id: string; fm_path: string | null; csv_path: string | null } {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'id' in value
    && typeof value.id === 'string'
}

export async function cleanupExpiredDiagnosticSamples() {
  if (!supabase) return
  const { data, error } = await supabase
    .from('fm_reader_samples')
    .select('id,fm_path,csv_path')
    .lt('expires_at', new Date().toISOString())
  if (error) throw new Error(error.message)
  for (const candidate of data ?? []) {
    if (!isExpiredRow(candidate)) continue
    const paths = [candidate.fm_path, candidate.csv_path].filter((path): path is string => typeof path === 'string' && Boolean(path))
    if (paths.length) {
      const removed = await supabase.storage.from(BUCKET).remove(paths)
      if (removed.error) {
        console.error('Não foi possível remover objetos diagnósticos expirados; metadata preservada para retry.', { id: candidate.id, error: removed.error })
        continue
      }
    }
    const deleted = await supabase.from('fm_reader_samples').delete().eq('id', candidate.id)
    if (deleted.error) console.error('Não foi possível remover metadata diagnóstica expirada.', { id: candidate.id, error: deleted.error })
  }
}

export async function uploadDiagnosticSample({
  saveId,
  fmFile,
  csvFile,
  comparison,
}: {
  saveId: string
  fmFile: File
  csvFile: File
  comparison: unknown
}) {
  if (!supabase) throw new Error('Banco Mestre não configurado.')
  const compatibility = await checkDatabaseCompatibility()
  if (compatibility.status !== 'compatible' || !compatibility.capabilities.diagnosticsUpload) {
    throw new Error(compatibility.diagnostic ?? 'O schema online não oferece o fluxo seguro de diagnóstico desta versão.')
  }
  const client = supabase
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError) throw new Error(authError.message)
  if (!user) throw new Error('Sua sessão expirou. Entre novamente para enviar o diagnóstico.')

  try {
    await cleanupExpiredDiagnosticSamples()
  } catch (cleanupError) {
    console.warn('Retention cleanup de diagnósticos não pôde ser concluído antes do novo upload.', cleanupError)
  }

  const adapter: DiagnosticUploadAdapter = {
    async reserve() {
      const result = await client.from('fm_reader_samples').insert({
        owner_id: user.id,
        save_id: saveId,
        comparison: {},
        parser_version: PARSER_VERSION,
        status: 'uploading',
      }).select('id,storage_prefix').single()
      if (result.error) throw new Error(result.error.message)
      if (!isReservation(result.data)) throw new Error('O Banco Mestre não retornou uma reserva diagnóstica válida.')
      return { id: result.data.id, storagePrefix: result.data.storage_prefix }
    },
    async setPaths(id, fmPath, csvPath) {
      const result = await client.from('fm_reader_samples').update({ fm_path: fmPath, csv_path: csvPath }).eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },
    async upload(path, file) {
      if (!(file instanceof File)) throw new Error('Arquivo diagnóstico inválido.')
      const result = await client.storage.from(BUCKET).upload(path, file, { upsert: false })
      if (result.error) throw new Error(result.error.message)
    },
    async complete(id) {
      const result = await client.from('fm_reader_samples').update({ comparison, status: 'complete' }).eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },
    async remove(paths) {
      const result = await client.storage.from(BUCKET).remove(paths)
      if (result.error) throw new Error(result.error.message)
    },
    async deleteReservation(id) {
      const result = await client.from('fm_reader_samples').delete().eq('id', id)
      if (result.error) throw new Error(result.error.message)
    },
  }

  return runDiagnosticReservationUpload(adapter, fmFile, csvFile)
}
