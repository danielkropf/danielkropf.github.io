import { canPlayPosition } from './positions'
import { positionalRating } from './position-aptitude'

export type PlanningFamiliarity = 'familiar' | 'out-ip' | 'out-oop' | 'out-both' | 'unknown'
export type FamiliarityPhase = 'ip' | 'oop'

type PositionPair = { ip: { position: string }; oop: { position: string } }
type FamiliaritySnapshot = { positions: string[]; normalized_data?: Record<string, unknown>; raw_data?: Record<string, unknown> }
type PhaseState = 'familiar' | 'out' | 'unknown'

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

export type FamiliarityDetail = { phase: FamiliarityPhase; position: string; rating: number | null; label: string }

function familiarityEvidenceLabel(snapshot: FamiliaritySnapshot, position: string) {
  const rating = positionalRating(snapshot, position)
  if (rating !== null) return { rating, label: `${rating}/20` }
  if (!snapshot.positions.length) return { rating: null, label: 'Desconhecida' }
  return { rating: null, label: canPlayPosition(snapshot.positions, position) ? 'Familiar' : 'Sem familiaridade' }
}

export function planningFamiliarityDetails(snapshot: FamiliaritySnapshot | undefined, pairs: PositionPair[]): FamiliarityDetail[] {
  if (!snapshot) return []
  const result: FamiliarityDetail[] = []
  for (const phase of ['ip', 'oop'] as FamiliarityPhase[]) {
    for (const position of [...new Set(pairs.map(pair => pair[phase].position))]) {
      const evidence = familiarityEvidenceLabel(snapshot, position)
      result.push({ phase, position, rating: evidence.rating, label: evidence.label })
    }
  }
  return result
}

export function planningFamiliarityTooltip(snapshot: FamiliaritySnapshot | undefined, pairs: PositionPair[]) {
  const details = planningFamiliarityDetails(snapshot, pairs)
  if (!details.length) return 'Familiaridade neste slot\nDados insuficientes'

  const uniquePositions = [...new Set(details.map(detail => detail.position.replaceAll(' ', '')))]
  if (uniquePositions.length === 1) {
    const labels = [...new Set(details.map(detail => detail.label))]
    if (labels.length === 1) return `Familiaridade neste slot\n\n${uniquePositions[0]}: ${labels[0]}`
  }

  const lines = details.map(detail => `${detail.phase.toUpperCase()} — ${detail.position.replaceAll(' ', '')}: ${detail.label}`)
  return `Familiaridade neste slot\n\n${lines.join('\n')}`
}
