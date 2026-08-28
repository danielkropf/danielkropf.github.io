export const POSITION_ORDER = ['GK', 'D', 'WB', 'DM', 'M', 'AM', 'ST'] as const

export type PositionCapability = { family: string; sides: string }

const compactCapability = (token: string): PositionCapability | null => {
  const clean = token.toUpperCase().replace(/\s+/g, '')
  if (clean === 'GK') return { family: 'GK', sides: '' }
  const match = clean.match(/^(WB|DM|AM|ST|D|M)([RCL]+)$/)
  return match ? { family: match[1], sides: match[2] } : null
}

/**
 * Expande tanto a notação compacta do FM (`D, WB (R)`) quanto os códigos
 * compactados que chegam em alguns imports (`DC`, `WBR`, `MC`, `AMC`).
 */
export function positionCapabilities(positions: string[]): PositionCapability[] {
  const capabilities: PositionCapability[] = []
  const pending: string[] = []
  const tokens = positions.flatMap(raw => raw.toUpperCase().split(',')).map(token => token.trim()).filter(Boolean)
  for (const token of tokens) {
    const compact = compactCapability(token)
    if (compact) {
      if (pending.length) capabilities.push(...pending.splice(0).map(family => ({ family, sides: compact.sides })))
      capabilities.push(compact)
      continue
    }

    const side = token.match(/\(([^)]+)\)/)?.[1]?.replace(/[^RCL]/g, '') ?? ''
    const families = token.replace(/\([^)]*\)/g, '').split('/').map(value => value.trim()).filter(Boolean)
    pending.push(...families)
    if (side) capabilities.push(...pending.splice(0).map(family => ({ family, sides: side })))
  }
  capabilities.push(...pending.map(family => ({ family, sides: '' })))
  return capabilities
}

export function canPlayPosition(positions: string[], target: string) {
  const normalized = target.toUpperCase().trim()
  const compactTarget = compactCapability(normalized)
  const family = compactTarget?.family ?? POSITION_ORDER.find(item => new RegExp(`^${item}(?:\\s|\\(|/|$)`).test(normalized)) ?? normalized.replace(/\s*\(.*/, '')
  const sides = compactTarget?.sides ?? normalized.match(/\(([^)]+)\)/)?.[1]?.replace(/[^RCL]/g, '') ?? ''
  return positionCapabilities(positions).some(position => position.family === family && (!sides || !position.sides || [...sides].some(side => position.sides.includes(side))))
}

export function positionRank(positions: string[]) {
  const capability = positionCapabilities(positions)[0]
  if (!capability) return POSITION_ORDER.length
  const rank = POSITION_ORDER.indexOf(capability.family as (typeof POSITION_ORDER)[number])
  return rank === -1 ? POSITION_ORDER.length : rank
}

export function positionSideRank(positions: string[]) {
  const specification = positionCapabilities(positions)[0]?.sides ?? ''
  for (const side of specification) {
    const rank = ['R', 'C', 'L'].indexOf(side)
    if (rank !== -1) return rank
  }
  return 3
}
