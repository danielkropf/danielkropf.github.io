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
