import type { ProjectionReference, ProjectionScoreType } from './projection-reference'

export const Q_LOW = 0.167
export const Q_HIGH = 0.833
export const MDI_NEUTRAL = 0.58421

export type ProjectionStatus = 'ok' | 'missing_cp' | 'missing_score' | 'missing_reference' | 'missing_age' | 'peak_reached' | 'unsupported_position'
export type PersonalitySource = 'exact' | 'inferred' | 'neutral'

export type ProjectionInput = {
  currentScore: number | null
  cp: number | null
  birthDate: string | null
  snapshotDate: string | null
  professionalism?: number | null
  ambition?: number | null
  determination?: number | null
  personalitySource?: PersonalitySource
  scoreType: ProjectionScoreType
  scoreKey: string
  eligible?: boolean
  reference: ProjectionReference | null
  historyPercentile?: number | null
}

export type ProjectionResult = {
  referenceMode: 'calibrated' | 'experimental-alpha1' | null
  projectedScore: number | null
  status: ProjectionStatus
  modelVersion: string
  referenceVersion: string | null
  exactAge: number | null
  peakAge: number | null
  cpPercentile: number | null
  effectiveSample: number | null
  mdi: number | null
  personalityShift: number
  historyShift: number
  trajectoryQuantile: number | null
  personalitySource: PersonalitySource
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const validTrait = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 20 ? value : null

export function exactAgeYears(birthDate: string | null, snapshotDate: string | null): number | null {
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

export function personalityShift(mdi: number) { return clamp(0.30 * (mdi - MDI_NEUTRAL), -0.15, 0.15) }
export function historyShift(percentile: number | null | undefined) { return percentile == null ? 0 : clamp(0.20 * (clamp(percentile, 0, 1) - 0.5), -0.10, 0.10) }

export function effectiveSample(weights: number[]) {
  const sum = weights.reduce((total, value) => total + value, 0)
  const squared = weights.reduce((total, value) => total + value * value, 0)
  return squared > 0 ? sum * sum / squared : 0
}

export function contextualCpPercentile(observations: Array<{ age: number; score: number; cp: number }>, age: number, score: number, cp: number) {
  if (!observations.length) return null
  let ageBandwidth = 1.5
  let scoreBandwidth = 1.0
  let weights: number[] = []
  let nEff = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    weights = observations.map(item => {
      const d2 = ((item.age - age) / ageBandwidth) ** 2 + ((item.score - score) / scoreBandwidth) ** 2
      return Math.exp(-0.5 * d2)
    })
    nEff = effectiveSample(weights)
    if (nEff >= 200) break
    ageBandwidth *= 1.25
    scoreBandwidth *= 1.25
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return null
  let below = 0
  let equal = 0
  observations.forEach((item, index) => {
    if (item.cp < cp) below += weights[index]
    else if (item.cp === cp) equal += weights[index]
  })
  return { percentile: clamp((below + 0.5 * equal) / total, 0, 1), effectiveSample: nEff }
}

export function weightedQuantile(values: number[], quantile: number, weights?: number[]) {
  if (!values.length) return null
  const rows = values.map((value, index) => ({ value, weight: Math.max(0, weights?.[index] ?? 1) })).filter(row => Number.isFinite(row.value) && row.weight > 0).sort((a, b) => a.value - b.value)
  if (!rows.length) return null
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const target = clamp(quantile, 0, 1) * total
  let cumulative = 0
  for (const row of rows) { cumulative += row.weight; if (cumulative >= target) return row.value }
  return rows[rows.length - 1].value
}

function peakAgeFor(input: ProjectionInput) {
  const custom = input.reference?.peakAges?.[`${input.scoreType}:${input.scoreKey}`]
  if (typeof custom === 'number' && Number.isFinite(custom)) return custom
  if (input.scoreType === 'general') return input.scoreKey === 'GK' ? 28 : 26
  return 26
}

function empty(input: ProjectionInput, status: ProjectionStatus, exactAge: number | null = null, peakAge: number | null = null): ProjectionResult {
  return { projectedScore: null, status, modelVersion: '1.0', referenceVersion: input.reference?.referenceVersion ?? null, referenceMode: input.reference?.mode ?? null, exactAge, peakAge, cpPercentile: null, effectiveSample: null, mdi: null, personalityShift: 0, historyShift: 0, trajectoryQuantile: null, personalitySource: input.personalitySource ?? 'neutral' }
}

function interpolateAnchoredGrowth(anchors: number[], values: number[], quantile: number) {
  if (anchors.length !== values.length || anchors.length < 2) return null
  const q = clamp(quantile, anchors[0], anchors[anchors.length - 1])
  if (q <= anchors[0]) return values[0]
  for (let index = 1; index < anchors.length; index += 1) {
    if (q > anchors[index]) continue
    const leftQ = anchors[index - 1], rightQ = anchors[index]
    const leftValue = values[index - 1], rightValue = values[index]
    if (![leftQ, rightQ, leftValue, rightValue].every(Number.isFinite)) return null
    const ratio = rightQ === leftQ ? 0 : (q - leftQ) / (rightQ - leftQ)
    return leftValue + (rightValue - leftValue) * ratio
  }
  return values[values.length - 1]
}

export function projectScore(input: ProjectionInput): ProjectionResult {
  if (input.currentScore == null || !Number.isFinite(input.currentScore)) return empty(input, 'missing_score')
  if (input.eligible === false) return empty(input, 'unsupported_position')
  if (input.cp == null || !Number.isFinite(input.cp)) return empty(input, 'missing_cp')
  if (!input.reference) return empty(input, 'missing_reference')
  const exactAge = exactAgeYears(input.birthDate, input.snapshotDate)
  if (exactAge == null) return empty(input, 'missing_age')
  const peakAge = peakAgeFor(input)
  if (exactAge >= peakAge) return empty(input, 'peak_reached', exactAge, peakAge)

  const experimental = input.reference.mode === 'experimental-alpha1' ? input.reference.experimental : null
  let cpSignal: number
  let cpPercentile: number | null = null
  let effectiveSampleValue: number | null = null
  if (experimental?.cpAdapter === 'absolute_scale_standin') {
    cpSignal = clamp((input.cp - 1) / 199, 0, 1)
  } else {
    const cohort = input.reference.cohorts.find(item => item.scoreType === input.scoreType && item.scoreKey === input.scoreKey)
    if (!cohort?.observations.length) return empty(input, 'missing_reference', exactAge, peakAge)
    const cpContext = contextualCpPercentile(cohort.observations, exactAge, input.currentScore, input.cp)
    if (!cpContext) return empty(input, 'missing_reference', exactAge, peakAge)
    cpSignal = cpContext.percentile
    cpPercentile = cpContext.percentile
    effectiveSampleValue = cpContext.effectiveSample
  }

  const pro = validTrait(input.professionalism) ?? 10
  const amb = validTrait(input.ambition) ?? 10
  const det = validTrait(input.determination) ?? 10
  const mdi = mentalDevelopmentIndex(pro, amb, det)
  const pShift = personalityShift(mdi)
  const hShift = historyShift(input.historyPercentile)
  const qBase = Q_LOW + (Q_HIGH - Q_LOW) * cpSignal
  const quantile = clamp(qBase + pShift + hShift, Q_LOW, Q_HIGH)

  let projection = input.currentScore
  const firstAge = Math.floor(exactAge)
  const fractional = exactAge - firstAge
  const firstFactor = fractional < 1e-9 ? 1 : 1 - fractional
  for (let ageStart = firstAge; ageStart < Math.ceil(peakAge); ageStart += 1) {
    if (ageStart >= peakAge) break
    let growth: number | null
    if (experimental) {
      const curve = experimental.curvesByIntegerAge[ageStart]
      growth = curve ? interpolateAnchoredGrowth(curve.anchors, curve.values, quantile) : null
    } else {
      const bucket = input.reference.growth.find(item => item.scoreType === input.scoreType && item.scoreKey === input.scoreKey && item.ageStart === ageStart)
      growth = bucket?.deltas.length ? weightedQuantile(bucket.deltas, quantile, bucket.weights) : null
    }
    if (growth == null) return empty(input, 'missing_reference', exactAge, peakAge)
    const intervalEnd = Math.min(ageStart + 1, peakAge)
    const factor = ageStart === firstAge ? Math.min(firstFactor, intervalEnd - exactAge) : intervalEnd - ageStart
    projection += growth * Math.max(0, factor)
  }
  projection = Math.min(20, Math.max(input.currentScore, projection))

  return {
    projectedScore: Math.round(projection * 100) / 100,
    status: 'ok',
    modelVersion: '1.0',
    referenceVersion: input.reference.referenceVersion,
    referenceMode: input.reference.mode,
    exactAge,
    peakAge,
    cpPercentile,
    effectiveSample: effectiveSampleValue,
    mdi,
    personalityShift: pShift,
    historyShift: hShift,
    trajectoryQuantile: quantile,
    personalitySource: input.personalitySource ?? (validTrait(input.professionalism) && validTrait(input.ambition) && validTrait(input.determination) ? 'exact' : 'neutral'),
  }
}
