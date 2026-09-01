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

function membership(overrides: Partial<PlayerMembershipWithClubs> = {}): PlayerMembershipWithClubs {
  return {
    id: 'membership', save_id: 'save', owner_id: 'owner', player_id: 'player',
    observed_date: '2026-09-01', season_id: null, current_club_id: selected.id,
    owner_club_id: selected.id, team_level: 'first_team', squad_name: 'Principal',
    is_loan: false, loan_from_club_id: null, loan_to_club_id: null,
    source_snapshot_id: 'snapshot', source_import_id: 'import', source_kind: 'fm',
    provenance: {}, created_at: '2026-09-01T12:00:00Z', currentClub: selected,
    ownerClub: selected, loanFromClub: null, loanToClub: null, ...overrides,
  }
}

describe('planning membership facts', () => {
  it('uses only the membership linked to the current snapshot', () => {
    const old = membership({ id: 'old', source_snapshot_id: 'old-snapshot' })
    const current = membership({ id: 'current' })
    expect(resolveCurrentSnapshotMembership([old, current], 'snapshot').membership?.id).toBe('current')
    expect(resolveCurrentSnapshotMembership([old], 'snapshot').membership).toBeNull()
  })

  it('fails closed when the current snapshot has conflicting memberships', () => {
    const conflict = membership({ id: 'conflict', current_club_id: external.id, currentClub: external })
    const result = resolveCurrentSnapshotMembership([membership(), conflict], 'snapshot')
    expect(result.membership).toBeNull()
    expect(result.diagnostic).toMatch(/conflitantes/i)
  })

  it('separates current, loaned in, loaned out and another club', () => {
    expect(classifyPlanningMembership({ membership: membership(), diagnostic: null }, selected.id).kind).toBe('current')
    expect(classifyPlanningMembership({ membership: membership({ owner_club_id: external.id, ownerClub: external, is_loan: true }), diagnostic: null }, selected.id).kind).toBe('loaned_in')
    expect(classifyPlanningMembership({ membership: membership({ current_club_id: external.id, currentClub: external, owner_club_id: selected.id, ownerClub: selected, is_loan: true }), diagnostic: null }, selected.id).kind).toBe('loaned_out')
    expect(classifyPlanningMembership({ membership: membership({ current_club_id: external.id, currentClub: external, owner_club_id: external.id, ownerClub: external }), diagnostic: null }, selected.id).kind).toBe('other_club')
  })

  it('does not infer a clean current membership when loan status is unknown', () => {
    const fact = classifyPlanningMembership({ membership: membership({ is_loan: null }), diagnostic: null }, selected.id)
    expect(fact.kind).toBe('unknown')
    expect(fact.diagnostic).toMatch(/is_loan=null/)
  })
})
