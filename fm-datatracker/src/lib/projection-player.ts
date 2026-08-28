import type { ProjectionInput, PersonalitySource } from './projection-engine'
import type { ProjectionReference, ProjectionScoreType } from './projection-reference'
import { generalScoreForSnapshot } from './base-position-score'
import { canPlayPosition } from './positions'

type UnknownRecord = Record<string, unknown>
export type ProjectionSnapshot = {
  id?: string
  snapshot_date: string
  age?: number | null
  positions: string[]
  raw_data?: UnknownRecord
  normalized_data?: UnknownRecord
  player_attributes: Array<{ attribute_key: string; value: number }>
}

export type ProjectionAbilityFact = {
  value: number | null
  origin: 'fm26-save-offline' | null
  namespace: 'normalized_data.fm_hidden' | null
  status: 'candidate_with_provenance_not_universally_validated' | 'unavailable'
  confidence: 'experimental_candidate' | 'unavailable'
  reason: string | null
}

export type ProjectionAbilityFacts = {
  ca: ProjectionAbilityFact
  pa: ProjectionAbilityFact
  available: boolean
  reason: string | null
}

const ALLOWED_FM_ORIGIN = 'fm26-save-offline'
const ALLOWED_CA_PA_STATUS = 'candidate_with_provenance_not_universally_validated'

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
const record = (value: unknown): UnknownRecord => isRecord(value) ? value : {}
const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const normalizedKey = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

function deepFinite(sources: UnknownRecord[], keys: string[]) {
  const wanted = new Set(keys.map(normalizedKey))
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!wanted.has(normalizedKey(key))) continue
      const result = finite(value)
      if (result !== null) return result
    }
  }
  return null
}

function unavailableAbility(reason: string): ProjectionAbilityFact {
  return {
    value: null,
    origin: null,
    namespace: null,
    status: 'unavailable',
    confidence: 'unavailable',
    reason,
  }
}

function trustedAbilityFact(snapshot: ProjectionSnapshot, key: 'current_ability' | 'potential_ability'): ProjectionAbilityFact {
  const normalized = record(snapshot.normalized_data)
  if (text(normalized.source) !== ALLOWED_FM_ORIGIN) {
    return unavailableAbility('Projection requer CA/PA com provenance explícita do leitor .fm offline.')
  }
  if (text(normalized.ca_pa_status) !== ALLOWED_CA_PA_STATUS) {
    return unavailableAbility('O status de confiança de CA/PA não é autorizado pela Projection experimental atual.')
  }
  const hidden = record(normalized.fm_hidden)
  const value = finite(hidden[key])
  if (value === null) {
    return unavailableAbility(`${key === 'current_ability' ? 'CA' : 'PA'} confiável não está disponível neste snapshot.`)
  }
  return {
    value,
    origin: ALLOWED_FM_ORIGIN,
    namespace: 'normalized_data.fm_hidden',
    status: ALLOWED_CA_PA_STATUS,
    confidence: 'experimental_candidate',
    reason: null,
  }
}

/**
 * Canonical CA/PA gate for Projection.
 * PlayerExport CSV fields, raw_data and generic normalized top-level aliases are
 * intentionally preserved as evidence only and are never accepted here.
 */
export function projectionAbilityFacts(snapshot: ProjectionSnapshot): ProjectionAbilityFacts {
  const ca = trustedAbilityFact(snapshot, 'current_ability')
  const pa = trustedAbilityFact(snapshot, 'potential_ability')
  const available = ca.value !== null && pa.value !== null
  const reason = available ? null : ca.reason ?? pa.reason ?? 'CA/PA confiável indisponível.'
  return { ca, pa, available, reason }
}

export function generalProjectionKey(positions: string[]) {
  return positions.some(position => position.toUpperCase().replaceAll(' ', '').startsWith('GK')) ? 'GK' : 'OUTFIELD'
}

export function functionProjectionKey(parts: Array<{ phase: string; position: string; roleCode: string }>) {
  return parts.map(part => `${part.phase.toUpperCase()}:${part.position.toUpperCase().replaceAll(' ', '')}:${part.roleCode.toUpperCase()}`).join('|')
}

export function snapshotProjectionFacts(snapshot: ProjectionSnapshot) {
  const normalized = record(snapshot.normalized_data)
  const hidden = record(normalized.fm_hidden)
  const personality = record(normalized.hidden_personality)
  const raw = record(snapshot.raw_data)
  const abilities = projectionAbilityFacts(snapshot)
  const trustedFm = text(normalized.source) === ALLOWED_FM_ORIGIN
  const professionalism = trustedFm ? deepFinite([hidden, personality], ['professionalism']) : null
  const ambition = trustedFm ? deepFinite([hidden, personality], ['ambition']) : null
  const determination = finite(snapshot.player_attributes.find(attribute => attribute.attribute_key === 'determination')?.value)
    ?? (trustedFm ? deepFinite([hidden, personality], ['determination']) : null)
  const birthDate = text(normalized.birth_date) ?? text(normalized.date_of_birth) ?? text(raw.birth_date) ?? text(raw.date_of_birth)
  const exact = professionalism !== null && ambition !== null && determination !== null
  const personalitySource: PersonalitySource = exact ? 'exact' : 'neutral'
  return {
    ca: abilities.ca.value,
    pa: abilities.pa.value,
    caFact: abilities.ca,
    paFact: abilities.pa,
    abilityAvailable: abilities.available,
    abilityUnavailableReason: abilities.reason,
    professionalism,
    ambition,
    determination,
    birthDate,
    personalitySource,
  }
}

export function projectionInputForSnapshot({ snapshot, currentScore, scoreType, scoreKey, eligible = true, reference }: {
  snapshot: ProjectionSnapshot
  currentScore: number | null
  scoreType: ProjectionScoreType
  scoreKey?: string
  eligible?: boolean
  reference: ProjectionReference | null
}): ProjectionInput {
  const facts = snapshotProjectionFacts(snapshot)
  const p0 = scoreType === 'general' ? generalScoreForSnapshot(snapshot) : null
  return {
    currentScore: scoreType === 'general' ? p0?.score ?? null : currentScore,
    scoreType,
    scoreKey: scoreType === 'general' ? p0?.scoreKey ?? scoreKey ?? generalProjectionKey(snapshot.positions) : scoreKey ?? '',
    family: scoreType === 'general' ? p0?.family ?? null : null,
    eligible: scoreType === 'general' ? eligible && Boolean(p0) : true,
    reference,
    snapshotDate: snapshot.snapshot_date,
    birthDate: facts.birthDate,
    ca: facts.ca,
    pa: facts.pa,
    professionalism: facts.professionalism,
    ambition: facts.ambition,
    determination: facts.determination,
    personalitySource: facts.personalitySource,
  }
}

export function supportsProjectionPositions(snapshot: ProjectionSnapshot, positions: string[]) {
  return positions.every(position => canPlayPosition(snapshot.positions, position))
}
