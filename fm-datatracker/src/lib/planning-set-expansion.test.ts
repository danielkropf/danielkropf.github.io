import { describe, expect, it } from 'vitest'
import { resolvePlanningSetExpansion, type PlanningSetRect } from './planning-set-expansion'

const base = { pitchWidth: 800, pitchHeight: 700, playerCount: 4, cardWidth: 82, cardHeight: 96, gap: 6 }
const compact: PlanningSetRect = { left: 24, top: 500, width: 184, height: 122 }

describe('resolvePlanningSetExpansion', () => {
  it('prefers vertical expansion when there is clear usable space', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact: { left: 300, top: 280, width: 184, height: 122 }, obstacles: [] })
    expect(result.axis).toBe('vertical')
    expect(result.height).toBeGreaterThan(122)
  })

  it('falls back horizontally toward the empty side when vertical space is blocked', () => {
    const result = resolvePlanningSetExpansion({
      ...base,
      compact,
      obstacles: [
        { left: 24, top: 360, width: 184, height: 122 },
        { left: 24, top: 632, width: 184, height: 54 },
      ],
    })
    expect(result.axis).toBe('horizontal')
    expect(result.direction).toBe('right')
    expect(result.left).toBeGreaterThanOrEqual(14)
  })

  it('never places an expanded set outside the useful pitch bounds', () => {
    const result = resolvePlanningSetExpansion({ ...base, compact: { left: 2, top: 10, width: 184, height: 122 }, obstacles: [], playerCount: 10 })
    expect(result.left).toBeGreaterThanOrEqual(14)
    expect(result.top).toBeGreaterThanOrEqual(14)
    expect(result.left + result.width).toBeLessThanOrEqual(base.pitchWidth - 14)
    expect(result.top + result.height).toBeLessThanOrEqual(base.pitchHeight - 14)
  })

  it('uses the left side for a right-edge set when vertical growth is blocked', () => {
    const edge = { left: 592, top: 500, width: 184, height: 122 }
    const result = resolvePlanningSetExpansion({
      ...base,
      compact: edge,
      obstacles: [
        { left: 592, top: 360, width: 184, height: 122 },
        { left: 592, top: 632, width: 184, height: 54 },
      ],
    })
    expect(result.axis).toBe('horizontal')
    expect(result.direction).toBe('left')
    expect(result.left + result.width).toBeLessThanOrEqual(base.pitchWidth - 14)
  })

  it('supports list-shaped depth sets with one player per vertical row', () => {
    const result = resolvePlanningSetExpansion({
      pitchWidth: 800,
      pitchHeight: 700,
      compact: { left: 300, top: 280, width: 184, height: 122 },
      obstacles: [],
      playerCount: 6,
      cardWidth: 170,
      cardHeight: 28,
      gap: 1,
      verticalItemsPerRow: 1,
      horizontalItemsPerColumn: 3,
    })
    expect(result.axis).toBe('vertical')
    expect(result.height).toBeGreaterThan(122)
  })

})
