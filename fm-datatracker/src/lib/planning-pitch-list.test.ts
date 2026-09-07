import { describe, expect, it } from 'vitest'
import { PLANNING_PITCH_LIST_CAPACITY, planningPitchSetHeader } from './planning-pitch-list'

describe('planning pitch list presentation contract', () => {
  it('reserves exactly three compact player rows', () => {
    expect(PLANNING_PITCH_LIST_CAPACITY).toBe(3)
  })

  it('formats the centered set header as position + abbreviated IP/OOP roles', () => {
    expect(planningPitchSetHeader('D(C)', ['BPD', 'BPD'], ['CD'])).toBe(
      'D(C) | IP: BPD - OOP: CD',
    )
  })

  it('fails visually closed when a phase has no role label', () => {
    expect(planningPitchSetHeader('GK', [], [])).toBe('GK | IP: — - OOP: —')
  })
})
