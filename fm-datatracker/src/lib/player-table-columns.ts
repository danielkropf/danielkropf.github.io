export type SnapshotScalarSource = 'normalized' | 'raw'
export type SnapshotFieldCategory = 'club' | 'contract' | 'transfer' | 'international' | 'training' | 'fitness' | 'stats' | 'general'

export type SnapshotScalarColumn = {
  id: string
  source: SnapshotScalarSource
  fieldKey: string
  label: string
  category: SnapshotFieldCategory
}

type SnapshotLike = {
  normalized_data?: Record<string, unknown>
  raw_data?: Record<string, unknown>
}

const scalar = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const normalizeKey = (key: string) => key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const HIDDEN_KEYS = new Set([
  'name', 'player_name', 'age', 'nationality', 'club', 'team', 'squad', 'position', 'positions',
  'height', 'weight', 'preferred_foot', 'foot', 'contract_expiry', 'snapshot_date',
  'value', 'market_value', 'transfer_value', 'valor',
])

export function prettifySnapshotField(key: string) {
  return key.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, letter => letter.toUpperCase())
}

export function snapshotFieldCategory(key: string): SnapshotFieldCategory {
  const value = normalizeKey(key)
  if (/(club|team|squad|roster|home_grown)/.test(value)) return 'club'
  if (/(contract|expiry|expire|wage|salary|clause)/.test(value)) return 'contract'
  if (/(transfer|value|market|asking|fee)/.test(value)) return 'transfer'
  if (/(international|cap|caps|national_team|nation)/.test(value)) return 'international'
  if (/(training|development|progress)/.test(value)) return 'training'
  if (/(injur|fitness|condition|fatigue|risk|medical)/.test(value)) return 'fitness'
  if (/(stat|appear|minute|goal|assist|rating|clean_sheet|shot|pass|tackle)/.test(value)) return 'stats'
  return 'general'
}

export function discoverSnapshotScalarColumns(snapshots: Array<SnapshotLike | null | undefined>) {
  const bySemantic = new Map<string, SnapshotScalarColumn>()
  for (const snapshot of snapshots) {
    if (!snapshot) continue
    for (const source of ['normalized', 'raw'] as const) {
      const values = source === 'normalized' ? snapshot.normalized_data : snapshot.raw_data
      for (const [fieldKey, fieldValue] of Object.entries(values ?? {})) {
        if (!scalar(fieldValue)) continue
        const semanticId = normalizeKey(fieldKey)
        if (!semanticId || HIDDEN_KEYS.has(semanticId)) continue
        const existing = bySemantic.get(semanticId)
        if (existing?.source === 'normalized') continue
        if (existing && source === 'raw') continue
        bySemantic.set(semanticId, {
          id: `snapshot|${source}|${encodeURIComponent(fieldKey)}`,
          source, fieldKey, label: prettifySnapshotField(fieldKey), category: snapshotFieldCategory(fieldKey),
        })
      }
    }
  }
  return [...bySemantic.values()].sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label, 'pt-BR'))
}

export function snapshotScalarValue(snapshot: SnapshotLike | null | undefined, column: Pick<SnapshotScalarColumn, 'source' | 'fieldKey'>) {
  if (!snapshot) return null
  const values = column.source === 'normalized' ? snapshot.normalized_data : snapshot.raw_data
  const value = values?.[column.fieldKey]
  return scalar(value) ? value : null
}
