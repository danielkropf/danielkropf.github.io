import { describe, expect, it } from 'vitest'
import { classifyPlanningMembership, resolveCurrentSnapshotMembership } from './planning-membership'
import type { Club, PlayerMembershipWithClubs } from '../types/domain'

const club = (id: string, name: string): Club => ({
  id, name, save_id: 'save', owner_id: 'owner', fm_club_id: null,
  normalized_name: name.toLowerCase(), country: null, source_kind: 'fm',
  source_import_id: null, provenance: {}, created_at: '', updated_at: '',
})

const selected = club('selected', 'Fluminense')
const external = club('external', 'Clube Externo')

function authority(fields: Partial<Record<string, Record<string, unknown>>> = {}) {
  return {
    membership_authority: 'membership_facts_v1',
    membership_facts_sync_version: 'e-mc-01b-v1',
    factual_fields: {
      current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['current'] },
      owner_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['owner'] },
      team_level: { status: 'confirmed', evidence_refs: ['team'] },
      structural_squad: { status: 'confirmed', evidence_refs: ['squad'] },
      is_loan: { status: 'confirmed', evidence_refs: ['loan'] },
      loan_from_organization: { status: 'unknown', evidence_refs: [] },
      loan_to_organization: { status: 'unknown', evidence_refs: [] },
      ...fields,
    },
  }
}

function membership(overrides: Partial<PlayerMembershipWithClubs> = {}): PlayerMembershipWithClubs {
  return {
    id: 'membership', save_id: 'save', owner_id: 'owner', player_id: 'player',
    observed_date: '2026-09-01', season_id: null, current_club_id: selected.id,
    owner_club_id: selected.id, team_level: 'first_team', squad_name: 'Principal',
    is_loan: false, loan_from_club_id: null, loan_to_club_id: null,
    source_snapshot_id: 'snapshot', source_import_id: 'import', source_kind: 'fm',
    provenance: authority(), created_at: '2026-09-01T12:00:00Z', currentClub: selected,
    ownerClub: selected, loanFromClub: null, loanToClub: null, ...overrides,
  }
}

describe('planning membership facts', () => {
  it('uses only memberships linked to the exact current snapshot set', () => {
    const old = membership({ id: 'old', source_snapshot_id: 'old-snapshot', observed_date: '2026-08-01' })
    const current = membership({ id: 'current' })
    const resolution = resolveCurrentSnapshotMembership([old, current], ['snapshot'])
    expect(resolution.membership?.current_club_id).toBe(selected.id)
    expect(resolveCurrentSnapshotMembership([old], ['snapshot']).membership).toBeNull()
  })

  it('accepts equivalent coverage from multiple snapshots at the same checkpoint without upload precedence', () => {
    const one = membership({ id: 'one', source_snapshot_id: 'snapshot-a', created_at: '2026-09-01T12:00:00Z' })
    const two = membership({ id: 'two', source_snapshot_id: 'snapshot-b', created_at: '2026-09-01T13:00:00Z' })
    const result = resolveCurrentSnapshotMembership([two, one], ['snapshot-a', 'snapshot-b'])
    expect(result.membership?.current_club_id).toBe(selected.id)
    expect(result.membership?.source_snapshot_id).toBeNull()
    expect(result.membership?.provenance.source_snapshot_ids).toEqual(['snapshot-a', 'snapshot-b'])
  })

  it('fails closed only for the conflicting factual field and preserves independent owner evidence', () => {
    const conflict = membership({
      id: 'conflict', source_snapshot_id: 'snapshot-b', current_club_id: external.id, currentClub: external,
      provenance: authority({ current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['external'] } }),
    })
    const result = resolveCurrentSnapshotMembership([membership({ source_snapshot_id: 'snapshot-a' }), conflict], ['snapshot-a', 'snapshot-b'])
    expect(result.membership?.current_club_id).toBeNull()
    expect(result.membership?.owner_club_id).toBe(selected.id)
    expect(result.diagnostic).toMatch(/currentClubId:conflicting/)
  })

  it('rejects legacy Phase0E rows as current authority', () => {
    const legacy = membership({ provenance: { legacy_phase0e_untrusted: true, membership_authority: 'legacy_phase0e_untrusted' } })
    const result = resolveCurrentSnapshotMembership([legacy], 'snapshot')
    expect(result.membership).toBeNull()
    expect(result.diagnostic).toMatch(/autoridade factual/i)
  })

  it('accepts a CSV row only with the checkpoint-exact authority contract', () => {
    const csv = membership({
      source_kind: 'csv', owner_club_id: null, ownerClub: null, is_loan: null,
      provenance: {
        membership_authority: 'csv_observation', current_fact_contract: 'checkpoint-exact-v1',
        factual_fields: {
          current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['csv'] },
          owner_organization: { status: 'unknown', evidence_refs: [] },
          team_level: { status: 'confirmed', evidence_refs: ['csv'] },
          structural_squad: { status: 'confirmed', evidence_refs: ['csv'] },
          is_loan: { status: 'unknown', evidence_refs: [] },
          loan_from_organization: { status: 'unknown', evidence_refs: [] },
          loan_to_organization: { status: 'unknown', evidence_refs: [] },
        },
      },
    })
    expect(resolveCurrentSnapshotMembership([csv], 'snapshot').membership?.current_club_id).toBe(selected.id)
    expect(resolveCurrentSnapshotMembership([csv], 'snapshot').membership?.is_loan).toBeNull()
  })

  it('separates current, loaned in, loaned out and another club', () => {
    expect(classifyPlanningMembership({ membership: membership(), diagnostic: null }, selected.id).kind).toBe('current')
    expect(classifyPlanningMembership({ membership: membership({ owner_club_id: external.id, ownerClub: external, is_loan: true }), diagnostic: null }, selected.id).kind).toBe('loaned_in')
    expect(classifyPlanningMembership({ membership: membership({ current_club_id: external.id, currentClub: external, owner_club_id: selected.id, ownerClub: selected, is_loan: true }), diagnostic: null }, selected.id).kind).toBe('loaned_out')
    expect(classifyPlanningMembership({ membership: membership({ current_club_id: external.id, currentClub: external, owner_club_id: external.id, ownerClub: external }), diagnostic: null }, selected.id).kind).toBe('other_club')
  })

  it('keeps current organization factual when loan status is unknown', () => {
    const fact = classifyPlanningMembership({ membership: membership({ is_loan: null }), diagnostic: null }, selected.id)
    expect(fact.kind).toBe('current')
    expect(fact.diagnostic).toMatch(/is_loan=null/)
  })
})
