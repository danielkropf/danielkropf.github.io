import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { attributeDelta, buildPlayerEvolution, generalScoreDelta, observedContextChanges, rankAttributeChanges, sortEvolutionSnapshots, type EvolutionSnapshot } from './player-evolution'

function snapshot(id: string, date: string, value: number, overrides: Partial<EvolutionSnapshot> = {}): EvolutionSnapshot {
  return {
    id,
    snapshot_date: date,
    age: 20,
    club: 'Numancia',
    squad: 'First Team',
    positions: ['M (C)'],
    normalized_data: {},
    raw_data: {},
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value })),
    ...overrides,
  }
}

describe('player evolution', () => {
  it('ordena snapshots por data e preserva ordem da fonte quando a data é igual', () => {
    const ordered = sortEvolutionSnapshots([snapshot('b', '2030-07-01', 10), snapshot('a', '2029-07-01', 10), snapshot('c', '2030-07-01', 10)])
    expect(ordered.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('recalcula GeneralScore canônico em cada checkpoint', () => {
    const evolution = buildPlayerEvolution([snapshot('a', '2029-07-01', 10), snapshot('b', '2030-07-01', 12)])
    expect(evolution.checkpoints).toHaveLength(2)
    expect(evolution.checkpoints[0].generalScore).not.toBeNull()
    expect((evolution.checkpoints[1].generalScore ?? 0) > (evolution.checkpoints[0].generalScore ?? 0)).toBe(true)
    expect(evolution.periodGeneralScoreDelta?.delta).toBeGreaterThan(0)
  })

  it('calcula deltas positivos, negativos e zero sem alterar a observação', () => {
    const key = ATTRIBUTE_CATALOG[0].key
    const from = snapshot('a', '2029-07-01', 10)
    const to = snapshot('b', '2030-07-01', 10)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 13
    expect(attributeDelta(from, to, key)?.delta).toBe(3)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 7
    expect(attributeDelta(from, to, key)?.delta).toBe(-3)
    to.player_attributes.find(attribute => attribute.attribute_key === key)!.value = 10
    expect(attributeDelta(from, to, key)?.delta).toBe(0)
  })

  it('não transforma atributo ausente em zero', () => {
    const key = ATTRIBUTE_CATALOG[0].key
    const from = snapshot('a', '2029-07-01', 10)
    const to = snapshot('b', '2030-07-01', 12, { player_attributes: [] })
    expect(attributeDelta(from, to, key)).toBeNull()
    expect(rankAttributeChanges(from, to)).toEqual([])
  })

  it('ordena ganhos/perdas deterministicamente por magnitude, delta e chave', () => {
    const first = snapshot('a', '2029-07-01', 10)
    const last = snapshot('b', '2030-07-01', 10)
    const [a, b, c] = ATTRIBUTE_CATALOG.slice(0, 3).map(attribute => attribute.key)
    last.player_attributes.find(item => item.attribute_key === a)!.value = 12
    last.player_attributes.find(item => item.attribute_key === b)!.value = 8
    last.player_attributes.find(item => item.attribute_key === c)!.value = 12
    const ranked = rankAttributeChanges(first, last).filter(item => item.delta !== 0)
    expect(ranked.map(item => item.attributeKey)).toEqual([a, c].sort().concat(b))
  })

  it('um único snapshot não fabrica delta de período', () => {
    const only = snapshot('a', '2029-07-01', 10)
    expect(buildPlayerEvolution([only]).periodGeneralScoreDelta).toBeNull()
    expect(generalScoreDelta(only, only)?.delta).toBe(0)
  })

  it('registra contexto apenas quando há dois valores conhecidos e diferentes', () => {
    const changes = observedContextChanges([
      snapshot('a', '2029-07-01', 10, { club: 'Numancia', squad: 'B' }),
      snapshot('b', '2030-01-01', 10, { club: null, squad: 'B' }),
      snapshot('c', '2030-07-01', 10, { club: 'Numancia', squad: 'First Team' }),
      snapshot('d', '2031-07-01', 10, { club: 'Burgos', squad: 'First Team' }),
    ])
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ fromSnapshotId: 'b', toSnapshotId: 'c', squad: { from: 'B', to: 'First Team' }, club: null })
    expect(changes[1]).toMatchObject({ fromSnapshotId: 'c', toSnapshotId: 'd', club: { from: 'Numancia', to: 'Burgos' }, squad: null })
  })
})
