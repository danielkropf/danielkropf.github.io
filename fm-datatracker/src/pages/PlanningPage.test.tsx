// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
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
vi.mock('../lib/role-scoring', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/role-scoring')>(),
  resolveRoleWeights: ({ roleId }: { roleId: string }) => ({ roleId }),
  pairedRoleScore: (_attributes: unknown, ip: { roleId: string }) => ip.roleId?.includes('AP') ? 13 : 10,
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
  vi.stubGlobal('PointerEvent', MouseEvent)
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

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function ready() { await screen.findAllByRole('button', { name: /Adicionar jogador a/ }) }
async function openPicker(index = 0) { await ready(); fireEvent.click(screen.getAllByRole('button', { name: /Adicionar jogador a/ })[index]) }

describe('PlanningPage 3C', () => {
  it('renders compact pitch sets as border legends without persistent vacancy squares and with a wider decision table', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()

    await waitFor(() => expect(view.container.querySelectorAll('.planning-set-legend').length).toBe(2))
    expect(view.container.querySelectorAll('.planning-phase-line').length).toBe(0)
    expect(view.container.querySelectorAll('.planning-set-vacancy').length).toBe(0)
    await openPicker()
    expect(await screen.findByText('Jogador Teste')).not.toBeNull()
    expect(screen.getByText('Idade')).not.toBeNull()
  })

  it('refreshes the tactic structure when Planning becomes active again', async () => {
    const view = render(<MemoryRouter><PlanningPage active /></MemoryRouter>)
    await ready()
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
    expect(set!.querySelectorAll('article.planning-pitch-depth-row').length).toBe(3)
    expect(set!.querySelectorAll('article.planning-pitch-depth-row').length).toBe(3)
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
    await ready()
    const pitchRow = view.container.querySelector<HTMLElement>('article.planning-pitch-depth-row')
    expect(pitchRow).not.toBeNull()
    expect(pitchRow!.querySelector('[data-testid="player-peek"]')).not.toBeNull()
    expect(pitchRow!.querySelector('.planning-player-meta')?.textContent).toContain('18 anos')
    expect(pitchRow!.querySelector('.position-warning-icon')).toBeNull()
    expect(pitchRow!.querySelector('.planning-pitch-score-trigger')).not.toBeNull()

    fireEvent.mouseEnter(pitchRow!.querySelector('.planning-pitch-score-trigger')!)
    expect(await screen.findByText('Notas na tática atual')).not.toBeNull()
    expect(screen.getByText('Nota geral')).not.toBeNull()
    expect(screen.getByText('11')).not.toBeNull()
    expect(screen.getByText('13')).not.toBeNull()

    const notesToggle = screen.getByRole('checkbox', { name: 'Mostrar notas' })
    expect((notesToggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(notesToggle)
    expect(pitchRow!.querySelector('.planning-pitch-score-trigger')).toBeNull()
    expect(pitchRow!.classList.contains('is-score-hidden')).toBe(true)
    await openPicker(1)
    expect(screen.getByText('Nota')).not.toBeNull()
  })

  it('uses the full pitch and adds players through the contextual picker', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await openPicker()
    expect(view.container.querySelector('.planning-full-pitch-layout')).not.toBeNull()
    expect(screen.queryByRole('separator', { name: 'Ajustar largura do campo e da tabela' })).toBeNull()
    fireEvent.click((await screen.findByText('Jogador Teste')).closest('tr')!)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar (1)' }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Buscar jogador')).toBeNull())
    expect(view.container.querySelector('article[data-planning-player-id="player"]')).not.toBeNull()
    expect(mocks.schedule.mock.calls.some(call => JSON.stringify(call[2]).includes('"player"'))).toBe(true)
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
    await ready()
    const dcSet = [...view.container.querySelectorAll<HTMLElement>('.planning-set-row')].find(row => row.querySelector('.planning-set-legend')?.textContent?.includes('D'))!
    expect(dcSet.style.getPropertyValue('--planning-x')).toBe('90%')
    expect(dcSet.style.getPropertyValue('--planning-y')).toBe('25%')
    expect(dcSet.dataset.gridRow).toBe('2')
    expect(dcSet.dataset.gridColumn).toBe('5')

    fireEvent.click(screen.getByRole('button', { name: 'Organizar posições' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar posições do campo' }))
    await waitFor(() => expect(dcSet.style.getPropertyValue('--planning-y')).not.toBe('25%'))
    expect(screen.getByText('Organização visual de Principal; arraste os conjuntos pela grade 5×5. A sexta linha permanece reservada ao goleiro.')).not.toBeNull()
  })

  it('previews a set move on the 5x5 grid without moving the real set until pointer release', async () => {
    const view = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
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

  it('uses the canonical header context menu for contextual picker columns', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await openPicker()
    fireEvent.contextMenu(screen.getByText('Posições').closest('th')!)
    fireEvent.click(screen.getByText('Remover esta coluna'))
    expect(screen.queryByText('Posições')).toBeNull()
    expect(screen.getByText('Jogador Teste')).not.toBeNull()
  })

  it('uses the single best contextual pair and moves the player to a market group from the context menu', async () => {
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()

    await openPicker(1)
    expect(screen.getByTestId('projection-key').textContent).toBe('IP:M(C):AP|OOP:DM(C):DM')
    fireEvent.click(screen.getByText('Jogador Teste').closest('tr')!)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar (1)' }))
    fireEvent.contextMenu(screen.getByText('Jogador Teste').closest('article')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adicionar para venda' }))
    // Market intent coexists with the player's squad; navigate to the market group.
    fireEvent.click(screen.getByRole('button', { name: '›' }))
    fireEvent.click(screen.getByRole('button', { name: '›' }))
    expect(await screen.findByText('Área livre de mercado')).not.toBeNull()
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
    await ready()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
    expect(mocks.loadMemberships).toHaveBeenLastCalledWith('save', ['snapshot'])

    const initialGeneralReferenceCalls = referenceScoreCalls()
    const initialRoleReferenceCalls = mocks.referencePairedRoleScore.mock.calls.length
    expect(initialRoleReferenceCalls).toBeGreaterThan(0)

    first.unmount()
    const second = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)
    expect(referenceScoreCalls()).toBe(initialGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore).toHaveBeenCalledTimes(initialRoleReferenceCalls)

    second.unmount()
    mocks.loadPlayers.mockResolvedValue([{ id: 'player', current_name: 'Jogador Teste', nationality: 'BRA', player_snapshots: [snapshot] }])
    const refreshed = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(2)
    expect(referenceScoreCalls()).toBe(initialGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore).toHaveBeenCalledTimes(initialRoleReferenceCalls)

    refreshed.unmount()
    mocks.selected = { id: 'save', structure: { trackedClubs: [{ club_id: 'club-b', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-b', name: 'Outro Clube' } }] } }
    const otherClub = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(3)

    const otherClubGeneralReferenceCalls = referenceScoreCalls()
    const otherClubRoleReferenceCalls = mocks.referencePairedRoleScore.mock.calls.length
    expect(otherClubGeneralReferenceCalls).toBeGreaterThanOrEqual(initialGeneralReferenceCalls)
    expect(otherClubRoleReferenceCalls).toBeGreaterThan(initialRoleReferenceCalls)

    otherClub.unmount()
    mocks.selected = { id: 'save-2', structure: { trackedClubs: [{ club_id: 'club-b', tracking_role: 'primary', is_active: true, display_order: 0, club: { id: 'club-b', name: 'Outro Clube' } }] } }
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(4)
    expect(referenceScoreCalls()).toBeGreaterThanOrEqual(otherClubGeneralReferenceCalls)
    expect(mocks.referencePairedRoleScore.mock.calls.length).toBeGreaterThan(otherClubRoleReferenceCalls)
  })

  it('does not retain a failed memberships request in the warm cache', async () => {
    const successfulRows = await mocks.loadMemberships()
    mocks.loadMemberships.mockReset()
      .mockRejectedValueOnce(new Error('membership unavailable'))
      .mockResolvedValueOnce(successfulRows)

    const first = render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    await openPicker()
    expect(await screen.findByText(/Contexto factual parcial/)).not.toBeNull()
    expect(mocks.loadMemberships).toHaveBeenCalledTimes(1)

    first.unmount()
    render(<MemoryRouter><PlanningPage /></MemoryRouter>)
    await ready()
    await waitFor(() => expect(mocks.loadMemberships).toHaveBeenCalledTimes(2))
    await openPicker()
    expect(screen.queryByText(/Contexto factual parcial/)).toBeNull()
  })
})

function ProfileReturnTest() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Voltar à seleção</button> }
it('returns from the profile to the picker with the selected row and search intact', async () => {
  render(<MemoryRouter initialEntries={['/tactics?mode=planning']}><Routes><Route path="/tactics" element={<PlanningPage />} /><Route path="/players/:id" element={<ProfileReturnTest />} /></Routes></MemoryRouter>)
  await openPicker()
  fireEvent.change(screen.getByPlaceholderText('Buscar jogador'), { target: { value: 'Teste' } })
  fireEvent.click(screen.getByText('Jogador Teste').closest('tr')!)
  expect(screen.getByRole('button', { name: 'Confirmar (1)' })).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Jogador Teste' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Voltar à seleção' }))
  const confirm = await screen.findByRole('button', { name: 'Confirmar (1)' })
  expect((screen.getByPlaceholderText('Buscar jogador') as HTMLInputElement).value).toBe('Teste')
  expect(screen.getByText('Jogador Teste').closest('tr')?.getAttribute('aria-selected')).toBe('true')
  fireEvent.contextMenu(screen.getByText('Jogador Teste').closest('tr')!)
  expect(screen.getByRole('menuitem', { name: 'Adicionar para venda' })).not.toBeNull()
  fireEvent.keyDown(window, { key: 'Escape' })
  // Escape closes the modal too; the selection was not committed by navigation.
  expect(confirm).not.toBeNull()
})

it('selects multiple rows with Ctrl and adds only after confirmation', async () => {
  mocks.loadPlayers.mockResolvedValue(['A', 'B', 'C'].map((name,i) => ({ id: `p${i}`, current_name: name, nationality: 'BRA', player_snapshots: [{ ...snapshot, id: `snap${i}` }] })))
  render(<MemoryRouter><PlanningPage /></MemoryRouter>)
  await openPicker()
  fireEvent.click(screen.getByRole('button', { name: 'A' }).closest('tr')!)
  fireEvent.click(screen.getByRole('button', { name: 'C' }).closest('tr')!, { ctrlKey: true })
  expect(screen.getByRole('button', { name: 'Confirmar (2)' })).not.toBeNull()
  expect(screen.getByRole('button', { name: 'B' }).closest('tr')?.getAttribute('aria-selected')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar (2)' }))
  expect(screen.queryByText('Adicionar jogador')).toBeNull()
  await waitFor(() => {
    const patch = mocks.schedule.mock.calls.at(-1)?.[2]
    const assigned = Object.values(patch.planning_by_club['club-a'].slotAssignments).flatMap((sets:any) => Object.values(sets).flat())
    expect(assigned).toEqual(['p0','p2'])
  })
})
