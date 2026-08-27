import { describe, expect, it } from 'vitest'
import {
  PROJECTION_EXPECTED_OBSERVATIONS,
  PROJECTION_MODEL_VERSION,
  PROJECTION_REFERENCE_ID,
  PROJECTION_REFERENCE_VERSION,
  PROJECTION_STATUS,
  validateProjectionReference,
  type ProjectionFamily,
} from './projection-reference'

const familyCounts: Array<[ProjectionFamily, number]> = [
  ['GK', 4536], ['D', 8983], ['WB', 4039], ['DM', 2703], ['M', 5506], ['AM', 11557], ['ST', 6088],
]

function auditedShape() {
  let index = 0
  return familyCounts.flatMap(([family, count]) => Array.from({ length: count }, () => {
    const saveUniverseId = index++ < 33907 ? 'bayern' : 'numancia'
    return { age: 24, score: 12, headroom: 10, intrinsicPeakGain: 0.5, family, saveUniverseId }
  }))
}

describe('Projection v2.1 reference validator', () => {
  it('accepts the audited raw-array transport without inventing observations', () => {
    const rows = auditedShape()
    expect(rows).toHaveLength(PROJECTION_EXPECTED_OBSERVATIONS)
    const reference = validateProjectionReference(rows)
    expect(reference?.referenceVersion).toBe(PROJECTION_REFERENCE_VERSION)
    expect(reference?.projectionModelVersion).toBe(PROJECTION_MODEL_VERSION)
    expect(reference?.projectionStatus).toBe(PROJECTION_STATUS)
    expect(reference?.calibrated).toBe(false)
    expect(reference?.sample.byUniverse).toEqual({ bayern: 33907, numancia: 9505 })
  })

  it('rejects truncated substitutes', () => {
    expect(validateProjectionReference(auditedShape().slice(0, -1))).toBeNull()
  })

  it('rejects calibrated=true even with the approved metadata', () => {
    expect(validateProjectionReference({
      id: PROJECTION_REFERENCE_ID,
      referenceVersion: PROJECTION_REFERENCE_VERSION,
      projectionModelVersion: PROJECTION_MODEL_VERSION,
      projectionStatus: PROJECTION_STATUS,
      calibrated: true,
      observations: auditedShape(),
    })).toBeNull()
  })
})
