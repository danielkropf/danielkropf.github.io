import { describe, expect, it } from 'vitest'
import { validateProjectionReference } from './projection-reference'

describe('projection reference guard', () => {
  it('aceita apenas a referência e o modelo versionados esperados', () => {
    expect(validateProjectionReference({ referenceVersion: 'fm26-v1', projectionModelVersion: '1.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [{ scoreType: 'general', scoreKey: 'OUTFIELD', observations: [{ age: 18, score: 12, cp: 150 }] }], growth: [{ scoreType: 'general', scoreKey: 'OUTFIELD', ageStart: 18, deltas: [0.5] }] })?.referenceVersion).toBe('fm26-v1')
    expect(validateProjectionReference({ referenceVersion: 'inventada', projectionModelVersion: '1.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [], growth: [] })).toBeNull()
    expect(validateProjectionReference({ referenceVersion: 'fm26-v1', projectionModelVersion: '2.0', calibrated: true, sample: { uniquePlayers: 10000, transitions: 50000 }, cohorts: [], growth: [] })).toBeNull()
  })
})
