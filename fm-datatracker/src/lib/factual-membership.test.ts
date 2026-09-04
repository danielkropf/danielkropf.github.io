import { describe, expect, it } from 'vitest'
import { resolveFactualMembershipContext, type FactualMembershipObservation } from './factual-membership'

function observation(overrides: Partial<FactualMembershipObservation> = {}): FactualMembershipObservation {
  return {
    id: crypto.randomUUID(), player_id: 'p1', observed_date: '2025-08-01',
    current_club_id: 'club-a', owner_club_id: 'club-a', team_level: 'first_team', squad_name: 'Principal',
    is_loan: false, loan_from_club_id: null, loan_to_club_id: null,
    provenance: {
      membership_authority: 'membership_facts_v1', membership_facts_sync_version: 'e-mc-01b-v1',
      factual_fields: {
        current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['a'] },
        owner_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['b'] },
        team_level: { status: 'confirmed', evidence_refs: ['c'] },
        structural_squad: { status: 'confirmed', evidence_refs: ['squad'] },
        is_loan: { status: 'confirmed', evidence_refs: ['d'] },
        loan_from_organization: { status: 'unknown', evidence_refs: [] },
        loan_to_organization: { status: 'unknown', evidence_refs: [] },
      },
    },
    ...overrides,
  }
}

describe('E-MC-01B factual membership resolver', () => {
  it('never fills current state from an older last-confirmed observation', () => {
    const old = observation({ observed_date: '2025-07-01' })
    const current = observation({ observed_date: '2025-08-01', current_club_id: null, provenance: {
      membership_authority: 'membership_facts_v1', membership_facts_sync_version: 'e-mc-01b-v1',
      factual_fields: { current_organization: { status: 'unknown', evidence_refs: [] } },
    } })
    const resolved = resolveFactualMembershipContext([old, current], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId).toMatchObject({ status: 'unknown', value: null })
    expect(resolved.lastConfirmed.currentClubId).toMatchObject({ status: 'confirmed', value: 'club-a', observed_date: '2025-07-01' })
  })

  it('fails closed when two confirmed observations at the same checkpoint disagree', () => {
    const resolved = resolveFactualMembershipContext([observation(), observation({ id: 'other', current_club_id: 'club-b' })], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId).toMatchObject({ status: 'conflicting', value: null })
  })


  it('resolves the raw squad label independently at the checkpoint', () => {
    const resolved = resolveFactualMembershipContext([observation()], 'p1', '2025-08-01')
    expect(resolved.current.squadName).toMatchObject({ status: 'confirmed', value: 'Principal' })
  })

  it('ignores Phase0E legacy observations even if their legacy columns are populated', () => {
    const legacy = observation({ provenance: { legacy_phase0e_untrusted: true, membership_facts_sync_version: 'phase0e-v1' } })
    const resolved = resolveFactualMembershipContext([legacy], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId.status).toBe('unknown')
    expect(resolved.ignoredLegacyObservationCount).toBe(1)
  })

  it('accepts a checkpoint-exact CSV observation only under its explicit authority contract', () => {
    const csv = observation({
      owner_club_id: null,
      is_loan: null,
      provenance: {
        membership_authority: 'csv_observation',
        current_fact_contract: 'checkpoint-exact-v1',
        factual_fields: {
          current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['snapshot:csv'] },
          owner_organization: { status: 'unknown', evidence_refs: [] },
          team_level: { status: 'confirmed', evidence_refs: ['snapshot:csv'] },
          structural_squad: { status: 'confirmed', evidence_refs: ['snapshot:csv'] },
          is_loan: { status: 'unknown', evidence_refs: [] },
          loan_from_organization: { status: 'unknown', evidence_refs: [] },
          loan_to_organization: { status: 'unknown', evidence_refs: [] },
        },
      },
    })
    const resolved = resolveFactualMembershipContext([csv], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId).toMatchObject({ status: 'confirmed', value: 'club-a' })
    expect(resolved.current.ownerClubId.status).toBe('unknown')
    expect(resolved.current.isLoan.status).toBe('unknown')
  })

  it('rejects an old CSV row without the checkpoint-exact authority contract', () => {
    const csv = observation({ provenance: { membership_authority: 'csv_observation' } })
    const resolved = resolveFactualMembershipContext([csv], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId.status).toBe('unknown')
    expect(resolved.ignoredLegacyObservationCount).toBe(1)
  })

  it('keeps owner independent when current location is unknown', () => {
    const row = observation({ current_club_id: null, provenance: {
      membership_authority: 'membership_facts_v1', membership_facts_sync_version: 'e-mc-01b-v1',
      factual_fields: {
        current_organization: { status: 'unknown', evidence_refs: [] },
        owner_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['owner'] },
        team_level: { status: 'unknown', evidence_refs: [] },
        is_loan: { status: 'unknown', evidence_refs: [] },
        loan_from_organization: { status: 'unknown', evidence_refs: [] },
        loan_to_organization: { status: 'unknown', evidence_refs: [] },
      },
    } })
    const resolved = resolveFactualMembershipContext([row], 'p1', '2025-08-01')
    expect(resolved.current.currentClubId.status).toBe('unknown')
    expect(resolved.current.ownerClubId).toMatchObject({ status: 'confirmed', value: 'club-a' })
    expect(resolved.current.isLoan.status).toBe('unknown')
  })
})
