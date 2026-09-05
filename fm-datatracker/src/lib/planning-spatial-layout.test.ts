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


  it('compresses a five-position structural line evenly inside safe pitch margins', () => {
    const result = planningSpatialLayout([
      { key: 'dl', label: 'D(L)', line: 'd', anchorX: 8 },
      { key: 'dcl', label: 'D(C)', line: 'd', anchorX: 29 },
      { key: 'dc', label: 'D(C)', line: 'd', anchorX: 50 },
      { key: 'dcr', label: 'D(C)', line: 'd', anchorX: 71 },
      { key: 'dr', label: 'D(R)', line: 'd', anchorX: 92 },
    ])
    const xs = result.map(item => item.x)
    expect(xs).toEqual([10, 30, 50, 70, 90])
    expect(xs.slice(1).map((x, index) => x - xs[index])).toEqual([20, 20, 20, 20])
  })

  it('keeps isolated structural flank nodes inside the same safe horizontal band', () => {
    const result = planningSpatialLayout([
      { key: 'aml', label: 'AM(L)', line: 'am', anchorX: 8 },
      { key: 'amr', label: 'AM(R)', line: 'am', anchorX: 92 },
    ])
    expect(result.map(item => item.x)).toEqual([10, 90])
  })

  it('widens a three-position central trio without losing its left-centre-right order', () => {
    const result = planningSpatialLayout([
      { key: 'left', label: 'M(C)', line: 'm', anchorX: 29 },
      { key: 'centre', label: 'M(C)', line: 'm', anchorX: 50 },
      { key: 'right', label: 'M(C)', line: 'm', anchorX: 71 },
    ])
    expect(result.map(item => [item.key, item.x])).toEqual([['left', 26], ['centre', 50], ['right', 74]])
  })

  it('recomputes the same central-labelled set from its current tactic node anchor', () => {
    const left = planningSpatialLayout([{ key: 'dm', label: 'DM(C)', line: 'dm', anchorX: 29 }])
    const centre = planningSpatialLayout([{ key: 'dm', label: 'DM(C)', line: 'm', anchorX: 50 }])
    expect(left[0]).toMatchObject({ x: 30, y: 59 })
    expect(centre[0]).toMatchObject({ x: 50, y: 42 })
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
