export const PLANNING_PITCH_LIST_CAPACITY = 3

const CENTRAL_TRIPLE_NODE_SIDE: Record<string, 'Left' | 'Center' | 'Right'> = {
  dcl: 'Left', dc: 'Center', dcr: 'Right',
  dml: 'Left', dmc: 'Center', dmr: 'Right',
  mcl: 'Left', mc: 'Center', mcr: 'Right',
  amcl: 'Left', amc: 'Center', amcr: 'Right',
  stl: 'Left', stc: 'Center', str: 'Right',
}

function uniqueLabels(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function compactPosition(position: string) {
  const compact = position.replaceAll(' ', '')
  if (compact === 'DM(C)') return 'DM'
  if (compact === 'ST(C)') return 'ST'
  return compact
}

export function planningPitchPositionLabel(position: string, nodeId?: string) {
  const base = compactPosition(position)
  const side = nodeId ? CENTRAL_TRIPLE_NODE_SIDE[nodeId] : undefined
  return side ? `${base} ${side}` : base
}

export function planningPitchSetHeader(position: string, ipRoles: string[], oopRoles: string[]) {
  const ip = uniqueLabels(ipRoles).join(' / ') || '—'
  const oop = uniqueLabels(oopRoles).join(' / ') || '—'
  return `${position}\nIP: ${ip} · OOP: ${oop}`
}
