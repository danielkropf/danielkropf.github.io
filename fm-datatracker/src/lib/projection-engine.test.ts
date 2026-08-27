import { describe, expect, it } from 'vitest'
import {
  MDI_NEUTRAL,
  Q_HIGH,
  Q_LOW,
  developmentPace,
  historyShift,
  mentalDevelopmentIndex,
  personalityShift,
  projectScore,
  weightedQuantile,
} from './projection-engine'
import type { ProjectionFamily, ProjectionReference } from './projection-reference'
import { PROJECTION_MODEL_VERSION, PROJECTION_REFERENCE_ID, PROJECTION_REFERENCE_VERSION, PROJECTION_SOURCE_SHA256, PROJECTION_STATUS } from './projection-reference'

function reference(family: ProjectionFamily = 'M', gain = 1): ProjectionReference {
  const observations = Array.from({ length: 260 }, (_, index) => ({
    age: 18 + (index % 8) * 0.1,
    score: 12 + (index % 5) * 0.03,
    headroom: index % 30,
    intrinsicPeakGain: gain + (index % 4) * 0.05,
    family,
    saveUniverseId: 'bayern' as const,
  }))
  return {
    id: PROJECTION_REFERENCE_ID,
    referenceVersion: PROJECTION_REFERENCE_VERSION,
    projectionModelVersion: PROJECTION_MODEL_VERSION,
    projectionStatus: PROJECTION_STATUS,
    mode: 'provisional-longitudinal',
    calibrated: false,
    sourceSha256: PROJECTION_SOURCE_SHA256,
    sample: { observations: observations.length, futureLinks: 0, byUniverse: { bayern: observations.length, numancia: 0 }, byFamily: { GK: 0, D: 0, WB: 0, DM: 0, M: family === 'M' ? observations.length : 0, AM: 0, ST: 0 } },
    observations,
  }
}

const baseInput = {
  currentScore: 12,
  birthDate: '2007-07-01',
  snapshotDate: '2026-07-01',
  ca: 120,
  pa: 150,
  professionalism: 12,
  ambition: 12,
  determination: 12,
  personalitySource: 'exact' as const,
  scoreType: 'general' as const,
  scoreKey: 'CM',
  family: 'M' as const,
  eligible: true,
}

describe('Projection v2.1 longitudinal', () => {
  it('projects directly from observed IntrinsicPeakGain and never below current score', () => {
    const result = projectScore({ ...baseInput, reference: reference('M', 0.8) })
    expect(result.status).toBe('ok')
    expect(result.projectedScore).toBeGreaterThanOrEqual(12)
    expect(result.expectedIntrinsicPeakGain).toBeGreaterThan(0)
    expect(result.peakAge).toBeNull()
    expect(result.historyShift).toBe(0)
  })

  it('does not force zero growth when CA equals PA / headroom is zero', () => {
    const result = projectScore({ ...baseInput, ca: 140, pa: 140, reference: reference('M', 0.6) })
    expect(result.status).toBe('ok')
    expect(result.headroom).toBe(0)
    expect(result.projectedScore).toBeGreaterThan(12)
  })

  it('has no hard peak-age cutoff', () => {
    const result = projectScore({ ...baseInput, birthDate: '1990-07-01', reference: reference('M', 0.5) })
    expect(result.status).toBe('ok')
    expect(result.exactAge).toBeGreaterThan(35)
    expect(result.projectedScore).toBeGreaterThan(12)
  })

  it('keeps function projections unavailable instead of reusing a generic delta', () => {
    const result = projectScore({ ...baseInput, scoreType: 'function', scoreKey: 'IP:MC:CM', reference: reference('M', 0.5) })
    expect(result.status).toBe('unsupported_score_type')
    expect(result.projectedScore).toBeNull()
  })

  it('uses personality only as a bounded quantile shift', () => {
    const mdi = mentalDevelopmentIndex(20, 20, 20)
    expect(mdi).toBeGreaterThan(MDI_NEUTRAL)
    expect(personalityShift(mdi)).toBeLessThanOrEqual(0.15)
    expect(personalityShift(mdi)).toBeGreaterThan(0)
    expect(historyShift(1)).toBe(0)
  })

  it('keeps weighted quantiles inside the approved q range', () => {
    expect(weightedQuantile([0, 1, 2], Q_LOW, [1, 1, 1])).toBe(0)
    expect(weightedQuantile([0, 1, 2], Q_HIGH, [1, 1, 1])).toBe(2)
  })

  it('keeps DevelopmentPace separate and requires at least 90 days', () => {
    expect(developmentPace({ days: 89, currentCa: 110, previousCa: 100 })).toBeNull()
    const pace = developmentPace({ days: 365.2425, currentCa: 110, previousCa: 100, currentVisibleBaseScore: 12, previousVisibleBaseScore: 11 })
    expect(pace?.recentCaAnnualized).toBeCloseTo(10)
    expect(pace?.recentVisibleBaseRate).toBeCloseTo(1)
  })
})
