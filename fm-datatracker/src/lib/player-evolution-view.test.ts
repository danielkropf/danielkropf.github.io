import { describe, expect, it } from 'vitest'
import type { EvolutionCheckpoint, EvolutionSnapshot } from './player-evolution'
import { evolutionRange, generalScoreSegments, paginateEvolution } from './player-evolution-view'

function snapshot(id: string, date: string): EvolutionSnapshot {
  return {
    id,
    snapshot_date: date,
    positions: [],
    normalized_data: {},
    raw_data: {},
    player_attributes: [],
  }
}

function checkpoint(id: string, date: string, score: number | null, age: number | null = 20): EvolutionCheckpoint {
  return {
    snapshotId: id,
    snapshotDate: date,
    age,
    club: null,
    squad: null,
    generalScore: score,
    generalPosition: null,
    scoreKey: null,
    basePositionScores: [],
    normalizedContext: null,
    contextDiagnostic: null,
  }
}

describe('player evolution view', () => {
  it('normaliza seleção invertida para o mesmo intervalo cronológico inclusivo', () => {
    const snapshots = [snapshot('a', '2029-01-01'), snapshot('b', '2030-01-01'), snapshot('c', '2031-01-01')]
    const forward = evolutionRange(snapshots, 'a', 'c')
    const reverse = evolutionRange(snapshots, 'c', 'a')
    expect(forward.snapshots.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(reverse.snapshots.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(reverse.normalizedFromId).toBe('a')
    expect(reverse.normalizedToId).toBe('c')
  })

  it('preserva checkpoints distintos com a mesma data', () => {
    const snapshots = [snapshot('a', '2030-01-01'), snapshot('b', '2030-01-01'), snapshot('c', '2031-01-01')]
    expect(evolutionRange(snapshots, 'a', 'b').snapshots.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('usa todo o histórico como fallback quando ids do filtro não existem', () => {
    const snapshots = [snapshot('a', '2029-01-01'), snapshot('b', '2030-01-01')]
    expect(evolutionRange(snapshots, 'missing-a', 'missing-b').snapshots.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('quebra a linha do gráfico quando GeneralScore está ausente', () => {
    const segments = generalScoreSegments([
      checkpoint('a', '2029-01-01', 10),
      checkpoint('b', '2030-01-01', 11),
      checkpoint('c', '2031-01-01', null),
      checkpoint('d', '2032-01-01', 13),
      checkpoint('e', '2033-01-01', 14),
    ])
    expect(segments.map(segment => segment.map(point => point.snapshotId))).toEqual([['a', 'b'], ['d', 'e']])
    expect(segments.flat().map(point => point.generalScore)).toEqual([10, 11, 13, 14])
  })

  it('mantém ponto isolado sem fabricar ligação', () => {
    const segments = generalScoreSegments([
      checkpoint('a', '2029-01-01', null),
      checkpoint('b', '2030-01-01', 12, 21),
      checkpoint('c', '2031-01-01', null),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual([{ snapshotId: 'b', snapshotDate: '2030-01-01', age: 21, generalScore: 12, checkpointIndex: 1 }])
  })

  it('pagina detalhes sem omitir nem duplicar itens entre páginas', () => {
    const items = Array.from({ length: 29 }, (_, index) => index + 1)
    const first = paginateEvolution(items, 1, 12)
    const second = paginateEvolution(items, 2, 12)
    const third = paginateEvolution(items, 3, 12)
    expect(first.items).toHaveLength(12)
    expect(second.items).toHaveLength(12)
    expect(third.items).toHaveLength(5)
    expect([...first.items, ...second.items, ...third.items]).toEqual(items)
    expect(third).toMatchObject({ page: 3, pageCount: 3, start: 25, end: 29, total: 29 })
  })

  it('clampa página inválida depois de um recorte menor', () => {
    const page = paginateEvolution(['a', 'b'], 8, 12)
    expect(page).toMatchObject({ page: 1, pageCount: 1, start: 1, end: 2 })
  })
})
