// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlayerStat } from '../types/domain'
import { PlayerPerformanceHistorySection } from './PlayerPerformanceHistorySection'

function stat(overrides: Partial<PlayerStat> = {}): PlayerStat {
  return {
    id: 'stat-1',
    player_id: 'player-1',
    save_id: 'save-1',
    import_id: 'import-1',
    snapshot_date: '2030-06-01',
    season: '2029/30',
    competition: 'LaLiga 2',
    team: 'Numancia',
    minutes: 900,
    appearances: 18,
    starts: 12,
    sub_appearances: 6,
    raw_stats: {},
    normalized_stats: { goals: 4, pass_pct: 87.5 },
    created_at: '2030-06-01T12:00:00Z',
    ...overrides,
  }
}

describe('PlayerPerformanceHistorySection', () => {
  it('renders an explicit season and safe career totals', () => {
    render(<PlayerPerformanceHistorySection stats={[stat()]} />)

    expect(screen.getByRole('heading', { name: 'Temporadas / Performance' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '2029/30' })).toBeTruthy()
    expect(screen.getByText('LaLiga 2 · Numancia')).toBeTruthy()
    expect(screen.getAllByText('900').length).toBeGreaterThan(0)
  })

  it('shows incomplete context without inventing totals', () => {
    render(<PlayerPerformanceHistorySection stats={[stat({ competition: null })]} />)

    expect(screen.getByText(/Totais de carreira indisponíveis/)).toBeTruthy()
    expect(screen.getByText(/Contexto incompleto/)).toBeTruthy()
  })
})
