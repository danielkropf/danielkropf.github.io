import {
  PROJECTION_MODEL_VERSION,
  type ProjectionFamily,
  type ProjectionObservation,
  type ProjectionReference,
  type ProjectionReferenceMode,
  type ProjectionScoreType,
} from './projection-reference'

export const Q_LOW = 0.167
export const Q_HIGH = 0.833
export const MDI_NEUTRAL = 0.58421
export const INITIAL_AGE_BANDWIDTH = 1.5
export const INITIAL_SCORE_BANDWIDTH = 1.0
export const BANDWIDTH_EXPANSION = 1.25
export const TARGET_EFFECTIVE_SAMPLE = 200

export type PersonalitySource = 'exact' | 'neutral'
export type ProjectionStatus =
  | 'ok'
  | 'missing_score'
  | 'missing_reference'
  | 'missing_age'
  | 'missing_ca'
  | 'missing_pa'
  | 'missing_family'
  | 'unsupported_position'
  | 'unsupported_score_type'
  | 'insufficient_reference'

export type ProjectionInput = {
  currentScore: number | null
  birthDate: string | null
  snapshotDate: string
  ca: number | null
  pa: number | null
  professionalism?: number | null
  ambition?: number | null
  determination?: number | null
  personalitySource?: PersonalitySource
  scoreType: ProjectionScoreType
  scoreKey: string
  family: ProjectionFamily | null
  eligible?: boolean
  reference: ProjectionReference | null
}

export type ProjectionResult = {
  status: ProjectionStatus
  projectedScore: number | null
  modelVersion: string
  referenceVersion: string | null
  referenceMode: ProjectionReferenceMode | null
  exactAge: number | null
  peakAge: null
  cpPercentile: null
  headroom: number | null
  headroomPercentile: number | null
  mdi: number | null
  personalityShift: number
  historyShift: 0
  baseQuantile: number | null
  trajectoryQuantile: number | null
  expectedIntrinsicPeakGain: number | null
  cohortCount: number
  referenceEffectiveSample: number
  referenceScope: string | null
  referenceFallbackLevel: number | null
  personalitySource: PersonalitySource
}

type WeightedObservation = { observation: ProjectionObservation; weight: number }
type ContextualCohort = {
  rows: WeightedObservation[]
  effectiveSample: number
  scope: string
  fallbackLevel: number
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

export function exactAgeYears(birthDate: string | null | undefined, snapshotDate: string | null | undefined) {
  if (!birthDate || !snapshotDate) return null
  const birth = new Date(`${birthDate}T00:00:00Z`).getTime()
  const snapshot = new Date(`${snapshotDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(birth) || !Number.isFinite(snapshot) || snapshot < birth) return null
  return (snapshot - birth) / 86_400_000 / 365.2425
}

export function saturatedTrait(value: number) {
  const x = clamp(value, 1, 20)
  return x <= 10 ? 0.75 * (x - 1) / 9 : 0.75 + 0.25 * (x - 10) / 10
}

export function mentalDevelopmentIndex(professionalism: number, ambition: number, determination: number) {
  const p = (clamp(professionalism, 1, 20) - 1) / 19
  return clamp(0.60 * p + 0.20 * saturatedTrait(ambition) + 0.20 * saturatedTrait(determination), 0, 1)
}

export function personalityShift(mdi: number) {
  return clamp(0.30 * (mdi - MDI_NEUTRAL), -0.15, 0.15)
}

/** History no longer shifts the peak quantile in Projection v2.1. Kept as a compatibility export. */
export function historyShift(_percentile: number | null | undefined) { return 0 }

export function effectiveSampleSize(weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0)
  const squares = weights.reduce((sum, value) => sum + value * value, 0)
  return total > 0 && squares > 0 ? total * total / squares : 0
}

function gaussianWeight(observation: ProjectionObservation, age: number, score: number, ageBandwidth: number, scoreBandwidth: number) {
  const da = (observation.age - age) / ageBandwidth
  const ds = (observation.score - score) / scoreBandwidth
  return Math.exp(-0.5 * (da * da + ds * ds))
}

function weightedRows(population: ProjectionObservation[], age: number, score: number, ageBandwidth: number, scoreBandwidth: number) {
  return population.map(observation => ({ observation, weight: gaussianWeight(observation, age, score, ageBandwidth, scoreBandwidth) })).filter(row => row.weight > 1e-12)
}

function expandedCohort(population: ProjectionObservation[], age: number, score: number, scope: string, fallbackLevel: number): ContextualCohort | null {
  if (!population.length) return null
  let ageBandwidth = INITIAL_AGE_BANDWIDTH
  let scoreBandwidth = INITIAL_SCORE_BANDWIDTH
  const maxAgeDistance = Math.max(INITIAL_AGE_BANDWIDTH, ...population.map(row => Math.abs(row.age - age)))
  const maxScoreDistance = Math.max(INITIAL_SCORE_BANDWIDTH, ...population.map(row => Math.abs(row.score - score)))
  let rows = weightedRows(population, age, score, ageBandwidth, scoreBandwidth)
  let effectiveSample = effectiveSampleSize(rows.map(row => row.weight))

  // Expand exactly as specified. The data range itself is the natural expansion limit.
  while (effectiveSample < TARGET_EFFECTIVE_SAMPLE && (ageBandwidth < maxAgeDistance || scoreBandwidth < maxScoreDistance)) {
    ageBandwidth *= BANDWIDTH_EXPANSION
    scoreBandwidth *= BANDWIDTH_EXPANSION
    rows = weightedRows(population, age, score, ageBandwidth, scoreBandwidth)
    effectiveSample = effectiveSampleSize(rows.map(row => row.weight))
  }
  return { rows, effectiveSample, scope, fallbackLevel }
}

export function contextualCohort(reference: ProjectionReference, family: ProjectionFamily, age: number, score: number): ContextualCohort | null {
  const exact = expandedCohort(reference.observations.filter(row => row.family === family), age, score, `family:${family}`, 0)
  if (exact && exact.effectiveSample >= TARGET_EFFECTIVE_SAMPLE) return exact

  // A goalkeeper is not mixed with outfield players. For outfield families, the only broad fallback is the
  // audited outfield corpus; this is explicit in the returned scope/fallback metadata.
  if (family !== 'GK') {
    const broad = expandedCohort(reference.observations.filter(row => row.family !== 'GK'), age, score, 'outfield:all', 1)
    if (broad && broad.effectiveSample >= TARGET_EFFECTIVE_SAMPLE) return broad
    if (broad && (!exact || broad.effectiveSample > exact.effectiveSample)) return broad
  }
  return exact
}

export function contextualHeadroomPercentile(rows: WeightedObservation[], headroom: number) {
  let below = 0
  let tied = 0
  let total = 0
  for (const { observation, weight } of rows) {
    total += weight
    if (observation.headroom < headroom) below += weight
    else if (observation.headroom === headroom) tied += weight
  }
  return total > 0 ? clamp((below + 0.5 * tied) / total, 0, 1) : null
}

export function weightedQuantile(values: number[], q: number, weights?: number[]) {
  if (!values.length) return null
  const pairs = values.map((value, index) => ({ value, weight: Math.max(0, weights?.[index] ?? 1) })).filter(item => Number.isFinite(item.value) && item.weight > 0).sort((a, b) => a.value - b.value)
  if (!pairs.length) return null
  const total = pairs.reduce((sum, item) => sum + item.weight, 0)
  const target = clamp(q, 0, 1) * total
  let cumulative = 0
  for (const item of pairs) {
    cumulative += item.weight
    if (cumulative >= target) return item.value
  }
  return pairs[pairs.length - 1].value
}

function baseResult(input: ProjectionInput, status: ProjectionStatus, exactAge: number | null, personalitySource: PersonalitySource): ProjectionResult {
  return {
    status,
    projectedScore: null,
    modelVersion: PROJECTION_MODEL_VERSION,
    referenceVersion: input.reference?.referenceVersion ?? null,
    referenceMode: input.reference?.mode ?? null,
    exactAge,
    peakAge: null,
    cpPercentile: null,
    headroom: finite(input.ca) && finite(input.pa) ? Math.max(0, input.pa - input.ca) : null,
    headroomPercentile: null,
    mdi: null,
    personalityShift: 0,
    historyShift: 0,
    baseQuantile: null,
    trajectoryQuantile: null,
    expectedIntrinsicPeakGain: null,
    cohortCount: 0,
    referenceEffectiveSample: 0,
    referenceScope: null,
    referenceFallbackLevel: null,
    personalitySource,
  }
}

export function projectScore(input: ProjectionInput): ProjectionResult {
  const personalitySource: PersonalitySource = input.personalitySource === 'exact' ? 'exact' : 'neutral'
  const exactAge = exactAgeYears(input.birthDate, input.snapshotDate)
  if (input.eligible === false) return baseResult(input, 'unsupported_position', exactAge, personalitySource)
  if (input.scoreType !== 'general') return baseResult(input, 'unsupported_score_type', exactAge, personalitySource)
  if (!finite(input.currentScore)) return baseResult(input, 'missing_score', exactAge, personalitySource)
  if (!input.reference) return baseResult(input, 'missing_reference', exactAge, personalitySource)
  if (exactAge === null) return baseResult(input, 'missing_age', null, personalitySource)
  if (!finite(input.ca)) return baseResult(input, 'missing_ca', exactAge, personalitySource)
  if (!finite(input.pa)) return baseResult(input, 'missing_pa', exactAge, personalitySource)
  if (!input.family) return baseResult(input, 'missing_family', exactAge, personalitySource)

  const headroom = Math.max(0, input.pa - input.ca)
  const cohort = contextualCohort(input.reference, input.family, exactAge, input.currentScore)
  if (!cohort || !cohort.rows.length || cohort.effectiveSample <= 0) return baseResult(input, 'insufficient_reference', exactAge, personalitySource)

  const headroomPercentile = contextualHeadroomPercentile(cohort.rows, headroom)
  if (headroomPercentile === null) return baseResult(input, 'insufficient_reference', exactAge, personalitySource)
  const baseQuantile = Q_LOW + (Q_HIGH - Q_LOW) * headroomPercentile

  const exactPersonality = finite(input.professionalism) && finite(input.ambition) && finite(input.determination)
  const mdi = exactPersonality
    ? mentalDevelopmentIndex(input.professionalism as number, input.ambition as number, input.determination as number)
    : MDI_NEUTRAL
  const shift = exactPersonality ? personalityShift(mdi) : 0
  const trajectoryQuantile = clamp(baseQuantile + shift, Q_LOW, Q_HIGH)
  const gain = weightedQuantile(
    cohort.rows.map(row => row.observation.intrinsicPeakGain),
    trajectoryQuantile,
    cohort.rows.map(row => row.weight),
  )
  if (gain === null) return baseResult(input, 'insufficient_reference', exactAge, personalitySource)
  const expectedIntrinsicPeakGain = Math.max(0, gain)
  const projectedScore = clamp(Math.max(input.currentScore, input.currentScore + expectedIntrinsicPeakGain), input.currentScore, 20)

  return {
    status: 'ok',
    projectedScore,
    modelVersion: PROJECTION_MODEL_VERSION,
    referenceVersion: input.reference.referenceVersion,
    referenceMode: input.reference.mode,
    exactAge,
    peakAge: null,
    cpPercentile: null,
    headroom,
    headroomPercentile,
    mdi,
    personalityShift: shift,
    historyShift: 0,
    baseQuantile,
    trajectoryQuantile,
    expectedIntrinsicPeakGain,
    cohortCount: cohort.rows.length,
    referenceEffectiveSample: cohort.effectiveSample,
    referenceScope: cohort.scope,
    referenceFallbackLevel: cohort.fallbackLevel,
    personalitySource: exactPersonality ? 'exact' : 'neutral',
  }
}

export type DevelopmentPaceInput = {
  days: number
  currentCa?: number | null
  previousCa?: number | null
  currentVisibleBaseScore?: number | null
  previousVisibleBaseScore?: number | null
  currentLatentBaseScore?: number | null
  previousLatentBaseScore?: number | null
}

export type DevelopmentPace = {
  days: number
  recentCaAnnualized: number | null
  recentVisibleBaseRate: number | null
  recentLatentBaseRate: number | null
}

function annualized(current: number | null | undefined, previous: number | null | undefined, days: number) {
  return finite(current) && finite(previous) && days >= 90 ? (current - previous) * 365.2425 / days : null
}

/** Separate short-term development signals. They deliberately do not alter Peak Projection v2.1. */
export function developmentPace(input: DevelopmentPaceInput): DevelopmentPace | null {
  if (!Number.isFinite(input.days) || input.days < 90) return null
  return {
    days: input.days,
    recentCaAnnualized: annualized(input.currentCa, input.previousCa, input.days),
    recentVisibleBaseRate: annualized(input.currentVisibleBaseScore, input.previousVisibleBaseScore, input.days),
    recentLatentBaseRate: annualized(input.currentLatentBaseScore, input.previousLatentBaseScore, input.days),
  }
}
