import { describe, expect, it } from 'vitest'
import {
  classifyIdentityEpoch,
  findAlternateBiographyCandidates,
  parseOrganizationScopeRecordAt,
  reconcilePersonRecordOrdering,
  resolveWorldIdentityCandidates,
} from './fm26-world-census'

const setU16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 255
  bytes[offset + 1] = (value >>> 8) & 255
}
const setU32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 255
  bytes[offset + 1] = (value >>> 8) & 255
  bytes[offset + 2] = (value >>> 16) & 255
  bytes[offset + 3] = (value >>> 24) & 255
}

describe('WC-A fail-closed primitives', () => {
  it('keeps multiple identity candidates ambiguous without independent structural authority', () => {
    const result = resolveWorldIdentityCandidates({ eid: 9, candidates: [{ offset: 100, uid: 33_554_432 }, { offset: 200, uid: 67_108_864 }, { offset: 300, uid: 100_663_296 }] })
    expect(result.status).toBe('ambiguous')
    expect(result.reason_code).toBe('multiple_structurally_plausible_identity_candidates')
  })

  it('parses framed A1/B0 and A1/B1 scope shapes without promoting Club identity', () => {
    const singleton = new Uint8Array(16)
    singleton.set([0, 255, 0, 1], 0); setU32(singleton, 4, 53); singleton[8] = 0
    expect(parseOrganizationScopeRecordAt(singleton, 0, new Set([53]))).toMatchObject({ a: [53], b: [] })

    const pair = new Uint8Array(20)
    pair.set([0, 255, 0, 1], 0); setU32(pair, 4, 1376); pair[8] = 1; setU32(pair, 9, 8702)
    expect(parseOrganizationScopeRecordAt(pair, 0, new Set([1376, 8702]))).toMatchObject({ a: [1376], b: [8702] })
  })

  it('decodes the alternate Biography grammar while leaving third-name semantics raw', () => {
    const bytes = new Uint8Array(64)
    const b = 24
    setU32(bytes, b - 19, 100)
    setU32(bytes, b - 14, 200)
    setU32(bytes, b - 9, 201)
    setU16(bytes, b, 78)
    setU16(bytes, b + 2, 2016)
    bytes[b + 4] = 255
    bytes.set([1, 16, 1, 7, 0, 0, 0], b + 5)
    bytes[b + 12] = 3
    setU16(bytes, b + 13, 170)
    bytes.set([17, 9, 9, 3, 12, 10, 8, 16], b + 21)
    const rows = findAlternateBiographyCandidates(bytes, 0, bytes.length, { forenames: 1000, surnames: 1000 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ forename_id: 100, surname_id: 200, third_name_id_raw: 201, birth_date: '2016-03-18', nation_id: 170, raw7_hex: '01100107000000' })
  })

  it('opens a new identity epoch on strong birth conflict even when UID+EID are unchanged', () => {
    expect(classifyIdentityEpoch(
      { uid: 2002081267, eid: 62463, birth_date: '2012-08-23', display_name: 'Adelino', hidden_personality: [1, 2, 3] },
      { uid: 2002081267, eid: 62463, birth_date: '2014-01-17', display_name: 'Marcos Vinicius', hidden_personality: [4, 5, 6] },
    )).toBe('new_epoch')
  })
  it('reclassifies non-monotonic PersonRecord identities before coverage publication', () => {
    const result = reconcilePersonRecordOrdering([
      { eid: 10, offset: 100 },
      { eid: 11, offset: 90 },
      { eid: 12, offset: 200 },
    ])
    expect(result.conflicting_eids).toEqual([10, 11])
    expect(result.records).toEqual([{ eid: 12, offset: 200 }])
  })

})
