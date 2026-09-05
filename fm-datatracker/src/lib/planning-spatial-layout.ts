export type PlanningPitchLine = 'st' | 'am' | 'm' | 'dm' | 'd' | 'gk'
export type PlanningPitchSide = 'left' | 'center' | 'right'

export type PlanningSpatialItem = {
  key: string
  line: PlanningPitchLine
  label: string
  /** Exact horizontal anchor from the tactic structure (PITCH_NODES.x). */
  anchorX?: number
}

export type PlanningSpatialPlacement = PlanningSpatialItem & {
  side: PlanningPitchSide
  x: number
  y: number
  rowCount: number
}

const SAFE_PITCH_MIN_X = 10
const SAFE_PITCH_MAX_X = 90

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

function safeStructuralAnchor(anchorX: number) {
  // Structure uses a very wide 8..92 lane system. Planning sets are much
  // wider than structure markers, so the same raw anchors can clip full
  // set cards at the pitch edges. Compress the complete structural width
  // symmetrically into a safe 10..90 band while preserving relative order.
  const structuralMin = 8
  const structuralMax = 92
  const ratio = (anchorX - structuralMin) / (structuralMax - structuralMin)
  const safe = SAFE_PITCH_MIN_X + (ratio * (SAFE_PITCH_MAX_X - SAFE_PITCH_MIN_X))
  return Math.max(SAFE_PITCH_MIN_X, Math.min(SAFE_PITCH_MAX_X, safe))
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

    const rowCount = lineItems.length
    const y = LINE_Y[line]
    const hasStructuralAnchors = lineItems.every(item => Number.isFinite(item.anchorX))

    if (hasStructuralAnchors) {
      // Planning must preserve the exact relative lane from Structure. Labels such
      // as M(C)/DM(C)/D(C) are intentionally ambiguous: three different tactic
      // nodes may share the same label, so persisted set order cannot decide x.
      const ordered = lineItems
        .map((item, index) => ({ item, index, anchorX: item.anchorX as number }))
        .sort((a, b) => a.anchorX - b.anchorX || a.index - b.index)
      const allCentral = ordered.every(({ item }) => planningPitchSide(item.label) === 'center')
      const xValues = rowCount === 3 && allCentral
        // The canonical central trio (left/centre/right central nodes) needs a
        // little more breathing room than the globally compressed lane system
        // because three Planning sets are wider than Structure role markers.
        ? distribute(3, 26, 74)
        // All other structural nodes use the same symmetric compression. This
        // is especially important for five-set lines: 8/29/50/71/92 becomes
        // 10/30/50/70/90, keeping equal spacing and both flanks in bounds.
        : ordered.map(({ anchorX }) => safeStructuralAnchor(anchorX))

      ordered.forEach(({ item }, index) => placements.push({
        ...item,
        side: planningPitchSide(item.label),
        x: xValues[index],
        y,
        rowCount,
      }))
      continue
    }

    // Backward-compatible fallback for legacy/non-canonical tactic data that
    // does not expose a structural node anchor.
    const left = lineItems.filter(item => planningPitchSide(item.label) === 'left')
    const center = lineItems.filter(item => planningPitchSide(item.label) === 'center')
    const right = lineItems.filter(item => planningPitchSide(item.label) === 'right')
    const leftX = left.length === 1 ? [SAFE_PITCH_MIN_X] : distribute(left.length, SAFE_PITCH_MIN_X, 27)
    const rightX = right.length === 1 ? [SAFE_PITCH_MAX_X] : distribute(right.length, 73, SAFE_PITCH_MAX_X)
    const [centerMin, centerMax] = centerBand(left.length > 0, right.length > 0)
    const centerX = distribute(center.length, centerMin, centerMax)

    left.forEach((item, index) => placements.push({ ...item, side: 'left', x: leftX[index], y, rowCount }))
    center.forEach((item, index) => placements.push({ ...item, side: 'center', x: centerX[index], y, rowCount }))
    right.forEach((item, index) => placements.push({ ...item, side: 'right', x: rightX[index], y, rowCount }))
  }

  return placements
}
