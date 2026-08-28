// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerPage } from './PlayerPage'

const mocks = vi.hoisted(() => ({
  selected: { id: 'save-a', name: 'Save A' } as { id: string; name: string } | null,
  queries: [] as Array<{
    filters: Array<[string, unknown]>
    result: Promise<{ data: unknown; error: { message: string } | null }>
  }>,
}))

vi.mock('../features/saves/SaveContext', () => ({ useSaves: () => ({ selected: mocks.selected }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
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

afterEach(() => {
  cleanup()
  mocks.queries.length = 0
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function player(id: string, name: string) {
  return {
    id,
    fm_player_id: null,
    current_name: name,
    nationality: null,
    date_of_birth: null,
    first_seen_date: '2026-01-01',
    last_seen_date: '2026-01-01',
    is_active: true,
    player_snapshots: [],
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
})
