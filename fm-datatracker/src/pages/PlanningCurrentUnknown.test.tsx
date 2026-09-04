// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningPage } from './PlanningPage'

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  loadConfig: vi.fn(),
  loadPlayers: vi.fn(),
  loadMemberships: vi.fn(),
  loadReference: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../features/saves/SaveContext', () => ({
  useSaves: () => ({ selected: { id: 'save', structure: { trackedClubs: [{ club_id: 'club-a', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-a', name: 'Fluminense' } }] } } }),
}))
vi.mock('../features/potential/PotentialContext', () => ({ usePotential: () => ({ showPotential: true }) }))
vi.mock('../lib/dataCache', () => ({
  loadCurrentPlayers: (...args: unknown[]) => mocks.loadPlayers(...args),
  loadReferenceDataset: (...args: unknown[]) => mocks.loadReference(...args),
}))
vi.mock('../lib/longitudinal-service', () => ({ loadPlanningMemberships: (...args: unknown[]) => mocks.loadMemberships(...args) }))
vi.mock('../lib/model-config', () => ({
  loadModelConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  scheduleModelConfigPatch: (...args: unknown[]) => mocks.schedule(...args),
  patchModelConfig: vi.fn().mockResolvedValue({ diagnostic: null }),
  retryModelConfigPatch: vi.fn().mockResolvedValue(null),
}))
vi.mock('../lib/reference', () => ({
  generalReferencePercentile: () => null,
  generalReferenceScoresByFamily: () => ({}),
  percentile: () => null,
  referencePairedRoleScore: () => null,
}))
vi.mock('../components/ScoreWithProjection', () => ({ ScoreWithProjection: () => <span data-testid="projection">projection</span> }))
vi.mock('../components/SaveState', () => ({ SaveState: () => null }))
vi.mock('../components/PlayerPeek', () => ({ PlayerPeek: () => <span data-testid="peek">peek</span> }))
vi.mock('../components/CustomSelect', () => ({ CustomSelect: () => null }))
vi.mock('../components/PositionSelector', () => ({
  canonicalPosition: (value: string) => value,
  PositionSelector: () => null,
}))

beforeEach(() => {
  localStorage.clear()
  mocks.schedule.mockReset()
  mocks.loadPlayers.mockReset().mockResolvedValue([{ id: 'player', current_name: 'Jogador sem snapshot', nationality: 'BRA', player_snapshots: [] }])
  mocks.loadMemberships.mockReset().mockResolvedValue([])
  mocks.loadReference.mockReset().mockResolvedValue({ players: [], attributes: [], markets: [] })
  mocks.loadConfig.mockReset().mockResolvedValue({
    planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} },
    tactics: [{
      id: 'tactic', name: 'Tática',
      ipAssignments: [{ playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CD', roleName: 'Central Defender' }],
      oopAssignments: [{ playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CB', roleName: 'Centre Back' }],
    }],
    selected_tactic_id: 'tactic',
  })
})

afterEach(cleanup)

describe('PlanningPage current unknown', () => {
  it('mantém identidade sem snapshot atual utilizável e não promove score/peek histórico', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)

    expect(await screen.findByText('Jogador sem snapshot')).not.toBeNull()
    expect(screen.getByText('Sem observação no checkpoint atual')).not.toBeNull()
    expect(screen.getByText('Situação atual desconhecida')).not.toBeNull()
    expect(screen.queryByTestId('projection')).toBeNull()
    expect(screen.queryByTestId('peek')).toBeNull()
  })

  it('preserva jogador já alocado no planejamento mesmo sem snapshot atual', async () => {
    mocks.loadConfig.mockResolvedValue({
      planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: { principal: { 'slot-1': ['player'] } }, setLayouts: {} },
      tactics: [{
        id: 'tactic', name: 'Tática',
        ipAssignments: [{ playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CD', roleName: 'Central Defender' }],
        oopAssignments: [{ playerId: 'slot-1', nodeId: '1', position: 'D (C)', roleCode: 'CB', roleName: 'Centre Back' }],
      }],
      selected_tactic_id: 'tactic',
    })

    render(<MemoryRouter><PlanningPage /></MemoryRouter>)

    expect(await screen.findByText('Jogador sem snapshot')).not.toBeNull()
    expect(screen.getByText('Sem observação atual')).not.toBeNull()
    expect(screen.queryByTestId('projection')).toBeNull()
  })
})
