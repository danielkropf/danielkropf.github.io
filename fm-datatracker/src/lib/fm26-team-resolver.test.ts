import { describe, expect, it } from 'vitest'
import { resolveOfflineTeamNames } from './fm26-team-resolver'

function putU16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint16(offset, value, true)
}

function putU32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value, true)
}

function putText(bytes: Uint8Array, offset: number, text: string): number {
  const encoded = new TextEncoder().encode(text)
  bytes.set(encoded, offset)
  return encoded.length
}

function putSquadRow(bytes: Uint8Array, offset: number, teamId: number, teamKey: number, eids = [101, 102, 103]) {
  putU32(bytes, offset, teamId - 1)
  putU32(bytes, offset + 4, teamKey)
  putU32(bytes, offset + 8, teamKey)
  putU16(bytes, offset + 46, eids.length)
  eids.forEach((eid, index) => putU32(bytes, offset + 48 + index * 4, eid))
}

function putNameRecord(bytes: Uint8Array, keyOffset: number, teamKey: number, name: string, shortName = name, rawReference = 10) {
  putU32(bytes, keyOffset - 4, rawReference)
  putU32(bytes, keyOffset, teamKey)
  putU32(bytes, keyOffset + 4, teamKey)
  const longLength = new TextEncoder().encode(name).length
  putU32(bytes, keyOffset + 35, longLength)
  const longWritten = putText(bytes, keyOffset + 39, name)
  const shortLength = new TextEncoder().encode(shortName).length
  putU32(bytes, keyOffset + 39 + longWritten, shortLength)
  putText(bytes, keyOffset + 43 + longWritten, shortName)
}

describe('FM26 structural team-name resolver', () => {
  it('resolves an unambiguous structural Team ID through its repeated team key', () => {
    const bytes = new Uint8Array(2048)
    putSquadRow(bytes, 100, 679, 913)
    putNameRecord(bytes, 700, 913, 'FC Bayern München')

    expect(resolveOfflineTeamNames(bytes, [679])).toEqual([expect.objectContaining({
      team_id: 679,
      team_index_zero_based: 678,
      status: 'confirmed',
      name: 'FC Bayern München',
      short_name: 'FC Bayern München',
      team_key: 913,
      squad_row_offset: 100,
      name_record_offset: 700,
    })])
  })

  it('supports distinct long and short names', () => {
    const bytes = new Uint8Array(2048)
    putSquadRow(bytes, 100, 1993, 103286)
    putNameRecord(bytes, 700, 103286, 'FC Bayern München II', 'FC Bayern II')

    expect(resolveOfflineTeamNames(bytes, [1993])[0]).toMatchObject({
      status: 'confirmed', name: 'FC Bayern München II', short_name: 'FC Bayern II',
    })
  })

  it('fails closed when the same Team ID has two distinct validated chains', () => {
    const bytes = new Uint8Array(4096)
    putSquadRow(bytes, 100, 679, 913)
    putNameRecord(bytes, 800, 913, 'FC Bayern München')
    putSquadRow(bytes, 1400, 679, 1844)
    putNameRecord(bytes, 2200, 1844, 'BSC Young Boys', 'Young Boys')

    expect(resolveOfflineTeamNames(bytes, [679])[0]).toMatchObject({
      status: 'ambiguous', name: null, team_key: null, candidate_count: 2,
    })
  })

  it('ignores non-squad lookalikes and leaves unknown variants unresolved', () => {
    const bytes = new Uint8Array(2048)
    putU32(bytes, 100, 16125 - 1)
    putU32(bytes, 104, 2000068941)
    putU32(bytes, 108, 2000068941)
    putU16(bytes, 146, 2) // structural squads are confirmed only for count 3..80

    expect(resolveOfflineTeamNames(bytes, [16125])[0]).toMatchObject({
      status: 'unresolved', name: null, candidate_count: 0,
    })
  })
})
