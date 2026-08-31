import { ATTRIBUTE_CATALOG } from './attributes'
import { DAYS_PER_YEAR, type ProjectionHistory, type ProjectionInputState, type RawAttributeVector } from './projected-role-score'
import type { ScoringAttribute } from './role-scoring'

type UnknownRecord = Record<string, unknown>

export type ProjectedRoleSnapshot = {
  snapshot_date: string
  age?: number | null
  raw_data?: UnknownRecord
  normalized_data?: UnknownRecord
  player_attributes: Array<{ attribute_key: string; value: number | null | undefined }>
}

export type ProjectedRoleInputOptions = {
  snapshot: ProjectedRoleSnapshot
  previousSnapshot?: ProjectedRoleSnapshot | null
  identityStable?: boolean
}

const ALLOWED_ORIGIN = 'fm26-save-offline'
const ALLOWED_CA_PA_STATUS = 'candidate_with_provenance_not_universally_validated'
const rawAliases: Record<string, string> = {
  teamwork: 'team_work',
  punching_tendency: 'punching',
}

const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

function trustedOrigin(snapshot: ProjectedRoleSnapshot) {
  return text(record(snapshot.normalized_data).source) === ALLOWED_ORIGIN
}

function rawState(snapshot: ProjectedRoleSnapshot): RawAttributeVector | null {
  if (!trustedOrigin(snapshot)) return null
  const source = record(record(snapshot.raw_data).attributes_raw_1_100)
  const translated: Record<string, number> = {}
  for (const [label, value] of Object.entries(source)) {
    const key = rawAliases[slug(label)] ?? slug(label)
    const parsed = finite(value)
    if (parsed !== null) translated[key] = parsed
  }
  const required = ATTRIBUTE_CATALOG.map(attribute => attribute.key)
  if (!required.every(key => finite(translated[key]) && translated[key] >= 1 && translated[key] <= 100)) return null
  return Object.fromEntries(required.map(key => [key, translated[key]])) as RawAttributeVector
}

function currentVisible(snapshot: ProjectedRoleSnapshot): ScoringAttribute[] | null {
  const byKey = new Map(snapshot.player_attributes.map(attribute => [attribute.attribute_key, finite(attribute.value)]))
  if (!ATTRIBUTE_CATALOG.every(attribute => {
    const value = byKey.get(attribute.key)
    return value !== null && value !== undefined && value >= 1 && value <= 20
  })) return null
  return ATTRIBUTE_CATALOG.map(attribute => ({ key: attribute.key, value: byKey.get(attribute.key)! }))
}

function birthDate(snapshot: ProjectedRoleSnapshot) {
  const normalized = record(snapshot.normalized_data)
  const raw = record(snapshot.raw_data)
  return text(normalized.birth_date) ?? text(normalized.date_of_birth) ?? text(raw.birth_date) ?? text(raw.date_of_birth)
}

function utcDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const milliseconds = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(milliseconds) ? milliseconds / 86_400_000 : null
}

export function continuousAgeAt(snapshot: ProjectedRoleSnapshot) {
  const born = utcDay(birthDate(snapshot))
  const observed = utcDay(snapshot.snapshot_date)
  if (born === null || observed === null || observed <= born) return null
  return (observed - born) / DAYS_PER_YEAR
}

function hiddenFact(snapshot: ProjectedRoleSnapshot, key: 'current_ability' | 'potential_ability' | 'professionalism' | 'ambition') {
  if (!trustedOrigin(snapshot)) return null
  const normalized = record(snapshot.normalized_data)
  if ((key === 'current_ability' || key === 'potential_ability') && text(normalized.ca_pa_status) !== ALLOWED_CA_PA_STATUS) return null
  const hidden = record(normalized.fm_hidden)
  const personality = record(normalized.hidden_personality)
  return finite(hidden[key]) ?? finite(personality[key])
}

function determination(snapshot: ProjectedRoleSnapshot) {
  return finite(snapshot.player_attributes.find(attribute => attribute.attribute_key === 'determination')?.value)
}

function historyFor(current: ProjectedRoleSnapshot, previous: ProjectedRoleSnapshot | null | undefined, identityStable: boolean | undefined): ProjectionHistory | null {
  if (!previous || identityStable !== true || !trustedOrigin(current) || !trustedOrigin(previous)) return null
  const currentRaw = rawState(current)
  const previousRaw = rawState(previous)
  if (!currentRaw || !previousRaw) return null
  const currentDay = utcDay(current.snapshot_date)
  const previousDay = utcDay(previous.snapshot_date)
  if (currentDay === null || previousDay === null || currentDay <= previousDay) return null
  const spanDays = currentDay - previousDay
  const ratePerYear = Object.fromEntries(ATTRIBUTE_CATALOG.map(attribute => [
    attribute.key,
    (currentRaw[attribute.key] - previousRaw[attribute.key]) * DAYS_PER_YEAR / spanDays,
  ])) as RawAttributeVector
  return {
    previousRaw,
    previousSnapshotDate: previous.snapshot_date,
    currentSnapshotDate: current.snapshot_date,
    spanDays,
    ratePerYear,
    provenanceStatus: 'TRUSTED',
  }
}

export function projectedRoleInputState({ snapshot, previousSnapshot = null, identityStable = false }: ProjectedRoleInputOptions): ProjectionInputState {
  const warnings: string[] = []
  const raw = rawState(snapshot)
  const visible = currentVisible(snapshot)
  if (!raw || !visible) {
    return {
      currentRaw: raw,
      currentVisible: visible,
      continuousAge: continuousAgeAt(snapshot),
      currentAbility: null,
      potentialAbility: null,
      professionalism: null,
      ambition: null,
      determination: determination(snapshot),
      inputProvenanceStatus: 'UNAVAILABLE',
      history: null,
      unavailableReason: 'RAW_STATE_UNAVAILABLE',
      warnings: ['ProjectedRoleScore requer o vetor raw 47 completo de um snapshot .fm autorizado.'],
    }
  }
  const age = continuousAgeAt(snapshot)
  if (age === null || age < 16 || age >= 30) {
    return {
      currentRaw: raw,
      currentVisible: visible,
      continuousAge: age,
      currentAbility: null,
      potentialAbility: null,
      professionalism: null,
      ambition: null,
      determination: determination(snapshot),
      inputProvenanceStatus: 'UNAVAILABLE',
      history: null,
      unavailableReason: 'OUTSIDE_VALIDATED_AGE_DOMAIN',
      warnings,
    }
  }
  const ca = hiddenFact(snapshot, 'current_ability')
  const pa = hiddenFact(snapshot, 'potential_ability')
  if (ca === null || pa === null) {
    return {
      currentRaw: raw,
      currentVisible: visible,
      continuousAge: age,
      currentAbility: ca,
      potentialAbility: pa,
      professionalism: null,
      ambition: null,
      determination: determination(snapshot),
      inputProvenanceStatus: 'UNAVAILABLE',
      history: null,
      unavailableReason: 'ABILITY_UNAVAILABLE',
      warnings: ['CA/PA de fontes não autorizadas permanecem rejeitados; não há imputação.'],
    }
  }
  const professionalism = hiddenFact(snapshot, 'professionalism')
  const ambition = hiddenFact(snapshot, 'ambition')
  const det = determination(snapshot)
  if (professionalism === null || ambition === null || det === null) {
    return {
      currentRaw: raw,
      currentVisible: visible,
      continuousAge: age,
      currentAbility: ca,
      potentialAbility: pa,
      professionalism,
      ambition,
      determination: det,
      inputProvenanceStatus: 'UNAVAILABLE',
      history: null,
      unavailableReason: 'PERSONALITY_UNAVAILABLE',
      warnings: ['A branch personality-partial não está congelada nesta versão; ProjectedRoleScore falha fechado.'],
    }
  }
  const history = historyFor(snapshot, previousSnapshot, identityStable)
  if (previousSnapshot && !history) warnings.push('Histórico não passou provenance/identidade/tempo; fallback exato para COLD_START.')
  return {
    currentRaw: raw,
    currentVisible: visible,
    continuousAge: age,
    currentAbility: ca,
    potentialAbility: pa,
    professionalism,
    ambition,
    determination: det,
    inputProvenanceStatus: 'FULL_TRUSTED',
    history,
    unavailableReason: null,
    warnings,
  }
}
