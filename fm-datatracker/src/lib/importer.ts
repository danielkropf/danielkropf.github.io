import Papa from 'papaparse'
import type { ImportPreview, ImportType } from '../types/domain'

const ignoredForScoring = /^(ca|pa|ability|potential|current ability|potential ability)$/i
export const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export function detectImportType(filename: string, headers: string[]): ImportType {
  const text = `${filename} ${headers.join(' ')}`.toLowerCase()
  if (/intake|youth/.test(text)) return 'intake'
  if (/stats|minutes|appearances|goals/.test(text)) return 'stats'
  if (/squad|position|club|age/.test(text)) return 'squad'
  return 'unknown'
}

export function inferSnapshotDate(filename: string): string | null {
  const intake = filename.match(/intake\s+(\d{2})(?:\D|$)/i)
  if (intake) return `20${intake[1]}-04-12`
  const range = filename.match(/(?:squad|stats)\s+(\d{2})-(\d{2})(?:\D|$)/i)
  if (range) return `20${range[2]}-01-01`
  const single = filename.match(/(?:squad|stats)\s+(\d{2})(?:\D|$)/i)
  if (single) return `20${single[1]}-07-01`
  return null
}

export function parseCsv(text: string, filename: string): ImportPreview {
  const clean = text.replace(/^\uFEFF/, '')
  const result = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() })
  const headers = result.meta.fields ?? []
  const warnings = result.errors.map(e => `Linha ${e.row ?? '?'}: ${e.message}`)
  const snapshotDate = inferSnapshotDate(filename)
  if (!snapshotDate) warnings.push('Não foi possível detectar a data; escolha-a manualmente.')
  const ignoredColumns = headers.filter(h => ignoredForScoring.test(h.trim()))
  if (ignoredColumns.length) warnings.push(`${ignoredColumns.join(', ')} serão preservados apenas como dados brutos e ignorados no scoring.`)
  return { filename, fileType: detectImportType(filename, headers), snapshotDate, rowCount: result.data.length, delimiter: result.meta.delimiter, headers, ignoredColumns, warnings, rows: result.data }
}
