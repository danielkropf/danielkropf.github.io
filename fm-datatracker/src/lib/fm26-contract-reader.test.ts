import { describe, expect, it } from 'vitest'
import { decodeContractDate, enrichOfflineContracts } from './fm26-contract-reader'

function putU16(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint16(offset, value, true) }
function putU32(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint32(offset, value, true) }
function putDate(bytes: Uint8Array, offset: number, iso: string) {
  const date = new Date(`${iso}T00:00:00Z`)
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const day = Math.floor((date.getTime() - start) / 86_400_000) + 1
  putU16(bytes, offset, day); putU16(bytes, offset + 2, date.getUTCFullYear())
}
function putContract(bytes: Uint8Array, offset: number, eid: number, teamId: number, wage: number, expiry: string, joined: string, effective: string, typeIds: number[] = []) {
  putU32(bytes, offset, eid); putU32(bytes, offset + 4, teamId); putU32(bytes, offset + 8, 0); putU32(bytes, offset + 12, wage)
  bytes[offset + 16] = 1; bytes[offset + 17] = 7; bytes[offset + 18] = 0; putU32(bytes, offset + 19, 0xffffffff)
  const header = offset + 40
  putDate(bytes, header, expiry)
  bytes.fill(0xff, header + 4, header + 12)
  bytes.fill(0, header + 12, header + 15)
  bytes[header + 15] = typeIds.length
  let cursor = header + 16
  typeIds.forEach((type, index) => { putU32(bytes, cursor + index * 8, 1000 + index); putU16(bytes, cursor + index * 8 + 4, 0xffff); putU16(bytes, cursor + index * 8 + 6, type) })
  cursor += typeIds.length * 8
  putDate(bytes, cursor, joined); putDate(bytes, cursor + 4, effective)
}
function putRelation(bytes: Uint8Array, offset: number, eid: number, teamId: number, wage: number, start: string, end: string) {
  putU32(bytes, offset, eid); putU32(bytes, offset + 4, teamId); putU32(bytes, offset + 8, 0); putU32(bytes, offset + 12, wage)
  putDate(bytes, offset + 20, start); putDate(bytes, offset + 24, end)
}
function putIdentity(bytes: Uint8Array, offset: number, eid: number, uid: number) { putU32(bytes, offset, eid); putU32(bytes, offset + 4, uid); putU32(bytes, offset + 8, uid) }

function playerResult(bytes: Uint8Array, relations: { root: number; roster: number }, currentDate = '2025-07-21') {
  const player: Record<string, unknown> = { eid: 123, uid: 900123, identity_offset: 900, identity_link_confidence: 'high', roster_group: { team_id: relations.roster } }
  return {
    bytes,
    result: { save: { current_date: currentDate }, human_managers: [{ human_club: { roster_groups: [{ team_id: relations.roster }] }, players: [player] }] },
    player,
  }
}

describe('FM26 contract layer', () => {
  it('normalizes a 1900 contract sentinel to null while preserving the raw date', () => {
    const bytes = new Uint8Array(8); putU16(bytes, 0, 2); putU16(bytes, 2, 1900)
    expect(decodeContractDate(bytes, 0)).toMatchObject({ year: 1900, day_of_year: 2, iso: null, sentinel: true })
  })

  it('keeps current and future contracts separate and preserves unknown term IDs', () => {
    const { bytes, result, player } = playerResult(new Uint8Array(4096), { root: 449, roster: 679 })
    putContract(bytes, 100, 123, 449, 120000, '2031-06-30', '2023-07-01', '2023-07-01', [0x20, 0x21, 0x25, 0x26])
    putContract(bytes, 300, 123, 777, 150000, '2034-06-30', '2026-07-01', '2026-07-01', [0x26])
    putIdentity(bytes, 900, 123, 900123)
    enrichOfflineContracts(result, bytes, '2025-07-21')
    expect(player.current_contract).toMatchObject({ team_id: 449, weekly_wage: 120000, expiry_date: '2031-06-30', terms_status: 'resolved' })
    expect((player.current_contract as { terms: Array<{ type_id: number | null; semantic_label: null }> }).terms.map(term => term.type_id)).toEqual([0x20, 0x21, 0x25, 0x26])
    expect((player.current_contract as { terms: Array<{ semantic_label: null }> }).terms.every(term => term.semantic_label === null)).toBe(true)
    expect(player.future_contracts).toEqual([expect.objectContaining({ team_id: 777, weekly_wage: 150000, signed_or_effective_date: '2026-07-01' })])
  })

  it('classifies one external active relation as loan but does not treat a managed subteam as loan', () => {
    const bytes = new Uint8Array(4096)
    const player: Record<string, unknown> = { eid: 123, uid: 900123, identity_offset: 1000, identity_link_confidence: 'high', roster_group: { team_id: 679 } }
    const result = { human_managers: [{ human_club: { roster_groups: [{ team_id: 679 }, { team_id: 1993 }] }, players: [player] }] }
    putContract(bytes, 100, 123, 679, 314903, '2029-06-30', '2015-07-01', '2025-03-13')
    putRelation(bytes, 300, 123, 1993, 0, '2025-07-01', '2026-06-30')
    putRelation(bytes, 500, 123, 4000, 100000, '2025-07-21', '2026-06-30')
    putIdentity(bytes, 1000, 123, 900123)
    enrichOfflineContracts(result, bytes, '2025-08-01')
    const relationships = player.contract_relationships as Array<{ team_id: number; classification: string }>
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ team_id: 1993, classification: 'internal' }),
      expect.objectContaining({ team_id: 4000, classification: 'loan_current' }),
    ]))
    expect(player.loan).toMatchObject({ status: 'current', from_team_id: 679, to_team_id: 4000, start_date: '2025-07-21', end_date: '2026-06-30' })
  })

  it('fails closed when more than one external relation could be a current loan', () => {
    const bytes = new Uint8Array(4096)
    const player: Record<string, unknown> = { eid: 123, uid: 900123, identity_offset: 1000, identity_link_confidence: 'high', roster_group: { team_id: 679 } }
    const result = { human_managers: [{ human_club: { roster_groups: [{ team_id: 679 }] }, players: [player] }] }
    putContract(bytes, 100, 123, 679, 314903, '2029-06-30', '2015-07-01', '2025-03-13')
    putRelation(bytes, 300, 123, 4000, 100000, '2025-07-21', '2026-06-30')
    putRelation(bytes, 500, 123, 5000, 100000, '2025-07-21', '2026-06-30')
    putIdentity(bytes, 1000, 123, 900123)
    enrichOfflineContracts(result, bytes, '2025-08-01')
    expect(player.loan).toMatchObject({ status: 'unresolved', to_team_id: null })
    expect((player.contract_relationships as Array<{ classification: string }>).some(relation => relation.classification === 'loan_current')).toBe(false)
  })
})
