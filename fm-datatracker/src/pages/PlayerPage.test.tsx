// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerPage } from './PlayerPage'

const mocks = vi.hoisted(() => ({
  selected: { id: 'save-a', name: 'Save A' } as { id: string; name: string } | null,
  currentCheckpoint: undefined as { saveId: string; status: 'ready'; date: string } | undefined,
  queries: [] as Array<{
    filters: Array<[string, unknown]>
    result: Promise<{ data: unknown; error: { message: string } | null }>
  }>,
  loadEvolutionContext: vi.fn(),
  loadCurrentPlayers: vi.fn(),
  loadReferenceDataset: vi.fn(),
}))

vi.mock('../features/saves/SaveContext', () => ({ useSaves: () => ({ selected: mocks.selected, currentCheckpoint: mocks.currentCheckpoint }) }))
vi.mock('../lib/longitudinal-service', () => ({
  loadPlayerEvolutionContext: (...args: unknown[]) => mocks.loadEvolutionContext(...args),
}))
vi.mock('../lib/dataCache', () => ({
  loadCurrentPlayers: (...args: unknown[]) => mocks.loadCurrentPlayers(...args),
  loadReferenceDataset: (...args: unknown[]) => mocks.loadReferenceDataset(...args),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'player_stats') {
        const result = Promise.resolve({ data: [], error: null })
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          then: result.then.bind(result),
        }
        return builder
      }

      const query = mocks.queries.shift()
      if (!query) throw new Error('query mock ausente')
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder },
        maybeSingle: () => query.result,
      }
      return builder
    }),
  },
}))

beforeEach(() => {
  mocks.currentCheckpoint = undefined
  mocks.loadEvolutionContext.mockReset()
  mocks.loadEvolutionContext.mockResolvedValue({ memberships: [], seasons: [], diagnostic: null })
  mocks.loadCurrentPlayers.mockReset().mockResolvedValue([])
  mocks.loadReferenceDataset.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  mocks.queries.length = 0
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function player(id: string, name: string, snapshots: unknown[] = []) {
  return {
    id,
    fm_player_id: null,
    current_name: name,
    nationality: null,
    date_of_birth: null,
    first_seen_date: '2026-01-01',
    last_seen_date: '2026-01-01',
    is_active: true,
    player_snapshots: snapshots,
  }
}
function snapshot(id: string, date: string) {
  return {
    id,
    snapshot_date: date,
    age: 20,
    club: 'Numancia',
    squad: 'First Team',
    positions: ['M (C)'],
    preferred_foot: null,
    height: null,
    weight: null,
    contract_expiry: null,
    raw_data: {},
    normalized_data: {},
    player_attributes: [],
  }
}
function view() {
  return <MemoryRouter initialEntries={['/players/player-1']}><Routes><Route path="/players/:id" element={<PlayerPage />} /></Routes></MemoryRouter>
}

describe('PlayerPage save isolation', () => {
  it('filtra por player + save e ignora uma resposta antiga depois de A→B', async () => {
    const a = deferred<{ data: unknown; error: null }>()
    const b = deferred<{ data: unknown; error: null }>()
    const filtersA: Array<[string, unknown]> = []
    const filtersB: Array<[string, unknown]> = []
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.queries.push({ filters: filtersA, result: a.promise })
    const rendered = render(view())

    mocks.selected = { id: 'save-b', name: 'B' }
    mocks.queries.push({ filters: filtersB, result: b.promise })
    rendered.rerender(view())

    b.resolve({ data: player('player-1', 'Jogador B'), error: null })
    expect(await screen.findByRole('heading', { name: 'Jogador B' })).not.toBeNull()
    a.resolve({ data: player('player-1', 'Jogador A'), error: null })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Jogador A' })).toBeNull())

    expect(filtersA).toEqual(expect.arrayContaining([['id', 'player-1'], ['save_id', 'save-a']]))
    expect(filtersB).toEqual(expect.arrayContaining([['id', 'player-1'], ['save_id', 'save-b']]))
    expect(mocks.loadEvolutionContext).toHaveBeenCalledWith('save-a', 'player-1')
    expect(mocks.loadEvolutionContext).toHaveBeenCalledWith('save-b', 'player-1')
  })

  it('mostra not-found em vez de loading infinito', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: null, error: null }) })
    render(view())
    expect(await screen.findByText('Jogador não encontrado neste save.')).not.toBeNull()
  })

  it('mostra erro de consulta em vez de loading infinito', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: null, error: { message: 'permission denied' } }) })
    render(view())
    expect(await screen.findByText(/permission denied/)).not.toBeNull()
  })

  it('integra a área Evolução sem fabricar delta com um único snapshot', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: player('player-1', 'Jogador A', [snapshot('s1', '2029-07-01')]), error: null }) })
    render(view())
    expect(await screen.findByRole('heading', { name: 'Evolução' })).not.toBeNull()
    expect(screen.getByText('Baseline único')).not.toBeNull()
    expect(screen.getByText(/não fabrica tendência ou delta/i)).not.toBeNull()
  })

  it('expõe comparação entre quaisquer checkpoints quando há histórico', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: player('player-1', 'Jogador A', [snapshot('s1', '2029-07-01'), snapshot('s2', '2030-07-01')]), error: null }) })
    render(view())
    expect(await screen.findByRole('heading', { name: 'Comparar checkpoints' })).not.toBeNull()
    expect(screen.getByLabelText('Checkpoint inicial')).not.toBeNull()
    expect(screen.getByLabelText('Checkpoint final')).not.toBeNull()
  })

  it('mantém a ficha utilizável quando o contexto longitudinal falha', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.loadEvolutionContext.mockResolvedValue({ memberships: [], seasons: [], diagnostic: 'membership unavailable' })
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: player('player-1', 'Jogador A', [snapshot('s1', '2029-07-01')]), error: null }) })
    render(view())
    expect(await screen.findByText(/Contexto normalizado indisponível: membership unavailable/)).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Jogador A' })).not.toBeNull()
  })

  it('mostra empréstimo factual confirmado sem inventar proprietário quando o owner está desconhecido', async () => {
    mocks.selected = { id: 'save-a', name: 'A' }
    mocks.currentCheckpoint = { saveId: 'save-a', status: 'ready', date: '2029-07-01' }
    const currentSnapshot = { ...snapshot('s1', '2029-07-01'), source_snapshot_ids: ['s1'] }
    mocks.loadCurrentPlayers.mockResolvedValue([player('player-1', 'Alisson', [currentSnapshot])])
    mocks.loadEvolutionContext.mockResolvedValue({
      seasons: [], diagnostic: null, memberships: [{
        id: 'membership-1', save_id: 'save-a', owner_id: 'owner', player_id: 'player-1', observed_date: '2029-07-01', season_id: null,
        current_club_id: 'club-flu', owner_club_id: null, team_level: 'first_team', squad_name: 'Principal', is_loan: true,
        loan_from_club_id: null, loan_to_club_id: 'club-flu', source_snapshot_id: 's1', source_import_id: 'import-1', source_kind: 'fm', created_at: '',
        currentClub: { id: 'club-flu', name: 'FLU' }, ownerClub: null, loanFromClub: null, loanToClub: { id: 'club-flu', name: 'FLU' },
        provenance: {
          membership_authority: 'membership_facts_v1', membership_facts_sync_version: 'e-mc-01b-v1',
          factual_fields: {
            current_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['current'] },
            owner_organization: { status: 'unknown', evidence_refs: ['owner'] },
            team_level: { status: 'confirmed', evidence_refs: ['level'] },
            structural_squad: { status: 'confirmed', evidence_refs: ['squad'] },
            is_loan: { status: 'confirmed', evidence_refs: ['loan'] },
            loan_from_organization: { status: 'unknown', evidence_refs: ['from'] },
            loan_to_organization: { status: 'confirmed', binding_status: 'confirmed', evidence_refs: ['to'] },
          },
        },
      }],
    })
    mocks.queries.push({ filters: [], result: Promise.resolve({ data: player('player-1', 'Alisson', [currentSnapshot]), error: null }) })

    render(view())
    expect(await screen.findByRole('heading', { name: 'Situação no checkpoint atual' })).not.toBeNull()
    expect(screen.getAllByText('Empréstimo confirmado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FLU').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Não resolvido').length).toBeGreaterThan(0)
    expect(screen.queryByText(/São Paulo/i)).toBeNull()
  })
})
