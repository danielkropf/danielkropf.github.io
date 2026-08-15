export const POSITION_ORDER = ['GK', 'D', 'WB', 'DM', 'M', 'AM', 'ST'] as const

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
