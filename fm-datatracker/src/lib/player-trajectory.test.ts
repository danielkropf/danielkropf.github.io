import { describe, expect, it } from 'vitest'
import type { Club, PlayerMembershipWithClubs, SaveEvent } from '../types/domain'
import { buildPlayerTrajectory, explicitEventLabel, safeTrajectoryObservations } from './player-trajectory'

function club(id: string, name: string): Club {
  return {
    id,
    save_id: 'save-1',
    owner_id: 'owner-1',
    fm_club_id: null,
    name,
    normalized_name: name.toLowerCase(),
    country: null,
    source_kind: 'fm',
    source_import_id: null,
    provenance: {},
    created_at: '2030-01-01T00:00:00Z',
    updated_at: '2030-01-01T00:00:00Z',
  }
}

function membership(
  id: string,
  date: string,
  snapshotId: string | null,
  overrides: Partial<PlayerMembershipWithClubs> = {},
): PlayerMembershipWithClubs {
  return {
    id,
    save_id: 'save-1',
    owner_id: 'owner-1',
    player_id: 'player-1',
    observed_date: date,
    season_id: null,
    current_club_id: null,
    owner_club_id: null,
    team_level: 'unknown',
    squad_name: 'Numancia',
    is_loan: null,
    loan_from_club_id: null,
    loan_to_club_id: null,
    source_snapshot_id: snapshotId,
    source_import_id: 'import-1',
    source_kind: 'fm',
    provenance: {},
    created_at: `${date}T12:00:00Z`,
    currentClub: null,
    ownerClub: null,
    loanFromClub: null,
    loanToClub: null,
    ...overrides,
  }
}

function event(overrides: Partial<SaveEvent> = {}): SaveEvent {
  return {
    id: 'event-1',
    save_id: 'save-1',
    owner_id: 'owner-1',
    event_type: 'manual_fact',
    event_date: '2030-06-01',
    season_id: null,
    club_id: null,
    player_id: 'player-1',
    intake_class_id: null,
    source_kind: 'manual',
    source_import_id: null,
    source_snapshot_id: null,
    derivation_version: null,
    provenance: {},
    payload: {},
    created_at: '2030-06-01T12:00:00Z',
    ...overrides,
  }
}

describe('player trajectory', () => {
  it('keeps only memberships with one unambiguous explicit snapshot link', () => {
    const result = safeTrajectoryObservations([
      membership('safe', '2030-01-01', 'snapshot-safe'),
      membership('no-link', '2030-02-01', null),
      membership('ambiguous-a', '2030-03-01', 'snapshot-ambiguous'),
      membership('ambiguous-b', '2030-03-01', 'snapshot-ambiguous'),
    ])

    expect(result.observations.map(item => item.membershipId)).toEqual(['safe'])
    expect(result.ambiguousSnapshotCount).toBe(1)
    expect(result.ignoredMembershipCount).toBe(3)
  })

  it('does not turn an unknown value into a context change', () => {
    const knownClub = club('club-a', 'Numancia')
    const trajectory = buildPlayerTrajectory([
      membership('a', '2030-01-01', 'snapshot-a', { current_club_id: knownClub.id, currentClub: knownClub, team_level: 'first_team' }),
      membership('b', '2030-06-01', 'snapshot-b', { current_club_id: null, currentClub: null, team_level: 'unknown' }),
    ])

    expect(trajectory.changes).toHaveLength(0)
  })

  it('derives a neutral observed context change when two known squads differ', () => {
    const trajectory = buildPlayerTrajectory([
      membership('a', '2030-01-01', 'snapshot-a', { squad_name: 'Numancia B' }),
      membership('b', '2030-06-01', 'snapshot-b', { squad_name: 'Numancia' }),
    ])

    expect(trajectory.changes).toHaveLength(1)
    expect(trajectory.changes[0].kind).toBe('observed_context_change')
    expect(trajectory.changes[0].changes).toEqual([
      { field: 'squad', label: 'Equipe/elenco', from: 'Numancia B', to: 'Numancia' },
    ])
    expect(trajectory.changes[0].provenance).toEqual({
      sourceMembershipIds: ['a', 'b'],
      sourceSnapshotIds: ['snapshot-a', 'snapshot-b'],
      rule: 'known-value-difference-v1',
    })
  })

  it('does not classify an observed club change as a transfer', () => {
    const clubA = club('club-a', 'Numancia')
    const clubB = club('club-b', 'Soria B')
    const trajectory = buildPlayerTrajectory([
      membership('a', '2030-01-01', 'snapshot-a', { current_club_id: clubA.id, currentClub: clubA }),
      membership('b', '2030-06-01', 'snapshot-b', { current_club_id: clubB.id, currentClub: clubB }),
    ])

    expect(trajectory.changes[0].changes[0].field).toBe('current_club')
    expect(trajectory.timeline[0].kind).toBe('derived_change')
    expect(JSON.stringify(trajectory.changes[0])).not.toContain('transfer')
  })

  it('preserves an explicit transfer SaveEvent as an explicit causal event', () => {
    const transfer = event({ id: 'transfer', event_type: 'transfer', event_date: '2030-07-01', source_kind: 'fm' })
    const trajectory = buildPlayerTrajectory([], [transfer])

    expect(trajectory.explicitEvents).toEqual([transfer])
    expect(trajectory.timeline[0].kind).toBe('explicit_event')
    expect(explicitEventLabel(transfer)).toBe('Transferência registrada')
  })

  it('keeps identical observed contexts without fabricating a milestone', () => {
    const trajectory = buildPlayerTrajectory([
      membership('a', '2030-01-01', 'snapshot-a'),
      membership('b', '2030-06-01', 'snapshot-b'),
    ])

    expect(trajectory.observations).toHaveLength(2)
    expect(trajectory.changes).toHaveLength(0)
    expect(trajectory.timeline).toHaveLength(0)
  })

  it('orders explicit events and derived changes chronologically', () => {
    const trajectory = buildPlayerTrajectory([
      membership('a', '2030-01-01', 'snapshot-a', { squad_name: 'Numancia B' }),
      membership('b', '2030-07-01', 'snapshot-b', { squad_name: 'Numancia' }),
    ], [event({ id: 'contract', event_type: 'contract_changed', event_date: '2030-04-01' })])

    expect(trajectory.timeline.map(item => [item.kind, item.date])).toEqual([
      ['explicit_event', '2030-04-01'],
      ['derived_change', '2030-07-01'],
    ])
  })
})
