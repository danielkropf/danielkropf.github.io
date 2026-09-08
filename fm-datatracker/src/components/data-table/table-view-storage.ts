export type StoredDataTableView<Column> = {
  id: string
  name: string
  columns: Column[]
  frozenIndex: number
  widths: Record<string, number>
}

export function readStoredDataTableViews<Column>(storageKey: string): StoredDataTableView<Column>[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.columns) && Number.isInteger(item.frozenIndex) && item.widths && typeof item.widths === 'object') as StoredDataTableView<Column>[]
  } catch { return [] }
}

export function writeStoredDataTableViews<Column>(storageKey: string, views: StoredDataTableView<Column>[]) {
  if (typeof window !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(views))
}
