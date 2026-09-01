import { ATTRIBUTE_CATALOG } from './attributes'
import { basePositionScores, generalScoreForSnapshot, type BasePositionGroup } from './base-position-score'
import { exactAgeYears } from './projection-engine'
import { functionProjectionKey, snapshotProjectionFacts, type ProjectionSnapshot } from './projection-player'
import { predictPotentialGeneralCeiling, predictPotentialGeneralCoarseCeilingMonotonic } from './potential-general-ceiling-binary'
import { POTENTIAL_GENERAL_GROUPS, type LoadedPotentialGeneralCeilingModel } from './potential-general-ceiling-model'
import { potentialRoleCeilingForSnapshot, type PotentialRoleCeilingResult } from './potential-role-ceiling'
import type { LoadedPotentialRoleCeilingModel } from './potential-role-ceiling-model'

export type PotentialGeneralCeilingUnavailableReason =
  | 'MODEL_ASSET_UNAVAILABLE'
  | 'ROLE_FLOOR_ASSET_UNAVAILABLE'
  | 'CURRENT_GENERAL_SCORE_UNAVAILABLE'
  | 'ABILITY_UNAVAILABLE'
  | 'AGE_UNAVAILABLE'
  | 'UNSUPPORTED_AGE_DOMAIN'
  | 'ATTRIBUTES_UNAVAILABLE'
  | 'POSITION_ELIGIBILITY_UNAVAILABLE'
  | 'ROLE_FLOOR_UNAVAILABLE'
  | 'MODEL_OUTPUT_INVALID'

export type PotentialGeneralCeilingResult = {
  status: 'AVAILABLE' | 'UNAVAILABLE'
  currentGeneralScore: number | null
  plausibleCareerCeilingGeneralScore: number | null
  ceilingGain: number | null
  directGeneralCeiling: number | null
  coarseGeneralCeiling: number | null
  bestEligibleRoleCeiling: number | null
  bestCurrentBaseGroup: BasePositionGroup | null
  bestRoleFloorGroup: BasePositionGroup | null
  eligibleBaseGroups: BasePositionGroup[]
  potentialModelVersion: string | null
  roleFloorModelVersion: string | null
  headroom: number | null
  exactAge: number | null
  unavailableReason: PotentialGeneralCeilingUnavailableReason | null
  warnings: string[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

function unavailable(reason: PotentialGeneralCeilingUnavailableReason, currentGeneralScore: number | null, generalModel: LoadedPotentialGeneralCeilingModel | null, roleModel: LoadedPotentialRoleCeilingModel | null, detail?: { age?: number | null; headroom?: number | null; groups?: BasePositionGroup[] }): PotentialGeneralCeilingResult {
  return {
    status: 'UNAVAILABLE', currentGeneralScore, plausibleCareerCeilingGeneralScore: null, ceilingGain: null,
    directGeneralCeiling: null, coarseGeneralCeiling: null, bestEligibleRoleCeiling: null, bestCurrentBaseGroup: null, bestRoleFloorGroup: null,
    eligibleBaseGroups: detail?.groups ?? [], potentialModelVersion: generalModel?.manifest.potentialModelVersion ?? null,
    roleFloorModelVersion: roleModel?.manifest.potentialModelVersion ?? null, headroom: detail?.headroom ?? null,
    exactAge: detail?.age ?? null, unavailableReason: reason, warnings: [],
  }
}

function visible47(snapshot: ProjectionSnapshot) {
  const values = new Map(snapshot.player_attributes.map(attribute => [attribute.attribute_key, attribute.value]))
  const output: number[] = []
  for (const definition of ATTRIBUTE_CATALOG) {
    const value = values.get(definition.key)
    if (!finite(value) || value < 1 || value > 20) return null
    output.push(value)
  }
  return output
}

function roleFloorForBase(snapshot: ProjectionSnapshot, score: ReturnType<typeof basePositionScores>[number], roleModel: LoadedPotentialRoleCeilingModel) {
  const scoreKey = functionProjectionKey([
    { phase: 'IP', position: score.position, roleCode: score.roleCode },
    { phase: 'OOP', position: score.position, roleCode: score.roleCode },
  ])
  return potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore: score.score, scoreKey, loadedModel: roleModel })
}

export function potentialGeneralCeilingForSnapshot({ snapshot, loadedGeneralModel, loadedRoleModel }: {
  snapshot: ProjectionSnapshot | null | undefined
  loadedGeneralModel: LoadedPotentialGeneralCeilingModel | null
  loadedRoleModel: LoadedPotentialRoleCeilingModel | null
}): PotentialGeneralCeilingResult {
  if (!snapshot) return unavailable('CURRENT_GENERAL_SCORE_UNAVAILABLE', null, loadedGeneralModel, loadedRoleModel)
  const current = generalScoreForSnapshot(snapshot)
  const bases = basePositionScores(snapshot)
  if (!current || !finite(current.score) || !bases.length) return unavailable('POSITION_ELIGIBILITY_UNAVAILABLE', null, loadedGeneralModel, loadedRoleModel)
  const groups = [...new Set(bases.map(score => score.group))]
  const facts = snapshotProjectionFacts(snapshot)
  if (!facts.abilityAvailable || !finite(facts.ca) || !finite(facts.pa)) return unavailable('ABILITY_UNAVAILABLE', current.score, loadedGeneralModel, loadedRoleModel, { groups })
  const age = exactAgeYears(facts.birthDate, snapshot.snapshot_date)
  const headroom = Math.max(0, facts.pa - facts.ca)
  const detail = { age, headroom, groups }
  if (!finite(age)) return unavailable('AGE_UNAVAILABLE', current.score, loadedGeneralModel, loadedRoleModel, detail)
  if (age >= 30) return unavailable('UNSUPPORTED_AGE_DOMAIN', current.score, loadedGeneralModel, loadedRoleModel, detail)
  const attributes = visible47(snapshot)
  if (!attributes) return unavailable('ATTRIBUTES_UNAVAILABLE', current.score, loadedGeneralModel, loadedRoleModel, detail)
  if (!loadedGeneralModel) return unavailable('MODEL_ASSET_UNAVAILABLE', current.score, null, loadedRoleModel, detail)
  const roleFloorSupported = age >= loadedGeneralModel.manifest.domain.roleFloorMinimumAgeInclusive
  if (roleFloorSupported && !loadedRoleModel) return unavailable('ROLE_FLOOR_ASSET_UNAVAILABLE', current.score, loadedGeneralModel, null, detail)

  try {
    const mask = POTENTIAL_GENERAL_GROUPS.map(group => groups.includes(group))
    const bestGroupId = POTENTIAL_GENERAL_GROUPS.indexOf(current.group)
    if (bestGroupId < 0 || mask.filter(Boolean).length !== groups.length) return unavailable('POSITION_ELIGIBILITY_UNAVAILABLE', current.score, loadedGeneralModel, loadedRoleModel, detail)
    const features = [bestGroupId, age, current.score, headroom, groups.length, ...mask.map(Boolean), ...attributes].map(Number)
    const directGain = Math.max(0, predictPotentialGeneralCeiling(loadedGeneralModel.model, features))
    const directGeneralCeiling = clamp(current.score + directGain, current.score, 20)
    const coarseGain = Math.max(0, predictPotentialGeneralCoarseCeilingMonotonic(loadedGeneralModel.model, features))
    const coarseGeneralCeiling = clamp(current.score + coarseGain, current.score, 20)

    const roleFloorModel = roleFloorSupported ? loadedRoleModel : null
    const floors = roleFloorModel ? bases.map(base => ({ base, result: roleFloorForBase(snapshot, base, roleFloorModel) })) : []
    if (floors.some(item => item.result.status !== 'AVAILABLE' || !finite(item.result.plausibleCareerCeilingRoleScore))) return unavailable('ROLE_FLOOR_UNAVAILABLE', current.score, loadedGeneralModel, loadedRoleModel, detail)
    const bestFloor = floors.length ? floors.reduce((best, item) => (item.result.plausibleCareerCeilingRoleScore as number) > (best.result.plausibleCareerCeilingRoleScore as number) ? item : best) : null
    const bestEligibleRoleCeiling = bestFloor?.result.plausibleCareerCeilingRoleScore ?? null
    const ceiling = clamp(Math.max(current.score, directGeneralCeiling, coarseGeneralCeiling, bestEligibleRoleCeiling ?? -Infinity), current.score, 20)
    if (![directGeneralCeiling, coarseGeneralCeiling, ceiling].every(finite)) return unavailable('MODEL_OUTPUT_INVALID', current.score, loadedGeneralModel, loadedRoleModel, detail)
    return {
      status: 'AVAILABLE', currentGeneralScore: current.score, plausibleCareerCeilingGeneralScore: ceiling,
      ceilingGain: ceiling - current.score, directGeneralCeiling, coarseGeneralCeiling, bestEligibleRoleCeiling,
      bestCurrentBaseGroup: current.group, bestRoleFloorGroup: bestFloor?.base.group ?? null, eligibleBaseGroups: groups,
      potentialModelVersion: loadedGeneralModel.manifest.potentialModelVersion,
      roleFloorModelVersion: roleFloorModel?.manifest.potentialModelVersion ?? null,
      headroom, exactAge: age, unavailableReason: null,
      warnings: [
        'Teto geral plausível em cenário positivo; não é previsão do resultado mais provável, horizonte fixo ou PA/CP.',
        ...(age < loadedGeneralModel.manifest.domain.observedMinimumAgeInclusive ? ['Abaixo da menor idade observada no corpus; o motor usa a borda jovem sem bloquear a exibição.'] : []),
      ],
    }
  } catch {
    return unavailable('MODEL_OUTPUT_INVALID', current.score, loadedGeneralModel, loadedRoleModel, detail)
  }
}

export function potentialGeneralUnavailableLabel(reason: PotentialGeneralCeilingUnavailableReason | null) {
  if (reason === 'UNSUPPORTED_AGE_DOMAIN') return 'Potencial geral indisponível: modelo validado para jogadores abaixo de 30 anos.'
  if (reason === 'ABILITY_UNAVAILABLE') return 'Potencial geral indisponível: CA/PA confiáveis do leitor .fm não estão disponíveis.'
  if (reason === 'AGE_UNAVAILABLE') return 'Potencial geral indisponível: data de nascimento/data do save não permite idade contínua confiável.'
  if (reason === 'ATTRIBUTES_UNAVAILABLE') return 'Potencial geral indisponível: perfil atual de 47 atributos está incompleto.'
  if (reason === 'POSITION_ELIGIBILITY_UNAVAILABLE') return 'Potencial geral indisponível: nenhuma posição-base canônica elegível para a Nota Geral.'
  if (reason === 'MODEL_ASSET_UNAVAILABLE') return 'Potencial geral carregando ou asset do modelo geral indisponível.'
  if (reason === 'ROLE_FLOOR_ASSET_UNAVAILABLE' || reason === 'ROLE_FLOOR_UNAVAILABLE') return 'Potencial geral indisponível: o piso coerente de Potencial na função não pôde ser calculado.'
  if (reason === 'CURRENT_GENERAL_SCORE_UNAVAILABLE') return 'Potencial geral indisponível: Nota Geral atual não pôde ser calculada.'
  return 'Potencial geral indisponível: saída do modelo inválida.'
}

export function availableRoleFloorValues(results: PotentialRoleCeilingResult[]) {
  return results.filter(result => result.status === 'AVAILABLE' && finite(result.plausibleCareerCeilingRoleScore)).map(result => result.plausibleCareerCeilingRoleScore as number)
}
