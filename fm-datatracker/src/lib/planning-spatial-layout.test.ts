import { describe, expect, it } from 'vitest'
import { planningPitchSide, planningSpatialLayout, type PlanningSpatialItem } from './planning-spatial-layout'

function line(labels: string[]): PlanningSpatialItem[] {
  return labels.map((label, index) => ({ key: `${label}-${index}`, label, line: 'd' }))
}

describe('planningSpatialLayout', () => {
  it('centers three centre-backs when there are no full-backs', () => {
    const result = planningSpatialLayout(line(['D(C)1', 'D(C)2', 'D(C)3']))
    expect(result.map(item => item.x)).toEqual([32, 50, 68])
  })

  it('keeps an isolated left-back wide and shifts three centre-backs without inventing a right-back', () => {
    const result = planningSpatialLayout(line(['D(L)', 'D(C)1', 'D(C)2', 'D(C)3']))
    const leftBack = result.find(item => item.label === 'D(L)')!
    const centreBacks = result.filter(item => item.side === 'center')
    expect(leftBack.x).toBe(10)
    expect(centreBacks.map(item => item.x)).toEqual([38, 57, 76])
    expect(Math.max(...centreBacks.map(item => item.x))).toBeLessThan(82)
  })

  it('mirrors the same rule when only the right-back exists', () => {
    const result = planningSpatialLayout(line(['D(C)1', 'D(C)2', 'D(C)3', 'D(R)']))
    const centreBacks = result.filter(item => item.side === 'center')
    const rightBack = result.find(item => item.label === 'D(R)')!
    expect(centreBacks.map(item => item.x)).toEqual([24, 43, 62])
    expect(rightBack.x).toBe(90)
  })

  it('reserves both flanks when both lateral positions exist', () => {
    const result = planningSpatialLayout(line(['D(L)', 'D(C)1', 'D(C)2', 'D(R)']))
    expect(result.find(item => item.label === 'D(L)')?.x).toBe(10)
    expect(result.filter(item => item.side === 'center').map(item => item.x)).toEqual([31, 69])
    expect(result.find(item => item.label === 'D(R)')?.x).toBe(90)
  })

  it('keeps the goalkeeper centred', () => {
    const result = planningSpatialLayout([{ key: 'gk', label: 'GK', line: 'gk' }])
    expect(result[0]).toMatchObject({ x: 50, y: 92, side: 'center' })
  })
})

describe('planningPitchSide', () => {
  it('classifies canonical FM position labels', () => {
    expect(planningPitchSide('AM(L)')).toBe('left')
    expect(planningPitchSide('WB(R)')).toBe('right')
    expect(planningPitchSide('D(C)2')).toBe('center')
    expect(planningPitchSide('GK')).toBe('center')
  })
})
