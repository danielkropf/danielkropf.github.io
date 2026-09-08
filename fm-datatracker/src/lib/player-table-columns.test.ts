import { describe, expect, it } from 'vitest'
import { discoverSnapshotScalarColumns, snapshotScalarValue } from './player-table-columns'

describe('discoverSnapshotScalarColumns', () => {
  it('exposes only real scalar fields and prefers normalized data', () => {
    const columns = discoverSnapshotScalarColumns([{ normalized_data: { Wage: '£10K', Nested: { a: 1 } }, raw_data: { Wage: 'raw', Injury_Risk: 3 } }])
    expect(columns.some(column => column.source === 'normalized' && column.fieldKey === 'Wage')).toBe(true)
    expect(columns.some(column => column.source === 'raw' && column.fieldKey === 'Wage')).toBe(false)
    expect(columns.some(column => column.fieldKey === 'Nested')).toBe(false)
    expect(columns.find(column => column.fieldKey === 'Injury_Risk')?.category).toBe('fitness')
  })

  it('deduplicates semantic fields across snapshots with normalized provenance winning', () => {
    const columns = discoverSnapshotScalarColumns([
      { raw_data: { Wage: 'raw', Value: '£1M' } },
      { normalized_data: { wage: '£10K' } },
    ])
    const wages = columns.filter(column => column.fieldKey.toLowerCase() === 'wage')
    expect(wages).toHaveLength(1)
    expect(wages[0].source).toBe('normalized')
    expect(columns.some(column => column.fieldKey.toLowerCase() === 'value')).toBe(false)
  })

  it('reads the value from the declared provenance map', () => {
    expect(snapshotScalarValue({ normalized_data: { Wage: 12 } }, { source: 'normalized', fieldKey: 'Wage' })).toBe(12)
  })
})
