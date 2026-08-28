export const SQUAD_TABLE_STORAGE_KEY = 'fm-datatracker:squad-table-v2'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type StoredColumn = { id?: unknown; kind?: unknown; [key: string]: unknown }

const isSaveAgnosticColumn = (column: StoredColumn) => column.kind === 'data' || column.kind === 'attribute'

export function sanitizeSquadTablePreferencesForSaveChange(storage: StorageLike = localStorage) {
  const raw = storage.getItem(SQUAD_TABLE_STORAGE_KEY)
  if (!raw) return false

  try {
    const parsed = JSON.parse(raw) as { columns?: unknown; frozenIndex?: unknown; widths?: unknown }
    if (!Array.isArray(parsed.columns)) {
      storage.removeItem(SQUAD_TABLE_STORAGE_KEY)
      return true
    }

    const originalColumns = parsed.columns.filter((column): column is StoredColumn => Boolean(column) && typeof column === 'object')
    const safeColumns = originalColumns.filter(isSaveAgnosticColumn)
    if (safeColumns.length === originalColumns.length) return false
    if (!safeColumns.some(column => column.id === 'name')) {
      storage.removeItem(SQUAD_TABLE_STORAGE_KEY)
      return true
    }

    const safeIds = new Set(safeColumns.map(column => String(column.id ?? '')))
    const sourceWidths = parsed.widths && typeof parsed.widths === 'object'
      ? parsed.widths as Record<string, unknown>
      : {}
    const widths = Object.fromEntries(Object.entries(sourceWidths).filter(([id]) => safeIds.has(id)))
    const requestedFrozen = typeof parsed.frozenIndex === 'number' && Number.isInteger(parsed.frozenIndex)
      ? parsed.frozenIndex
      : 0
    const frozenIndex = Math.max(0, Math.min(requestedFrozen, safeColumns.length - 1))

    storage.setItem(SQUAD_TABLE_STORAGE_KEY, JSON.stringify({
      columns: safeColumns,
      frozenIndex,
      widths,
    }))
    return true
  } catch {
    storage.removeItem(SQUAD_TABLE_STORAGE_KEY)
    return true
  }
}
