import { describe, expect, it } from 'vitest'
import { planningFamiliarity, planningFamiliarityTooltip } from './planning-familiarity'

const pairs = [{ ip: { position: 'DC' }, oop: { position: 'DM' } }]
const snapshot = (DC?: number, DM?: number) => ({
  positions: [] as string[],
  normalized_data: { positional_ratings: Object.fromEntries([['DC', DC], ['DM', DM]].filter(([, value]) => value !== undefined)) },
})

describe('planning familiarity by tactical phase', () => {
  it('is familiar only when both phases are familiar', () => {
    expect(planningFamiliarity(snapshot(18, 17), pairs)).toBe('familiar')
  })
  it('flags only OOP when IP is familiar and OOP is not', () => {
    expect(planningFamiliarity(snapshot(18, 8), pairs)).toBe('out-oop')
  })
  it('flags only IP when OOP is familiar and IP is not', () => {
    expect(planningFamiliarity(snapshot(8, 18), pairs)).toBe('out-ip')
  })
  it('flags both phases when neither position is familiar', () => {
    expect(planningFamiliarity(snapshot(8, 9), pairs)).toBe('out-both')
  })
  it('keeps unknown data unknown instead of inventing an issue', () => {
    expect(planningFamiliarity({ positions: [] }, pairs)).toBe('unknown')
  })
  it('describes the actual IP/OOP positional evidence in the tooltip', () => {
    const snapshot = { positions: ['D(C)'], normalized_data: { positional_ratings: { DC: 18, WBL: 8 } } }
    const text = planningFamiliarityTooltip(snapshot, [{ ip: { position: 'D(C)' }, oop: { position: 'WB(L)' } }])
    expect(text).toContain('IP — D(C): 18/20')
    expect(text).toContain('OOP — WB(L): 8/20')
  })

})
