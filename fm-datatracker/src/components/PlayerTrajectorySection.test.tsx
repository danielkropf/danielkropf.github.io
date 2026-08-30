// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerMembershipWithClubs, SaveEvent } from '../types/domain'
import { PlayerTrajectorySection } from './PlayerTrajectorySection'

afterEach(cleanup)

function membership(id: string, date: string, squad: string): PlayerMembershipWithClubs {
  return {
    id,
    save_id: 'save-1', owner_id: 'owner-1', player_id: 'player-1', observed_date: date,
    season_id: null, current_club_id: null, owner_club_id: null, team_level: 'unknown', squad_name: squad,
    is_loan: null, loan_from_club_id: null, loan_to_club_id: null, source_snapshot_id: `snapshot-${id}`,
    source_import_id: 'import-1', source_kind: 'fm', provenance: {}, created_at: `${date}T12:00:00Z`,
    currentClub: null, ownerClub: null, loanFromClub: null, loanToClub: null,
  }
}

function transferEvent(): SaveEvent {
  return {
    id: 'event-transfer', save_id: 'save-1', owner_id: 'owner-1', event_type: 'transfer', event_date: '2030-08-01',
    season_id: null, club_id: null, player_id: 'player-1', intake_class_id: null, source_kind: 'fm',
    source_import_id: null, source_snapshot_id: null, derivation_version: null, provenance: {}, payload: {},
    created_at: '2030-08-01T12:00:00Z',
  }
}

describe('PlayerTrajectorySection', () => {
  it('renders a neutral observed change without calling it a transfer', () => {
    render(<PlayerTrajectorySection memberships={[
      membership('a', '2030-01-01', 'Numancia B'),
      membership('b', '2030-06-01', 'Numancia'),
    ]} />)

    expect(screen.getByRole('heading', { name: 'Histórico longitudinal' })).toBeTruthy()
    expect(screen.getByText('Mudança de contexto observada')).toBeTruthy()
    expect(screen.queryByText('Transferência registrada')).toBeNull()
  })

  it('uses the causal label only for an explicit SaveEvent', () => {
    render(<PlayerTrajectorySection events={[transferEvent()]} />)

    expect(screen.getByText('Transferência registrada')).toBeTruthy()
    expect(screen.getByText('EVENTO EXPLÍCITO')).toBeTruthy()
  })

  it('shows observations but no fabricated milestone when context is unchanged', () => {
    render(<PlayerTrajectorySection memberships={[
      membership('a', '2030-01-01', 'Numancia'),
      membership('b', '2030-06-01', 'Numancia'),
    ]} />)

    expect(within(screen.getByRole('list', { name: 'Vínculos observados' })).getAllByText('Numancia')).toHaveLength(2)
    expect(screen.getByText('Nenhuma mudança ou evento confirmado')).toBeTruthy()
  })
})
