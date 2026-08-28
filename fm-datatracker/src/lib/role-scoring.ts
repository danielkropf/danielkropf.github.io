import { ATTRIBUTE_CATALOG } from './attributes'
import { attributeScore, combinedPhaseScore, fmScaleScore } from './scoring'
import { ROLE_WEIGHT_MATRIX } from './roleWeights'

export type ScoringAttribute = {
  key?: string
  attribute_key?: string
  value: number | null | undefined
}

export type RoleWeightSources = {
  roleId: string
  roleName: string
  overrideWeights?: Record<string, number> | null
}

const IGNORED_ATTRIBUTE_WEIGHTS = Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [attribute.key, 1])) as Record<string, number>
const GROUP_PREFIXES: Record<string, string[]> = {
  GK: ['GK'],
  CB: ['DC'],
  FB: ['FB', 'WB'],
  WB: ['WB', 'FB'],
  DM: ['DM'],
  CM: ['CM'],
  WM: ['MRL', 'W', 'AMRL'],
  AM: ['AMC', 'CM'],
  W: ['W', 'AMRL'],
  ST: ['ST'],
}

const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

const matrixSuffix = (roleName: string) => roleName
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_|_$/g, '')

export function resolveRoleWeightMatrixKey(roleId: string, roleName: string) {
  const parts = roleId.toUpperCase().split('-')
  const phase = parts[0] === 'OOP' ? 'OOP' : 'IP'
  const group = parts[1] ?? ''
  const suffix = matrixSuffix(roleName)
  const keys = Object.keys(ROLE_WEIGHT_MATRIX).filter(key => key.startsWith(`${phase}_`) && key.endsWith(`_${suffix}`))
  const preferred = GROUP_PREFIXES[group] ?? []
  for (const prefix of preferred) {
    const match = keys.find(key => key.startsWith(`${phase}_${prefix}_`))
    if (match) return match
  }
  return keys.length === 1 ? keys[0] : null
}

export function canonicalRoleDefaultWeights(roleId: string, roleName: string) {
  const matrixKey = resolveRoleWeightMatrixKey(roleId, roleName)
  return { ...IGNORED_ATTRIBUTE_WEIGHTS, ...(matrixKey ? ROLE_WEIGHT_MATRIX[matrixKey] : {}) }
}

function isLegacyAllThree(weights: Record<string, number> | null | undefined) {
  const values = Object.values(weights ?? {})
  return values.length > 0 && values.every(value => value === 3)
}

export function resolveRoleWeights({ roleId, roleName, overrideWeights }: RoleWeightSources) {
  const explicit = isLegacyAllThree(overrideWeights) ? null : overrideWeights
  return { ...canonicalRoleDefaultWeights(roleId, roleName), ...(explicit ?? {}) }
}

export function rawRoleScore(attributes: ScoringAttribute[], weights: Record<string, number>) {
  return attributeScore(attributes.map(attribute => {
    const key = attribute.attribute_key ?? attribute.key ?? ''
    return { key, value: finite(attribute.value), weight: weights[key] ?? 1 }
  }))
}

export function roleScore(attributes: ScoringAttribute[], weights: Record<string, number>) {
  const raw = rawRoleScore(attributes, weights)
  return raw === null ? null : fmScaleScore(raw)
}

export function pairedRoleScore(attributes: ScoringAttribute[], ipWeights: Record<string, number>, oopWeights: Record<string, number>) {
  return combinedPhaseScore(rawRoleScore(attributes, ipWeights), rawRoleScore(attributes, oopWeights))
}
