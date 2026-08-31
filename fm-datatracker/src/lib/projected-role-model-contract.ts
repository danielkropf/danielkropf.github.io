import { ATTRIBUTE_CATALOG } from './attributes'
import type { ProjectedRawDeltaModel, ProjectionHorizon, ProjectionModelSupport, RawAttributeVector } from './projected-role-score'

/**
 * Production boundary for Scoring §14.
 *
 * The validated research reproduces the forest operationally, but the fitted
 * estimator object itself was not persisted as a deployable artifact. This
 * contract therefore still fails closed until an exported browser-safe bundle
 * passes golden/lockbox equivalence and receives a new explicit model version.
 */
export const PROJECTED_ROLE_MODEL_ASSET_CONTRACT_VERSION = 'projected-role-asset-contract-v1'
export const PROJECTED_ROLE_EXPECTED_ALGORITHM = 'ExtraTreesRegressor-multioutput-48trees-x10seeds'
export const PROJECTED_ROLE_OUTPUT_KEYS = ATTRIBUTE_CATALOG.map(attribute => attribute.key)

export type ProjectedRoleModelAssetMetadata = {
  contractVersion: typeof PROJECTED_ROLE_MODEL_ASSET_CONTRACT_VERSION
  projectionModelVersion: string
  algorithm: typeof PROJECTED_ROLE_EXPECTED_ALGORITHM
  horizons: ProjectionHorizon[]
  outputKeys: string[]
  seeds: number[]
  treesPerSeed: number
  minSamplesLeaf: number
  maxFeatures: number
  goldenLockboxId: string
  goldenTolerance: number
  assetSha256: string
}

export type ProjectedRoleModelProvider = ProjectedRawDeltaModel & {
  metadata: ProjectedRoleModelAssetMetadata
}

export function validateProjectedRoleModelAssetMetadata(metadata: ProjectedRoleModelAssetMetadata) {
  if (metadata.contractVersion !== PROJECTED_ROLE_MODEL_ASSET_CONTRACT_VERSION) return false
  if (metadata.algorithm !== PROJECTED_ROLE_EXPECTED_ALGORITHM) return false
  if (metadata.treesPerSeed !== 48 || metadata.minSamplesLeaf !== 2 || metadata.maxFeatures !== 1) return false
  if (metadata.seeds.join(',') !== '7,11,19,23,31,42,57,83,101,137') return false
  if (metadata.horizons.slice().sort((a, b) => a - b).join(',') !== '12,24,36') return false
  if (metadata.outputKeys.join(',') !== PROJECTED_ROLE_OUTPUT_KEYS.join(',')) return false
  if (!metadata.projectionModelVersion || !metadata.goldenLockboxId || !Number.isFinite(metadata.goldenTolerance) || metadata.goldenTolerance < 0) return false
  return /^[a-f0-9]{64}$/i.test(metadata.assetSha256)
}

/** Always fail closed until a validated asset is actually supplied. */
export const MISSING_PROJECTED_ROLE_MODEL: ProjectedRawDeltaModel | null = null

/** Type-only helpers for future serializer implementations. */
export type ProjectedRolePredictCold = (horizon: ProjectionHorizon, features: Parameters<ProjectedRawDeltaModel['predictCold']>[1]) => RawAttributeVector | null
export type ProjectedRoleHistorySupport = (horizon: ProjectionHorizon, features: Parameters<ProjectedRawDeltaModel['historySupport']>[1], history: Parameters<ProjectedRawDeltaModel['historySupport']>[2]) => ProjectionModelSupport | null
