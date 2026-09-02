// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningPage } from './PlanningPage'

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  loadConfig: vi.fn(),
  loadPlayers: vi.fn(),
  loadMemberships: vi.fn(),
  loadReference: vi.fn(),
  generalReferenceScores: vi.fn(),
  referencePairedRoleScore: vi.fn(),
  referenceDataset: { players: [{ p: ['D (C)'] }], attributes: [] } as any,
  selected: { id: 'save', structure: { trackedClubs: [{ club_id: 'club-a', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-a', name: 'Fluminense' } }] } } as any,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../features/saves/SaveContext', () => ({ useSaves: () => ({ selected: mocks.selected }) }))
vi.mock('../features/potential/PotentialContext', () => ({ usePotential: () => ({ showPotential: true }) }))
vi.mock('../lib/dataCache', () => ({ loadCurrentPlayers: (...args: unknown[]) => mocks.loadPlayers(...args), loadReferenceDataset: (...args: unknown[]) => mocks.loadReference(...args) }))
vi.mock('../lib/longitudinal-service', () => ({ loadPlanningMemberships: (...args: unknown[]) => mocks.loadMemberships(...args) }))
vi.mock('../lib/model-config', () => ({
  loadModelConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  scheduleModelConfigPatch: (...args: unknown[]) => mocks.schedule(...args),
  patchModelConfig: vi.fn().mockResolvedValue({ diagnostic: null }),
  retryModelConfigPatch: vi.fn().mockResolvedValue(null),
}))
vi.mock('../lib/base-position-score', () => ({ generalScoreForSnapshot: () => ({ score: 11 }) }))
vi.mock('../lib/role-scoring', () => ({
  resolveRoleWeights: ({ roleId }: { roleId: string }) => ({ roleId }),
  pairedRoleScore: (_attributes: unknown, ip: { roleId: string }) => ip.roleId.includes('AP') ? 13 : 10,
}))
vi.mock('../lib/reference', () => ({
  generalReferencePercentile: () => ({ percentile: 50, population: [] }),
  generalReferenceScoresByFamily: (...args: unknown[]) => mocks.generalReferenceScores(...args),
  percentile: () => 50,
  referencePairedRoleScore: (...args: unknown[]) => mocks.referencePairedRoleScore(...args),
}))
vi.mock('../lib/positions', () => ({ canPlayPosition: () => true }))
vi.mock('../lib/planning-familiarity', () => ({
  planningFamiliarity: () => 'familiar', isPlanningFamiliar: () => true,
  isPlanningOutOfPosition: () => false, planningFamiliarityLabel: () => '', planningFamiliarityTooltip: () => '',
}))
vi.mock('../components/ScoreWithProjection', () => ({ ScoreWithProjection: ({ scoreKey }: { scoreKey?: string }) => <span data-testid="projection-key">{scoreKey ?? 'general'}</span> }))
vi.mock('../components/SaveState', () => ({ SaveState: () => null }))
vi.mock('../components/PlayerPeek', () => ({ PlayerPeek: () => null }))
vi.mock('../components/CustomSelect', () => ({ CustomSelect: ({ value, options, onChange, ariaLabel }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; ariaLabel: string }) => <select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }))
vi.mock('../components/PositionSelector', () => ({
  canonicalPosition: (value: string) => value,
  PositionSelector: ({ onChange }: { onChange: (value: string[]) => void }) => <button onClick={() => onChange(['D (C)', 'M (C)'])}>Duas posições</button>,
}))

const snapshot = {
  id: 'snapshot', snapshot_date: '2026-09-01', age: 18, positions: ['D (C)', 'M (C)'],
  club: 'Fluminense', squad: 'Principal', preferred_foot: 'right', height: 180, weight: 75,
  player_attributes: [], raw_data: {}, normalized_data: {},
}

beforeEach(() => {
  localStorage.clear()
  mocks.referenceDataset = { players: [{ p: ['D (C)'] }], attributes: [] }
  mocks.selected = { id: 'save', structure: { trackedClubs: [{ club_id: 'club-a', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-a', name: 'Fluminense' } }] } }
  mocks.schedule.mockReset()
  mocks.loadPlayers.mockReset().mockResolvedValue([{ id: 'player', current_name: 'Jogador Teste', nationality: 'BRA', player_snapshots: [snapshot] }])
  mocks.loadReference.mockReset().mockResolvedValue(mocks.referenceDataset)
  mocks.generalReferenceScores.mockReset().mockReturnValue({})
  mocks.referencePairedRoleScore.mockReset().mockReturnValue(10)
  mocks.loadMemberships.mockReset().mockResolvedValue([{
    id: 'membership', save_id: 'save', owner_id: 'owner', player_id: 'player', observed_date: '2026-09-01', season_id: null,
    current_club_id: 'club-a', owner_club_id: 'club-a', team_level: 'first_team', squad_name: 'Principal', is_loan: false,
    loan_from_club_id: null, loan_to_club_id: null, source_snapshot_id: 'snapshot', source_import_id: 'import', source_kind: 'fm',
    provenance: {}, created_at: '', currentClub: { id: 'club-a', name: 'Fluminense' }, ownerClub: { id: 'club-a', name: 'Fluminense' }, loanFromClub: null, loanToClub: null,
  }])
  mocks.loadConfig.mockReset().mockResolvedValue({
    planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} },
    tactics: [{
      id: 'tactic', name: 'Tática',
      ipAssignments: [
        { playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CD', roleName: 'Central Defender' },
        { playerId: 'slot-2', nodeId: '2', position: 'M (C)', roleCode: 'AP', roleName: 'Advanced Playmaker' },
      ],
      oopAssignments: [
        { playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CB', roleName: 'Centre Back' },
        { playerId: 'slot-2', nodeId: '2', position: 'DM (C)', roleCode: 'DM', roleName: 'Defensive Midfielder' },
      ],
    }],
    selected_tactic_id: 'tactic',
  })
})

afterEach(cleanup)

describe('PlanningPage 3C', () => {
  it('uses the single best contextual pair and moves the player to a market group from the context menu', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Duas posições' }))
    await waitFor(() => expect(screen.getByTestId('projection-key').textContent).toBe('IP:M(C):AP|OOP:DM(C):DM'))

    fireEvent.contextMenu(screen.getByText('Jogador Teste').closest('.roster-player-card')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar a Venda' }))

    await waitFor(() => expect(screen.getByText('Área livre de mercado')).not.toBeNull())
    expect(screen.getAllByText('Jogador Teste').length).toBeGreaterThan(0)
    await waitFor(() => {
      const patches = mocks.schedule.mock.calls.map(call => call[2] as Record<string, unknown>)
      const saved = patches.find(patch => JSON.stringify(patch).includes('"sale":{"market":["player"]}'))
      expect(saved).toBeTruthy()
    })
  })


  it('reuses memberships only for the same save, planning club, and exact cached player list', async () => {
    const referenceScoreCalls = () => mocks.generalReferenceScores.mock.calls.filter(call => call[0] === mocks.referenceDataset.players).length

    const first = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
    expect(mocks.loadMemberships).toHaveBeenLastCalledWith('save', ['snapshot'])

    const initialGeneralReferenceCalls = referenceScoreCalls()
    const initialRoleReferenceCalls = mocks.referencePairedRoleScore.mock.calls.length
    expect(initialGeneralReferenceCalls).toBeGreaterThan(0)
    expect(initialRoleReferenceCalls).toBeGreaterThan(0)

    first.unmount()
    const second = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
    expect(referenceScoreCalls()).toBe(initialGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore).toHaveBeenCalledTimes(initialRoleReferenceCalls)

    second.unmount()
    mocks.loadPlayers.mockResolvedValue([{ id: 'player', current_name: 'Jogador Teste', nationality: 'BRA', player_snapshots: [snapshot] }])
    const refreshed = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(2)
    expect(referenceScoreCalls()).toBe(initialGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore).toHaveBeenCalledTimes(initialRoleReferenceCalls)

    refreshed.unmount()
    mocks.selected = { id: 'save', structure: { trackedClubs: [{ club_id: 'club-b', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-b', name: 'Outro Clube' } }] } }
    const otherClub = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(3)

    const otherClubGeneralReferenceCalls = referenceScoreCalls()
    const otherClubRoleReferenceCalls = mocks.referencePairedRoleScore.mock.calls.length
    expect(otherClubGeneralReferenceCalls).toBeGreaterThan(initialGeneralReferenceCalls)
    expect(otherClubRoleReferenceCalls).toBeGreaterThan(initialRoleReferenceCalls)

    otherClub.unmount()
    mocks.selected = { id: 'save-2', structure: { trackedClubs: [{ club_id: 'club-b', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-b', name: 'Outro Clube' } }] } }
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(4)
    expect(referenceScoreCalls()).toBeGreaterThan(otherClubGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore.mock.calls.length).toBeGreaterThan(otherClubRoleReferenceCalls)
  })

  it('does not retain a failed memberships request in the warm cache', async () => {
    const successfulRows = await mocks.loadMemberships()
    mocks.loadMemberships.mockReset()
      .mockRejectedValueOnce(new Error('membership unavailable'))
      .mockResolvedValueOnce(successfulRows)

    const first = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(await screen.findByText('Contexto factual indisponível; o planejamento manual continua seguro.')).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)

    first.unmount()
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    await waitFor(() => expect(mocks.loadMemberships).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Contexto factual indisponível; o planejamento manual continua seguro.')).toBeNull()
  })
})
