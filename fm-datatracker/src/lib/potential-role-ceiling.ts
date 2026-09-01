import { ATTRIBUTE_CATALOG } from './attributes'
import { exactAgeYears } from './projection-engine'
import { snapshotProjectionFacts, type ProjectionSnapshot } from './projection-player'
import { canonicalRoleDefaultWeights, pairedRoleScore, roleScore } from './role-scoring'
import { IP_ROLES, OOP_ROLES } from './tactics'
import { predictPotentialCeilingEnsemble } from './potential-role-ceiling-binary'
import type { LoadedPotentialRoleCeilingModel } from './potential-role-ceiling-model'

export const POTENTIAL_ROLE_CEILING_ENGINE_VERSION = 'plausible-career-ceiling-role-score-engine-v1.1'
export type PotentialRoleCeilingUnavailableReason =
  | 'MODEL_ASSET_UNAVAILABLE'
  | 'CURRENT_ROLE_SCORE_UNAVAILABLE'
  | 'ABILITY_UNAVAILABLE'
  | 'AGE_UNAVAILABLE'
  | 'UNSUPPORTED_AGE_DOMAIN'
  | 'ATTRIBUTES_UNAVAILABLE'
  | 'ROLE_IDENTITY_UNAVAILABLE'
  | 'NON_CANONICAL_ROLE'
  | 'CUSTOM_MATRIX_UNSUPPORTED'
  | 'MODEL_OUTPUT_INVALID'

export type PotentialRoleCeilingResult = {
  status: 'AVAILABLE' | 'UNAVAILABLE'
  currentRoleScore: number | null
  plausibleCareerCeilingRoleScore: number | null
  ceilingGain: number | null
  potentialModelVersion: string | null
  /** Legacy 171-pair id when the pair belongs to the old same-group catalog. */
  roleComboId: number | null
  ipFunctionId: number | null
  oopFunctionId: number | null
  roleIdentity: string | null
  currentIpRoleScore: number | null
  currentOopRoleScore: number | null
  plausibleIpCeilingRoleScore: number | null
  plausibleOopCeilingRoleScore: number | null
  supportStatus: 'VALIDATED_DOMAIN' | 'YOUTH_EDGE_EXTRAPOLATION' | 'UNAVAILABLE'
  headroom: number | null
  exactAge: number | null
  unavailableReason: PotentialRoleCeilingUnavailableReason | null
  warnings: string[]
}

type Group = keyof typeof IP_ROLES
type Phase = 'IP' | 'OOP'
const GROUP_ORDER: Group[] = ['GK','CB','FB','WB','DM','CM','WM','AM','W','ST']
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

export type IndividualRole = {
  id: number
  phase: Phase
  group: Group
  code: string
  name: string
  identity: string
}
export type RolePair = {
  legacyComboId: number | null
  ip: IndividualRole
  oop: IndividualRole
  identity: string
}
export type RoleSelection = {
  legacyComboId: number | null
  ip: IndividualRole | null
  oop: IndividualRole | null
  identity: string
}

const IP_FUNCTIONS: IndividualRole[] = GROUP_ORDER
  .flatMap(group => IP_ROLES[group].map(([code, name]) => ({ phase: 'IP' as const, group, code, name })))
  .map((role, id) => ({ ...role, id, identity: `IP:${role.group}|${role.name}` }))
const OOP_FUNCTIONS: IndividualRole[] = GROUP_ORDER
  .flatMap(group => OOP_ROLES[group].map(([code, name]) => ({ phase: 'OOP' as const, group, code, name })))
  .map((role, offset) => ({ ...role, id: IP_FUNCTIONS.length + offset, identity: `OOP:${role.group}|${role.name}` }))
export const POTENTIAL_INDIVIDUAL_ROLE_CATALOG = [...IP_FUNCTIONS, ...OOP_FUNCTIONS]

if (IP_FUNCTIONS.length !== 48 || OOP_FUNCTIONS.length !== 35 || POTENTIAL_INDIVIDUAL_ROLE_CATALOG.length !== 83) {
  throw new Error(`Catálogo PotentialRole individual divergente: ${IP_FUNCTIONS.length}+${OOP_FUNCTIONS.length}/83.`)
}

const LEGACY_COMBO_IDS = new Map<string, number>()
let legacyId = 0
for (const group of GROUP_ORDER) {
  for (const [ipCode] of IP_ROLES[group]) {
    for (const [oopCode] of OOP_ROLES[group]) {
      LEGACY_COMBO_IDS.set(`${group}|${ipCode.toUpperCase()}|${oopCode.toUpperCase()}`, legacyId)
      legacyId += 1
    }
  }
}
if (legacyId !== 171) throw new Error(`Catálogo PotentialRole legado divergente: ${legacyId}/171.`)

function unavailable(reason: PotentialRoleCeilingUnavailableReason, currentRoleScore: number | null, model: LoadedPotentialRoleCeilingModel | null, detail?: { age?: number | null; headroom?: number | null; pair?: RoleSelection | null; currentIp?: number | null; currentOop?: number | null }): PotentialRoleCeilingResult {
  return {
    status: 'UNAVAILABLE', currentRoleScore, plausibleCareerCeilingRoleScore: null, ceilingGain: null,
    potentialModelVersion: model?.manifest.potentialModelVersion ?? null,
    roleComboId: detail?.pair?.legacyComboId ?? null,
    ipFunctionId: detail?.pair?.ip?.id ?? null,
    oopFunctionId: detail?.pair?.oop?.id ?? null,
    roleIdentity: detail?.pair?.identity ?? null,
    currentIpRoleScore: detail?.currentIp ?? null,
    currentOopRoleScore: detail?.currentOop ?? null,
    plausibleIpCeilingRoleScore: null,
    plausibleOopCeilingRoleScore: null,
    supportStatus: 'UNAVAILABLE', headroom: detail?.headroom ?? null, exactAge: detail?.age ?? null,
    unavailableReason: reason, warnings: [],
  }
}

function groupForPositionToken(token: string): Group | null {
  const value = token.toUpperCase().replaceAll(' ', '')
  if (value === 'GK') return 'GK'
  if (value.startsWith('D(C)')) return 'CB'
  if (value.startsWith('D(')) return 'FB'
  if (value.startsWith('WB')) return 'WB'
  if (value.startsWith('DM')) return 'DM'
  if (value.startsWith('M(C)')) return 'CM'
  if (value.startsWith('M(')) return 'WM'
  if (value.startsWith('AM(C)')) return 'AM'
  if (value.startsWith('AM(')) return 'W'
  if (value.startsWith('ST')) return 'ST'
  return null
}

export function potentialRoleComboFromProjectionKey(scoreKey: string | null | undefined): RoleSelection | null {
  if (!scoreKey) return null
  const parts = scoreKey.split('|').map(part => part.split(':'))
  if (parts.length < 1 || parts.length > 2 || parts.some(part => part.length !== 3)) return null
  const ipPart = parts.find(part => part[0] === 'IP')
  const oopPart = parts.find(part => part[0] === 'OOP')
  if (!ipPart && !oopPart) return null
  const ipGroup = ipPart ? groupForPositionToken(ipPart[1]) : null
  const oopGroup = oopPart ? groupForPositionToken(oopPart[1]) : null
  if ((ipPart && !ipGroup) || (oopPart && !oopGroup)) return null
  const ipCode = ipPart?.[2].toUpperCase() ?? null
  const oopCode = oopPart?.[2].toUpperCase() ?? null
  const ip = ipGroup && ipCode ? IP_FUNCTIONS.find(role => role.group === ipGroup && role.code.toUpperCase() === ipCode) ?? null : null
  const oop = oopGroup && oopCode ? OOP_FUNCTIONS.find(role => role.group === oopGroup && role.code.toUpperCase() === oopCode) ?? null : null
  if ((ipPart && !ip) || (oopPart && !oop)) return null
  const legacyComboId = ip && oop && ipGroup === oopGroup ? LEGACY_COMBO_IDS.get(`${ipGroup}|${ipCode}|${oopCode}`) ?? null : null
  return { legacyComboId, ip, oop, identity: [ip?.identity, oop?.identity].filter(Boolean).join(' > ') }
}

function visible47(snapshot: ProjectionSnapshot) {
  const values = new Map(snapshot.player_attributes.map(attribute => [attribute.attribute_key, attribute.value]))
  const out: number[] = []
  for (const definition of ATTRIBUTE_CATALOG) {
    const value = values.get(definition.key)
    if (!finite(value) || value < 1 || value > 20) return null
    out.push(value)
  }
  return out
}

function canonicalCurrentScores(snapshot: ProjectionSnapshot, pair: RoleSelection) {
  const ipWeights = pair.ip ? canonicalRoleDefaultWeights(`IP-${pair.ip.group}-${pair.ip.code}`, pair.ip.name) : null
  const oopWeights = pair.oop ? canonicalRoleDefaultWeights(`OOP-${pair.oop.group}-${pair.oop.code}`, pair.oop.name) : null
  const ip = ipWeights ? roleScore(snapshot.player_attributes, ipWeights) : null
  const oop = oopWeights ? roleScore(snapshot.player_attributes, oopWeights) : null
  return {
    ip,
    oop,
    combined: ipWeights && oopWeights ? pairedRoleScore(snapshot.player_attributes, ipWeights, oopWeights) : ip ?? oop,
  }
}

export function potentialRoleCeilingForSnapshot({ snapshot, currentRoleScore, scoreKey, loadedModel }: {
  snapshot: ProjectionSnapshot | null | undefined
  currentRoleScore: number | null
  scoreKey?: string
  loadedModel: LoadedPotentialRoleCeilingModel | null
}): PotentialRoleCeilingResult {
  if (!snapshot || !finite(currentRoleScore)) return unavailable('CURRENT_ROLE_SCORE_UNAVAILABLE', currentRoleScore, loadedModel)
  const pair = potentialRoleComboFromProjectionKey(scoreKey)
  if (!pair) return unavailable(scoreKey ? 'NON_CANONICAL_ROLE' : 'ROLE_IDENTITY_UNAVAILABLE', currentRoleScore, loadedModel)
  const current = canonicalCurrentScores(snapshot, pair)
  if (!finite(current.combined) || (pair.ip && !finite(current.ip)) || (pair.oop && !finite(current.oop))) return unavailable('CURRENT_ROLE_SCORE_UNAVAILABLE', currentRoleScore, loadedModel, { pair })
  const detail = { pair, currentIp: current.ip, currentOop: current.oop }
  if (Math.abs(current.combined - currentRoleScore) > 1e-6) return unavailable('CUSTOM_MATRIX_UNSUPPORTED', currentRoleScore, loadedModel, detail)
  const facts = snapshotProjectionFacts(snapshot)
  if (!facts.abilityAvailable || !finite(facts.ca) || !finite(facts.pa)) return unavailable('ABILITY_UNAVAILABLE', currentRoleScore, loadedModel, detail)
  const age = exactAgeYears(facts.birthDate, snapshot.snapshot_date)
  if (!finite(age)) return unavailable('AGE_UNAVAILABLE', currentRoleScore, loadedModel, detail)
  const headroom = Math.max(0, facts.pa - facts.ca)
  const domainDetail = { ...detail, age, headroom }
  if (age >= 30) return unavailable('UNSUPPORTED_AGE_DOMAIN', currentRoleScore, loadedModel, domainDetail)
  const attrs = visible47(snapshot)
  if (!attrs) return unavailable('ATTRIBUTES_UNAVAILABLE', currentRoleScore, loadedModel, domainDetail)
  if (!loadedModel) return unavailable('MODEL_ASSET_UNAVAILABLE', currentRoleScore, null, domainDetail)
  try {
    const modelAge = Math.max(16, age)
    const ipGain = pair.ip && finite(current.ip) ? Math.max(0, predictPotentialCeilingEnsemble(loadedModel.model.phase, [pair.ip.id, modelAge, current.ip, headroom, ...attrs])) : null
    const oopGain = pair.oop && finite(current.oop) ? Math.max(0, predictPotentialCeilingEnsemble(loadedModel.model.phase, [pair.oop.id, modelAge, current.oop, headroom, ...attrs])) : null
    const ipCeiling = ipGain !== null && finite(current.ip) ? clamp(current.ip + ipGain, current.ip, 20) : null
    const oopCeiling = oopGain !== null && finite(current.oop) ? clamp(current.oop + oopGain, current.oop, 20) : null
    const phaseCeiling = ipCeiling !== null && oopCeiling !== null ? Math.sqrt(ipCeiling * oopCeiling) : ipCeiling ?? oopCeiling
    if (!finite(phaseCeiling)) return unavailable('MODEL_OUTPUT_INVALID', currentRoleScore, loadedModel, domainDetail)
    const ceiling = clamp(Math.max(currentRoleScore, phaseCeiling), currentRoleScore, 20)
    return {
      status: 'AVAILABLE', currentRoleScore, plausibleCareerCeilingRoleScore: ceiling, ceilingGain: ceiling - currentRoleScore,
      potentialModelVersion: loadedModel.manifest.potentialModelVersion,
      roleComboId: pair.legacyComboId, ipFunctionId: pair.ip?.id ?? null, oopFunctionId: pair.oop?.id ?? null, roleIdentity: pair.identity,
      currentIpRoleScore: current.ip, currentOopRoleScore: current.oop,
      plausibleIpCeilingRoleScore: ipCeiling, plausibleOopCeilingRoleScore: oopCeiling,
      supportStatus: age < 16 ? 'YOUTH_EDGE_EXTRAPOLATION' : 'VALIDATED_DOMAIN', headroom, exactAge: age, unavailableReason: null,
      warnings: [
        'Teto plausível em cenário positivo; não é previsão do resultado mais provável nem probabilidade de atingir esta nota.',
        ...(age < 16 ? ['Abaixo da idade observada no treino funcional; o motor usa a borda jovem de 16 anos sem ocultar o potencial.'] : []),
      ],
    }
  } catch {
    return unavailable('MODEL_OUTPUT_INVALID', currentRoleScore, loadedModel, domainDetail)
  }
}

export function potentialRoleUnavailableLabel(reason: PotentialRoleCeilingUnavailableReason | null) {
  if (reason === 'UNSUPPORTED_AGE_DOMAIN') return 'Potencial na função indisponível: modelo validado para jogadores abaixo de 30 anos.'
  if (reason === 'ABILITY_UNAVAILABLE') return 'Potencial na função indisponível: CA/PA confiáveis do leitor .fm não estão disponíveis.'
  if (reason === 'AGE_UNAVAILABLE') return 'Potencial na função indisponível: data de nascimento/data do save não permite idade contínua confiável.'
  if (reason === 'ATTRIBUTES_UNAVAILABLE') return 'Potencial na função indisponível: perfil atual de 47 atributos está incompleto.'
  if (reason === 'CUSTOM_MATRIX_UNSUPPORTED') return 'Potencial na função indisponível para pesos customizados nesta versão; a v1.1 é calibrada apenas nas matrizes canônicas.'
  if (reason === 'NON_CANONICAL_ROLE' || reason === 'ROLE_IDENTITY_UNAVAILABLE') return 'Potencial na função indisponível: uma das funções IP/OOP não pertence ao catálogo individual canônico validado.'
  if (reason === 'MODEL_ASSET_UNAVAILABLE') return 'Potencial na função carregando ou asset de modelo indisponível.'
  if (reason === 'CURRENT_ROLE_SCORE_UNAVAILABLE') return 'Potencial na função indisponível: RoleScore atual não pôde ser calculado.'
  return 'Potencial na função indisponível: saída do modelo inválida.'
}
