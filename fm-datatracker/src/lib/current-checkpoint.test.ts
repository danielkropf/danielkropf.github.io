import { describe, expect, it } from 'vitest'
import { formatCheckpointDate, formatCheckpointWeekday, resolveCurrentCheckpointDate, resolveSameDateSnapshotGroup } from './current-checkpoint'

function snap(id: string, date: string, club: string | null, passing: number | null = null) {
  return {
    id, snapshot_date: date, age: 20, club, squad: 'Principal', positions: ['M (C)'], contract_expiry: null,
    preferred_foot: null, height: null, weight: null, raw_data: {}, normalized_data: {},
    player_attributes: passing == null ? [] : [{ attribute_key: 'passing', attribute_label: 'Passing', value: passing, category: 'technical' }],
  }
}

describe('current checkpoint', () => {
  it('uses the greatest dated authoritative imported snapshot', () => {
    expect(resolveCurrentCheckpointDate([
      { status: 'imported', snapshot_date: '2027-01-01' },
      { status: 'imported', snapshot_date: '2027-07-01' },
      { status: 'imported', snapshot_date: '2028-01-01' },
      { status: 'imported', snapshot_date: '2027-04-01' },
    ])).toBe('2028-01-01')
  })

  it('ignores failed, duplicate, mapping and malformed dates', () => {
    expect(resolveCurrentCheckpointDate([
      { status: 'imported', snapshot_date: '2028-01-01' },
      { status: 'failed', snapshot_date: '2029-01-01' },
      { status: 'duplicate', snapshot_date: '2030-01-01' },
      { status: 'needs_mapping', snapshot_date: '2031-01-01' },
      { status: 'imported', snapshot_date: '2032-02-31' },
    ])).toBe('2028-01-01')
  })

  it('returns null when no authoritative dated import exists', () => {
    expect(resolveCurrentCheckpointDate([{ status: 'failed', snapshot_date: '2029-01-01' }, { status: 'imported', snapshot_date: null }])).toBeNull()
  })

  it('does not depend on arrival order for equal max dates', () => {
    const a = [{ status: 'imported', snapshot_date: '2028-01-01' }, { status: 'imported', snapshot_date: '2028-01-01' }]
    expect(resolveCurrentCheckpointDate(a)).toBe('2028-01-01')
    expect(resolveCurrentCheckpointDate([...a].reverse())).toBe('2028-01-01')
  })

  it('formats game dates without local-time parsing', () => {
    expect(formatCheckpointDate('2028-01-01')).toBe('01/01/2028')
    expect(formatCheckpointWeekday('2028-01-01')).toBe('Sábado')
  })
})

describe('exact checkpoint snapshot reconciliation', () => {
  it('never pulls D-1 into D', () => {
    expect(resolveSameDateSnapshotGroup([snap('old', '2027-07-01', 'Clube')], '2028-01-01')).toBeNull()
  })

  it('keeps agreeing same-date values and exposes all source ids', () => {
    const result = resolveSameDateSnapshotGroup([snap('b', '2028-01-01', 'Clube', 12), snap('a', '2028-01-01', 'Clube', 12)], '2028-01-01')
    expect(result?.club).toBe('Clube')
    expect(result?.player_attributes[0]?.value).toBe(12)
    expect(result?.source_snapshot_ids).toEqual(['a', 'b'])
  })

  it('fails closed on same-date field conflicts instead of using upload order', () => {
    const first = resolveSameDateSnapshotGroup([snap('a', '2028-01-01', 'A', 12), snap('b', '2028-01-01', 'B', 13)], '2028-01-01')
    const reversed = resolveSameDateSnapshotGroup([snap('b', '2028-01-01', 'B', 13), snap('a', '2028-01-01', 'A', 12)], '2028-01-01')
    expect(first?.club).toBeNull()
    expect(first?.player_attributes).toEqual([])
    expect(reversed?.club).toBeNull()
    expect(reversed?.player_attributes).toEqual([])
  })
})
