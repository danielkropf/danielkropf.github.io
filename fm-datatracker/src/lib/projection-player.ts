import type { ProjectionInput, PersonalitySource } from './projection-engine'
import type { ProjectionReference, ProjectionScoreType } from './projection-reference'
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
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

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
  const cp = finite(hidden.potential_ability) ?? finite(normalized.potential_ability) ?? finite(normalized.pa_candidate)
  const professionalism = finite(hidden.professionalism) ?? finite(personality.professionalism)
  const ambition = finite(hidden.ambition) ?? finite(personality.ambition)
  const determination = finite(snapshot.player_attributes.find(attribute => attribute.attribute_key === 'determination')?.value)
  const birthDate = text(raw.birth_date) ?? text(raw.date_of_birth) ?? text(normalized.date_of_birth)
  const exact = professionalism !== null && ambition !== null && determination !== null
  const personalitySource: PersonalitySource = exact ? 'exact' : 'neutral'
  return { cp, professionalism, ambition, determination, birthDate, personalitySource }
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
  return {
    currentScore,
    scoreType,
    scoreKey: scoreKey ?? generalProjectionKey(snapshot.positions),
    eligible,
    reference,
    snapshotDate: snapshot.snapshot_date,
    birthDate: facts.birthDate,
    cp: facts.cp,
    professionalism: facts.professionalism,
    ambition: facts.ambition,
    determination: facts.determination,
    personalitySource: facts.personalitySource,
  }
}

export function supportsProjectionPositions(snapshot: ProjectionSnapshot, positions: string[]) {
  return positions.every(position => canPlayPosition(snapshot.positions, position))
}
