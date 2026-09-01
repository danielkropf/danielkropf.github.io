import { ATTRIBUTE_CATALOG } from './attributes'
import { parsePotentialGeneralCeilingModel, type GeneralCeilingBinaryModel } from './potential-general-ceiling-binary'
import { POTENTIAL_ROLE_CEILING_MODEL_VERSION } from './potential-role-ceiling-model'

export const POTENTIAL_GENERAL_CEILING_MANIFEST_SCHEMA = 'fm-datatracker-potential-general-ceiling-manifest-v2'
export const POTENTIAL_GENERAL_CEILING_MODEL_VERSION = 'pccgs-profileq95-coarseq90-phasefloor-20260901-v2'
export const POTENTIAL_GENERAL_CEILING_ENGINE_VERSION = 'plausible-career-ceiling-general-score-engine-v2'
export const POTENTIAL_GENERAL_GROUPS = ['GK','CB','FB','WB','DM','CM','WM','AM','W','ST'] as const

export type PotentialGeneralCeilingManifest = {
  schemaVersion: typeof POTENTIAL_GENERAL_CEILING_MANIFEST_SCHEMA
  potentialModelVersion: string
  engineVersion: string
  scoringModelVersion: string
  basePositionCatalogVersion: string
  model: { file: string; sha256: string; byteLength: number; format: 'FMDTGC02'; formatVersion: 2; profileTreeCount: 180; profileFeatureCount: 62; coarseTreeCount: 180; coarseFeatureCount: 15; basePositionGroupCount: 10 }
  domain: { minimumAgeGate: false; observedMinimumAgeInclusive: number; maxAgeExclusive: number; roleFloorMinimumAgeInclusive: number; positionEligibilityThreshold: number; canonicalBasePositionGroups: number; requiresTrustedCaPa: boolean; requiresCompleteVisible47: boolean; requiresPotentialRoleCeilingV1_1WhenAgeSupported: boolean; customMatricesSupported: boolean }
  featureOrderModel: string[]
  basePositionGroups: Array<{ id: number; code: string }>
  combination: { method: 'maximum'; components: string[]; roleFloorModelVersion: string; clampMin: string; clampMax: number }
}
export type LoadedPotentialGeneralCeilingModel = { manifest: PotentialGeneralCeilingManifest; model: GeneralCeilingBinaryModel }

const EXPECTED_FEATURE_ORDER = ['current_best_base_group_id', 'age', 'current_general_score', 'headroom', 'eligible_base_group_count', ...POTENTIAL_GENERAL_GROUPS.map(group => `eligible_${group.toLowerCase()}`), ...ATTRIBUTE_CATALOG.map(attribute => attribute.key)]
const hex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
async function sha256(bytes: Uint8Array) { if (!globalThis.crypto?.subtle) throw new Error('WebCrypto indisponível para validar asset PotentialGeneral.'); return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))) }
function resolveUrl(path: string, base: string) { try { return new URL(path, new URL(base, globalThis.location?.href ?? 'http://localhost/')).toString() } catch { throw new Error(`URL inválida do asset PotentialGeneral: ${path}.`) } }

export async function loadPotentialGeneralCeilingModel(manifestUrl: string, fetcher: typeof fetch = fetch): Promise<LoadedPotentialGeneralCeilingModel> {
  const resolvedManifestUrl = resolveUrl(manifestUrl, globalThis.location?.href ?? 'http://localhost/')
  const response = await fetcher(resolvedManifestUrl, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Falha ao carregar manifest PotentialGeneral (${response.status}).`)
  const manifest = await response.json() as PotentialGeneralCeilingManifest
  if (manifest.schemaVersion !== POTENTIAL_GENERAL_CEILING_MANIFEST_SCHEMA || manifest.potentialModelVersion !== POTENTIAL_GENERAL_CEILING_MODEL_VERSION || manifest.engineVersion !== POTENTIAL_GENERAL_CEILING_ENGINE_VERSION) throw new Error('Manifest PotentialGeneral com identidade incompatível.')
  const metadata = manifest.model
  if (metadata.format !== 'FMDTGC02' || metadata.formatVersion !== 2 || metadata.profileTreeCount !== 180 || metadata.profileFeatureCount !== 62 || metadata.coarseTreeCount !== 180 || metadata.coarseFeatureCount !== 15 || metadata.basePositionGroupCount !== 10) throw new Error('Manifest PotentialGeneral diverge do contrato binário v2.')
  const domain = manifest.domain
  if (domain.minimumAgeGate !== false || domain.observedMinimumAgeInclusive !== 15 || domain.maxAgeExclusive !== 30 || domain.roleFloorMinimumAgeInclusive !== 16 || domain.positionEligibilityThreshold !== 15 || domain.canonicalBasePositionGroups !== 10 || !domain.requiresTrustedCaPa || !domain.requiresCompleteVisible47 || !domain.requiresPotentialRoleCeilingV1_1WhenAgeSupported || domain.customMatricesSupported) throw new Error('Manifest PotentialGeneral diverge do domínio validado v2.')
  if (manifest.combination.method !== 'maximum' || manifest.combination.roleFloorModelVersion !== POTENTIAL_ROLE_CEILING_MODEL_VERSION || manifest.combination.clampMax !== 20) throw new Error('Manifest PotentialGeneral diverge da composição híbrida validada.')
  if (!Array.isArray(manifest.featureOrderModel) || manifest.featureOrderModel.length !== EXPECTED_FEATURE_ORDER.length || manifest.featureOrderModel.some((value, index) => value !== EXPECTED_FEATURE_ORDER[index])) throw new Error('Manifest PotentialGeneral diverge da ordem canônica de features.')
  if (!Array.isArray(manifest.basePositionGroups) || manifest.basePositionGroups.length !== 10 || manifest.basePositionGroups.some((value, index) => value.id !== index || value.code !== POTENTIAL_GENERAL_GROUPS[index])) throw new Error('Manifest PotentialGeneral diverge do catálogo de posições-base.')
  const modelResponse = await fetcher(resolveUrl(metadata.file, resolvedManifestUrl), { cache: 'force-cache' })
  if (!modelResponse.ok) throw new Error(`Falha ao carregar asset PotentialGeneral (${modelResponse.status}).`)
  const bytes = new Uint8Array(await modelResponse.arrayBuffer())
  if (bytes.byteLength !== metadata.byteLength) throw new Error('PotentialGeneral byteLength divergente.')
  if ((await sha256(bytes)).toLowerCase() !== metadata.sha256.toLowerCase()) throw new Error('SHA-256 divergente para asset PotentialGeneral.')
  return { manifest, model: parsePotentialGeneralCeilingModel(bytes) }
}
