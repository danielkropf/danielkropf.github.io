import { describe, expect, it } from 'vitest'
import { parseDatabaseCompatibilityInfo } from './database-compatibility'

const allCapabilities = {
  import_rpc: true,
  delete_import_rpc: true,
  model_config_patch: true,
  projections: true,
  diagnostics_table: true,
  diagnostics_bucket: true,
  diagnostics_reservations: true,
  diagnostics_upload: true,
}

describe('database capability detection', () => {
  it('aceita schema atual somente quando capabilities reais estão presentes', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608280002', capabilities: allCapabilities })
    expect(result.status).toBe('compatible')
    expect(result.capabilities.deleteImportRpc).toBe(true)
    expect(result.capabilities.diagnosticsUpload).toBe(true)
  })


  it('rejeita o schema anterior ao cleanup de relações PostgREST', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608280001', capabilities: allCapabilities })
    expect(result.status).toBe('outdated')
    expect(result.diagnostic).toContain('202608280002')
  })

  it('não trata número alto de schema como prova de feature', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608290001', capabilities: { ...allCapabilities, delete_import_rpc: false } })
    expect(result.status).toBe('outdated')
    expect(result.capabilities.deleteImportRpc).toBe(false)
    expect(result.diagnostic).toContain('delete import RPC')
  })

  it('falha fechado quando capabilities explícitas não existem', () => {
    const result = parseDatabaseCompatibilityInfo({ schema_version: '202608290001', features: ['delete_fm_import'] })
    expect(result.status).toBe('unversioned')
    expect(result.capabilities.deleteImportRpc).toBe(false)
  })
})
