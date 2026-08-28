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

const record = (value: unknown): UnknownRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
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
  const sources = [hidden, normalized, raw]
  const ca = deepFinite(sources, ['current_ability', 'ca', 'ca_candidate'])
  const pa = deepFinite(sources, ['potential_ability', 'pa', 'pa_candidate'])
  const professionalism = deepFinite([hidden, personality, normalized, raw], ['professionalism'])
  const ambition = deepFinite([hidden, personality, normalized, raw], ['ambition'])
  const determination = finite(snapshot.player_attributes.find(attribute => attribute.attribute_key === 'determination')?.value) ?? deepFinite([hidden, personality, normalized, raw], ['determination'])
  const birthDate = text(raw.birth_date) ?? text(raw.date_of_birth) ?? text(normalized.birth_date) ?? text(normalized.date_of_birth)
  const exact = professionalism !== null && ambition !== null && determination !== null
  const personalitySource: PersonalitySource = exact ? 'exact' : 'neutral'
  return { ca, pa, professionalism, ambition, determination, birthDate, personalitySource }
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
