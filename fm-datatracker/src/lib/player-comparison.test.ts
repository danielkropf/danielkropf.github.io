import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { canonicalRoleDefaultWeights } from './role-scoring'
import { comparisonAttributeRows, resolveComparisonScore, type ComparisonMetric, type ComparisonSnapshot } from './player-comparison'

function snapshot(position = 'M (C)', value = 10): ComparisonSnapshot {
  return {
    positions: [position],
    normalized_data: {},
    raw_data: {},
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value })),
  }
}

describe('player comparison', () => {
  it('calcula BasePositionScore específico com a mesma matriz para os dois jogadores', () => {
    const left = snapshot('M (C)', 12)
    const right = snapshot('M (C)', 10)
    const metric: ComparisonMetric = { kind: 'base', position: 'M (C)' }
    const a = resolveComparisonScore(left, metric)
    const b = resolveComparisonScore(right, metric)
    expect(a?.score).not.toBeNull()
    expect(b?.score).not.toBeNull()
    expect((a?.score ?? 0) > (b?.score ?? 0)).toBe(true)
    expect(a?.weights).toEqual(b?.weights)
  })

  it('RoleScore continua calculável fora da posição e familiaridade fica separada', () => {
    const player = snapshot('ST (C)', 11)
    const metric: ComparisonMetric = { kind: 'role', phase: 'IP', position: 'M (C)', roleCode: 'CM' }
    const result = resolveComparisonScore(player, metric)
    expect(result?.score).not.toBeNull()
    expect(result?.familiarity).toEqual([{ position: 'M (C)', familiar: false }])
  })

  it('ordena diferenças usando apenas atributos efetivamente usados pela matriz', () => {
    const left = snapshot('M (C)', 10)
    const right = snapshot('M (C)', 10)
    const weights = canonicalRoleDefaultWeights('IP-CM-CM', 'Central Midfielder')
    const important = ATTRIBUTE_CATALOG.find(attribute => (weights[attribute.key] ?? 1) > 1)
    expect(important).toBeTruthy()
    const leftAttribute = left.player_attributes.find(attribute => attribute.attribute_key === important!.key)!
    leftAttribute.value = 15
    const rows = comparisonAttributeRows(left, right, { kind: 'role', phase: 'IP', position: 'M (C)', roleCode: 'CM' })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.find(row => row.key === important!.key)?.delta).toBe(5)
    expect(rows.every(row => (row.ipWeight ?? 1) > 1)).toBe(true)
  })

  it('Nota Geral não fabrica uma matriz compartilhada para explicar jogadores com bases diferentes', () => {
    const rows = comparisonAttributeRows(snapshot('M (C)'), snapshot('ST (C)'), { kind: 'general' })
    expect(rows).toEqual([])
  })
})
