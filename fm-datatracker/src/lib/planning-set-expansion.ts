export type PlanningSetExpansionDirection = 'up' | 'down' | 'left' | 'right'
export type PlanningSetExpansionAxis = 'vertical' | 'horizontal'

export type PlanningSetRect = {
  left: number
  top: number
  width: number
  height: number
}

export type PlanningSetExpansion = PlanningSetRect & {
  direction: PlanningSetExpansionDirection
  axis: PlanningSetExpansionAxis
}

type ResolvePlanningSetExpansionInput = {
  pitchWidth: number
  pitchHeight: number
  compact: PlanningSetRect
  obstacles: PlanningSetRect[]
  playerCount: number
  cardWidth: number
  cardHeight: number
  gap: number
  verticalItemsPerRow?: number
  horizontalItemsPerColumn?: number
  horizontalPadding?: number
  verticalPadding?: number
  boundaryMargin?: number
  obstacleGutter?: number
}

const EPSILON = 0.5
function right(rect: PlanningSetRect) { return rect.left + rect.width }
function bottom(rect: PlanningSetRect) { return rect.top + rect.height }
function overlapsRange(aStart: number, aEnd: number, bStart: number, bEnd: number, gutter: number) {
  return aEnd + gutter > bStart && bEnd + gutter > aStart
}

/**
 * Expands a Planning set only on the vertical axis. Product behavior for the
 * full-pitch depth list is deliberately asymmetric: consume clear space above
 * first and, when that is insufficient, continue below. Horizontal expansion
 * is never used because it distorts the fixed 5x5 + GK visual grid.
 *
 * The returned rectangle never crosses the useful pitch bounds or a vertically
 * adjacent set whose horizontal footprint overlaps the source. When the pitch
 * cannot reveal the entire requested depth, the returned height is the maximum
 * safe vertical envelope; the expanded list then scrolls internally.
 */
export function resolvePlanningSetExpansion({
  pitchWidth,
  pitchHeight,
  compact,
  obstacles,
  playerCount,
  cardHeight,
  gap,
  verticalItemsPerRow = 1,
  verticalPadding = 16,
  boundaryMargin = 10,
  obstacleGutter = 8,
}: ResolvePlanningSetExpansionInput): PlanningSetExpansion {
  const safeLeft = boundaryMargin
  const safeTop = boundaryMargin
  const safeRight = Math.max(safeLeft, pitchWidth - boundaryMargin)
  const safeBottom = Math.max(safeTop, pitchHeight - boundaryMargin)
  const compactLeft = Math.max(safeLeft, Math.min(compact.left, safeRight - compact.width))
  const compactTop = Math.max(safeTop, Math.min(compact.top, safeBottom - compact.height))
  const normalizedCompact: PlanningSetRect = { left: compactLeft, top: compactTop, width: Math.min(compact.width, safeRight - safeLeft), height: Math.min(compact.height, safeBottom - safeTop) }
  const compactRight = right(normalizedCompact)
  const compactBottom = bottom(normalizedCompact)

  const perRow = Math.max(1, Math.floor(verticalItemsPerRow))
  const rows = Math.max(1, Math.ceil(Math.max(1, playerCount) / perRow))
  const desiredHeight = Math.max(normalizedCompact.height, rows * cardHeight + Math.max(0, rows - 1) * gap + verticalPadding)
  const desiredExtra = Math.max(0, desiredHeight - normalizedCompact.height)

  let upBoundary = safeTop
  let downBoundary = safeBottom
  for (const obstacle of obstacles) {
    const obstacleRight = right(obstacle)
    const obstacleBottom = bottom(obstacle)
    if (!overlapsRange(normalizedCompact.left, compactRight, obstacle.left, obstacleRight, obstacleGutter)) continue
    if (obstacleBottom <= normalizedCompact.top + EPSILON) upBoundary = Math.max(upBoundary, obstacleBottom + obstacleGutter)
    if (obstacle.top >= compactBottom - EPSILON) downBoundary = Math.min(downBoundary, obstacle.top - obstacleGutter)
  }

  const availableUp = Math.max(0, normalizedCompact.top - upBoundary)
  const availableDown = Math.max(0, downBoundary - compactBottom)
  const growUp = Math.min(desiredExtra, availableUp)
  const growDown = Math.min(Math.max(0, desiredExtra - growUp), availableDown)

  return {
    direction: growUp > EPSILON ? 'up' : 'down',
    axis: 'vertical',
    left: normalizedCompact.left,
    top: normalizedCompact.top - growUp,
    width: normalizedCompact.width,
    height: normalizedCompact.height + growUp + growDown,
  }
}
