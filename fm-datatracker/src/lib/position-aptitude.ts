import { canPlayPosition } from './positions'

export const GENERAL_SCORE_POSITION_THRESHOLD = 15

export type PositionAptitudeSnapshot = {
  positions: string[]
  normalized_data?: Record<string, unknown>
  raw_data?: Record<string, unknown>
}

export const POSITION_ABILITY_KEYS: Record<string, string> = {
  GK: 'goalkeeper', DL: 'defender_left', DC: 'defender_center', DR: 'defender_right', DM: 'defensive_midfielder',
  WBL: 'wing_back_left', WBR: 'wing_back_right', ML: 'midfielder_left', MC: 'midfielder_central', MR: 'midfielder_right',
  AML: 'attacking_midfielder_left', AMC: 'attacking_midfielder_central', AMR: 'attacking_midfielder_right', ST: 'striker',
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const normalizedKey = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export function compactPositionCode(position: string) {
  const raw = position.toUpperCase().replace(/[^A-Z]/g, '')
  for (const code of ['WBL', 'WBR', 'AML', 'AMC', 'AMR', 'GK', 'DM', 'DL', 'DC', 'DR', 'ML', 'MC', 'MR', 'ST']) {
    if (raw.startsWith(code)) return code
  }
  if (raw === 'G') return 'GK'
  return raw
}

export function positionalRating(snapshot: PositionAptitudeSnapshot, position: string): number | null {
  const normalized = record(snapshot.normalized_data)
  const code = compactPositionCode(position)

  const abilityKey = POSITION_ABILITY_KEYS[code]
  const aliases = [code, position, position.replace(/[ ()]/g, ''), abilityKey ?? ''].filter(Boolean).map(normalizedKey)

  const ratings = record(normalized.positional_ratings)
  const direct = finite(ratings[code])
  if (direct !== null) return direct
  for (const [key, value] of Object.entries(ratings)) {
    if (!aliases.includes(normalizedKey(key))) continue
    const parsed = finite(value)
    if (parsed !== null) return parsed
  }

  const ability = record(normalized.positional_ability)
  if (abilityKey) {
    const abilityValue = finite(ability[abilityKey])
    if (abilityValue !== null) return abilityValue
  }
  for (const [key, value] of Object.entries(ability)) {
    if (!aliases.includes(normalizedKey(key))) continue
    const parsed = finite(value)
    if (parsed !== null) return parsed
  }
  return null
}

export function isGeneralScorePositionEligible(snapshot: PositionAptitudeSnapshot, position: string) {
  const rating = positionalRating(snapshot, position)
  if (rating !== null) return rating >= GENERAL_SCORE_POSITION_THRESHOLD
  return canPlayPosition(snapshot.positions, position)
}
