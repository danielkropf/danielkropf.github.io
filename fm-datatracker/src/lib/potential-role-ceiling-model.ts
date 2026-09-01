import { parsePotentialRoleCeilingModel, type PotentialCeilingBinaryModel } from './potential-role-ceiling-binary'
import { ATTRIBUTE_CATALOG } from './attributes'
import { IP_ROLES, OOP_ROLES } from './tactics'

export const POTENTIAL_ROLE_CEILING_MANIFEST_SCHEMA = 'fm-datatracker-potential-role-ceiling-manifest-v1_1'
export const POTENTIAL_ROLE_CEILING_MODEL_VERSION = 'pccrs-phase-hgbq925-20260901-v1.1'

export type PotentialRoleCeilingManifest = {
  schemaVersion: typeof POTENTIAL_ROLE_CEILING_MANIFEST_SCHEMA
  potentialModelVersion: string
  engineVersion: string
  scoringModelVersion: string
  roleCatalogVersion: string
  model: {
    file: string
    sha256: string
    byteLength: number
    format: 'FMDTPH21'
    formatVersion: 2
    treeCount: 180
    featureCount: 51
    individualRoleCount: 83
  }
  domain: {
    minAgeInclusive: number
    maxAgeExclusive: number
    canonicalIpFunctions: number
    canonicalOopFunctions: number
    canonicalIndividualFunctions: number
    canonicalPairCapacity: number
    requiresTrustedCaPa: boolean
    requiresCompleteVisible47: boolean
    customMatricesSupported: boolean
  }
  featureOrderModel: string[]
  individualRoles: Array<{ id: number; phase: 'IP' | 'OOP'; group: string; code: string; name: string }>
  notes?: string[]
}

export type LoadedPotentialRoleCeilingModel = { manifest: PotentialRoleCeilingManifest; model: PotentialCeilingBinaryModel }
type FetchLike = typeof fetch
const GROUP_ORDER = ['GK','CB','FB','WB','DM','CM','WM','AM','W','ST'] as const
const EXPECTED_FEATURE_ORDER = ['individual_role_id', 'age', 'current_single_phase_role_score', 'headroom', ...ATTRIBUTE_CATALOG.map(attribute => attribute.key)]
const EXPECTED_ROLE_CATALOG = [
  ...GROUP_ORDER.flatMap(group => IP_ROLES[group].map(([code, name]) => ({ phase: 'IP', group, code, name }))),
  ...GROUP_ORDER.flatMap(group => OOP_ROLES[group].map(([code, name]) => ({ phase: 'OOP', group, code, name }))),
]

function hex(bytes: Uint8Array) { return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') }
async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto indisponível para validar asset PotentialRole.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return hex(new Uint8Array(digest))
}
function resolveUrl(path: string, base: string) {
  try { return new URL(path, new URL(base, globalThis.location?.href ?? 'http://localhost/')).toString() }
  catch { throw new Error(`URL inválida do asset PotentialRole: ${path}.`) }
}

export async function loadPotentialRoleCeilingModel(manifestUrl: string, fetcher: FetchLike = fetch): Promise<LoadedPotentialRoleCeilingModel> {
  const resolvedManifestUrl = resolveUrl(manifestUrl, globalThis.location?.href ?? 'http://localhost/')
  const response = await fetcher(resolvedManifestUrl, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Falha ao carregar manifest PotentialRole (${response.status}).`)
  const manifest = await response.json() as PotentialRoleCeilingManifest
  if (manifest.schemaVersion !== POTENTIAL_ROLE_CEILING_MANIFEST_SCHEMA) throw new Error('Manifest PotentialRole com schema incompatível.')
  if (manifest.potentialModelVersion !== POTENTIAL_ROLE_CEILING_MODEL_VERSION) throw new Error(`PotentialRole modelVersion inesperada: ${manifest.potentialModelVersion}.`)
  if (manifest.model.format !== 'FMDTPH21' || manifest.model.formatVersion !== 2 || manifest.model.treeCount !== 180 || manifest.model.featureCount !== 51 || manifest.model.individualRoleCount !== 83) throw new Error('Manifest PotentialRole diverge do contrato binário v1.1.')
  if (manifest.domain.canonicalIpFunctions !== 48 || manifest.domain.canonicalOopFunctions !== 35 || manifest.domain.canonicalIndividualFunctions !== 83 || manifest.domain.canonicalPairCapacity !== 1680 || manifest.domain.minAgeInclusive !== 16 || manifest.domain.maxAgeExclusive !== 30 || manifest.domain.customMatricesSupported) throw new Error('Manifest PotentialRole diverge do domínio validado v1.1.')
  if (!Array.isArray(manifest.featureOrderModel) || manifest.featureOrderModel.length !== EXPECTED_FEATURE_ORDER.length || manifest.featureOrderModel.some((feature, index) => feature !== EXPECTED_FEATURE_ORDER[index])) throw new Error('Manifest PotentialRole diverge da ordem canônica de features v1.1.')
  if (!Array.isArray(manifest.individualRoles) || manifest.individualRoles.length !== EXPECTED_ROLE_CATALOG.length || manifest.individualRoles.some((role, id) => {
    const expected = EXPECTED_ROLE_CATALOG[id]
    return role.id !== id || role.phase !== expected.phase || role.group !== expected.group || role.code !== expected.code || role.name !== expected.name
  })) throw new Error('Manifest PotentialRole diverge do catálogo individual v1.1.')
  const modelUrl = resolveUrl(manifest.model.file, resolvedManifestUrl)
  const modelResponse = await fetcher(modelUrl, { cache: 'force-cache' })
  if (!modelResponse.ok) throw new Error(`Falha ao carregar asset PotentialRole (${modelResponse.status}).`)
  const bytes = new Uint8Array(await modelResponse.arrayBuffer())
  if (bytes.byteLength !== manifest.model.byteLength) throw new Error('PotentialRole byteLength divergente.')
  const digest = await sha256(bytes)
  if (digest.toLowerCase() !== manifest.model.sha256.toLowerCase()) throw new Error('SHA-256 divergente para asset PotentialRole.')
  const model = parsePotentialRoleCeilingModel(bytes)
  if (model.individualRoleCount !== manifest.model.individualRoleCount) throw new Error('PotentialRole catálogo binário diverge do manifest.')
  return { manifest, model }
}
