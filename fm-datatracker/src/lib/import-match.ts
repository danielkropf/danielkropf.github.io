import type { prepareRows } from './importer'

type CsvPreparedRow = ReturnType<typeof prepareRows>[number]
export type PreparedImportRow = Omit<CsvPreparedRow, 'raw_data' | 'normalized_data'> & {
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  statistics?: unknown
  tactic?: unknown
  membership_facts_v1?: unknown
  membership_persistence_v1?: unknown
}

export type ImportRowMatch = {
  csv: PreparedImportRow
  fm: PreparedImportRow
  reason: 'fm-id' | 'name-and-birth' | 'unique-name'
}

export type ImportMatchResult = {
  matches: ImportRowMatch[]
  csvOnly: number
  fmOnly: number
  ambiguous: number
  coverage: number
}

const bucket = (rows: PreparedImportRow[], key: (row: PreparedImportRow) => string | null) => {
  const out = new Map<string, PreparedImportRow[]>()
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    const items = out.get(value) ?? []
    items.push(row)
    out.set(value, items)
  }
  return out
}

const bioKey = (row: PreparedImportRow) => row.date_of_birth ? `${row.normalized_name}|${row.date_of_birth}` : null

export function matchImportRows(csvRows: PreparedImportRow[], fmRows: PreparedImportRow[]): ImportMatchResult {
  const fmById = bucket(fmRows, row => row.fm_player_id || null)
  const fmByBio = bucket(fmRows, bioKey)
  const fmByName = bucket(fmRows, row => row.normalized_name || null)
  const csvByName = bucket(csvRows, row => row.normalized_name || null)
  const used = new Set<PreparedImportRow>()
  const matches: ImportRowMatch[] = []
  let ambiguous = 0

  for (const csv of csvRows) {
    let candidates: PreparedImportRow[] = []
    let reason: ImportRowMatch['reason'] | null = null

    if (csv.fm_player_id) {
      candidates = fmById.get(csv.fm_player_id) ?? []
      reason = 'fm-id'
    } else if (csv.date_of_birth) {
      candidates = fmByBio.get(bioKey(csv)!) ?? []
      reason = 'name-and-birth'
    } else if ((csvByName.get(csv.normalized_name)?.length ?? 0) === 1) {
      const byName = fmByName.get(csv.normalized_name) ?? []
      if (byName.length === 1) {
        candidates = byName
        reason = 'unique-name'
      }
    }

    const available = candidates.filter(candidate => !used.has(candidate))
    if (available.length === 1 && reason) {
      used.add(available[0])
      matches.push({ csv, fm: available[0], reason })
    } else if (candidates.length > 1 || (candidates.length === 1 && available.length === 0)) {
      ambiguous += 1
    }
  }

  const csvOnly = csvRows.length - matches.length
  const fmOnly = fmRows.length - used.size
  return {
    matches,
    csvOnly,
    fmOnly,
    ambiguous,
    coverage: csvRows.length ? matches.length / csvRows.length : 0,
  }
}

/**
 * CSV defines the population of a validated combined import. The .fm data only
 * enriches matched CSV rows, so extra roster groups from the save cannot appear
 * silently in the persisted snapshot.
 */
export function mergeValidatedRows(csvRows: PreparedImportRow[], matches: ImportRowMatch[]): PreparedImportRow[] {
  const fmForCsv = new Map(matches.map(match => [match.csv, match.fm]))
  return csvRows.map(csv => {
    const fm = fmForCsv.get(csv)
    if (!fm) return csv

    const fmId = fm.fm_player_id || csv.fm_player_id
    return {
      ...csv,
      fm_player_id: fmId,
      identity_key: fmId ? `fm:${fmId}` : csv.identity_key,
      age: fm.age ?? csv.age,
      club: csv.club ?? fm.club,
      squad: fm.squad ?? csv.squad,
      positions: fm.positions.length ? fm.positions : csv.positions,
      date_of_birth: fm.date_of_birth ?? csv.date_of_birth,
      nationality: fm.nationality ?? csv.nationality,
      preferred_foot: fm.preferred_foot ?? csv.preferred_foot,
      height: fm.height ?? csv.height,
      weight: fm.weight ?? csv.weight,
      contract_expiry: csv.contract_expiry ?? fm.contract_expiry,
      attributes: fm.attributes.length ? fm.attributes : csv.attributes,
      raw_data: { csv: csv.raw_data, fm: fm.raw_data },
      normalized_data: { ...csv.normalized_data, ...fm.normalized_data, import_source: 'csv+fm26-offline' },
      ...(fm.statistics !== undefined ? { statistics: fm.statistics } : {}),
      ...(fm.tactic !== undefined ? { tactic: fm.tactic } : {}),
      ...(fm.membership_facts_v1 !== undefined ? { membership_facts_v1: fm.membership_facts_v1 } : {}),
      ...(fm.membership_persistence_v1 !== undefined ? { membership_persistence_v1: fm.membership_persistence_v1 } : {}),
    }
  })
}
