import { ATTRIBUTE_CATALOG } from './attributes'
import { rawRoleScore, type ScoringAttribute } from './role-scoring'
import { combinedPhaseScore } from './scoring'

export const PROJECTED_ROLE_ENGINE_VERSION = 'projected-role-score-engine-v1'
export const PROJECTED_ROLE_HORIZONS = [12, 24, 36] as const
export const PROJECTED_ROLE_HISTORY_ALPHA = { 12: 0.45, 24: 0.25, 36: 0.25 } as const
export const PROJECTED_ROLE_HISTORY_MIN_CALIBRATION_N = 200
export const PROJECTED_ROLE_VALIDATED_MIN_AGE = 16
export const PROJECTED_ROLE_VALIDATED_MAX_AGE_EXCLUSIVE = 30
export const DAYS_PER_YEAR = 365.2425

export type ProjectionHorizon = typeof PROJECTED_ROLE_HORIZONS[number]
export type RawAttributeKey = typeof ATTRIBUTE_CATALOG[number]['key']
export type RawAttributeVector = Record<string, number>
export type ProjectionPredictionBranch = 'COLD_START' | 'HISTORY_AWARE'
export type HistorySupportStatus = 'NOT_AVAILABLE' | 'UNSUPPORTED' | 'SUPPORTED' | 'MODEL_METADATA_MISSING'
export type SupportOverlapStatus = 'IN_SUPPORT' | 'WEAK_SUPPORT' | 'OOD' | 'UNKNOWN'
export type ProjectionPointValidationStatus = 'PASS' | 'EXPERIMENTAL_UNCALIBRATED'
export type ProjectionIntervalStatus = 'NOT_PRODUCT_CALIBRATED'
export type ExternalTransportStatus = 'NOT_VALIDATED'
export type ProjectionUnavailableReason =
  | 'RAW_STATE_UNAVAILABLE'
  | 'ABILITY_UNAVAILABLE'
  | 'PERSONALITY_UNAVAILABLE'
  | 'OUTSIDE_VALIDATED_AGE_DOMAIN'
  | 'MODEL_ASSET_UNAVAILABLE'
  | 'MODEL_OUTPUT_INVALID'
  | 'ROLE_MATRIX_UNAVAILABLE'
  | 'CURRENT_ROLE_SCORE_UNAVAILABLE'

export type ColdProjectionFeatures = {
  continuousAge: number
  currentAbility: number
  potentialAbility: number
  headroom: number
  professionalism: number
  ambition: number
  determination: number
}

export type ProjectionHistory = {
  previousRaw: RawAttributeVector
  previousSnapshotDate: string
  currentSnapshotDate: string
  spanDays: number
  ratePerYear: RawAttributeVector
  provenanceStatus: 'TRUSTED'
}

export type ProjectionInputState = {
  currentRaw: RawAttributeVector | null
  currentVisible: ScoringAttribute[] | null
  continuousAge: number | null
  currentAbility: number | null
  potentialAbility: number | null
  professionalism: number | null
  ambition: number | null
  determination: number | null
  inputProvenanceStatus: 'FULL_TRUSTED' | 'UNAVAILABLE'
  history: ProjectionHistory | null
  unavailableReason: ProjectionUnavailableReason | null
  warnings: string[]
}

export type ProjectionModelSupport = {
  supported: boolean
  calibrationN: number | null
  overlapStatus: SupportOverlapStatus
  reason?: string | null
}

export type ProjectedRawDeltaModel = {
  projectionModelVersion: string
  predictCold: (horizon: ProjectionHorizon, features: ColdProjectionFeatures) => RawAttributeVector | null
  predictHistory: (horizon: ProjectionHorizon, features: ColdProjectionFeatures, historyRatePerYear: RawAttributeVector) => RawAttributeVector | null
  historySupport: (horizon: ProjectionHorizon, features: ColdProjectionFeatures, history: ProjectionHistory) => ProjectionModelSupport | null
}

export type ExactRoleMatrix = {
  roleIdentity: string
  positionalGroup: string
  roleMatrixVersion: string
  scoringModelVersion: string
  canonicalRoleId?: string | null
  ipMatrixKey?: string | null
  oopMatrixKey?: string | null
  ipMatrixHash?: string | null
  oopMatrixHash?: string | null
  ipWeights?: Record<string, number> | null
  oopWeights?: Record<string, number> | null
  custom: boolean
}

export type HorizonProjectionResult = {
  horizonMonths: ProjectionHorizon
  status: 'AVAILABLE' | 'UNAVAILABLE'
  projectedRoleScore: number | null
  projectedRoleGain: number | null
  predictionBranch: ProjectionPredictionBranch | null
  alphaHistoryApplied: number
  historySpanDays: number | null
  historySupportStatus: HistorySupportStatus
  supportOverlapStatus: SupportOverlapStatus
  predictedRawDelta: RawAttributeVector | null
  projectedRaw: RawAttributeVector | null
  projectedVisible: Record<string, number> | null
  reason: ProjectionUnavailableReason | null
  warnings: string[]
}

export type ProjectedRoleScoreResult = {
  status: 'AVAILABLE' | 'UNAVAILABLE'
  engineVersion: string
  projectionModelVersion: string | null
  scoringModelVersion: string
  roleMatrixVersion: string
  roleIdentity: string
  currentRoleScore: number | null
  horizons: Record<ProjectionHorizon, HorizonProjectionResult>
  inputProvenanceStatus: ProjectionInputState['inputProvenanceStatus']
  pointEstimateValidationStatus: ProjectionPointValidationStatus
  predictionIntervalStatus: ProjectionIntervalStatus
  externalTransportStatus: ExternalTransportStatus
  unavailableReason: ProjectionUnavailableReason | null
  warnings: string[]
}

export type ExpectedPeakResidualModel = {
  modelVersion: string
  residualMean: (input: {
    ageBand: '20-23' | '24-29'
    positionalGroup: string
    roleIdentity: string
    customMatrix: boolean
  }) => number | null
}

export type ExpectedPeakThrough24Result = {
  typicalPeakThrough24: number | null
  expectedPeakThrough24: number | null
  status: 'AVAILABLE' | 'UNAVAILABLE'
  residualModelVersion: string | null
  reason: 'POINT_ESTIMATES_UNAVAILABLE' | 'UNSUPPORTED_AGE_SLICE' | 'RESIDUAL_MODEL_UNAVAILABLE' | 'RESIDUAL_SUPPORT_UNAVAILABLE' | null
}

const rawKeys = ATTRIBUTE_CATALOG.map(attribute => attribute.key)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function rawToVisible(raw: number) {
  return clamp(Math.floor(raw / 5 + 0.5), 1, 20)
}

export function isCompleteRawState(raw: RawAttributeVector | null | undefined): raw is RawAttributeVector {
  return Boolean(raw) && rawKeys.every(key => finite(raw![key]) && raw![key] >= 1 && raw![key] <= 100)
}

export function isCompleteRawDelta(delta: RawAttributeVector | null | undefined): delta is RawAttributeVector {
  return Boolean(delta) && rawKeys.every(key => finite(delta![key]))
}

export function visibleAttributesFromRaw(raw: RawAttributeVector): ScoringAttribute[] {
  return ATTRIBUTE_CATALOG.map(attribute => ({ key: attribute.key, value: rawToVisible(raw[attribute.key]) }))
}

export function rawVectorToVisibleMap(raw: RawAttributeVector) {
  return Object.fromEntries(rawKeys.map(key => [key, rawToVisible(raw[key])])) as Record<string, number>
}

export function scoreExactRoleMatrix(attributes: ScoringAttribute[], matrix: ExactRoleMatrix) {
  const ipRaw = matrix.ipWeights ? rawRoleScore(attributes, matrix.ipWeights) : null
  const oopRaw = matrix.oopWeights ? rawRoleScore(attributes, matrix.oopWeights) : null
  if (ipRaw === null && oopRaw === null) return null
  return combinedPhaseScore(ipRaw, oopRaw)
}

function coldFeatures(input: ProjectionInputState): ColdProjectionFeatures | null {
  if (!finite(input.continuousAge)
    || !finite(input.currentAbility)
    || !finite(input.potentialAbility)
    || !finite(input.professionalism)
    || !finite(input.ambition)
    || !finite(input.determination)) return null
  return {
    continuousAge: input.continuousAge,
    currentAbility: input.currentAbility,
    potentialAbility: input.potentialAbility,
    headroom: Math.max(0, input.potentialAbility - input.currentAbility),
    professionalism: input.professionalism,
    ambition: input.ambition,
    determination: input.determination,
  }
}

function unavailableHorizon(horizonMonths: ProjectionHorizon, reason: ProjectionUnavailableReason, warnings: string[] = []): HorizonProjectionResult {
  return {
    horizonMonths,
    status: 'UNAVAILABLE',
    projectedRoleScore: null,
    projectedRoleGain: null,
    predictionBranch: null,
    alphaHistoryApplied: 0,
    historySpanDays: null,
    historySupportStatus: 'NOT_AVAILABLE',
    supportOverlapStatus: 'UNKNOWN',
    predictedRawDelta: null,
    projectedRaw: null,
    projectedVisible: null,
    reason,
    warnings,
  }
}

function allUnavailable(reason: ProjectionUnavailableReason, input: ProjectionInputState, matrix: ExactRoleMatrix, modelVersion: string | null): ProjectedRoleScoreResult {
  return {
    status: 'UNAVAILABLE',
    engineVersion: PROJECTED_ROLE_ENGINE_VERSION,
    projectionModelVersion: modelVersion,
    scoringModelVersion: matrix.scoringModelVersion,
    roleMatrixVersion: matrix.roleMatrixVersion,
    roleIdentity: matrix.roleIdentity,
    currentRoleScore: null,
    horizons: Object.fromEntries(PROJECTED_ROLE_HORIZONS.map(horizon => [horizon, unavailableHorizon(horizon, reason, input.warnings)])) as Record<ProjectionHorizon, HorizonProjectionResult>,
    inputProvenanceStatus: input.inputProvenanceStatus,
    pointEstimateValidationStatus: matrix.custom ? 'EXPERIMENTAL_UNCALIBRATED' : 'PASS',
    predictionIntervalStatus: 'NOT_PRODUCT_CALIBRATED',
    externalTransportStatus: 'NOT_VALIDATED',
    unavailableReason: reason,
    warnings: [...input.warnings],
  }
}

function historyDecision(model: ProjectedRawDeltaModel, horizon: ProjectionHorizon, features: ColdProjectionFeatures, history: ProjectionHistory | null) {
  if (!history) return {
    useHistory: false,
    status: 'NOT_AVAILABLE' as HistorySupportStatus,
    overlap: 'UNKNOWN' as SupportOverlapStatus,
    warning: null as string | null,
  }
  const support = model.historySupport(horizon, features, history)
  if (!support) return {
    useHistory: false,
    status: 'MODEL_METADATA_MISSING' as HistorySupportStatus,
    overlap: 'UNKNOWN' as SupportOverlapStatus,
    warning: 'HISTORY_AWARE ignorado: metadata de suporte ausente; fallback exato para COLD_START.',
  }
  const enoughCalibration = support.calibrationN !== null && support.calibrationN >= PROJECTED_ROLE_HISTORY_MIN_CALIBRATION_N
  if (!support.supported || !enoughCalibration) return {
    useHistory: false,
    status: 'UNSUPPORTED' as HistorySupportStatus,
    overlap: support.overlapStatus,
    warning: support.reason ?? 'HISTORY_AWARE fora do suporte aprovado; fallback exato para COLD_START.',
  }
  return {
    useHistory: true,
    status: 'SUPPORTED' as HistorySupportStatus,
    overlap: support.overlapStatus,
    warning: support.reason ?? null,
  }
}

function blendRawDelta(cold: RawAttributeVector, history: RawAttributeVector, alpha: number) {
  return Object.fromEntries(rawKeys.map(key => [key, (1 - alpha) * cold[key] + alpha * history[key]])) as RawAttributeVector
}

function futureRaw(currentRaw: RawAttributeVector, delta: RawAttributeVector) {
  return Object.fromEntries(rawKeys.map(key => [key, clamp(currentRaw[key] + delta[key], 1, 100)])) as RawAttributeVector
}

export function projectRoleScore(input: ProjectionInputState, matrix: ExactRoleMatrix, model: ProjectedRawDeltaModel | null): ProjectedRoleScoreResult {
  if (!matrix.ipWeights && !matrix.oopWeights) return allUnavailable('ROLE_MATRIX_UNAVAILABLE', input, matrix, model?.projectionModelVersion ?? null)
  if (input.unavailableReason) return allUnavailable(input.unavailableReason, input, matrix, model?.projectionModelVersion ?? null)
  if (!isCompleteRawState(input.currentRaw) || !input.currentVisible) return allUnavailable('RAW_STATE_UNAVAILABLE', input, matrix, model?.projectionModelVersion ?? null)
  const features = coldFeatures(input)
  if (!features) return allUnavailable('PERSONALITY_UNAVAILABLE', input, matrix, model?.projectionModelVersion ?? null)
  if (features.continuousAge < PROJECTED_ROLE_VALIDATED_MIN_AGE || features.continuousAge >= PROJECTED_ROLE_VALIDATED_MAX_AGE_EXCLUSIVE) {
    return allUnavailable('OUTSIDE_VALIDATED_AGE_DOMAIN', input, matrix, model?.projectionModelVersion ?? null)
  }
  const currentRoleScore = scoreExactRoleMatrix(input.currentVisible, matrix)
  if (currentRoleScore === null) return allUnavailable('CURRENT_ROLE_SCORE_UNAVAILABLE', input, matrix, model?.projectionModelVersion ?? null)
  if (!model) {
    const result = allUnavailable('MODEL_ASSET_UNAVAILABLE', input, matrix, null)
    return { ...result, currentRoleScore }
  }

  const horizons = Object.fromEntries(PROJECTED_ROLE_HORIZONS.map(horizon => {
    const coldDelta = model.predictCold(horizon, features)
    if (!isCompleteRawDelta(coldDelta)) return [horizon, unavailableHorizon(horizon, 'MODEL_OUTPUT_INVALID')]

    const decision = historyDecision(model, horizon, features, input.history)
    const warnings = decision.warning ? [decision.warning] : []
    let predictedDelta = coldDelta
    let branch: ProjectionPredictionBranch = 'COLD_START'
    let alpha = 0
    if (decision.useHistory && input.history) {
      const historyDelta = model.predictHistory(horizon, features, input.history.ratePerYear)
      if (isCompleteRawDelta(historyDelta)) {
        alpha = PROJECTED_ROLE_HISTORY_ALPHA[horizon]
        predictedDelta = blendRawDelta(coldDelta, historyDelta, alpha)
        branch = 'HISTORY_AWARE'
      } else {
        warnings.push('Saída HISTORY_AWARE inválida; fallback exato para COLD_START.')
      }
    }

    const projectedRaw = futureRaw(input.currentRaw!, predictedDelta)
    const projectedAttributes = visibleAttributesFromRaw(projectedRaw)
    const projectedRoleScore = scoreExactRoleMatrix(projectedAttributes, matrix)
    if (projectedRoleScore === null) return [horizon, unavailableHorizon(horizon, 'ROLE_MATRIX_UNAVAILABLE', warnings)]
    const projectedRoleGain = projectedRoleScore - currentRoleScore
    const result: HorizonProjectionResult = {
      horizonMonths: horizon,
      status: 'AVAILABLE',
      projectedRoleScore,
      projectedRoleGain,
      predictionBranch: branch,
      alphaHistoryApplied: alpha,
      historySpanDays: input.history?.spanDays ?? null,
      historySupportStatus: decision.status,
      supportOverlapStatus: decision.overlap,
      predictedRawDelta: predictedDelta,
      projectedRaw,
      projectedVisible: rawVectorToVisibleMap(projectedRaw),
      reason: null,
      warnings,
    }
    return [horizon, result]
  })) as Record<ProjectionHorizon, HorizonProjectionResult>

  const available = PROJECTED_ROLE_HORIZONS.some(horizon => horizons[horizon].status === 'AVAILABLE')
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    engineVersion: PROJECTED_ROLE_ENGINE_VERSION,
    projectionModelVersion: model.projectionModelVersion,
    scoringModelVersion: matrix.scoringModelVersion,
    roleMatrixVersion: matrix.roleMatrixVersion,
    roleIdentity: matrix.roleIdentity,
    currentRoleScore,
    horizons,
    inputProvenanceStatus: input.inputProvenanceStatus,
    pointEstimateValidationStatus: matrix.custom ? 'EXPERIMENTAL_UNCALIBRATED' : 'PASS',
    predictionIntervalStatus: 'NOT_PRODUCT_CALIBRATED',
    externalTransportStatus: 'NOT_VALIDATED',
    unavailableReason: available ? null : 'MODEL_OUTPUT_INVALID',
    warnings: [...input.warnings],
  }
}

export function typicalPeakThrough24(result: ProjectedRoleScoreResult) {
  const p12 = result.horizons[12].projectedRoleScore
  const p24 = result.horizons[24].projectedRoleScore
  if (result.currentRoleScore === null || p12 === null || p24 === null) return null
  return Math.max(result.currentRoleScore, p12, p24)
}

export function expectedPeakThrough24(result: ProjectedRoleScoreResult, continuousAge: number | null, matrix: ExactRoleMatrix, residualModel: ExpectedPeakResidualModel | null): ExpectedPeakThrough24Result {
  const typical = typicalPeakThrough24(result)
  if (typical === null || continuousAge === null) return { typicalPeakThrough24: typical, expectedPeakThrough24: null, status: 'UNAVAILABLE', residualModelVersion: residualModel?.modelVersion ?? null, reason: 'POINT_ESTIMATES_UNAVAILABLE' }
  if (continuousAge < 20 || continuousAge >= 30) return { typicalPeakThrough24: typical, expectedPeakThrough24: null, status: 'UNAVAILABLE', residualModelVersion: residualModel?.modelVersion ?? null, reason: 'UNSUPPORTED_AGE_SLICE' }
  if (!residualModel) return { typicalPeakThrough24: typical, expectedPeakThrough24: null, status: 'UNAVAILABLE', residualModelVersion: null, reason: 'RESIDUAL_MODEL_UNAVAILABLE' }
  const ageBand = continuousAge < 24 ? '20-23' : '24-29'
  const residual = residualModel.residualMean({ ageBand, positionalGroup: matrix.positionalGroup, roleIdentity: matrix.roleIdentity, customMatrix: matrix.custom })
  if (!finite(residual)) return { typicalPeakThrough24: typical, expectedPeakThrough24: null, status: 'UNAVAILABLE', residualModelVersion: residualModel.modelVersion, reason: 'RESIDUAL_SUPPORT_UNAVAILABLE' }
  const current = result.currentRoleScore!
  const typicalGain = typical - current
  const expectedGain = Math.max(0, typicalGain + residual)
  return {
    typicalPeakThrough24: typical,
    expectedPeakThrough24: clamp(current + expectedGain, 1, 20),
    status: 'AVAILABLE',
    residualModelVersion: residualModel.modelVersion,
    reason: null,
  }
}
