import { describe, expect, it } from 'vitest'
import { calculatePlanningCardLayout, resolvePlanningInsertionBefore } from './planning-layout'

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

  it('uses the second collapsed row before hiding players in a grouped set', () => {
    const layout = calculatePlanningCardLayout(900, true, 8)
    expect(layout.columns).toBe(4)
    expect(layout.capacity).toBe(8)
    expect(layout.reservesExpand).toBe(false)
  })

  it('budgets +N on the final row of a grouped set without exceeding eight visible cards', () => {
    const layout = calculatePlanningCardLayout(900, true, 12)
    expect(layout.reservesExpand).toBe(true)
    expect(layout.capacity).toBeLessThanOrEqual(8)
    expect(layout.cardWidth).toBeGreaterThanOrEqual(164)
  })
})

describe('predictive insertion zones', () => {
  const cards = [
    { id: 'a', left: 0, right: 180, top: 0, bottom: 40 },
    { id: 'b', left: 186, right: 366, top: 0, bottom: 40 },
    { id: 'c', left: 372, right: 552, top: 0, bottom: 40 },
  ]

  it('resolves continuous zones before, between and after cards', () => {
    expect(resolvePlanningInsertionBefore(cards, 5, 20, undefined)).toBe('a')
    expect(resolvePlanningInsertionBefore(cards, 183, 20, undefined)).toBe('b')
    expect(resolvePlanningInsertionBefore(cards, 369, 20, undefined)).toBe('c')
    expect(resolvePlanningInsertionBefore(cards, 550, 20, undefined)).toBe(null)
  })

  it('keeps the current placeholder stable around a boundary', () => {
    expect(resolvePlanningInsertionBefore(cards, 205, 20, 'b')).toBe('b')
    expect(resolvePlanningInsertionBefore(cards, 198, 20, 'b')).toBe('b')
  })

  it('moves predictably between rows', () => {
    const twoRows = [
      ...cards.slice(0, 2),
      { id: 'c', left: 0, right: 180, top: 48, bottom: 88 },
      { id: 'd', left: 186, right: 366, top: 48, bottom: 88 },
    ]
    expect(resolvePlanningInsertionBefore(twoRows, 10, 15, undefined)).toBe('a')
    expect(resolvePlanningInsertionBefore(twoRows, 10, 70, undefined)).toBe('c')
  })
})
