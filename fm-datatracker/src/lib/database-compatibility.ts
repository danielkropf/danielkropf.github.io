import { supabase } from './supabase'
import { describeDbError, isMissingRpcError } from './db-error'

export const REQUIRED_DATABASE_SCHEMA = '202608280003'
const STALE_RECHECK_MS = 30_000

export type DatabaseCapabilities = {
  importRpc: boolean
  deleteImportRpc: boolean
  modelConfigPatch: boolean
  projections: boolean
  diagnosticsTable: boolean
  diagnosticsBucket: boolean
  diagnosticsReservations: boolean
  diagnosticsServerRetention: boolean
  diagnosticsUpload: boolean
}

export type DatabaseCompatibility = {
  status: 'compatible' | 'outdated' | 'unversioned' | 'unavailable'
  schemaVersion: string | null
  capabilities: DatabaseCapabilities
  diagnostic: string | null
}

const NO_CAPABILITIES: DatabaseCapabilities = {
  importRpc: false,
  deleteImportRpc: false,
  modelConfigPatch: false,
  projections: false,
  diagnosticsTable: false,
  diagnosticsBucket: false,
  diagnosticsReservations: false,
  diagnosticsServerRetention: false,
  diagnosticsUpload: false,
}

let cached: Promise<DatabaseCompatibility> | null = null
let cachedAt = 0
let cachedStatus: DatabaseCompatibility['status'] | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function normalizedVersion(value: unknown) {
  return typeof value === 'string' && /^\d{12}$/.test(value) ? value : null
}
function capability(source: Record<string, unknown>, key: string) { return source[key] === true }
function shouldReuseCache(force: boolean) {
  if (force || !cached) return false
  if (cachedStatus === 'compatible') return true
  return Date.now() - cachedAt < STALE_RECHECK_MS
}

export function parseDatabaseCompatibilityInfo(value: unknown): DatabaseCompatibility {
  if (!isRecord(value)) {
    return { status: 'unversioned', schemaVersion: null, capabilities: { ...NO_CAPABILITIES }, diagnostic: 'O banco respondeu sem metadata de schema reconhecível.' }
  }
  const schemaVersion = normalizedVersion(value.schema_version)
  if (!schemaVersion) {
    return { status: 'unversioned', schemaVersion: null, capabilities: { ...NO_CAPABILITIES }, diagnostic: 'O banco respondeu sem uma versão de schema reconhecível.' }
  }
  if (schemaVersion < REQUIRED_DATABASE_SCHEMA) {
    return { status: 'outdated', schemaVersion, capabilities: { ...NO_CAPABILITIES }, diagnostic: `Schema ${schemaVersion}; esta versão espera ${REQUIRED_DATABASE_SCHEMA}.` }
  }
  if (!isRecord(value.capabilities)) {
    return { status: 'unversioned', schemaVersion, capabilities: { ...NO_CAPABILITIES }, diagnostic: 'O schema informa uma versão recente, mas não expõe capability detection explícita. Atualize as migrations antes de continuar.' }
  }

  const source = value.capabilities
  const diagnosticsServerRetention = capability(source, 'diagnostics_server_retention')
  const capabilities: DatabaseCapabilities = {
    importRpc: capability(source, 'import_rpc'),
    deleteImportRpc: capability(source, 'delete_import_rpc'),
    modelConfigPatch: capability(source, 'model_config_patch'),
    projections: capability(source, 'projections'),
    diagnosticsTable: capability(source, 'diagnostics_table'),
    diagnosticsBucket: capability(source, 'diagnostics_bucket'),
    diagnosticsReservations: capability(source, 'diagnostics_reservations'),
    diagnosticsServerRetention,
    // Diagnostic upload is only safe when the server-side retention contract is
    // actually active. Keep the rest of the application compatible if retention
    // is temporarily unavailable, but fail closed for new private .fm uploads.
    diagnosticsUpload: capability(source, 'diagnostics_upload') && diagnosticsServerRetention,
  }
  const missingCore = [
    capabilities.importRpc ? null : 'import RPC',
    capabilities.deleteImportRpc ? null : 'delete import RPC',
    capabilities.modelConfigPatch ? null : 'model config patch',
    capabilities.projections ? null : 'projections',
  ].filter((item): item is string => Boolean(item))
  if (missingCore.length) {
    return {
      status: 'outdated',
      schemaVersion,
      capabilities,
      diagnostic: `Schema ${schemaVersion} sem capabilities obrigatórias: ${missingCore.join(', ')}.`,
    }
  }
  return { status: 'compatible', schemaVersion, capabilities, diagnostic: null }
}

export function checkDatabaseCompatibility(force = false): Promise<DatabaseCompatibility> {
  if (shouldReuseCache(force) && cached) return cached
  cachedAt = Date.now()
  cached = (async () => {
    if (!supabase) return { status: 'unavailable', schemaVersion: null, capabilities: { ...NO_CAPABILITIES }, diagnostic: 'Banco Mestre não configurado.' } as DatabaseCompatibility
    const { data, error } = await supabase.rpc('datatracker_schema_info')
    if (error) {
      const info = describeDbError(error)
      if (isMissingRpcError(error) || info.code === 'PGRST202') {
        return { status: 'unversioned', schemaVersion: null, capabilities: { ...NO_CAPABILITIES }, diagnostic: 'O banco online não possui o marcador de schema desta versão.' } as DatabaseCompatibility
      }
      return { status: 'unavailable', schemaVersion: null, capabilities: { ...NO_CAPABILITIES }, diagnostic: info.full } as DatabaseCompatibility
    }
    return parseDatabaseCompatibilityInfo(data)
  })().then(result => {
    cachedStatus = result.status
    return result
  })
  return cached
}

export function resetDatabaseCompatibilityCache() {
  cached = null
  cachedAt = 0
  cachedStatus = null
}
