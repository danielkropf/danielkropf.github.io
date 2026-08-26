import { canPlayPosition } from './positions'

export type PlanningFamiliarity = 'familiar' | 'out-ip' | 'out-oop' | 'out-both' | 'unknown'
export type FamiliarityPhase = 'ip' | 'oop'

type PositionPair = { ip: { position: string }; oop: { position: string } }
type FamiliaritySnapshot = { positions: string[]; normalized_data?: Record<string, unknown> }
type PhaseState = 'familiar' | 'out' | 'unknown'

const POSITION_ABILITY_KEYS: Record<string, string> = {
  GK: 'goalkeeper', DL: 'defender_left', DC: 'defender_center', DR: 'defender_right', DM: 'defensive_midfielder',
  WBL: 'wing_back_left', WBR: 'wing_back_right', ML: 'midfielder_left', MC: 'midfielder_central', MR: 'midfielder_right',
  AML: 'attacking_midfielder_left', AMC: 'attacking_midfielder_central', AMR: 'attacking_midfielder_right', ST: 'striker',
}

function compactPositionCode(position: string) {
  const raw = position.toUpperCase().replace(/[^A-Z]/g, '')
  for (const code of ['WBL', 'WBR', 'AML', 'AMC', 'AMR', 'GK', 'DM', 'DL', 'DC', 'DR', 'ML', 'MC', 'MR', 'ST']) {
    if (raw.startsWith(code)) return code
  }
  if (raw === 'G') return 'GK'
  return raw
}

function positionalRating(snapshot: FamiliaritySnapshot, position: string): number | null {
  const normalized = snapshot.normalized_data ?? {}
  const code = compactPositionCode(position)
  const rawRatings = normalized.positional_ratings
  if (rawRatings && typeof rawRatings === 'object' && !Array.isArray(rawRatings)) {
    const value = Number((rawRatings as Record<string, unknown>)[code])
    if (Number.isFinite(value)) return value
  }
  const ability = normalized.positional_ability
  const abilityKey = POSITION_ABILITY_KEYS[code]
  if (abilityKey && ability && typeof ability === 'object' && !Array.isArray(ability)) {
    const value = Number((ability as Record<string, unknown>)[abilityKey])
    if (Number.isFinite(value)) return value
  }
  return null
}

function phaseState(snapshot: FamiliaritySnapshot, pairs: PositionPair[], phase: FamiliarityPhase): PhaseState {
  const targets = [...new Set(pairs.map(pair => pair[phase].position))]
  let hasNumericEvidence = false
  for (const position of targets) {
    const rating = positionalRating(snapshot, position)
    if (rating === null) continue
    hasNumericEvidence = true
    if (rating >= 15) return 'familiar'
  }
  if (hasNumericEvidence) return 'out'
  if (!snapshot.positions.length) return 'unknown'
  return targets.some(position => canPlayPosition(snapshot.positions, position)) ? 'familiar' : 'out'
}

/**
 * Familiarity is evaluated independently for IP and OOP. A good rating in one
 * phase can no longer hide an out-of-position requirement in the other phase.
 */
export function planningFamiliarity(snapshot: FamiliaritySnapshot | undefined, pairs: PositionPair[]): PlanningFamiliarity {
  if (!snapshot || !pairs.length) return 'unknown'
  const ip = phaseState(snapshot, pairs, 'ip')
  const oop = phaseState(snapshot, pairs, 'oop')
  if (ip === 'out' && oop === 'out') return 'out-both'
  if (ip === 'out') return 'out-ip'
  if (oop === 'out') return 'out-oop'
  if (ip === 'familiar' && oop === 'familiar') return 'familiar'
  return 'unknown'
}

export function isPlanningFamiliar(familiarity: PlanningFamiliarity) { return familiarity === 'familiar' }
export function isPlanningOutOfPosition(familiarity: PlanningFamiliarity) { return familiarity.startsWith('out-') }
export function planningFamiliarityLabel(familiarity: PlanningFamiliarity) {
  if (familiarity === 'out-ip') return 'Fora de posição · IP'
  if (familiarity === 'out-oop') return 'Fora de posição · OOP'
  if (familiarity === 'out-both') return 'Fora de posição · IP/OOP'
  return null
}
