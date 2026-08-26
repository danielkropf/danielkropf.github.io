export const PROJECTION_MODEL_VERSION = '1.0'
export const PROJECTION_REFERENCE_VERSION = 'fm26-v1'

export type ProjectionScoreType = 'general' | 'function'

export type ProjectionCohortObservation = {
  age: number
  score: number
  cp: number
}

export type ProjectionCohort = {
  scoreType: ProjectionScoreType
  scoreKey: string
  observations: ProjectionCohortObservation[]
}

export type ProjectionGrowthBucket = {
  scoreType: ProjectionScoreType
  scoreKey: string
  ageStart: number
  deltas: number[]
  weights?: number[]
}

export type ProjectionReference = {
  referenceVersion: string
  projectionModelVersion: string
  cohorts: ProjectionCohort[]
  growth: ProjectionGrowthBucket[]
  peakAges?: Record<string, number>
  generatedAt?: string
  calibrated: boolean
  sample?: { uniquePlayers?: number; transitions?: number }
}

export type ProjectionReferenceState =
  | { status: 'loading'; reference: null; detail: string }
  | { status: 'ready'; reference: ProjectionReference; detail: string }
  | { status: 'missing'; reference: null; detail: string }
  | { status: 'invalid'; reference: null; detail: string }

function finite(value: unknown) { return typeof value === 'number' && Number.isFinite(value) }

export function validateProjectionReference(value: unknown): ProjectionReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.referenceVersion !== PROJECTION_REFERENCE_VERSION || raw.projectionModelVersion !== PROJECTION_MODEL_VERSION) return null
  if (raw.calibrated !== true) return null
  const sampleRaw = raw.sample && typeof raw.sample === 'object' && !Array.isArray(raw.sample) ? raw.sample as Record<string, unknown> : {}
  if (!finite(sampleRaw.uniquePlayers) || !finite(sampleRaw.transitions) || Number(sampleRaw.uniquePlayers) < 10_000 || Number(sampleRaw.transitions) < 50_000) return null
  if (!Array.isArray(raw.cohorts) || !Array.isArray(raw.growth) || !raw.cohorts.length || !raw.growth.length) return null

  const cohorts: ProjectionCohort[] = []
  for (const item of raw.cohorts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const cohort = item as Record<string, unknown>
    if ((cohort.scoreType !== 'general' && cohort.scoreType !== 'function') || typeof cohort.scoreKey !== 'string' || !Array.isArray(cohort.observations)) return null
    const observations = cohort.observations.map(observation => {
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null
      const entry = observation as Record<string, unknown>
      return finite(entry.age) && finite(entry.score) && finite(entry.cp)
        ? { age: entry.age as number, score: entry.score as number, cp: entry.cp as number }
        : null
    })
    if (observations.some(entry => entry === null)) return null
    cohorts.push({ scoreType: cohort.scoreType, scoreKey: cohort.scoreKey, observations: observations as ProjectionCohortObservation[] })
  }

  const growth: ProjectionGrowthBucket[] = []
  for (const item of raw.growth) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const bucket = item as Record<string, unknown>
    if ((bucket.scoreType !== 'general' && bucket.scoreType !== 'function') || typeof bucket.scoreKey !== 'string' || !finite(bucket.ageStart) || !Array.isArray(bucket.deltas) || !bucket.deltas.every(finite)) return null
    const weights = bucket.weights
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== bucket.deltas.length || !weights.every(finite))) return null
    growth.push({ scoreType: bucket.scoreType, scoreKey: bucket.scoreKey, ageStart: bucket.ageStart as number, deltas: bucket.deltas as number[], weights: weights as number[] | undefined })
  }

  const peakAges = raw.peakAges && typeof raw.peakAges === 'object' && !Array.isArray(raw.peakAges)
    ? Object.fromEntries(Object.entries(raw.peakAges as Record<string, unknown>).filter(([, age]) => finite(age)).map(([key, age]) => [key, age as number]))
    : undefined

  return {
    referenceVersion: PROJECTION_REFERENCE_VERSION,
    projectionModelVersion: PROJECTION_MODEL_VERSION,
    cohorts,
    growth,
    peakAges,
    calibrated: true,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    sample: raw.sample && typeof raw.sample === 'object' && !Array.isArray(raw.sample) ? raw.sample as ProjectionReference['sample'] : undefined,
  }
}

let cached: Promise<ProjectionReferenceState> | null = null

export function loadProjectionReference(): Promise<ProjectionReferenceState> {
  if (cached) return cached
  cached = fetch(`${import.meta.env.BASE_URL}reference/projection.fm26-v1.json`, { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) return { status: 'missing', reference: null, detail: 'Projeções indisponíveis: referência de desenvolvimento não carregada.' } as const
      const parsed = validateProjectionReference(await response.json())
      return parsed
        ? { status: 'ready', reference: parsed, detail: `Referência ${parsed.referenceVersion} carregada.` } as const
        : { status: 'invalid', reference: null, detail: 'Projeções indisponíveis: a referência FM26 não está calibrada ou não corresponde ao Projection Model v1.0.' } as const
    })
    .catch(() => ({ status: 'missing', reference: null, detail: 'Projeções indisponíveis: referência de desenvolvimento não carregada.' } as const))
  return cached
}

export function resetProjectionReferenceCache() { cached = null }
