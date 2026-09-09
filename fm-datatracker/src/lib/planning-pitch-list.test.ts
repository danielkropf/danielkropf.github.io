import { describe, expect, it } from 'vitest'
import { PLANNING_PITCH_LIST_CAPACITY, planningPitchPositionLabel, planningPitchSetHeader, planningPitchVisibleSlotCount } from './planning-pitch-list'

describe('planning pitch list presentation contract', () => {
  it('reserves exactly three compact player rows', () => {
    expect(PLANNING_PITCH_LIST_CAPACITY).toBe(3)
  })

  it('keeps one empty placeholder while a set is expanded, including after a removal', () => {
    expect(planningPitchVisibleSlotCount(4, true)).toBe(5)
    expect(planningPitchVisibleSlotCount(3, true)).toBe(4)
    expect(planningPitchVisibleSlotCount(2, true)).toBe(3)
    expect(planningPitchVisibleSlotCount(0, true)).toBe(3)
    expect(planningPitchVisibleSlotCount(4, false)).toBe(3)
  })

  it('formats the set header in two lines with abbreviated IP/OOP roles', () => {
    expect(planningPitchSetHeader('D(C) Left', ['BPD', 'BPD'], ['CD'])).toBe(
      'D(C) Left\nIP: BPD · OOP: CD',
    )
  })

  it('labels the five central triple families by structural side without numeric suffixes', () => {
    expect(planningPitchPositionLabel('D (C)', 'dcl')).toBe('D(C) Left')
    expect(planningPitchPositionLabel('D (C)', 'dc')).toBe('D(C) Center')
    expect(planningPitchPositionLabel('D (C)', 'dcr')).toBe('D(C) Right')
    expect(planningPitchPositionLabel('DM (C)', 'dmc')).toBe('DM Center')
    expect(planningPitchPositionLabel('M (C)', 'mcl')).toBe('M(C) Left')
    expect(planningPitchPositionLabel('AM (C)', 'amcr')).toBe('AM(C) Right')
    expect(planningPitchPositionLabel('ST (C)', 'stc')).toBe('ST Center')
  })

  it('keeps non-triple positions compact without adding a side', () => {
    expect(planningPitchPositionLabel('D (L)', 'dl')).toBe('D(L)')
    expect(planningPitchPositionLabel('AM (R)', 'amr')).toBe('AM(R)')
    expect(planningPitchPositionLabel('GK', 'gk')).toBe('GK')
  })

  it('fails visually closed when a phase has no role label', () => {
    expect(planningPitchSetHeader('GK', [], [])).toBe('GK\nIP: — · OOP: —')
  })
})
