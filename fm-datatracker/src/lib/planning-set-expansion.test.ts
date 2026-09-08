import { describe, expect, it } from 'vitest'
import { resolvePlanningSetExpansion, type PlanningSetRect } from './planning-set-expansion'

const base = { pitchWidth: 800, pitchHeight: 700, playerCount: 6, cardWidth: 170, cardHeight: 30, gap: 3, verticalItemsPerRow: 1 }
const compact: PlanningSetRect = { left: 300, top: 280, width: 184, height: 122 }
const desiredHeight = (count: number, padding = 16) => Math.max(compact.height, count * 30 + Math.max(0, count - 1) * 3 + padding)

describe('resolvePlanningSetExpansion', () => {
  it('always expands vertically and preserves the compact width', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact, obstacles: [] })
    expect(result.axis).toBe('vertical')
    expect(result.direction).toBe('up')
    expect(result.width).toBe(compact.width)
    expect(result.height).toBe(desiredHeight(6))
  })

  it('reveals the entire depth even when neighbouring sets block both directions', () => {
    const result = resolvePlanningSetExpansion({
      ...base,
      compact,
      playerCount: 10,
      obstacles: [
        { left: 292, top: 170, width: 200, height: 100 },
        { left: 292, top: 412, width: 200, height: 110 },
      ],
    })
    expect(result.axis).toBe('vertical')
    expect(result.width).toBe(compact.width)
    expect(result.height).toBe(desiredHeight(10))
  })

  it('uses lower space when the set is already at the upper pitch boundary', () => {
    const nearTop = { ...compact, top: 10 }
    const result = resolvePlanningSetExpansion({ ...base, compact: nearTop, obstacles: [], playerCount: 5 })
    expect(result.direction).toBe('down')
    expect(result.top).toBe(10)
    expect(result.height).toBe(5 * 30 + 4 * 3 + 16)
  })

  it('keeps a normally sized expanded set inside the useful pitch', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact: { left: 2, top: 10, width: 184, height: 122 }, obstacles: [], playerCount: 8 })
    expect(result.left).toBeGreaterThanOrEqual(10)
    expect(result.top).toBeGreaterThanOrEqual(10)
    expect(result.left + result.width).toBeLessThanOrEqual(base.pitchWidth - 10)
    expect(result.top + result.height).toBeLessThanOrEqual(base.pitchHeight - 10)
  })

  it('never shrinks an exceptional oversized list just to keep it inside the pitch', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact, obstacles: [], playerCount: 30 })
    expect(result.height).toBe(desiredHeight(30))
    expect(result.height).toBeGreaterThan(base.pitchHeight - 20)
  })
})
