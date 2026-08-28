import { describe, expect, it } from 'vitest'
import { sanitizeSquadTablePreferencesForSaveChange, SQUAD_TABLE_STORAGE_KEY } from './squad-table-preferences'

function memoryStorage(initial: string | null) {
  const values = new Map<string, string>()
  if (initial !== null) values.set(SQUAD_TABLE_STORAGE_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('squad table preferences across saves', () => {
  it('remove referências de role/tática do save A antes de abrir o save B', () => {
    const storage = memoryStorage(JSON.stringify({
      columns: [
        { id: 'name', kind: 'data', label: 'Jogador' },
        { id: 'age', kind: 'attribute', attributeKey: 'age' },
        { id: 'role-a', kind: 'role', roleId: 'IP-AM-AP' },
        { id: 'tactic-a', kind: 'tacticRole', tacticId: 'save-a-tactic', linkId: 'save-a-link' },
      ],
      frozenIndex: 1,
      widths: { name: 220, age: 80, 'role-a': 90, 'tactic-a': 90 },
    }))

    expect(sanitizeSquadTablePreferencesForSaveChange(storage)).toBe(true)
    const sanitized = JSON.parse(storage.getItem(SQUAD_TABLE_STORAGE_KEY) ?? '{}')
    expect(sanitized.columns.map((column: { id: string }) => column.id)).toEqual(['name', 'age'])
    expect(sanitized.widths).toEqual({ name: 220, age: 80 })
    expect(JSON.stringify(sanitized)).not.toContain('save-a')
    expect(JSON.stringify(sanitized)).not.toContain('role-a')
  })

  it('preserva preferências puramente visuais quando não há referência save-specific', () => {
    const raw = JSON.stringify({
      columns: [{ id: 'name', kind: 'data' }, { id: 'pace', kind: 'attribute', attributeKey: 'pace' }],
      frozenIndex: 0,
      widths: { name: 200, pace: 70 },
    })
    const storage = memoryStorage(raw)

    expect(sanitizeSquadTablePreferencesForSaveChange(storage)).toBe(false)
    expect(storage.getItem(SQUAD_TABLE_STORAGE_KEY)).toBe(raw)
  })
})
