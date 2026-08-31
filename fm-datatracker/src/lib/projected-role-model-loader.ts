import {
  PROJECTED_ROLE_OUTPUT_KEYS,
  validateProjectedRoleModelAssetMetadata,
  type ProjectedRoleModelAssetMetadata,
  type ProjectedRoleModelProvider,
} from './projected-role-model-contract'
import {
  PROJECTED_ROLE_HISTORY_MIN_CALIBRATION_N,
  type ColdProjectionFeatures,
  type ProjectionHorizon,
  type RawAttributeVector,
} from './projected-role-score'
import { parseProjectedRoleForest, predictProjectedRoleForest, type ProjectedRoleForest } from './projected-role-forest-binary'

export const PROJECTED_ROLE_FOREST_MANIFEST_SCHEMA = 'fm-datatracker-projected-role-forest-manifest-v1'

export const PROJECTED_ROLE_COLD_FEATURE_KEYS = [
  'continuousAge',
  'currentAbility',
  'potentialAbility',
  'headroom',
  'professionalism',
  'ambition',
  'determination',
] as const

export type ProjectedRoleAgeBand = '16-19' | '20-23' | '24-29'

export type ProjectedRoleForestFile = {
  file: string
  sha256: string
  treeCount: number
  outputCount: number
  featureCount: number
  leafCodec: 0 | 1 | 2
}

export type ProjectedRoleForestManifest = {
  schemaVersion: typeof PROJECTED_ROLE_FOREST_MANIFEST_SCHEMA
  metadata: ProjectedRoleModelAssetMetadata
  forests: Record<string, { cold: ProjectedRoleForestFile; history: ProjectedRoleForestFile }>
  historyCalibrationN: Record<string, Record<ProjectedRoleAgeBand, number>>
  notes?: string[]
}

export type LoadedProjectedRoleModel = {
  manifest: ProjectedRoleForestManifest
  provider: ProjectedRoleModelProvider
}

type FetchLike = typeof fetch

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function ageBand(age: number): ProjectedRoleAgeBand | null {
  if (age >= 16 && age < 20) return '16-19'
  if (age >= 20 && age < 24) return '20-23'
  if (age >= 24 && age < 30) return '24-29'
  return null
}

function coldVector(features: ColdProjectionFeatures) {
  return PROJECTED_ROLE_COLD_FEATURE_KEYS.map(key => features[key])
}

function historyVector(features: ColdProjectionFeatures, historyRatePerYear: RawAttributeVector) {
  return [...coldVector(features), ...PROJECTED_ROLE_OUTPUT_KEYS.map(key => historyRatePerYear[key])]
}

function outputVector(values: ArrayLike<number>): RawAttributeVector | null {
  if (values.length !== PROJECTED_ROLE_OUTPUT_KEYS.length) return null
  const out: RawAttributeVector = {}
  for (let index = 0; index < PROJECTED_ROLE_OUTPUT_KEYS.length; index += 1) {
    const value = values[index]
    if (!finite(value)) return null
    out[PROJECTED_ROLE_OUTPUT_KEYS[index]] = value
  }
  return out
}

function hex(bytes: Uint8Array) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto indisponível para validar asset ProjectedRole.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return hex(new Uint8Array(digest))
}

function validateForestAgainstManifest(forest: ProjectedRoleForest, file: ProjectedRoleForestFile, expectedFeatureCount: number) {
  if (forest.treeCount !== file.treeCount || forest.treeCount !== 480) throw new Error(`ProjectedRole forest treeCount inválido: ${forest.treeCount}.`)
  if (forest.outputCount !== file.outputCount || forest.outputCount !== PROJECTED_ROLE_OUTPUT_KEYS.length) throw new Error(`ProjectedRole forest outputCount inválido: ${forest.outputCount}.`)
  if (forest.featureCount !== file.featureCount || forest.featureCount !== expectedFeatureCount) throw new Error(`ProjectedRole forest featureCount inválido: ${forest.featureCount}.`)
  if (forest.leafCodec !== file.leafCodec) throw new Error(`ProjectedRole forest leafCodec divergente: ${forest.leafCodec}.`)
}

async function fetchForest(manifestUrl: string, file: ProjectedRoleForestFile, expectedFeatureCount: number, fetcher: FetchLike) {
  const url = new URL(file.file, manifestUrl).toString()
  const response = await fetcher(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Falha ao carregar ProjectedRole forest (${response.status}): ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = await sha256(bytes)
  if (digest.toLowerCase() !== file.sha256.toLowerCase()) throw new Error(`SHA-256 divergente para ${file.file}.`)
  const forest = parseProjectedRoleForest(bytes)
  validateForestAgainstManifest(forest, file, expectedFeatureCount)
  return forest
}

function manifestHorizon(manifest: ProjectedRoleForestManifest, horizon: ProjectionHorizon) {
  const files = manifest.forests[String(horizon)]
  if (!files) throw new Error(`ProjectedRole manifest sem horizonte ${horizon}.`)
  return files
}

export async function loadProjectedRoleModel(manifestUrl: string, fetcher: FetchLike = fetch): Promise<LoadedProjectedRoleModel> {
  const response = await fetcher(manifestUrl, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Falha ao carregar ProjectedRole manifest (${response.status}).`)
  const manifest = await response.json() as ProjectedRoleForestManifest
  if (manifest.schemaVersion !== PROJECTED_ROLE_FOREST_MANIFEST_SCHEMA) throw new Error(`ProjectedRole manifest schema inválido: ${String(manifest.schemaVersion)}.`)
  if (!validateProjectedRoleModelAssetMetadata(manifest.metadata)) throw new Error('ProjectedRole manifest metadata inválida.')

  const cold = new Map<ProjectionHorizon, ProjectedRoleForest>()
  const history = new Map<ProjectionHorizon, ProjectedRoleForest>()
  for (const horizon of manifest.metadata.horizons) {
    const files = manifestHorizon(manifest, horizon)
    const [coldForest, historyForest] = await Promise.all([
      fetchForest(manifestUrl, files.cold, PROJECTED_ROLE_COLD_FEATURE_KEYS.length, fetcher),
      fetchForest(manifestUrl, files.history, PROJECTED_ROLE_COLD_FEATURE_KEYS.length + PROJECTED_ROLE_OUTPUT_KEYS.length, fetcher),
    ])
    cold.set(horizon, coldForest)
    history.set(horizon, historyForest)
  }

  const provider: ProjectedRoleModelProvider = {
    metadata: manifest.metadata,
    projectionModelVersion: manifest.metadata.projectionModelVersion,
    predictCold: (horizon, features) => {
      const forest = cold.get(horizon)
      return forest ? outputVector(predictProjectedRoleForest(forest, coldVector(features))) : null
    },
    predictHistory: (horizon, features, historyRatePerYear) => {
      const forest = history.get(horizon)
      if (!forest || PROJECTED_ROLE_OUTPUT_KEYS.some(key => !finite(historyRatePerYear[key]))) return null
      return outputVector(predictProjectedRoleForest(forest, historyVector(features, historyRatePerYear)))
    },
    historySupport: (horizon, features) => {
      const band = ageBand(features.continuousAge)
      const calibrationN = band ? manifest.historyCalibrationN[String(horizon)]?.[band] ?? null : null
      return {
        supported: calibrationN !== null && calibrationN >= PROJECTED_ROLE_HISTORY_MIN_CALIBRATION_N,
        calibrationN,
        // KNN100 overlap is deliberately independent from branch selection in the
        // canonical research. Until its source-cloud asset is serialized, runtime
        // reports UNKNOWN rather than fabricating IN_SUPPORT/OOD.
        overlapStatus: 'UNKNOWN',
        reason: calibrationN !== null && calibrationN >= PROJECTED_ROLE_HISTORY_MIN_CALIBRATION_N
          ? 'HISTORY_AWARE aprovado pelo N_cal da faixa etária; overlap KNN100 ainda não serializado.'
          : 'HISTORY_AWARE sem N_cal mínimo na faixa etária; fallback exato para COLD_START.',
      }
    },
  }

  return { manifest, provider }
}
