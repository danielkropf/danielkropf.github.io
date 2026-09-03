import { describe, expect, it } from 'vitest'
import {
  MEMBERSHIP_FACTS_VERSION,
  buildPlayerMembershipFacts,
  decodeMembershipPackedDate,
  enrichOfflineMembershipFacts,
  indexStructuralOrganizations,
  resolveStructuralTeamOrganization,
} from './fm26-membership-facts'

function putU16(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint16(offset, value, true) }
function putU32(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint32(offset, value, true) }
function packDate(iso: string, flags = 0x1a00) {
  const date = new Date(`${iso}T00:00:00Z`)
  const day = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
  return ((date.getUTCFullYear() << 16) | flags | day) >>> 0
}
function putPackedDate(bytes: Uint8Array, offset: number, iso: string, flags = 0x1a00) { putU32(bytes, offset, packDate(iso, flags)) }
function putIdentity(bytes: Uint8Array, offset: number, eid: number, uid: number) {
  putU32(bytes, offset, eid); putU32(bytes, offset + 4, uid); putU32(bytes, offset + 8, uid)
}
function putOrganization(bytes: Uint8Array, offset: number, a: number[], b: number[] = []) {
  bytes.set([0, 0xff, 0, a.length], offset)
  let cursor = offset + 4
  for (const team of a) { putU32(bytes, cursor, team); cursor += 4 }
  bytes[cursor++] = b.length
  for (const team of b) { putU32(bytes, cursor, team); cursor += 4 }
  return cursor
}
function putCompleteContract(bytes: Uint8Array, header: number, eid: number, team: number, wage: number, dates: { expiry: string; joined: string; effective: string }, typeIds: number[] = [], auxCount = 0) {
  putPackedDate(bytes, header, dates.expiry)
  bytes.fill(0xff, header + 4, header + 12)
  bytes.fill(0, header + 12, header + 15)
  bytes[header + 15] = typeIds.length
  let cursor = header + 16
  for (let index = 0; index < typeIds.length; index++) {
    putU32(bytes, cursor, 1000 + index); putU16(bytes, cursor + 4, 0xffff); putU16(bytes, cursor + 6, typeIds[index]); cursor += 8
  }
  bytes[cursor++] = auxCount
  for (let index = 0; index < auxCount; index++) { bytes.fill(index + 1, cursor, cursor + 31); cursor += 31 }
  const anchor = cursor + 74
  putPackedDate(bytes, anchor - 43, dates.expiry)
  putPackedDate(bytes, anchor - 39, dates.joined)
  putPackedDate(bytes, anchor - 24, dates.effective)
  putPackedDate(bytes, anchor - 5, '1900-01-02', 0)
  putU32(bytes, anchor, eid); putU32(bytes, anchor + 4, team); putU32(bytes, anchor + 8, 0); putU32(bytes, anchor + 12, wage)
  return { anchor, termsEnd: header + 16 + typeIds.length * 8 }
}
function putRelation(bytes: Uint8Array, anchor: number, eid: number, team: number, wage: number, start: string, end: string) {
  putPackedDate(bytes, anchor - 43, end)
  putPackedDate(bytes, anchor - 39, start)
  putPackedDate(bytes, anchor - 24, start)
  putPackedDate(bytes, anchor - 5, '1900-01-02', 0)
  putU32(bytes, anchor, eid); putU32(bytes, anchor + 4, team); putU32(bytes, anchor + 8, 0); putU32(bytes, anchor + 12, wage)
}
function player(eid = 123, uid = 900123, identityOffset = 2400, team = 679, primary = true) {
  return { eid, uid, identity_offset: identityOffset, identity_link_confidence: 'high', roster_group: { team_id: team, label: primary ? 'Principal' : 'B', index: primary ? 0 : 1, primary, record_offset: 42 } }
}

const resolved = (facts: ReturnType<typeof buildPlayerMembershipFacts>) => facts!.resolved_membership_facts

describe('E-MC-01A packed contract dates', () => {
  it('decodes flags separately instead of treating the low u16 as a simple day field', () => {
    const bytes = new Uint8Array(4)
    putU32(bytes, 0, packDate('2025-07-21', 0x1a00))
    expect(decodeMembershipPackedDate(bytes, 0)).toMatchObject({ year: 2025, day_of_year: 202, flags: 0x1a00, iso: '2025-07-21' })
  })

  it('fails closed for an impossible packed date', () => {
    const bytes = new Uint8Array(4)
    putU32(bytes, 0, ((2025 << 16) | 0x1ff) >>> 0)
    expect(decodeMembershipPackedDate(bytes, 0)).toBeNull()
  })
})

describe('E-MC-01A organization bridge', () => {
  it('groups multiple structural Teams into one organization without inventing a public Club UID', () => {
    const bytes = new Uint8Array(256)
    putOrganization(bytes, 16, [679, 16125], [1993])
    const index = indexStructuralOrganizations(bytes)
    const a = resolveStructuralTeamOrganization(index, 679)
    const b = resolveStructuralTeamOrganization(index, 1993)
    expect(a.status).toBe('confirmed')
    expect(b.organization?.organization_ref).toBe(a.organization?.organization_ref)
    expect(a.organization?.organization_team_ids).toEqual([679, 16125, 1993])
  })

  it('fails closed when a Team belongs to two valid organization records', () => {
    const bytes = new Uint8Array(256)
    putOrganization(bytes, 16, [2887, 100])
    putOrganization(bytes, 64, [2887, 200])
    const resolution = resolveStructuralTeamOrganization(indexStructuralOrganizations(bytes), 2887)
    expect(resolution).toMatchObject({ status: 'ambiguous', candidate_count: 2, organization: null })
  })

  it('fails closed when no organization record exists', () => {
    const resolution = resolveStructuralTeamOrganization(indexStructuralOrganizations(new Uint8Array(64)), 679)
    expect(resolution).toMatchObject({ status: 'unknown', candidate_count: 0, organization: null })
  })
})

describe('E-MC-01A complete contract grammar and resolver', () => {
  it('parses terms -> auxiliary_count -> 31-byte blocks -> trailer -> anchor and keeps current/future separate', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putOrganization(bytes, 3050, [670, 6700])
    const current = putCompleteContract(bytes, 120, 123, 679, 120000, { expiry: '2029-06-30', joined: '2015-07-02', effective: '2025-03-13' }, [0x20, 0x26], 2)
    const future = putCompleteContract(bytes, 650, 123, 670, 150000, { expiry: '2031-06-30', joined: '2026-07-01', effective: '2026-07-01' }, [0x26], 0)
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-07-21')!
    expect(facts.version).toBe(MEMBERSHIP_FACTS_VERSION)
    expect(facts.contracts.complete_objects).toHaveLength(2)
    expect(facts.contracts.complete_objects[0]).toMatchObject({ team_id_raw: 679, auxiliary_count: 2, expiry_date: '2029-06-30', joined_or_start_date: '2015-07-02', signed_or_effective_date: '2025-03-13' })
    expect(facts.contracts.complete_objects[0].offsets.anchor).toBe(current.anchor)
    expect(current.anchor - current.termsEnd).toBe(75 + 31 * 2)
    expect(facts.contracts.complete_objects[1].offsets.anchor).toBe(future.anchor)
    expect(resolved(facts).current_standard_contract).toMatchObject({ status: 'confirmed', value: { team_id_raw: 679 } })
    expect(resolved(facts).future_standard_contracts).toMatchObject({ status: 'confirmed', value: [expect.objectContaining({ team_id_raw: 670, signed_or_effective_date: '2026-07-01' })] })
  })

  it('does not let a future contract silently replace a missing current contract', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [670, 6700])
    putCompleteContract(bytes, 120, 123, 670, 150000, { expiry: '2031-06-30', joined: '2026-07-01', effective: '2026-07-01' })
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-07-21')!
    expect(resolved(facts).current_standard_contract.status).toBe('unknown')
    expect(resolved(facts).future_standard_contracts.value).toHaveLength(1)
  })

  it('fails closed with two current complete candidates', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putOrganization(bytes, 3050, [449, 22243])
    putCompleteContract(bytes, 120, 123, 679, 120000, { expiry: '2029-06-30', joined: '2015-07-02', effective: '2025-03-13' })
    putCompleteContract(bytes, 650, 123, 449, 120000, { expiry: '2031-06-30', joined: '2023-07-01', effective: '2023-07-01' })
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-07-21')!
    expect(resolved(facts).current_standard_contract.status).toBe('ambiguous')
    expect(resolved(facts).owner_organization.status).toBe('ambiguous')
  })

  it('classifies a same-organization relationship as internal, never loan', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 16125], [1993])
    putCompleteContract(bytes, 120, 123, 679, 120000, { expiry: '2029-06-30', joined: '2015-07-02', effective: '2025-03-13' })
    putRelation(bytes, 600, 123, 1993, 0, '2025-07-01', '2026-06-30')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(facts.relationships).toEqual([expect.objectContaining({ team_id_raw: 1993, structural_classification: 'internal_same_organization' })])
    expect(resolved(facts).is_loan).toMatchObject({ status: 'confirmed', value: false })
    expect(resolved(facts).current_organization.value?.organization_team_ids).toEqual([679, 16125, 1993])
  })

  it('confirms a loan only after grouping one external active organization', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [449, 22243])
    putOrganization(bytes, 3050, [679, 16125], [1993])
    putCompleteContract(bytes, 120, 123, 449, 120000, { expiry: '2031-06-30', joined: '2023-07-01', effective: '2023-07-01' })
    putRelation(bytes, 600, 123, 679, 165600, '2025-07-21', '2026-06-30')
    putRelation(bytes, 780, 123, 1993, 0, '2025-07-21', '2026-06-30')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(123, 900123, 2400, 679), bytes, '2025-08-01')!
    expect(resolved(facts).owner_organization.value?.organization_team_ids).toEqual([449, 22243])
    expect(resolved(facts).is_loan).toMatchObject({ status: 'confirmed', value: true })
    expect(resolved(facts).loan_to_organization.value?.organization_team_ids).toEqual([679, 16125, 1993])
    expect(resolved(facts).current_organization.value?.organization_ref).toBe(resolved(facts).loan_to_organization.value?.organization_ref)
  })

  it('groups two active relationship Teams from the same organization into one destination', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 16125], [1993])
    putOrganization(bytes, 3050, [708, 16147], [4441])
    putCompleteContract(bytes, 120, 123, 16125, 1000, { expiry: '2027-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    putRelation(bytes, 600, 123, 708, 0, '2025-07-01', '2026-06-30')
    putRelation(bytes, 780, 123, 4441, 0, '2025-07-01', '2026-06-30')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(123, 900123, 2400, 708), bytes, '2025-08-01')!
    expect(resolved(facts).is_loan).toMatchObject({ status: 'confirmed', value: true })
    expect(resolved(facts).loan_to_organization.value?.organization_team_ids).toEqual([708, 16147, 4441])
  })

  it('fails closed when more than one external active organization exists', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putOrganization(bytes, 3050, [449, 22243])
    putOrganization(bytes, 3100, [534, 22410])
    putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    putRelation(bytes, 600, 123, 449, 0, '2025-07-01', '2026-06-30')
    putRelation(bytes, 780, 123, 534, 0, '2025-07-01', '2026-06-30')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(resolved(facts).is_loan.status).toBe('ambiguous')
    expect(resolved(facts).loan_to_organization.status).toBe('ambiguous')
    expect(resolved(facts).owner_organization.status).toBe('confirmed')
  })

  it('does not invent owner/loan from a rootless secondary relation, while allowing current-org convergence', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 16125], [1993])
    putRelation(bytes, 600, 123, 679, 0, '2026-03-09', '2026-04-20')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2026-03-30')!
    expect(resolved(facts).owner_organization.status).toBe('unknown')
    expect(resolved(facts).loan_from_organization.status).toBe('unknown')
    expect(resolved(facts).is_loan.status).toBe('unknown')
    expect(resolved(facts).current_organization).toMatchObject({ status: 'confirmed', reason_code: 'structural_membership_and_current_relation_converge' })
  })

  it('fails closed when the root organization contradicts structural membership without positive external evidence', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putOrganization(bytes, 3050, [449, 22243])
    putCompleteContract(bytes, 120, 123, 449, 1000, { expiry: '2031-06-30', joined: '2023-07-01', effective: '2023-07-01' })
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(123, 900123, 2400, 679), bytes, '2025-08-01')!
    expect(resolved(facts).owner_organization.value?.organization_team_ids).toEqual([449, 22243])
    // No secondary evidence exists to explain why structural current Team points elsewhere.
    // The owner remains independent, but current membership must not be silently copied.
    expect(resolved(facts).current_organization.status).not.toBe('confirmed')
  })

  it('marks a non-primary roster team level unknown rather than name-classifying it', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(123, 900123, 2400, 1993, false), bytes, '2025-08-01')!
    expect(resolved(facts).team_level).toMatchObject({ status: 'unknown', value: null })
  })
})

describe('E-MC-01A fail-closed malformed evidence', () => {
  it('treats an anchor without a complete preamble as a secondary relationship, never a standard contract', () => {
    const bytes = new Uint8Array(4096)
    putRelation(bytes, 600, 123, 679, 0, '2025-07-01', '2026-06-30')
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(facts.contracts.complete_objects).toEqual([])
    expect(facts.relationships).toHaveLength(1)
  })

  it('fails closed for an incompatible auxiliary count / complete layout', () => {
    const bytes = new Uint8Array(4096)
    const built = putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    bytes[built.termsEnd] = 2 // derived anchor moves +62 bytes, real anchor stays put
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(facts.contracts.complete_objects).toEqual([])
    expect(facts.contracts.unsupported_anchors).toEqual([expect.objectContaining({ reason_code: 'complete_contract_layout_mismatch' })])
    expect(resolved(facts).current_standard_contract.status).toBe('unsupported')
  })

  it('fails closed for a truncated complete-object term payload', () => {
    const bytes = new Uint8Array(4096)
    const built = putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    bytes[135] = 5 // count claims five terms without moving the anchor
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(facts.contracts.complete_objects).toEqual([])
    expect(facts.contracts.unsupported_anchors.length).toBeGreaterThan(0)
    expect(built.anchor).toBeGreaterThan(0)
  })

  it('fails closed for an invalid essential packed date', () => {
    const bytes = new Uint8Array(4096)
    const built = putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    putU32(bytes, built.anchor - 43, ((2025 << 16) | 0x1ff) >>> 0)
    putIdentity(bytes, 2400, 123, 900123)
    const facts = buildPlayerMembershipFacts(player(), bytes, '2025-08-01')!
    expect(facts.contracts.complete_objects).toEqual([])
    expect(facts.contracts.unsupported_anchors).toEqual([expect.objectContaining({ reason_code: 'invalid_complete_contract_trailer_date' })])
  })

  it('does not throw or invent facts for an unsupported contract variant', () => {
    const bytes = new Uint8Array(4096)
    const built = putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    bytes[built.termsEnd] = 1
    putIdentity(bytes, 2400, 123, 900123)
    expect(() => buildPlayerMembershipFacts(player(), bytes, '2025-08-01')).not.toThrow()
    expect(resolved(buildPlayerMembershipFacts(player(), bytes, '2025-08-01')).current_standard_contract.value).toBeNull()
  })
})

describe('E-MC-01A persistence fence', () => {
  it('adds only membership_facts_v1 and diagnostics; legacy player fields are byte-for-byte unchanged', () => {
    const bytes = new Uint8Array(4096)
    putOrganization(bytes, 3000, [679, 1993])
    putCompleteContract(bytes, 120, 123, 679, 1000, { expiry: '2029-06-30', joined: '2024-07-01', effective: '2024-07-01' })
    putIdentity(bytes, 2400, 123, 900123)
    const p: Record<string, unknown> = {
      ...player(),
      current_contract: { team_id: 9999, team_name: 'LEGACY', expiry_date: '2030-01-01' },
      future_contracts: [{ team_id: 9998 }],
      contract_relationships: [{ team_id: 9997 }],
      loan: { status: 'current', from_team_id: 9999, to_team_id: 9997 },
      contracts_status: 'legacy',
      contract_team_id: 9999,
    }
    const result = { human_managers: [{ players: [p] }] }
    const before = JSON.stringify(p)
    enrichOfflineMembershipFacts(result, bytes, '2025-08-01')
    const afterWithoutEnvelope = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'membership_facts_v1')))
    expect(afterWithoutEnvelope).toBe(before)
    expect(p.membership_facts_v1).toMatchObject({ schema: 'membership_facts_v1', version: 'e-mc-01-v1' })
    expect(result).toHaveProperty('membership_facts_v1_diagnostics.persistence_authority', false)
  })
})
