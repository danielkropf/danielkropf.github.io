import { describe, expect, it } from 'vitest'
import { resolvePlanningSetExpansion, type PlanningSetRect } from './planning-set-expansion'

const base = { pitchWidth: 800, pitchHeight: 700, playerCount: 6, cardWidth: 170, cardHeight: 30, gap: 3, verticalItemsPerRow: 1 }
const compact: PlanningSetRect = { left: 300, top: 280, width: 184, height: 122 }

describe('resolvePlanningSetExpansion', () => {
  it('always expands vertically and prefers the space above the compact set', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact, obstacles: [] })
    expect(result.axis).toBe('vertical')
    expect(result.direction).toBe('up')
    expect(result.width).toBe(compact.width)
    expect(result.top).toBeLessThan(compact.top)
    expect(result.height).toBeGreaterThan(compact.height)
  })

  it('uses downward space after the available upward space is exhausted', () => {
    const result = resolvePlanningSetExpansion({
      ...base,
      compact,
      playerCount: 10,
      obstacles: [{ left: 292, top: 214, width: 200, height: 54 }],
      obstacleGutter: 8,
    })
    const upGrowth = compact.top - result.top
    const downGrowth = result.top + result.height - (compact.top + compact.height)
    expect(result.axis).toBe('vertical')
    expect(upGrowth).toBeGreaterThanOrEqual(0)
    expect(downGrowth).toBeGreaterThan(0)
  })

  it('grows only downward when no usable space exists above', () => {
    const result = resolvePlanningSetExpansion({
      ...base,
      compact,
      obstacles: [{ left: 292, top: 140, width: 200, height: 132 }],
    })
    expect(result.axis).toBe('vertical')
    expect(result.direction).toBe('down')
    expect(result.top).toBe(compact.top)
    expect(result.height).toBeGreaterThan(compact.height)
  })

  it('never crosses the useful pitch bounds', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact: { left: 2, top: 10, width: 184, height: 122 }, obstacles: [], playerCount: 30 })
    expect(result.left).toBeGreaterThanOrEqual(10)
    expect(result.top).toBeGreaterThanOrEqual(10)
    expect(result.left + result.width).toBeLessThanOrEqual(base.pitchWidth - 10)
    expect(result.top + result.height).toBeLessThanOrEqual(base.pitchHeight - 10)
  })

  it('keeps the fixed grid width even when vertical space cannot expose every row', () => {
    const result = resolvePlanningSetExpansion({
      ...base,
      compact: { left: 300, top: 280, width: 184, height: 122 },
      obstacles: [
        { left: 292, top: 170, width: 200, height: 100 },
        { left: 292, top: 412, width: 200, height: 110 },
      ],
      playerCount: 20,
    })
    expect(result.axis).toBe('vertical')
    expect(result.width).toBe(184)
    expect(result.height).toBeLessThan(20 * 30 + 19 * 3 + 16)
  })
})
