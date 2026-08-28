export const PROJECTION_REFERENCE_ID = 'projection_reference_fm26_v2_provisional'
export const PROJECTION_REFERENCE_VERSION = 'fm26-v2-provisional'
export const PROJECTION_MODEL_VERSION = '2.0-research'
export const PROJECTION_STATUS = 'provisional_longitudinal'
export const PROJECTION_REFERENCE_FILENAME = 'projection.fm26-v2-provisional.json'
export const PROJECTION_REFERENCE_PATH = `reference/${PROJECTION_REFERENCE_FILENAME}`
export const PROJECTION_SOURCE_SHA256 = 'cd5e9d85f411faa15eac7ca3bff89d9679491d588a4231814eb1c5c295f9917b'
export const PROJECTION_EXPECTED_OBSERVATIONS = 43_412
export const PROJECTION_EXPECTED_FUTURE_LINKS = 174_281

export type ProjectionScoreType = 'general' | 'function'
export type ProjectionReferenceMode = 'provisional-longitudinal'
export type ProjectionFamily = 'GK' | 'D' | 'WB' | 'DM' | 'M' | 'AM' | 'ST'

export type ProjectionObservation = {
  age: number
  score: number
  headroom: number
  intrinsicPeakGain: number
  family: ProjectionFamily
  saveUniverseId?: 'bayern' | 'numancia'
}

export type ProjectionReference = {
  id: typeof PROJECTION_REFERENCE_ID
  referenceVersion: typeof PROJECTION_REFERENCE_VERSION
  projectionModelVersion: typeof PROJECTION_MODEL_VERSION
  projectionStatus: typeof PROJECTION_STATUS
  mode: ProjectionReferenceMode
  calibrated: false
  sourceSha256: typeof PROJECTION_SOURCE_SHA256
  sample: {
    observations: number
    futureLinks: number
    byUniverse: { bayern: number; numancia: number }
    byFamily: Record<ProjectionFamily, number>
  }
  observations: ProjectionObservation[]
}

export type ProjectionReferenceState = {
  status: 'ready' | 'experimental' | 'missing' | 'invalid'
  reference: ProjectionReference | null
  detail: string
}

type UnknownRecord = Record<string, unknown>
const FAMILIES: ProjectionFamily[] = ['GK', 'D', 'WB', 'DM', 'M', 'AM', 'ST']
const EXPECTED_BY_FAMILY: Record<ProjectionFamily, number> = { GK: 4536, D: 8983, WB: 4039, DM: 2703, M: 5506, AM: 11557, ST: 6088 }
const EXPECTED_BY_UNIVERSE = { bayern: 33907, numancia: 9505 }

const record = (value: unknown): UnknownRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

function normalizeUniverse(value: unknown): 'bayern' | 'numancia' | undefined {
  const normalized = text(value)?.toLowerCase()
  return normalized === 'bayern' || normalized === 'numancia' ? normalized : undefined
}

function normalizeObservation(value: unknown): ProjectionObservation | null {
  const source = record(value)
  if (!source) return null
  const age = finite(source.age)
  const score = finite(source.score)
  const headroom = finite(source.headroom)
  const gain = finite(source.intrinsicPeakGain ?? source.intrinsic_peak_gain)
  const family = text(source.family)?.toUpperCase() as ProjectionFamily | undefined
  if (age === null || score === null || headroom === null || gain === null || !family || !FAMILIES.includes(family)) return null
  if (age < 0 || age > 100 || score < 1 || score > 20 || headroom < 0 || gain < 0 || score + gain > 20.000001) return null
  const saveUniverseId = normalizeUniverse(source.saveUniverseId ?? source.save_universe_id)
  if ((source.saveUniverseId != null || source.save_universe_id != null) && !saveUniverseId) return null
  return { age, score, headroom, intrinsicPeakGain: gain, family, ...(saveUniverseId ? { saveUniverseId } : {}) }
}

function inspectSample(observations: ProjectionObservation[]) {
  const byFamily = Object.fromEntries(FAMILIES.map(family => [family, 0])) as Record<ProjectionFamily, number>
  const byUniverse = { bayern: 0, numancia: 0 }
  for (const observation of observations) {
    byFamily[observation.family] += 1
    if (observation.saveUniverseId) byUniverse[observation.saveUniverseId] += 1
  }
  return { byFamily, byUniverse }
}

function exactExpectedPopulation(observations: ProjectionObservation[]) {
  if (observations.length !== PROJECTION_EXPECTED_OBSERVATIONS) return false
  const { byFamily, byUniverse } = inspectSample(observations)
  if (FAMILIES.some(family => byFamily[family] !== EXPECTED_BY_FAMILY[family])) return false
  return byUniverse.bayern === EXPECTED_BY_UNIVERSE.bayern && byUniverse.numancia === EXPECTED_BY_UNIVERSE.numancia
}

function buildReference(observations: ProjectionObservation[]): ProjectionReference {
  return {
    id: PROJECTION_REFERENCE_ID,
    referenceVersion: PROJECTION_REFERENCE_VERSION,
    projectionModelVersion: PROJECTION_MODEL_VERSION,
    projectionStatus: PROJECTION_STATUS,
    mode: 'provisional-longitudinal',
    calibrated: false,
    sourceSha256: PROJECTION_SOURCE_SHA256,
    sample: {
      observations: PROJECTION_EXPECTED_OBSERVATIONS,
      futureLinks: PROJECTION_EXPECTED_FUTURE_LINKS,
      byUniverse: { ...EXPECTED_BY_UNIVERSE },
      byFamily: { ...EXPECTED_BY_FAMILY },
    },
    observations,
  }
}

export function validateProjectionReference(value: unknown): ProjectionReference | null {
  let rawObservations: unknown[] | null = null
  if (Array.isArray(value)) rawObservations = value
  else {
    const source = record(value)
    if (!source) return null
    if (source.id !== PROJECTION_REFERENCE_ID || source.referenceVersion !== PROJECTION_REFERENCE_VERSION || source.projectionModelVersion !== PROJECTION_MODEL_VERSION || source.projectionStatus !== PROJECTION_STATUS || source.calibrated !== false) return null
    rawObservations = Array.isArray(source.observations) ? source.observations : null
  }
  if (!rawObservations || rawObservations.length !== PROJECTION_EXPECTED_OBSERVATIONS) return null
  const observations: ProjectionObservation[] = []
  for (const value of rawObservations) {
    const observation = normalizeObservation(value)
    if (!observation) return null
    observations.push(observation)
  }
  if (!exactExpectedPopulation(observations)) return null
  return buildReference(observations)
}

export function projectionReferenceUrl(baseUrl = import.meta.env.BASE_URL) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${base}${PROJECTION_REFERENCE_PATH}`
}

export async function sha256Hex(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto indisponível')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

let cachedPromise: Promise<ProjectionReferenceState> | null = null

async function fetchReference() {
  const response = await fetch(projectionReferenceUrl(), { cache: 'force-cache' })
  if (!response.ok) return { kind: 'missing' as const, value: null }
  const bytes = await response.arrayBuffer()
  if (!bytes.byteLength) return { kind: 'invalid' as const, value: null }
  const hash = await sha256Hex(bytes)
  if (hash !== PROJECTION_SOURCE_SHA256) return { kind: 'invalid' as const, value: null }
  const sourceText = new TextDecoder().decode(bytes)
  if (!sourceText.trim() || /^\s*</.test(sourceText)) return { kind: 'invalid' as const, value: null }
  try { return { kind: 'ok' as const, value: JSON.parse(sourceText) as unknown } }
  catch { return { kind: 'invalid' as const, value: null } }
}

export function resetProjectionReferenceCache() { cachedPromise = null }

export function loadProjectionReference(): Promise<ProjectionReferenceState> {
  if (cachedPromise) return cachedPromise
  cachedPromise = (async () => {
    try {
      const loaded = await fetchReference()
      if (loaded.kind === 'missing') return { status: 'missing', reference: null, detail: 'Projection v2.1 indisponível: referência longitudinal não encontrada.' } as ProjectionReferenceState
      if (loaded.kind === 'invalid') return { status: 'invalid', reference: null, detail: 'Projection v2.1 indisponível: asset longitudinal inválido ou com SHA-256 divergente.' } as ProjectionReferenceState
      const reference = validateProjectionReference(loaded.value)
      if (!reference) return { status: 'invalid', reference: null, detail: 'Projection v2.1 indisponível: o asset não corresponde ao corpus longitudinal auditado.' } as ProjectionReferenceState
      return {
        status: 'experimental',
        reference,
        detail: `Projection v2.1 provisória · ${reference.sample.observations.toLocaleString('pt-BR')} observações longitudinais · não calibrada`,
      } as ProjectionReferenceState
    } catch {
      return { status: 'missing', reference: null, detail: 'Projection v2.1 indisponível: não foi possível carregar ou verificar a referência longitudinal.' } as ProjectionReferenceState
    }
  })()
  return cachedPromise
}
