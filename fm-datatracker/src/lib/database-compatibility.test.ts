import { describe, expect, it } from 'vitest'
import { parseDatabaseCompatibilityInfo, REQUIRED_DATABASE_SCHEMA } from './database-compatibility'

const allCapabilities = {
  import_rpc: true,
  delete_import_rpc: true,
  model_config_patch: true,
  projections: true,
  diagnostics_table: true,
  diagnostics_bucket: true,
  diagnostics_reservations: true,
  diagnostics_upload: true,
  diagnostics_server_retention: true,
  longitudinal_core: true,
  longitudinal_backfill: true,
  longitudinal_save_structure: true,
  longitudinal_imports: true,
}

describe('database capability detection', () => {
  it('aceita a fundação longitudinal somente quando todas as capabilities obrigatórias estão presentes', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, capabilities: allCapabilities })
    expect(result.status).toBe('compatible')
    expect(result.capabilities.longitudinalCore).toBe(true)
    expect(result.capabilities.longitudinalBackfill).toBe(true)
    expect(result.capabilities.longitudinalSaveStructure).toBe(true)
    expect(result.capabilities.longitudinalImports).toBe(true)
  })

  it('rejeita um schema anterior ao contrato final da Fase 0', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608290003', capabilities: allCapabilities })
    expect(result.status).toBe('outdated')
    expect(result.diagnostic).toContain(REQUIRED_DATABASE_SCHEMA)
  })

  it('falha fechado para a fundação se longitudinal imports não estiver ativo', () => {
    const result = parseDatabaseCompatibilityInfo({
      schema_version: REQUIRED_DATABASE_SCHEMA,
      capabilities: { ...allCapabilities, longitudinal_imports: false },
    })
    expect(result.status).toBe('outdated')
    expect(result.capabilities.longitudinalImports).toBe(false)
    expect(result.diagnostic).toContain('longitudinal imports')
  })

  it('mantém diagnóstico privado fail-closed sem tornar o restante do app incompatível', () => {
    const result = parseDatabaseCompatibilityInfo({
      schema_version: REQUIRED_DATABASE_SCHEMA,
      capabilities: { ...allCapabilities, diagnostics_server_retention: false },
    })
    expect(result.status).toBe('compatible')
    expect(result.capabilities.diagnosticsServerRetention).toBe(false)
    expect(result.capabilities.diagnosticsUpload).toBe(false)
  })

  it('não trata número alto de schema como prova de capability', () => {
    const result = parseDatabaseCompatibilityInfo({
      schema_version: REQUIRED_DATABASE_SCHEMA,
      capabilities: { ...allCapabilities, delete_import_rpc: false },
    })
    expect(result.status).toBe('outdated')
    expect(result.capabilities.deleteImportRpc).toBe(false)
    expect(result.diagnostic).toContain('delete import RPC')
  })

  it('falha fechado quando capabilities explícitas não existem', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: REQUIRED_DATABASE_SCHEMA, features: ['delete_fm_import'] })
    expect(result.status).toBe('unversioned')
    expect(result.capabilities.deleteImportRpc).toBe(false)
  })
})
