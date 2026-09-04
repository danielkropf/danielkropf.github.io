import { describe, expect, it } from 'vitest'
import { buildMembershipPersistenceRow, buildMembershipPersistenceRows } from './membership-persistence'

function fact(status: string, value: unknown, reason = 'fixture_reason') {
  return { status, reason_code: reason, value, evidence_refs: ['game_db.dat@42'] }
}

function row() {
  const organization = {
    organization_ref: 'game_db.dat@100',
    organization_team_ids: [1993, 679, 16125, 679],
    record_offset: 100,
    evidence_team_id_raw: 679,
    evidence_team_name_raw: 'FC Bayern München',
    evidence_team_name_status: 'confirmed',
  }
  return {
    fm_player_id: '900123',
    membership_facts_v1: {
      schema: 'membership_facts_v1',
      version: 'e-mc-01-v1',
      provenance: { checkpoint_date: '2025-08-01' },
      raw_structural_membership: { team_id_raw: 679, team_name_raw: 'FC Bayern München', roster_group_label_raw: 'Principal', roster_group_index_raw: 0, roster_group_primary_raw: true },
      resolved_membership_facts: {
        structural_team: fact('confirmed', { team_id_raw: 679 }),
        structural_squad: fact('confirmed', { label_raw: 'Principal', index_raw: 0 }),
        organization_identity: fact('confirmed', organization),
        team_level: fact('confirmed', 'first_team'),
        current_organization: fact('confirmed', organization),
        owner_organization: fact('confirmed', organization),
        is_loan: fact('confirmed', false),
        loan_from_organization: fact('unknown', null),
        loan_to_organization: fact('unknown', null),
        current_standard_contract: fact('confirmed', { ref: 'game_db.dat@500', team_id_raw: 679, organization_ref: 'game_db.dat@100', expiry_date: '2029-06-30' }),
        future_standard_contracts: fact('confirmed', []),
        contract_expiry: fact('confirmed', '2029-06-30'),
        joined_or_start_date: fact('confirmed', '2015-07-02'),
        signed_or_effective_date: fact('confirmed', '2025-03-13'),
      },
    },
  }
}

describe('E-MC-01B membership persistence payload', () => {
  it('keeps factual status/provenance, canonical Team set and safe display-name evidence', () => {
    const compact = buildMembershipPersistenceRow(row())!
    expect(compact.checkpoint_date).toBe('2025-08-01')
    expect(compact.organization_identity.value?.organization_team_ids).toEqual([679, 1993, 16125])
    expect(compact.organization_identity.value?.evidence_team_name_raw).toBe('FC Bayern München')
    expect(compact.is_loan).toMatchObject({ status: 'confirmed', value: false })
    expect(compact.loan_to_organization).toMatchObject({ status: 'unknown', value: null })
    expect(compact.contract_facts.contract_expiry.value).toBe('2029-06-30')
  })

  it('fails closed when a confirmed organization has no structurally valid identity', () => {
    const source = row()
    source.membership_facts_v1.resolved_membership_facts.current_organization = fact('confirmed', { organization_ref: '', organization_team_ids: [] })
    const compact = buildMembershipPersistenceRow(source)!
    expect(compact.current_organization).toMatchObject({ status: 'unsupported', value: null, reason_code: 'invalid_confirmed_organization_shape' })
  })

  it('fails closed instead of persisting an unsupported semantic team level as confirmed null', () => {
    const source = row()
    source.membership_facts_v1.resolved_membership_facts.team_level = fact('confirmed', 'academy')
    const compact = buildMembershipPersistenceRow(source)!
    expect(compact.team_level).toMatchObject({ status: 'unsupported', value: null, reason_code: 'team_level_not_supported_by_emc01b' })
  })

  it('rejects duplicate FM identities in one persistence payload', () => {
    expect(() => buildMembershipPersistenceRows([row(), row()])).toThrow(/duplicate FM player id/)
  })

  it('ignores unknown membership envelope versions instead of treating them as authority', () => {
    const source = row()
    source.membership_facts_v1.version = 'future-version'
    expect(buildMembershipPersistenceRow(source)).toBeNull()
  })
})
