import { supabase } from './supabase'
import { describeDbError, isMissingRpcError } from './db-error'

export const REQUIRED_DATABASE_SCHEMA = '202608260002'
const STALE_RECHECK_MS = 30_000

export type DatabaseCompatibility = {
  status: 'compatible' | 'outdated' | 'unversioned' | 'unavailable'
  schemaVersion: string | null
  diagnostic: string | null
}

let cached: Promise<DatabaseCompatibility> | null = null
let cachedAt = 0
let cachedStatus: DatabaseCompatibility['status'] | null = null

function normalizedVersion(value: unknown) {
  return typeof value === 'string' && /^\d{12}$/.test(value) ? value : null
}

function shouldReuseCache(force: boolean) {
  if (force || !cached) return false
  if (cachedStatus === 'compatible') return true
  return Date.now() - cachedAt < STALE_RECHECK_MS
}

export function checkDatabaseCompatibility(force = false): Promise<DatabaseCompatibility> {
  if (shouldReuseCache(force)) return cached!
  cachedAt = Date.now()
  cached = (async () => {
    if (!supabase) return { status: 'unavailable', schemaVersion: null, diagnostic: 'Banco Mestre não configurado.' } as DatabaseCompatibility
    const { data, error } = await supabase.rpc('datatracker_schema_info')
    if (error) {
      const info = describeDbError(error)
      if (isMissingRpcError(error) || info.code === 'PGRST202') {
        return { status: 'unversioned', schemaVersion: null, diagnostic: 'O banco online não possui o marcador de schema desta versão.' } as DatabaseCompatibility
      }
      return { status: 'unavailable', schemaVersion: null, diagnostic: info.full } as DatabaseCompatibility
    }
    const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
    const schemaVersion = normalizedVersion(row.schema_version)
    if (!schemaVersion) return { status: 'unversioned', schemaVersion: null, diagnostic: 'O banco respondeu sem uma versão de schema reconhecível.' } as DatabaseCompatibility
    if (schemaVersion < REQUIRED_DATABASE_SCHEMA) return { status: 'outdated', schemaVersion, diagnostic: `Schema ${schemaVersion}; esta versão espera ${REQUIRED_DATABASE_SCHEMA}.` } as DatabaseCompatibility
    return { status: 'compatible', schemaVersion, diagnostic: null } as DatabaseCompatibility
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
