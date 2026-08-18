export const POSITION_ORDER = ['GK', 'D', 'WB', 'DM', 'M', 'AM', 'ST'] as const

export type PositionCapability = { family: string; sides: string }

/** Expande a notação compacta do FM: em `D, WB (R)`, o `(R)` vale para D e WB. */
export function positionCapabilities(positions: string[]): PositionCapability[] {
  const capabilities: PositionCapability[] = []
  for (const raw of positions) {
    const pending: string[] = []
    const tokens = raw.toUpperCase().split(',').map(token => token.trim()).filter(Boolean)
    for (const token of tokens) {
      const side = token.match(/\(([^)]+)\)/)?.[1]?.replace(/[^RCL]/g, '') ?? ''
      const families = token.replace(/\([^)]*\)/g, '').split('/').map(value => value.trim()).filter(Boolean)
      pending.push(...families)
      if (side) {
        capabilities.push(...pending.splice(0).map(family => ({ family, sides: side })))
      }
    }
    capabilities.push(...pending.map(family => ({ family, sides: '' })))
  }
  return capabilities
}

export function canPlayPosition(positions: string[], target: string) {
  const normalized = target.toUpperCase().trim()
  const family = POSITION_ORDER.find(item => new RegExp(`^${item}(?:\\s|\\(|/|$)`).test(normalized)) ?? normalized.replace(/\s*\(.*/, '')
  const sides = normalized.match(/\(([^)]+)\)/)?.[1]?.replace(/[^RCL]/g, '') ?? ''
  return positionCapabilities(positions).some(position => position.family === family && (!sides || !position.sides || [...sides].some(side => position.sides.includes(side))))
}

export function positionRank(positions: string[]) {
  const primary = (positions[0] ?? '').toUpperCase().trim()
  if (/^GK(?:\s|\(|$)/.test(primary)) return 0
  if (/^D(?:\s|\(|\/|$)/.test(primary)) return 1
  if (/^WB(?:\s|\(|\/|$)/.test(primary)) return 2
  if (/^DM(?:\s|\(|\/|$)/.test(primary)) return 3
  if (/^M(?:\s|\(|\/|$)/.test(primary)) return 4
  if (/^AM(?:\s|\(|\/|$)/.test(primary)) return 5
  if (/^ST(?:\s|\(|\/|$)/.test(primary)) return 6
  return POSITION_ORDER.length
}

export function positionSideRank(positions: string[]) {
  const specification = (positions[0] ?? '').match(/\(([^)]+)\)/)?.[1]?.toUpperCase() ?? ''
  for (const side of specification) {
    const rank = ['R', 'C', 'L'].indexOf(side)
    if (rank !== -1) return rank
  }
  return 3
}
