import { describe, expect, it } from 'vitest'
import type { PlayerStat } from '../types/domain'
import { buildPlayerPerformanceHistory } from './player-performance-history'

function stat(overrides: Partial<PlayerStat> & Pick<PlayerStat, 'id' | 'snapshot_date'>): PlayerStat {
  return {
    player_id: 'player-1',
    save_id: 'save-1',
    import_id: 'import-1',
    season: '2029/30',
    competition: 'Liga',
    team: 'Numancia',
    minutes: 100,
    appearances: 2,
    starts: 1,
    sub_appearances: 1,
    raw_stats: {},
    normalized_stats: {},
    ...overrides,
    id: overrides.id,
    snapshot_date: overrides.snapshot_date,
    created_at: overrides.created_at ?? `${overrides.snapshot_date}T12:00:00Z`,
  }
}

describe('player performance history', () => {
  it('keeps only the latest cumulative observation for an identical complete context', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'old', snapshot_date: '2030-01-01', minutes: 500, appearances: 10 }),
      stat({ id: 'new', snapshot_date: '2030-06-01', minutes: 900, appearances: 18 }),
    ])

    expect(history.seasons).toHaveLength(1)
    expect(history.seasons[0].contexts).toHaveLength(1)
    expect(history.seasons[0].contexts[0].stat.id).toBe('new')
    expect(history.seasons[0].contexts[0].superseded.map(item => item.id)).toEqual(['old'])
    expect(history.seasons[0].totals?.minutes).toBe(900)
    expect(history.careerTotals?.appearances).toBe(18)
    expect(history.supersededCount).toBe(1)
  })

  it('adds distinct complete competition/team contexts inside a season', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'league', snapshot_date: '2030-06-01', competition: 'Liga', minutes: 900, appearances: 18, starts: 12, sub_appearances: 6 }),
      stat({ id: 'cup', snapshot_date: '2030-05-15', competition: 'Copa', minutes: 180, appearances: 3, starts: 2, sub_appearances: 1 }),
    ])

    expect(history.seasons[0].totals).toEqual({ minutes: 1080, appearances: 21, starts: 14, subAppearances: 7 })
    expect(history.careerTotals).toEqual({ minutes: 1080, appearances: 21, starts: 14, subAppearances: 7 })
  })

  it('fails closed for season and career totals when a context is incomplete', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'complete', snapshot_date: '2030-06-01' }),
      stat({ id: 'partial', snapshot_date: '2030-05-01', competition: null }),
    ])

    expect(history.partialContextCount).toBe(1)
    expect(history.seasons[0].totals).toBeNull()
    expect(history.seasons[0].totalsDiagnostic).toContain('season + competition + team')
    expect(history.careerTotals).toBeNull()
    expect(history.careerTotalsDiagnostic).toContain('season + competition + team')
  })

  it('keeps an additive metric unavailable when any selected context is missing it', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'league', snapshot_date: '2030-06-01', competition: 'Liga', minutes: 900 }),
      stat({ id: 'cup', snapshot_date: '2030-05-01', competition: 'Copa', minutes: null, appearances: 3, starts: 2, sub_appearances: 1 }),
    ])

    expect(history.seasons[0].totals?.minutes).toBeNull()
    expect(history.seasons[0].totals?.appearances).toBe(5)
  })

  it('keeps seasons separate and orders them by latest observed checkpoint', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'older-season', snapshot_date: '2030-06-01', season: '2029/30' }),
      stat({ id: 'newer-season', snapshot_date: '2031-02-01', season: '2030/31' }),
    ])

    expect(history.seasons.map(item => item.label)).toEqual(['2030/31', '2029/30'])
    expect(history.careerTotals?.minutes).toBe(200)
  })

  it('does not aggregate normalized rates, percentages or ratings', () => {
    const history = buildPlayerPerformanceHistory([
      stat({ id: 'league', snapshot_date: '2030-06-01', competition: 'Liga', normalized_stats: { xg_per_90: 0.4, pass_pct: 88 } }),
      stat({ id: 'cup', snapshot_date: '2030-05-01', competition: 'Copa', normalized_stats: { xg_per_90: 0.7, pass_pct: 91 } }),
    ])

    expect(history.careerTotals).toEqual({ minutes: 200, appearances: 4, starts: 2, subAppearances: 2 })
    expect('xg_per_90' in (history.careerTotals as unknown as Record<string, unknown>)).toBe(false)
  })
})
