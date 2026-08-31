import { describe, expect, it } from 'vitest'
import { ATTRIBUTE_CATALOG } from './attributes'
import { pairedRoleScore, resolveRoleWeightMatrixKey } from './role-scoring'
import {
  PROJECTED_ROLE_HISTORY_ALPHA,
  expectedPeakThrough24,
  projectRoleScore,
  rawToVisible,
  type ExactRoleMatrix,
  type ProjectedRawDeltaModel,
  type ProjectionInputState,
  type RawAttributeVector,
  type ProjectionHorizon,
} from './projected-role-score'
import { projectedRoleInputState, type ProjectedRoleSnapshot } from './projected-role-input'
import {
  PROJECTED_ROLE_EXPECTED_ALGORITHM,
  PROJECTED_ROLE_MODEL_ASSET_CONTRACT_VERSION,
  PROJECTED_ROLE_OUTPUT_KEYS,
  validateProjectedRoleModelAssetMetadata,
  type ProjectedRoleModelAssetMetadata,
} from './projected-role-model-contract'

const raw = (value = 50): RawAttributeVector => Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [attribute.key, value]))
const delta = (value: number): RawAttributeVector => Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [attribute.key, value]))
const visible = (value = 10) => ATTRIBUTE_CATALOG.map(attribute => ({ key: attribute.key, value }))
const weights = (value = 3) => Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [attribute.key, value]))
const exactMatrix = (overrides: Partial<ExactRoleMatrix> = {}): ExactRoleMatrix => ({
  roleIdentity: 'CM:IP_CM_CENTRAL_MIDFIELDER|OOP_CM_CENTRAL_MIDFIELDER',
  positionalGroup: 'CM',
  roleMatrixVersion: 'test-role-matrix-v1',
  scoringModelVersion: 'test-scoring-v1',
  ipWeights: weights(),
  oopWeights: weights(),
  custom: false,
  ...overrides,
})
const baseInput = (overrides: Partial<ProjectionInputState> = {}): ProjectionInputState => ({
  currentRaw: raw(),
  currentVisible: visible(),
  continuousAge: 21,
  currentAbility: 120,
  potentialAbility: 160,
  professionalism: 15,
  ambition: 14,
  determination: 13,
  inputProvenanceStatus: 'FULL_TRUSTED',
  history: null,
  unavailableReason: null,
  warnings: [],
  ...overrides,
})

function fixtureModel({ cold = 5, history = 15, supported = true, calibrationN = 500 }: { cold?: number; history?: number; supported?: boolean; calibrationN?: number | null } = {}): ProjectedRawDeltaModel {
  return {
    projectionModelVersion: 'fixture-projected-role-v1',
    predictCold: () => delta(cold),
    predictHistory: () => delta(history),
    historySupport: () => ({ supported, calibrationN, overlapStatus: supported ? 'IN_SUPPORT' : 'OOD' }),
  }
}

function historyInput() {
  const previousRaw = raw(45)
  return baseInput({
    history: {
      previousRaw,
      previousSnapshotDate: '2036-09-01',
      currentSnapshotDate: '2036-12-30',
      spanDays: 120,
      ratePerYear: delta((50 - 45) * 365.2425 / 120),
      provenanceStatus: 'TRUSTED',
    },
  })
}

function realReaderSnapshot(overrides: Partial<ProjectedRoleSnapshot> = {}): ProjectedRoleSnapshot {
  const rawLabels = Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => {
    const label = attribute.key === 'team_work' ? 'Teamwork' : attribute.key === 'punching' ? 'Punching Tendency' : attribute.label
    return [label, 50]
  }))
  return {
    snapshot_date: '2021-01-01',
    raw_data: { birth_date: '2000-01-01', attributes_raw_1_100: rawLabels },
    normalized_data: {
      source: 'fm26-save-offline',
      ca_pa_status: 'candidate_with_provenance_not_universally_validated',
      fm_hidden: { current_ability: 120, potential_ability: 160, professionalism: 15, ambition: 14 },
    },
    player_attributes: ATTRIBUTE_CATALOG.map(attribute => ({ attribute_key: attribute.key, value: 10 })),
    ...overrides,
  }
}

describe('ProjectedRoleScore Scoring §14 contract', () => {
  it('1. runs pure COLD_START without history', () => {
    const result = projectRoleScore(baseInput(), exactMatrix(), fixtureModel())
    expect(result.status).toBe('AVAILABLE')
    expect(result.horizons[12].predictionBranch).toBe('COLD_START')
    expect(result.horizons[12].alphaHistoryApplied).toBe(0)
  })

  it.each([12, 24, 36] as const)('2/4. runs HISTORY_AWARE at %sm with the approved alpha', (horizon: ProjectionHorizon) => {
    const result = projectRoleScore(historyInput(), exactMatrix(), fixtureModel({ cold: 10, history: 20 }))
    const expected = 10 * (1 - PROJECTED_ROLE_HISTORY_ALPHA[horizon]) + 20 * PROJECTED_ROLE_HISTORY_ALPHA[horizon]
    expect(result.horizons[horizon].predictionBranch).toBe('HISTORY_AWARE')
    expect(result.horizons[horizon].alphaHistoryApplied).toBe(PROJECTED_ROLE_HISTORY_ALPHA[horizon])
    expect(result.horizons[horizon].predictedRawDelta?.passing).toBeCloseTo(expected, 10)
  })

  it('3. falls back exactly to COLD_START when history support is insufficient', () => {
    const coldOnly = projectRoleScore(baseInput(), exactMatrix(), fixtureModel({ cold: 7, history: 99 }))
    const fallback = projectRoleScore(historyInput(), exactMatrix(), fixtureModel({ cold: 7, history: 99, calibrationN: 199 }))
    expect(fallback.horizons[24].predictionBranch).toBe('COLD_START')
    expect(fallback.horizons[24].alphaHistoryApplied).toBe(0)
    expect(fallback.horizons[24].predictedRawDelta).toEqual(coldOnly.horizons[24].predictedRawDelta)
    expect(fallback.horizons[24].projectedRoleScore).toBe(coldOnly.horizons[24].projectedRoleScore)
  })

  it('5. clips future raw attributes to 1..100', () => {
    const current = raw(50); current.passing = 99; current.tackling = 2
    const model = fixtureModel({ cold: 10 })
    model.predictCold = () => ({ ...delta(0), passing: 10, tackling: -10 })
    const result = projectRoleScore(baseInput({ currentRaw: current }), exactMatrix(), model)
    expect(result.horizons[12].projectedRaw?.passing).toBe(100)
    expect(result.horizons[12].projectedRaw?.tackling).toBe(1)
  })

  it('6. uses the canonical raw to visible rule', () => {
    expect(rawToVisible(1)).toBe(1)
    expect(rawToVisible(47)).toBe(9)
    expect(rawToVisible(48)).toBe(10)
    expect(rawToVisible(97)).toBe(19)
    expect(rawToVisible(98)).toBe(20)
    expect(rawToVisible(100)).toBe(20)
  })

  it('7. applies the exact same role matrix to current and projected scores', () => {
    const ip = weights(1); ip.passing = 5
    const oop = weights(1); oop.tackling = 5
    const matrix = exactMatrix({ ipWeights: ip, oopWeights: oop })
    const input = baseInput()
    const directCurrent = pairedRoleScore(input.currentVisible!, ip, oop)
    const result = projectRoleScore(input, matrix, fixtureModel({ cold: 0 }))
    expect(result.currentRoleScore).toBe(directCurrent)
    expect(result.horizons[12].projectedRoleScore).toBe(directCurrent)
  })

  it('8. preserves IP/OOP geometric mean through the existing scoring primitive', () => {
    const currentRaw = raw(50); currentRaw.passing = 80; currentRaw.tackling = 20
    const currentVisible = ATTRIBUTE_CATALOG.map(attribute => ({ key: attribute.key, value: rawToVisible(currentRaw[attribute.key]) }))
    const ip = weights(1); ip.passing = 5
    const oop = weights(1); oop.tackling = 5
    const expected = pairedRoleScore(currentVisible, ip, oop)
    const result = projectRoleScore(baseInput({ currentRaw, currentVisible }), exactMatrix({ ipWeights: ip, oopWeights: oop }), fixtureModel({ cold: 0 }))
    expect(result.currentRoleScore).toBe(expected)
  })

  it('9. preserves an exact custom matrix and marks it uncalibrated', () => {
    const custom = weights(1); custom.vision = 5
    const matrix = exactMatrix({ roleIdentity: 'CUSTOM:vision-only', ipWeights: custom, oopWeights: null, custom: true })
    const result = projectRoleScore(baseInput(), matrix, fixtureModel({ cold: 0 }))
    expect(result.pointEstimateValidationStatus).toBe('EXPERIMENTAL_UNCALIBRATED')
    expect(result.currentRoleScore).toBe(10)
  })

  it('10. never consumes a GeneralProjectedGain to manufacture role projection', () => {
    const clean = projectRoleScore(baseInput(), exactMatrix(), fixtureModel({ cold: 5 }))
    const poisoned = projectRoleScore({ ...baseInput(), generalProjectedGain: 999 } as ProjectionInputState, exactMatrix(), fixtureModel({ cold: 5 }))
    expect(poisoned.horizons[12].projectedRoleScore).toBe(clean.horizons[12].projectedRoleScore)
    expect(poisoned.horizons[12].projectedRoleGain).toBe(clean.horizons[12].projectedRoleGain)
  })

  it('11. fails closed on invalid raw provenance', () => {
    const snapshot = realReaderSnapshot({ normalized_data: { source: 'csv-import' } })
    const input = projectedRoleInputState({ snapshot })
    expect(input.unavailableReason).toBe('RAW_STATE_UNAVAILABLE')
    expect(projectRoleScore(input, exactMatrix(), fixtureModel()).status).toBe('UNAVAILABLE')
  })

  it('12. fails closed when required personality is absent', () => {
    const snapshot = realReaderSnapshot({ normalized_data: {
      source: 'fm26-save-offline', ca_pa_status: 'candidate_with_provenance_not_universally_validated',
      fm_hidden: { current_ability: 120, potential_ability: 160, professionalism: 15 },
    } })
    const input = projectedRoleInputState({ snapshot })
    expect(input.unavailableReason).toBe('PERSONALITY_UNAVAILABLE')
  })

  it('13. rejects CA/PA aliases from unauthorized sources even when numbers exist', () => {
    const snapshot = realReaderSnapshot({
      normalized_data: { source: 'fm26-save-offline', ca_pa_status: 'untrusted', current_ability: 120, potential_ability: 160 },
      raw_data: { ...realReaderSnapshot().raw_data, current_ability: 120, potential_ability: 160 },
    })
    const input = projectedRoleInputState({ snapshot })
    expect(input.unavailableReason).toBe('ABILITY_UNAVAILABLE')
    expect(input.currentAbility).toBeNull()
    expect(input.potentialAbility).toBeNull()
  })

  it('14. supports GK and outfield matrices without changing the raw 47 invariant', () => {
    const gk = weights(1); gk.reflexes = 5
    const line = weights(1); line.passing = 5
    const input = baseInput()
    expect(projectRoleScore(input, exactMatrix({ roleIdentity: 'GK', positionalGroup: 'GK', ipWeights: gk, oopWeights: null }), fixtureModel({ cold: 0 })).currentRoleScore).toBe(10)
    expect(projectRoleScore(input, exactMatrix({ roleIdentity: 'CM', positionalGroup: 'CM', ipWeights: line, oopWeights: null }), fixtureModel({ cold: 0 })).currentRoleScore).toBe(10)
    expect(Object.keys(input.currentRaw!)).toHaveLength(47)
  })

  it('15. keeps duplicate role names resolved by exact canonical identity', () => {
    expect(resolveRoleWeightMatrixKey('IP-WB-WB', 'Wing Back')).toBe('IP_WB_WING_BACK')
    expect(resolveRoleWeightMatrixKey('IP-WB-IWB', 'Inside Wing Back')).toBe('IP_WB_INSIDE_WING_BACK')
  })

  it('16. exposes branch, provenance, horizon outputs and model version', () => {
    const result = projectRoleScore(historyInput(), exactMatrix(), fixtureModel())
    expect(result.projectionModelVersion).toBe('fixture-projected-role-v1')
    expect(result.inputProvenanceStatus).toBe('FULL_TRUSTED')
    expect(result.predictionIntervalStatus).toBe('NOT_PRODUCT_CALIBRATED')
    expect(Object.keys(result.horizons).sort()).toEqual(['12', '24', '36'])
  })

  it('17. keeps the product fail-closed while the validated production model asset is absent', () => {
    const result = projectRoleScore(baseInput(), exactMatrix(), null)
    expect(result.status).toBe('UNAVAILABLE')
    expect(result.unavailableReason).toBe('MODEL_ASSET_UNAVAILABLE')
    expect(result.horizons[12].projectedRoleScore).toBeNull()
  })

  it('18. does not alter current RoleScore when projection is introduced', () => {
    const ip = weights(1); ip.passing = 5
    const oop = weights(1); oop.positioning = 5
    const before = pairedRoleScore(baseInput().currentVisible!, ip, oop)
    const projected = projectRoleScore(baseInput(), exactMatrix({ ipWeights: ip, oopWeights: oop }), fixtureModel({ cold: 25 }))
    expect(projected.currentRoleScore).toBe(before)
  })

  it('normalizes trusted history by the real day interval', () => {
    const previous = realReaderSnapshot({ snapshot_date: '2020-09-03' })
    const current = realReaderSnapshot({ snapshot_date: '2021-01-01' })
    const currentRaw = current.raw_data!.attributes_raw_1_100 as Record<string, number>
    currentRaw.Passing = 60
    const previousRaw = previous.raw_data!.attributes_raw_1_100 as Record<string, number>
    previousRaw.Passing = 50
    const input = projectedRoleInputState({ snapshot: current, previousSnapshot: previous, identityStable: true })
    expect(input.history?.spanDays).toBe(120)
    expect(input.history?.ratePerYear.passing).toBeCloseTo(10 * 365.2425 / 120, 10)
  })

  it('falls back to cold when history identity is not stable', () => {
    const input = projectedRoleInputState({ snapshot: realReaderSnapshot(), previousSnapshot: realReaderSnapshot({ snapshot_date: '2020-09-03' }), identityStable: false })
    expect(input.history).toBeNull()
    const result = projectRoleScore(input, exactMatrix(), fixtureModel())
    expect(result.horizons[12].predictionBranch).toBe('COLD_START')
  })

  it('keeps ExpectedPeakThrough24 separate from fixed-horizon projection and support-gated', () => {
    const result = projectRoleScore(baseInput(), exactMatrix(), fixtureModel({ cold: 5 }))
    const expected = expectedPeakThrough24(result, 21, exactMatrix(), { modelVersion: 'fixture-residual-v1', residualMean: () => 0.4 })
    expect(expected.status).toBe('AVAILABLE')
    expect(expected.expectedPeakThrough24).toBeGreaterThanOrEqual(expected.typicalPeakThrough24!)
    expect(expected.residualModelVersion).toBe('fixture-residual-v1')
  })

  it('does not apply adult ExpectedPeak residuals to 16-19', () => {
    const result = projectRoleScore(baseInput({ continuousAge: 18 }), exactMatrix(), fixtureModel({ cold: 5 }))
    const expected = expectedPeakThrough24(result, 18, exactMatrix(), { modelVersion: 'fixture-residual-v1', residualMean: () => 10 })
    expect(expected.status).toBe('UNAVAILABLE')
    expect(expected.reason).toBe('UNSUPPORTED_AGE_SLICE')
  })

  it('requires exact frozen-model metadata before accepting a future production asset', () => {
    const metadata: ProjectedRoleModelAssetMetadata = {
      contractVersion: PROJECTED_ROLE_MODEL_ASSET_CONTRACT_VERSION,
      projectionModelVersion: 'future-explicit-version',
      algorithm: PROJECTED_ROLE_EXPECTED_ALGORITHM,
      horizons: [12, 24, 36],
      outputKeys: PROJECTED_ROLE_OUTPUT_KEYS,
      seeds: [7, 11, 19, 23, 31, 42, 57, 83, 101, 137],
      treesPerSeed: 48,
      minSamplesLeaf: 2,
      maxFeatures: 1,
      goldenLockboxId: 'resimulated-2037-branch-lockbox',
      goldenTolerance: 1e-9,
      assetSha256: 'a'.repeat(64),
    }
    expect(validateProjectedRoleModelAssetMetadata(metadata)).toBe(true)
    expect(validateProjectedRoleModelAssetMetadata({ ...metadata, treesPerSeed: 47 })).toBe(false)
  })
})
