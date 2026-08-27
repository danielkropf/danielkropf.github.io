import { attributeScore, combinedPhaseScore } from './scoring'
import { roleDefaultWeights } from './roleWeights'
import { canPlayPosition } from './positions'
import type { ProjectionFamily } from './projection-reference'
import type { ReferencePlayer } from './reference'

export type BasePositionScoreResult = {
  position: string
  scoreKey: string
  family: ProjectionFamily
  score: number
}

type AttributeValue = { attribute_key: string; value: number | null }
type SnapshotLike = {
  positions: string[]
  normalized_data?: Record<string, unknown>
  raw_data?: Record<string, unknown>
  player_attributes: AttributeValue[]
}

type BaseDefinition = { position: string; scoreKey: string; family: ProjectionFamily; roleName: string }
export const BASE_POSITION_DEFINITIONS: BaseDefinition[] = [
  { position: 'GK', scoreKey: 'GK', family: 'GK', roleName: 'Goalkeeper' },
  { position: 'D (C)', scoreKey: 'DC', family: 'D', roleName: 'Centre-Back' },
  { position: 'D (L)', scoreKey: 'FB', family: 'D', roleName: 'Full Back' },
  { position: 'D (R)', scoreKey: 'FB', family: 'D', roleName: 'Full Back' },
  { position: 'WB (L)', scoreKey: 'WB', family: 'WB', roleName: 'Wing Back' },
  { position: 'WB (R)', scoreKey: 'WB', family: 'WB', roleName: 'Wing Back' },
  { position: 'DM (C)', scoreKey: 'DM', family: 'DM', roleName: 'Defensive Midfielder' },
  { position: 'M (C)', scoreKey: 'CM', family: 'M', roleName: 'Central Midfielder' },
  { position: 'M (L)', scoreKey: 'MRL', family: 'M', roleName: 'Wide Midfielder' },
  { position: 'M (R)', scoreKey: 'MRL', family: 'M', roleName: 'Wide Midfielder' },
  { position: 'AM (C)', scoreKey: 'AMC', family: 'AM', roleName: 'Attacking Midfielder' },
  { position: 'AM (L)', scoreKey: 'W', family: 'AM', roleName: 'Winger' },
  { position: 'AM (R)', scoreKey: 'W', family: 'AM', roleName: 'Winger' },
  { position: 'ST (C)', scoreKey: 'ST', family: 'ST', roleName: 'Centre Forward' },
]

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const normalizedKey = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

function phaseScore(attributes: AttributeValue[], phase: 'IP' | 'OOP', roleName: string) {
  const weights = roleDefaultWeights(`${phase}-base-position-score`, roleName)
  return attributeScore(attributes.map(attribute => ({ key: attribute.attribute_key, value: finite(attribute.value), weight: weights[attribute.attribute_key] ?? 1 })))
}

function referencePhaseScore(player: ReferencePlayer, attributeKeys: string[], phase: 'IP' | 'OOP', roleName: string) {
  const weights = roleDefaultWeights(`${phase}-base-position-score`, roleName)
  return attributeScore(attributeKeys.map((key, index) => ({ key, value: finite(player.v[index]), weight: weights[key] ?? 1 })))
}

function positionalRating(snapshot: SnapshotLike, definition: BaseDefinition) {
  const normalized = record(snapshot.normalized_data)
  const raw = record(snapshot.raw_data)
  const containers = [record(normalized.position_ratings), record(normalized.positions_numeric), record(record(normalized.fm_hidden).positions), record(raw.position_ratings)]
  const aliases = [definition.position, definition.position.replace(/[ ()]/g, ''), definition.scoreKey].map(normalizedKey)
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (!aliases.includes(normalizedKey(key))) continue
      const parsed = finite(value)
      if (parsed !== null) return parsed
    }
  }
  return null
}

function chooseBest(candidates: BasePositionScoreResult[]) {
  return candidates.length ? candidates.reduce((best, item) => item.score > best.score ? item : best) : null
}

export function generalBasePositionScore(snapshot: SnapshotLike): BasePositionScoreResult | null {
  const candidates: BasePositionScoreResult[] = []
  const seen = new Set<string>()
  for (const definition of BASE_POSITION_DEFINITIONS) {
    const rating = positionalRating(snapshot, definition)
    if (rating !== null ? rating < 15 : !canPlayPosition(snapshot.positions, definition.position)) continue
    const key = `${definition.scoreKey}:${definition.family}`
    if (seen.has(key)) continue
    const score = combinedPhaseScore(phaseScore(snapshot.player_attributes, 'IP', definition.roleName), phaseScore(snapshot.player_attributes, 'OOP', definition.roleName))
    if (score === null) continue
    candidates.push({ position: definition.position, scoreKey: definition.scoreKey, family: definition.family, score })
    seen.add(key)
  }
  return chooseBest(candidates)
}

export function generalBasePositionScoreForReference(player: ReferencePlayer, attributeKeys: string[]): BasePositionScoreResult | null {
  const candidates: BasePositionScoreResult[] = []
  const seen = new Set<string>()
  for (const definition of BASE_POSITION_DEFINITIONS) {
    if (!canPlayPosition([player.p], definition.position)) continue
    const key = `${definition.scoreKey}:${definition.family}`
    if (seen.has(key)) continue
    const score = combinedPhaseScore(referencePhaseScore(player, attributeKeys, 'IP', definition.roleName), referencePhaseScore(player, attributeKeys, 'OOP', definition.roleName))
    if (score === null) continue
    candidates.push({ position: definition.position, scoreKey: definition.scoreKey, family: definition.family, score })
    seen.add(key)
  }
  return chooseBest(candidates)
}
