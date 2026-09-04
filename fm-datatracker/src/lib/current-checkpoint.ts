export type AuthoritativeImportLike = {
  status: string | null | undefined
  snapshot_date: string | null | undefined
}

export type AttributeLike = {
  attribute_key: string
  attribute_label: string
  value: number
  category: string
  [key: string]: unknown
}

export type SnapshotLike = {
  id: string
  snapshot_date: string
  age: number | null
  club: string | null
  squad: string | null
  positions: string[]
  contract_expiry: string | null
  preferred_foot?: string | null
  height?: number | null
  weight?: number | null
  raw_data: Record<string, unknown>
  normalized_data: Record<string, unknown>
  player_attributes: AttributeLike[]
  source_snapshot_ids?: string[]
  [key: string]: unknown
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoGameDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

export function resolveCurrentCheckpointDate(imports: AuthoritativeImportLike[]): string | null {
  let current: string | null = null
  for (const item of imports) {
    if (item.status !== 'imported' || !isIsoGameDate(item.snapshot_date)) continue
    if (current === null || item.snapshot_date > current) current = item.snapshot_date
  }
  return current
}

export function formatCheckpointDate(value: string | null): string | null {
  if (!isIsoGameDate(value)) return null
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function formatCheckpointWeekday(value: string | null): string | null {
  if (!isIsoGameDate(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)))
  return label ? label[0].toUpperCase() + label.slice(1) : null
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function mergeScalar<T>(values: Array<T | null | undefined>): T | null {
  const present = values.filter((value): value is T => value !== null && value !== undefined && value !== '')
  if (!present.length) return null
  const byCanonical = new Map(present.map(value => [canonical(value), value]))
  return byCanonical.size === 1 ? [...byCanonical.values()][0] : null
}

function mergeRecord(records: Array<Record<string, unknown>>): Record<string, unknown> {
  const keys = new Set(records.flatMap(record => Object.keys(record)))
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const values = records.map(record => record[key]).filter(value => value !== undefined)
    if (!values.length) continue
    const signatures = new Set(values.map(canonical))
    if (signatures.size === 1) merged[key] = values[0]
  }
  return merged
}

function normalizedPositions(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function mergePositions(snapshots: SnapshotLike[]): string[] {
  const variants = new Map<string, string[]>()
  for (const snapshot of snapshots) {
    const normalized = normalizedPositions(snapshot.positions ?? [])
    if (!normalized.length) continue
    variants.set(canonical(normalized), normalized)
  }
  return variants.size === 1 ? [...variants.values()][0] : []
}

function mergeAttributes(snapshots: SnapshotLike[]): AttributeLike[] {
  const buckets = new Map<string, AttributeLike[]>()
  for (const snapshot of snapshots) {
    for (const attribute of snapshot.player_attributes ?? []) {
      const rows = buckets.get(attribute.attribute_key) ?? []
      rows.push(attribute)
      buckets.set(attribute.attribute_key, rows)
    }
  }
  const out: AttributeLike[] = []
  for (const [key, rows] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    const values = new Set(rows.map(row => row.value))
    if (values.size !== 1) continue
    const labels = new Set(rows.map(row => row.attribute_label))
    const categories = new Set(rows.map(row => row.category))
    if (labels.size !== 1 || categories.size !== 1) continue
    out.push({ attribute_key: key, attribute_label: rows[0].attribute_label, category: rows[0].category, value: rows[0].value })
  }
  return out
}

export function currentSnapshotSourceIds(snapshot: Pick<SnapshotLike, 'id' | 'source_snapshot_ids'> | null | undefined): string[] {
  if (!snapshot) return []
  const ids = snapshot.source_snapshot_ids?.filter(Boolean) ?? []
  return ids.length ? [...new Set(ids)].sort() : snapshot.id ? [snapshot.id] : []
}

/**
 * Reconciles only observations from one exact checkpoint. Same-date imports can
 * add coverage, but insertion order never wins: disagreement becomes unknown.
 */
export type ReconciledSnapshot<T extends SnapshotLike> = T & { source_snapshot_ids: string[] }

export function resolveSameDateSnapshotGroup<T extends SnapshotLike>(snapshots: T[], checkpointDate: string): ReconciledSnapshot<T> | null {
  if (!isIsoGameDate(checkpointDate)) return null
  const exact = snapshots.filter(snapshot => snapshot.snapshot_date === checkpointDate)
  if (!exact.length) return null
  const ids = [...new Set(exact.flatMap(snapshot => currentSnapshotSourceIds(snapshot)))].sort()
  const base = exact[0]
  const merged = {
    ...base,
    id: ids.length === 1 ? ids[0] : `current:${checkpointDate}:${ids.join('+')}`,
    source_snapshot_ids: ids,
    snapshot_date: checkpointDate,
    age: mergeScalar(exact.map(row => row.age)),
    club: mergeScalar(exact.map(row => row.club)),
    squad: mergeScalar(exact.map(row => row.squad)),
    positions: mergePositions(exact),
    contract_expiry: mergeScalar(exact.map(row => row.contract_expiry)),
    preferred_foot: mergeScalar(exact.map(row => row.preferred_foot)),
    height: mergeScalar(exact.map(row => row.height)),
    weight: mergeScalar(exact.map(row => row.weight)),
    raw_data: mergeRecord(exact.map(row => row.raw_data ?? {})),
    normalized_data: mergeRecord(exact.map(row => row.normalized_data ?? {})),
    player_attributes: mergeAttributes(exact),
  }
  return merged as ReconciledSnapshot<T>
}
