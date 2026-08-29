import { describe, expect, it } from 'vitest'
import { matchImportRows, mergeValidatedRows, type PreparedImportRow } from './import-match'

const row = (name: string, id: string | null, dob: string | null, extra: Partial<PreparedImportRow> = {}): PreparedImportRow => {
  const base: PreparedImportRow = {
    name,
    current_name: name,
    normalized_name: name.toLowerCase(),
    fm_player_id: id,
    date_of_birth: dob,
    nationality: null,
    identity_key: id ? `fm:${id}` : `bio:${name.toLowerCase()}:${dob ?? 'unknown'}`,
    age: null,
    club: null,
    squad: null,
    positions: [],
    preferred_foot: null,
    height: null,
    weight: null,
    contract_expiry: null,
    minutes: null,
    appearances: null,
    team: null,
    starts: null,
    sub_appearances: null,
    season: null,
    competition: null,
    raw_data: {},
    normalized_data: {},
    attributes: [],
  }
  return Object.assign(base, extra)
}

describe('import matching', () => {
  it('never falls back to name when an explicit FM id disagrees', () => {
    const csv = [row('Alex', '10', '2000-01-01')]
    const fm = [row('Alex', '11', '2000-01-01')]
    const result = matchImportRows(csv, fm)
    expect(result.matches).toHaveLength(0)
    expect(result.csvOnly).toBe(1)
  })

  it('uses name + birth without id and rejects ambiguous same-name rows', () => {
    const csv = [row('Alex', null, '2000-01-01'), row('Alex', null, '2001-01-01')]
    const fm = [row('Alex', '10', '2000-01-01'), row('Alex', '11', '2001-01-01')]
    const result = matchImportRows(csv, fm)
    expect(result.matches.map(match => match.fm.fm_player_id)).toEqual(['10', '11'])
    expect(result.ambiguous).toBe(0)
  })

  it('keeps CSV population when the .fm contains extra players', () => {
    const csv = [row('A', '1', '2000-01-01'), row('B', '2', '2000-02-01')]
    const fm = [
      row('A', '1', '2000-01-01', { squad: 'Principal' }),
      row('B', '2', '2000-02-01', { squad: 'Principal' }),
      row('C', '3', '2000-03-01', { squad: 'B' }),
    ]
    const matched = matchImportRows(csv, fm)
    const merged = mergeValidatedRows(csv, matched.matches)
    expect(matched.csvOnly).toBe(0)
    expect(matched.fmOnly).toBe(1)
    expect(merged.map(item => item.current_name)).toEqual(['A', 'B'])
  })
})
