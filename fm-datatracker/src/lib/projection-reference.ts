export const PROJECTION_MODEL_VERSION = '1.0'
export const PROJECTION_REFERENCE_VERSION = 'fm26-v1'
export const PROJECTION_EXPERIMENTAL_REFERENCE_ID = 'projection_reference_fm26_alpha1'

export type ProjectionScoreType = 'general' | 'function'
export type ProjectionReferenceMode = 'calibrated' | 'experimental-alpha1'

export type ProjectionCohortObservation = { age: number; score: number; cp: number }
export type ProjectionCohort = { scoreType: ProjectionScoreType; scoreKey: string; observations: ProjectionCohortObservation[] }
export type ProjectionGrowthBucket = { scoreType: ProjectionScoreType; scoreKey: string; ageStart: number; deltas: number[]; weights?: number[] }
export type ExperimentalGrowthCurve = { anchors: number[]; values: number[] }

export type ProjectionReference = {
  referenceVersion: string
  projectionModelVersion: string
  mode: ProjectionReferenceMode
  cohorts: ProjectionCohort[]
  growth: ProjectionGrowthBucket[]
  peakAges?: Record<string, number>
  generatedAt?: string
  calibrated: boolean
  sample?: { uniquePlayers?: number; transitions?: number }
  experimental?: {
    sourceId: string
    cpAdapter: 'absolute_scale_standin'
    functionProjectionMode: 'reuse_generic_delta_for_ui_test_only'
    curvesByIntegerAge: Record<number, ExperimentalGrowthCurve>
    persistResults: false
    observedRows: number
  }
}

export type ProjectionReferenceState =
  | { status: 'loading'; reference: null; detail: string }
  | { status: 'ready'; reference: ProjectionReference; detail: string }
  | { status: 'experimental'; reference: ProjectionReference; detail: string }
  | { status: 'missing'; reference: null; detail: string }
  | { status: 'invalid'; reference: null; detail: string }

function finite(value: unknown) { return typeof value === 'number' && Number.isFinite(value) }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }

export function validateProjectionReference(value: unknown): ProjectionReference | null {
  const raw = record(value)
  if (!raw) return null
  if (raw.referenceVersion !== PROJECTION_REFERENCE_VERSION || raw.projectionModelVersion !== PROJECTION_MODEL_VERSION) return null
  if (raw.calibrated !== true) return null
  const sampleRaw = record(raw.sample) ?? {}
  if (!finite(sampleRaw.uniquePlayers) || !finite(sampleRaw.transitions) || Number(sampleRaw.uniquePlayers) < 10_000 || Number(sampleRaw.transitions) < 50_000) return null
  if (!Array.isArray(raw.cohorts) || !Array.isArray(raw.growth) || !raw.cohorts.length || !raw.growth.length) return null

  const cohorts: ProjectionCohort[] = []
  for (const item of raw.cohorts) {
    const cohort = record(item)
    if (!cohort || (cohort.scoreType !== 'general' && cohort.scoreType !== 'function') || typeof cohort.scoreKey !== 'string' || !Array.isArray(cohort.observations)) return null
    const observations = cohort.observations.map(observation => {
      const entry = record(observation)
      return entry && finite(entry.age) && finite(entry.score) && finite(entry.cp) ? { age: entry.age as number, score: entry.score as number, cp: entry.cp as number } : null
    })
    if (observations.some(entry => entry === null)) return null
    cohorts.push({ scoreType: cohort.scoreType, scoreKey: cohort.scoreKey, observations: observations as ProjectionCohortObservation[] })
  }

  const growth: ProjectionGrowthBucket[] = []
  for (const item of raw.growth) {
    const bucket = record(item)
    if (!bucket || (bucket.scoreType !== 'general' && bucket.scoreType !== 'function') || typeof bucket.scoreKey !== 'string' || !finite(bucket.ageStart) || !Array.isArray(bucket.deltas) || !bucket.deltas.every(finite)) return null
    const weights = bucket.weights
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== bucket.deltas.length || !weights.every(finite))) return null
    growth.push({ scoreType: bucket.scoreType, scoreKey: bucket.scoreKey, ageStart: bucket.ageStart as number, deltas: bucket.deltas as number[], weights: weights as number[] | undefined })
  }

  const peakAgesRaw = record(raw.peakAges)
  const peakAges = peakAgesRaw ? Object.fromEntries(Object.entries(peakAgesRaw).filter(([, age]) => finite(age)).map(([key, age]) => [key, age as number])) : undefined
  return { referenceVersion: PROJECTION_REFERENCE_VERSION, projectionModelVersion: PROJECTION_MODEL_VERSION, mode: 'calibrated', cohorts, growth, peakAges, calibrated: true, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined, sample: raw.sample as ProjectionReference['sample'] }
}

export function validateExperimentalProjectionReference(value: unknown): ProjectionReference | null {
  const raw = record(value)
  if (!raw || raw.id !== PROJECTION_EXPERIMENTAL_REFERENCE_ID || raw.version !== 'alpha1' || raw.production_ready !== false || raw.accuracy_validated !== false) return null
  if (raw.score_scope !== 'generic_general_delta_proxy' || raw.function_projection_mode !== 'reuse_generic_delta_for_ui_test_only') return null
  const quantileModel = record(raw.quantile_model)
  const anchors = Array.isArray(quantileModel?.anchors) && quantileModel.anchors.every(finite) ? quantileModel.anchors as number[] : null
  if (!anchors || anchors.length < 2 || anchors[0] !== 0.167 || anchors[anchors.length - 1] !== 0.833) return null
  const cpAdapter = record(raw.cp_adapter_alpha)
  if (cpAdapter?.mode !== 'absolute_scale_standin_not_contextual_percentile') return null
  const peak = record(raw.peak_age)
  if (!finite(peak?.outfield) || !finite(peak?.goalkeeper)) return null
  const curvesRaw = record(raw.curves_by_integer_age)
  if (!curvesRaw) return null
  const curvesByIntegerAge: Record<number, ExperimentalGrowthCurve> = {}
  for (const [ageKey, value] of Object.entries(curvesRaw)) {
    const age = Number(ageKey)
    const curve = record(value)
    const q = record(curve?.q)
    if (!Number.isInteger(age) || !q) return null
    const values = anchors.map(anchor => q[String(anchor)])
    if (!values.every(finite)) return null
    curvesByIntegerAge[age] = { anchors: [...anchors], values: values as number[] }
  }
  if (!Object.keys(curvesByIntegerAge).length) return null
  const observations = record(raw.raw_partial_observations)
  const observedRows = observations ? Object.values(observations).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0) : 0
  return {
    referenceVersion: 'alpha1',
    projectionModelVersion: PROJECTION_MODEL_VERSION,
    mode: 'experimental-alpha1',
    calibrated: false,
    cohorts: [],
    growth: [],
    peakAges: {
      'general:OUTFIELD': peak!.outfield as number,
      'general:GK': peak!.goalkeeper as number,
    },
    experimental: {
      sourceId: PROJECTION_EXPERIMENTAL_REFERENCE_ID,
      cpAdapter: 'absolute_scale_standin',
      functionProjectionMode: 'reuse_generic_delta_for_ui_test_only',
      curvesByIntegerAge,
      persistResults: false,
      observedRows,
    },
  }
}

type JsonCandidate =
  | { status: 'ok'; value: unknown }
  | { status: 'missing'; value: null }
  | { status: 'invalid'; value: null }

async function fetchJson(path: string): Promise<JsonCandidate> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!response.ok) return { status: 'missing', value: null }
    const text = await response.text()
    try {
      return { status: 'ok', value: JSON.parse(text) as unknown }
    } catch {
      return { status: 'invalid', value: null }
    }
  } catch {
    return { status: 'missing', value: null }
  }
}

let cached: Promise<ProjectionReferenceState> | null = null
export function loadProjectionReference(): Promise<ProjectionReferenceState> {
  if (cached) return cached
  cached = (async () => {
    const calibratedCandidate = await fetchJson('reference/projection.fm26-v1.json')
    let calibratedInvalid = calibratedCandidate.status === 'invalid'
    if (calibratedCandidate.status === 'ok') {
      const calibrated = validateProjectionReference(calibratedCandidate.value)
      if (calibrated) return { status: 'ready', reference: calibrated, detail: `Referência ${calibrated.referenceVersion} carregada.` } as const
      calibratedInvalid = true
    }

    // A futura referência calibrada não pode bloquear a alpha. GitHub Pages pode
    // responder HTML de fallback para um asset ausente; tratamos cada candidato
    // de forma independente e seguimos normalmente para a referência seguinte.
    const alphaCandidate = await fetchJson('reference/projection.fm26-alpha1.json')
    if (alphaCandidate.status === 'ok') {
      const alpha = validateExperimentalProjectionReference(alphaCandidate.value)
      if (alpha) return { status: 'experimental', reference: alpha, detail: `Projeção experimental — referência alpha1 (${alpha.experimental?.observedRows ?? 0} observações parciais). Não validada para precisão.` } as const
      return { status: 'invalid', reference: null, detail: 'Projeções indisponíveis: a referência experimental alpha1 é inválida.' } as const
    }
    if (alphaCandidate.status === 'invalid') {
      return { status: 'invalid', reference: null, detail: 'Projeções indisponíveis: a referência experimental alpha1 não retornou JSON válido.' } as const
    }
    if (calibratedInvalid) {
      return { status: 'invalid', reference: null, detail: 'Projeções indisponíveis: a referência FM26 definitiva é inválida e a alpha1 não foi encontrada.' } as const
    }
    return { status: 'missing', reference: null, detail: 'Projeções indisponíveis: referência de desenvolvimento não carregada.' } as const
  })()
  return cached
}

export function resetProjectionReferenceCache() { cached = null }
