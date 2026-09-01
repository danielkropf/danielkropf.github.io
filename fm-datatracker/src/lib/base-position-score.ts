import { pairedRoleScore, canonicalRoleDefaultWeights } from './role-scoring'
import { canPlayPosition } from './positions'
import { isGeneralScorePositionEligible } from './position-aptitude'
import type { ProjectionFamily } from './projection-reference'
import type { ReferencePlayer } from './reference'

export type BasePositionScoreResult = {
  position: string
  scoreKey: string
  family: ProjectionFamily
  group: BasePositionGroup
  roleCode: string
  roleName: string
  score: number
}

type AttributeValue = { attribute_key: string; value: number | null }
export type GeneralScoreSnapshot = {
  positions: string[]
  normalized_data?: Record<string, unknown>
  raw_data?: Record<string, unknown>
  player_attributes: AttributeValue[]
}

export type BasePositionGroup = 'GK' | 'CB' | 'FB' | 'WB' | 'DM' | 'CM' | 'WM' | 'AM' | 'W' | 'ST'

export type BaseDefinition = {
  position: string
  scoreKey: string
  family: ProjectionFamily
  group: BasePositionGroup
  roleCode: string
  roleName: string
}

export const BASE_POSITION_DEFINITIONS: BaseDefinition[] = [
  { position: 'GK', scoreKey: 'GK', family: 'GK', group: 'GK', roleCode: 'GK', roleName: 'Goalkeeper' },
  { position: 'D (C)', scoreKey: 'DC', family: 'D', group: 'CB', roleCode: 'CB', roleName: 'Centre-Back' },
  { position: 'D (L)', scoreKey: 'FB', family: 'D', group: 'FB', roleCode: 'FB', roleName: 'Full Back' },
  { position: 'D (R)', scoreKey: 'FB', family: 'D', group: 'FB', roleCode: 'FB', roleName: 'Full Back' },
  { position: 'WB (L)', scoreKey: 'WB', family: 'WB', group: 'WB', roleCode: 'WB', roleName: 'Wing Back' },
  { position: 'WB (R)', scoreKey: 'WB', family: 'WB', group: 'WB', roleCode: 'WB', roleName: 'Wing Back' },
  { position: 'DM (C)', scoreKey: 'DM', family: 'DM', group: 'DM', roleCode: 'DM', roleName: 'Defensive Midfielder' },
  { position: 'M (C)', scoreKey: 'CM', family: 'M', group: 'CM', roleCode: 'CM', roleName: 'Central Midfielder' },
  { position: 'M (L)', scoreKey: 'MRL', family: 'M', group: 'WM', roleCode: 'WM', roleName: 'Wide Midfielder' },
  { position: 'M (R)', scoreKey: 'MRL', family: 'M', group: 'WM', roleCode: 'WM', roleName: 'Wide Midfielder' },
  { position: 'AM (C)', scoreKey: 'AMC', family: 'AM', group: 'AM', roleCode: 'AM', roleName: 'Attacking Midfielder' },
  { position: 'AM (L)', scoreKey: 'W', family: 'AM', group: 'W', roleCode: 'W', roleName: 'Winger' },
  { position: 'AM (R)', scoreKey: 'W', family: 'AM', group: 'W', roleCode: 'W', roleName: 'Winger' },
  { position: 'ST (C)', scoreKey: 'ST', family: 'ST', group: 'ST', roleCode: 'CF', roleName: 'Centre Forward' },
]

function baseWeights(phase: 'IP' | 'OOP', definition: BaseDefinition) {
  return canonicalRoleDefaultWeights(`${phase}-${definition.group}-${definition.roleCode}`, definition.roleName)
}

function scoreDefinition(attributes: AttributeValue[], definition: BaseDefinition) {
  return pairedRoleScore(attributes, baseWeights('IP', definition), baseWeights('OOP', definition))
}

function referenceAttributes(player: ReferencePlayer, attributeKeys: string[]) {
  return attributeKeys.map((key, index) => ({ key, value: player.v[index] ?? null }))
}

function chooseBest(candidates: BasePositionScoreResult[]) {
  return candidates.length ? candidates.reduce((best, item) => item.score > best.score ? item : best) : null
}

export function eligibleBasePositionDefinitions(snapshot: GeneralScoreSnapshot) {
  return BASE_POSITION_DEFINITIONS.filter(definition => isGeneralScorePositionEligible(snapshot, definition.position))
}

export function eligibleGeneralScoreFamilies(snapshot: GeneralScoreSnapshot) {
  return [...new Set(eligibleBasePositionDefinitions(snapshot).map(definition => definition.family))]
}

export function basePositionScores(snapshot: GeneralScoreSnapshot): BasePositionScoreResult[] {
  const candidates: BasePositionScoreResult[] = []
  const seen = new Set<string>()
  for (const definition of eligibleBasePositionDefinitions(snapshot)) {
    const key = `${definition.scoreKey}:${definition.family}`
    if (seen.has(key)) continue
    const score = scoreDefinition(snapshot.player_attributes, definition)
    if (score === null) continue
    candidates.push({ position: definition.position, scoreKey: definition.scoreKey, family: definition.family, group: definition.group, roleCode: definition.roleCode, roleName: definition.roleName, score })
    seen.add(key)
  }
  return candidates
}

export function generalScoreForSnapshot(snapshot: GeneralScoreSnapshot): BasePositionScoreResult | null {
  return chooseBest(basePositionScores(snapshot))
}

export function generalScoreValue(snapshot: GeneralScoreSnapshot | null | undefined) {
  return snapshot ? generalScoreForSnapshot(snapshot)?.score ?? null : null
}

export function basePositionScoresForReference(player: ReferencePlayer, attributeKeys: string[]): BasePositionScoreResult[] {
  const candidates: BasePositionScoreResult[] = []
  const seen = new Set<string>()
  const attributes = referenceAttributes(player, attributeKeys)
  for (const definition of BASE_POSITION_DEFINITIONS) {
    if (!canPlayPosition([player.p], definition.position)) continue
    const key = `${definition.scoreKey}:${definition.family}`
    if (seen.has(key)) continue
    const score = pairedRoleScore(attributes, baseWeights('IP', definition), baseWeights('OOP', definition))
    if (score === null) continue
    candidates.push({ position: definition.position, scoreKey: definition.scoreKey, family: definition.family, group: definition.group, roleCode: definition.roleCode, roleName: definition.roleName, score })
    seen.add(key)
  }
  return candidates
}

export function generalScoreForReference(player: ReferencePlayer, attributeKeys: string[]): BasePositionScoreResult | null {
  return chooseBest(basePositionScoresForReference(player, attributeKeys))
}

export const generalBasePositionScore = generalScoreForSnapshot
export const generalBasePositionScoreForReference = generalScoreForReference

