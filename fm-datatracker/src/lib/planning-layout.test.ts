import { describe, expect, it } from 'vitest'
import { calculatePlanningCardLayout } from './planning-layout'

describe('planning card density', () => {
  it('never shows more than four cards in a normal collapsed row', () => {
    expect(calculatePlanningCardLayout(1200, false, 12).capacity).toBeLessThanOrEqual(4)
  })
  it('never shows more than eight cards in a grouped collapsed row', () => {
    expect(calculatePlanningCardLayout(1200, true, 20).capacity).toBeLessThanOrEqual(8)
  })
  it('reserves space for +N before cards become narrower than the minimum', () => {
    const layout = calculatePlanningCardLayout(720, false, 8)
    expect(layout.reservesExpand).toBe(true)
    expect(layout.cardWidth).toBeGreaterThanOrEqual(164)
  })
  it('does not stretch a single card beyond the stable ideal width', () => {
    expect(calculatePlanningCardLayout(1200, false, 1).cardWidth).toBeLessThanOrEqual(220)
  })
})
