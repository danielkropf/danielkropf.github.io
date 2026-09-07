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
vi.mock('../components/ScoreWithProjection', () => ({ ScoreWithProjection: ({ scoreKey, currentScore }: { scoreKey?: string; currentScore?: number | null }) => <span data-testid="projection-key" data-current-score={currentScore ?? ''}>{scoreKey ?? 'general'}</span> }))
vi.mock('../components/SaveState', () => ({ SaveState: () => null }))
vi.mock('../components/PlayerPeek', () => ({ PlayerPeek: ({ player }: { player: { current_name: string } }) => <button type="button" data-testid="player-peek" aria-label={`Prévia de ${player.current_name}`}>peek</button> }))
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
  it('renders compact pitch sets as border legends without persistent vacancy squares and with a wider decision table', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()

    await waitFor(() => expect(view.container.querySelectorAll('.planning-set-legend').length).toBe(2))
    expect(view.container.querySelectorAll('.planning-phase-line').length).toBe(0)
    expect(view.container.querySelectorAll('.planning-set-vacancy').length).toBe(0)
    expect(screen.getByText('Idade')).not.toBeNull()
    expect(screen.getByText('Clube atual')).not.toBeNull()
  })

  it('refreshes the tactic structure when Planning becomes active again', async () => {
    const view = render(<MemoryRouter><PlanningPage active /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    await waitFor(() => expect(view.container.querySelectorAll('.planning-set-legend').length).toBe(2))

    mocks.loadConfig.mockResolvedValue({
      planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} },
      tactics: [{
        id: 'tactic', name: 'Tática',
        ipAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'AF', roleName: 'Advanced Forward' }],
        oopAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'PF', roleName: 'Pressing Forward' }],
      }],
      selected_tactic_id: 'tactic',
      selected_tactic_id_by_club: { 'club-a': 'tactic' },
    })

    view.rerender(<MemoryRouter><PlanningPage active={false} /></MemoryRouter>)
    view.rerender(<MemoryRouter><PlanningPage active /></MemoryRouter>)

    await waitFor(() => {
      const legends = [...view.container.querySelectorAll<HTMLElement>('.planning-set-legend')]
      expect(legends).toHaveLength(1)
      expect(legends[0].textContent).toContain('ST')
    })
    expect(mocks.loadPlayers).toHaveBeenCalledTimes(1)
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
  })

  it('drops a deleted tactic from Planning and sanitizes its stale club selection on reactivation', async () => {
    mocks.loadConfig.mockResolvedValue({
      planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} },
      tactics: [
        {
          id: 'deleted', name: 'Tática excluída',
          ipAssignments: [{ playerId: 'slot-dc', nodeId: '1', position: 'D (C)', roleCode: 'CD', roleName: 'Central Defender' }],
          oopAssignments: [{ playerId: 'slot-dc', nodeId: '1', position: 'D (C)', roleCode: 'CB', roleName: 'Centre Back' }],
        },
        {
          id: 'kept', name: 'Tática mantida',
          ipAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'AF', roleName: 'Advanced Forward' }],
          oopAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'PF', roleName: 'Pressing Forward' }],
        },
      ],
      selected_tactic_id: 'deleted',
      selected_tactic_id_by_club: { 'club-a': 'deleted' },
    })

    const view = render(<MemoryRouter><PlanningPage active /></MemoryRouter>)
    expect(await screen.findByRole('option', { name: 'Tática excluída' })).not.toBeNull()

    mocks.loadConfig.mockResolvedValue({
      planning: { groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }], slotAssignments: {}, setLayouts: {} },
      tactics: [{
        id: 'kept', name: 'Tática mantida',
        ipAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'AF', roleName: 'Advanced Forward' }],
        oopAssignments: [{ playerId: 'slot-st', nodeId: '9', position: 'ST (C)', roleCode: 'PF', roleName: 'Pressing Forward' }],
      }],
      selected_tactic_id: null,
      selected_tactic_id_by_club: { 'club-a': 'deleted' },
    })

    view.rerender(<MemoryRouter><PlanningPage active={false} /></MemoryRouter>)
    view.rerender(<MemoryRouter><PlanningPage active /></MemoryRouter>)

    await waitFor(() => expect(screen.queryByRole('option', { name: 'Tática excluída' })).toBeNull())
    expect(screen.getByRole('option', { name: 'Tática mantida' })).not.toBeNull()
    await waitFor(() => {
      const legends = [...view.container.querySelectorAll<HTMLElement>('.planning-set-legend')]
      expect(legends).toHaveLength(1)
      expect(legends[0].textContent).toContain('ST')
    })
    await waitFor(() => {
      const patches = mocks.schedule.mock.calls.map(call => call[2] as Record<string, unknown>)
      expect(patches.some(patch => (patch.selected_tactic_id_by_club as Record<string, string | null> | undefined)?.['club-a'] === null)).toBe(true)
    })
    expect(mocks.loadPlayers).toHaveBeenCalledTimes(1)
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
  })

  it('uses a three-row compact depth list and keeps extra players behind +N', async () => {
    const secondSnapshot = { ...snapshot, id: 'snapshot-2' }
    const thirdSnapshot = { ...snapshot, id: 'snapshot-3' }
    const fourthSnapshot = { ...snapshot, id: 'snapshot-4' }
    mocks.loadPlayers.mockResolvedValue([
      { id: 'player', current_name: 'Jogador Teste', nationality: 'BRA', player_snapshots: [snapshot] },
      { id: 'player-2', current_name: 'Segundo Jogador', nationality: 'BRA', player_snapshots: [secondSnapshot] },
      { id: 'player-3', current_name: 'Terceiro Jogador', nationality: 'BRA', player_snapshots: [thirdSnapshot] },
      { id: 'player-4', current_name: 'Quarto Jogador', nationality: 'BRA', player_snapshots: [fourthSnapshot] },
    ])
    mocks.loadConfig.mockResolvedValue({
      planning: {
        groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }],
        slotAssignments: { principal: { 'slot-1': ['player', 'player-2', 'player-3', 'player-4'] } },
        setLayouts: {},
      },
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

    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    const firstPlayer = await screen.findAllByText('Jogador Teste')
    const set = firstPlayer.map(node => node.closest('.planning-set-row')).find(Boolean)
    expect(set).not.toBeNull()
    expect(set!.querySelectorAll('.planning-set-player-card').length).toBe(3)
    expect(set!.querySelectorAll('.planning-depth-player-row').length).toBe(3)
    expect(set!.querySelectorAll('.planning-player-silhouette').length).toBe(0)
    expect(set!.querySelector('.planning-set-expand')?.textContent).toBe('+1')
    expect(set!.querySelectorAll('.planning-set-vacancy').length).toBe(0)
    expect(view.container.querySelectorAll('.planning-set-vacancy').length).toBe(0)
  })

  it('shows a Player Peek in pitch rows, exposes a score detail hover, and can hide pitch scores without changing the roster score column', async () => {
    mocks.loadConfig.mockResolvedValue({
      planning: {
        groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }],
        slotAssignments: { principal: { 'slot-1': ['player'] } },
        setLayouts: {},
      },
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

    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    const pitchRow = view.container.querySelector<HTMLElement>('.planning-depth-player-row')
    expect(pitchRow).not.toBeNull()
    expect(pitchRow!.querySelector('[data-testid="player-peek"]')).not.toBeNull()
    expect(pitchRow!.querySelector('.planning-score-peek-trigger')).not.toBeNull()

    fireEvent.mouseEnter(pitchRow!.querySelector('.planning-score-peek-trigger')!)
    expect(await screen.findByText('Notas na tática atual')).not.toBeNull()
    expect(screen.getByText('Nota geral')).not.toBeNull()
    expect(screen.getByText('11')).not.toBeNull()
    expect(screen.getByText('13')).not.toBeNull()

    const notesToggle = screen.getByRole('checkbox', { name: 'Mostrar notas' })
    expect((notesToggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(notesToggle)
    expect(pitchRow!.querySelector('.planning-score-peek-trigger')).toBeNull()
    expect(pitchRow!.classList.contains('is-score-hidden')).toBe(true)
    expect(screen.getByText('Nota')).not.toBeNull()
  })

  it('uses a draggable field/table separator and restores the exact canonical 60/40 split from either side without drift', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    const layout = view.container.querySelector<HTMLElement>('.planning-flex-layout')!
    const separator = screen.getByRole('separator', { name: 'Ajustar largura do campo e da tabela' })
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('60fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('40fr')
    expect(view.container.querySelector('.planning-panel-focus-button')).toBeNull()

    layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    // With a 10 px divider, the field owns 60% of the remaining 990 px.
    // Starting a resize exactly at that divider centre must therefore stay 60/40,
    // instead of creeping upward because the percentage was measured against 990
    // but applied against the full 1000 px grid.
    fireEvent.pointerDown(separator, { pointerId: 7, button: 0, clientX: 599 })
    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 599 })
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('60fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('40fr')

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('62fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('38fr')
    fireEvent.doubleClick(separator)
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('60fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('40fr')

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('56fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('44fr')
    fireEvent.doubleClick(separator)
    fireEvent.doubleClick(separator)
    expect(layout.style.getPropertyValue('--planning-field-fr')).toBe('60fr')
    expect(layout.style.getPropertyValue('--planning-table-fr')).toBe('40fr')
  })

  it('applies a saved free 5x5 visual grid cell without changing the tactic and can restore tactic-derived field positions independently', async () => {
    mocks.loadConfig.mockResolvedValue({
      planning: {
        groups: [{ id: 'principal', name: 'Principal' }, { id: 'loan', name: 'Empréstimo' }, { id: 'sale', name: 'Venda' }],
        slotAssignments: {},
        setLayouts: { tactic: { principal: [
          { id: 'slot-1', label: 'D (C)', slotIds: ['slot-1'], visualGridRow: 2, visualGridColumn: 5 },
          { id: 'slot-2', label: 'M (C)', slotIds: ['slot-2'] },
        ] } },
      },
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

    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    const dcSet = [...view.container.querySelectorAll<HTMLElement>('.planning-set-row')].find(row => row.querySelector('.planning-set-legend')?.textContent?.includes('D'))!
    expect(dcSet.style.getPropertyValue('--planning-x')).toBe('90%')
    expect(dcSet.style.getPropertyValue('--planning-y')).toBe('25%')
    expect(dcSet.dataset.gridRow).toBe('2')
    expect(dcSet.dataset.gridColumn).toBe('5')

    fireEvent.click(screen.getByRole('button', { name: 'Organizar posições' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar posições do campo' }))
    await waitFor(() => expect(dcSet.style.getPropertyValue('--planning-y')).not.toBe('25%'))
    expect(screen.getByText('Organização visual de Principal; arraste os conjuntos livremente pela grade 5×5. A tática não é alterada.')).not.toBeNull()
  })

  it('previews a set move on the 5x5 grid without moving the real set until pointer release', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    const pitch = view.container.querySelector<HTMLElement>('.planning-set-list')!
    pitch.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const movable = [...view.container.querySelectorAll<HTMLElement>('.planning-set-row')].find(row => row.dataset.gridLocked !== 'goalkeeper')!
    const originX = movable.style.getPropertyValue('--planning-x')
    const originY = movable.style.getPropertyValue('--planning-y')
    const originRow = movable.dataset.gridRow
    const originColumn = movable.dataset.gridColumn

    fireEvent.pointerDown(movable, { pointerId: 31, button: 0, clientX: 500, clientY: 450 })
    fireEvent.pointerMove(movable, { pointerId: 31, clientX: 900, clientY: 50 })

    expect(view.container.querySelector('.planning-visual-grid-overlay')).not.toBeNull()
    expect(view.container.querySelectorAll('.planning-visual-grid-cell')).toHaveLength(25)
    expect(view.container.querySelector('.planning-visual-grid-ghost')).not.toBeNull()
    expect(movable.style.getPropertyValue('--planning-x')).toBe(originX)
    expect(movable.style.getPropertyValue('--planning-y')).toBe(originY)
    expect(movable.dataset.gridRow).toBe(originRow)
    expect(movable.dataset.gridColumn).toBe(originColumn)

    fireEvent.pointerUp(movable, { pointerId: 31, clientX: 900, clientY: 50 })
    await waitFor(() => {
      expect(movable.dataset.gridRow).toBe('1')
      expect(movable.dataset.gridColumn).toBe('5')
    })
    expect(view.container.querySelector('.planning-visual-grid-overlay')).toBeNull()
  })

  it('uses the canonical header context menu to remove and restore Planning roster columns', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()

    fireEvent.contextMenu(screen.getByText('Posições').closest('th')!)
    expect(screen.getByText('Remover coluna')).not.toBeNull()
    fireEvent.click(screen.getByText('Remover coluna'))
    expect(screen.queryByText('Posições')).toBeNull()

    fireEvent.contextMenu(screen.getByText('Jogador').closest('th')!)
    fireEvent.click(screen.getByText('Adicionar Posições'))
    expect(screen.getByText('Posições')).not.toBeNull()
  })

  it('uses the single best contextual pair and moves the player to a market group from the context menu', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Duas posições' }))
    await waitFor(() => expect(screen.getByTestId('projection-key').textContent).toBe('IP:M(C):AP|OOP:DM(C):DM'))

    fireEvent.contextMenu(screen.getByText('Jogador Teste').closest('tr')!)
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
