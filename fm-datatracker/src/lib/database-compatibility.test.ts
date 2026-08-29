import { describe, expect, it } from 'vitest'
import { parseDatabaseCompatibilityInfo, REQUIRED_DATABASE_SCHEMA } from './database-compatibility'

const allCapabilities = {
  import_rpc: true, delete_import_rpc: true, model_config_patch: true, projections: true,
  diagnostics_table: true, diagnostics_bucket: true, diagnostics_reservations: true, diagnostics_upload: true, diagnostics_server_retention: true,
  longitudinal_core: true, longitudinal_backfill: true, longitudinal_save_structure: true, longitudinal_imports: true,
  analyzer_stats_context: true,
}

describe('database capability detection', () => {
  it('aceita Fase 1A somente com fundação longitudinal e contexto estatístico', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, capabilities: allCapabilities })
    expect(result.status).toBe('compatible')
    expect(result.capabilities.longitudinalCore).toBe(true)
    expect(result.capabilities.analyzerStatsContext).toBe(true)
  })
  it('rejeita o schema final da Fase 0 sem a migration do Analyzer', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608290004', capabilities: allCapabilities })
    expect(result.status).toBe('outdated')
    expect(result.diagnostic).toContain(REQUIRED_DATABASE_SCHEMA)
  })
  it('falha fechado se analyzer stats context não estiver ativo', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, capabilities: { ...allCapabilities, analyzer_stats_context: false } })
    expect(result.status).toBe('outdated')
    expect(result.capabilities.analyzerStatsContext).toBe(false)
    expect(result.diagnostic).toContain('analyzer stats context')
  })
  it('mantém diagnóstico privado fail-closed sem tornar o restante do app incompatível', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, capabilities: { ...allCapabilities, diagnostics_server_retention: false } })
    expect(result.status).toBe('compatible')
    expect(result.capabilities.diagnosticsUpload).toBe(false)
  })
  it('não trata número alto de schema como prova de capability', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, capabilities: { ...allCapabilities, delete_import_rpc: false } })
    expect(result.status).toBe('outdated')
    expect(result.diagnostic).toContain('delete import RPC')
  })
  it('falha fechado quando capabilities explícitas não existem', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, features: ['delete_fm_import'] })
    expect(result.status).toBe('unversioned')
  })
})
