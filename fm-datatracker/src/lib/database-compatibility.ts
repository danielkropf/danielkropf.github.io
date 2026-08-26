import { supabase } from './supabase'
import { describeDbError, isMissingRpcError } from './db-error'

export const REQUIRED_DATABASE_SCHEMA = '202608260001'

export type DatabaseCompatibility = {
  status: 'compatible' | 'outdated' | 'unversioned' | 'unavailable'
  schemaVersion: string | null
  diagnostic: string | null
}

let cached: Promise<DatabaseCompatibility> | null = null

function normalizedVersion(value: unknown) {
  return typeof value === 'string' && /^\d{12}$/.test(value) ? value : null
}

export function checkDatabaseCompatibility(force = false): Promise<DatabaseCompatibility> {
  if (!force && cached) return cached
  cached = (async () => {
    if (!supabase) return { status: 'unavailable', schemaVersion: null, diagnostic: 'Banco Mestre não configurado.' }
    const { data, error } = await supabase.rpc('datatracker_schema_info')
    if (error) {
      const info = describeDbError(error)
      if (isMissingRpcError(error) || info.code === 'PGRST202') {
        return { status: 'unversioned', schemaVersion: null, diagnostic: 'O banco online não possui o marcador de schema desta versão.' }
      }
      return { status: 'unavailable', schemaVersion: null, diagnostic: info.full }
    }
    const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
    const schemaVersion = normalizedVersion(row.schema_version)
    if (!schemaVersion) return { status: 'unversioned', schemaVersion: null, diagnostic: 'O banco respondeu sem uma versão de schema reconhecível.' }
    if (schemaVersion < REQUIRED_DATABASE_SCHEMA) return { status: 'outdated', schemaVersion, diagnostic: `Schema ${schemaVersion}; esta versão espera ${REQUIRED_DATABASE_SCHEMA}.` }
    return { status: 'compatible', schemaVersion, diagnostic: null }
  })()
  return cached
}

export function resetDatabaseCompatibilityCache() { cached = null }
