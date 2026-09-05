export type PlanningPitchLine = 'st' | 'am' | 'm' | 'dm' | 'd' | 'gk'
export type PlanningPitchSide = 'left' | 'center' | 'right'

export type PlanningSpatialItem = {
  key: string
  line: PlanningPitchLine
  label: string
}

export type PlanningSpatialPlacement = PlanningSpatialItem & {
  side: PlanningPitchSide
  x: number
  y: number
  rowCount: number
}

const LINE_Y: Record<PlanningPitchLine, number> = {
  st: 9,
  am: 25,
  m: 42,
  dm: 59,
  d: 77,
  gk: 92,
}

function distribute(count: number, min: number, max: number) {
  if (count <= 0) return []
  if (count === 1) return [(min + max) / 2]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, index) => min + (step * index))
}

export function planningPitchSide(label: string): PlanningPitchSide {
  const normalized = label.toUpperCase().replaceAll(' ', '')
  const left = normalized.includes('(L)')
  const right = normalized.includes('(R)')
  if (left && !right) return 'left'
  if (right && !left) return 'right'
  return 'center'
}

function centerBand(hasLeft: boolean, hasRight: boolean) {
  if (hasLeft && hasRight) return [31, 69] as const
  if (hasLeft) return [38, 76] as const
  if (hasRight) return [24, 62] as const
  return [32, 68] as const
}

export function planningSpatialLayout(items: PlanningSpatialItem[]): PlanningSpatialPlacement[] {
  const placements: PlanningSpatialPlacement[] = []
  const lines: PlanningPitchLine[] = ['st', 'am', 'm', 'dm', 'd', 'gk']

  for (const line of lines) {
    const lineItems = items.filter(item => item.line === line)
    if (!lineItems.length) continue

    const left = lineItems.filter(item => planningPitchSide(item.label) === 'left')
    const center = lineItems.filter(item => planningPitchSide(item.label) === 'center')
    const right = lineItems.filter(item => planningPitchSide(item.label) === 'right')
    const rowCount = lineItems.length
    const y = LINE_Y[line]

    const leftX = left.length === 1 ? [10] : distribute(left.length, 8, 23)
    const rightX = right.length === 1 ? [90] : distribute(right.length, 77, 92)
    const [centerMin, centerMax] = centerBand(left.length > 0, right.length > 0)
    const centerX = distribute(center.length, centerMin, centerMax)

    left.forEach((item, index) => placements.push({ ...item, side: 'left', x: leftX[index], y, rowCount }))
    center.forEach((item, index) => placements.push({ ...item, side: 'center', x: centerX[index], y, rowCount }))
    right.forEach((item, index) => placements.push({ ...item, side: 'right', x: rightX[index], y, rowCount }))
  }

  return placements
}
