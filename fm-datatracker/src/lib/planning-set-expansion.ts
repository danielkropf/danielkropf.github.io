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

type Candidate = PlanningSetExpansion & {
  extra: number
  desiredExtra: number
  ratio: number
}

const EPSILON = 0.5

function right(rect: PlanningSetRect) { return rect.left + rect.width }
function bottom(rect: PlanningSetRect) { return rect.top + rect.height }
function overlapsRange(aStart: number, aEnd: number, bStart: number, bEnd: number, gutter: number) {
  return aEnd + gutter > bStart && bEnd + gutter > aStart
}

function preferredCandidate(candidates: Candidate[], axis: PlanningSetExpansionAxis) {
  return candidates
    .filter(candidate => candidate.axis === axis && candidate.extra > EPSILON)
    .sort((a, b) => b.ratio - a.ratio || b.extra - a.extra || directionOrder(a.direction) - directionOrder(b.direction))[0]
}

function directionOrder(direction: PlanningSetExpansionDirection) {
  if (direction === 'down') return 0
  if (direction === 'up') return 1
  if (direction === 'right') return 2
  return 3
}

/**
 * Finds clear space around one compact Planning set without moving any other set.
 * Vertical growth has product priority. Horizontal growth is used when neither
 * vertical direction can reveal a meaningful portion of another card row.
 * Returned geometry is always clamped inside the pitch's useful area.
 */
export function resolvePlanningSetExpansion({
  pitchWidth,
  pitchHeight,
  compact,
  obstacles,
  playerCount,
  cardWidth,
  cardHeight,
  gap,
  verticalItemsPerRow = 2,
  horizontalItemsPerColumn = 1,
  horizontalPadding = 14,
  verticalPadding = 22,
  boundaryMargin = 14,
  obstacleGutter = 14,
}: ResolvePlanningSetExpansionInput): PlanningSetExpansion {
  const safeLeft = boundaryMargin
  const safeTop = boundaryMargin
  const safeRight = Math.max(safeLeft, pitchWidth - boundaryMargin)
  const safeBottom = Math.max(safeTop, pitchHeight - boundaryMargin)
  const compactRight = right(compact)
  const compactBottom = bottom(compact)

  const safeVerticalItemsPerRow = Math.max(1, Math.floor(verticalItemsPerRow))
  const safeHorizontalItemsPerColumn = Math.max(1, Math.floor(horizontalItemsPerColumn))
  const itemCount = Math.max(playerCount, 1)
  const rows = Math.max(1, Math.ceil(itemCount / safeVerticalItemsPerRow))
  const columns = Math.max(1, Math.ceil(itemCount / safeHorizontalItemsPerColumn))
  const desiredVerticalHeight = Math.max(compact.height, rows * cardHeight + Math.max(0, rows - 1) * gap + verticalPadding)
  const desiredHorizontalWidth = Math.max(compact.width, columns * cardWidth + Math.max(0, columns - 1) * gap + horizontalPadding)
  const desiredVerticalExtra = Math.max(1, desiredVerticalHeight - compact.height)
  const desiredHorizontalExtra = Math.max(1, desiredHorizontalWidth - compact.width)

  let upBoundary = safeTop
  let downBoundary = safeBottom
  let leftBoundary = safeLeft
  let rightBoundary = safeRight

  for (const obstacle of obstacles) {
    const obstacleRight = right(obstacle)
    const obstacleBottom = bottom(obstacle)

    if (overlapsRange(compact.left, compactRight, obstacle.left, obstacleRight, obstacleGutter)) {
      if (obstacleBottom <= compact.top + EPSILON) upBoundary = Math.max(upBoundary, obstacleBottom + obstacleGutter)
      if (obstacle.top >= compactBottom - EPSILON) downBoundary = Math.min(downBoundary, obstacle.top - obstacleGutter)
    }

    if (overlapsRange(compact.top, compactBottom, obstacle.top, obstacleBottom, obstacleGutter)) {
      if (obstacleRight <= compact.left + EPSILON) leftBoundary = Math.max(leftBoundary, obstacleRight + obstacleGutter)
      if (obstacle.left >= compactRight - EPSILON) rightBoundary = Math.min(rightBoundary, obstacle.left - obstacleGutter)
    }
  }

  const maxUpHeight = Math.max(compact.height, compactBottom - upBoundary)
  const maxDownHeight = Math.max(compact.height, downBoundary - compact.top)
  const maxLeftWidth = Math.max(compact.width, compactRight - leftBoundary)
  const maxRightWidth = Math.max(compact.width, rightBoundary - compact.left)

  const upHeight = Math.min(desiredVerticalHeight, maxUpHeight)
  const downHeight = Math.min(desiredVerticalHeight, maxDownHeight)
  const leftWidth = Math.min(desiredHorizontalWidth, maxLeftWidth)
  const rightWidth = Math.min(desiredHorizontalWidth, maxRightWidth)

  const candidates: Candidate[] = [
    {
      direction: 'up', axis: 'vertical',
      left: Math.max(safeLeft, Math.min(compact.left, safeRight - compact.width)),
      top: Math.max(safeTop, compactBottom - upHeight),
      width: Math.min(compact.width, safeRight - safeLeft), height: upHeight,
      extra: upHeight - compact.height, desiredExtra: desiredVerticalExtra,
      ratio: Math.max(0, upHeight - compact.height) / desiredVerticalExtra,
    },
    {
      direction: 'down', axis: 'vertical',
      left: Math.max(safeLeft, Math.min(compact.left, safeRight - compact.width)),
      top: Math.max(safeTop, Math.min(compact.top, safeBottom - downHeight)),
      width: Math.min(compact.width, safeRight - safeLeft), height: downHeight,
      extra: downHeight - compact.height, desiredExtra: desiredVerticalExtra,
      ratio: Math.max(0, downHeight - compact.height) / desiredVerticalExtra,
    },
    {
      direction: 'left', axis: 'horizontal',
      left: Math.max(safeLeft, compactRight - leftWidth),
      top: Math.max(safeTop, Math.min(compact.top, safeBottom - compact.height)),
      width: leftWidth, height: Math.min(compact.height, safeBottom - safeTop),
      extra: leftWidth - compact.width, desiredExtra: desiredHorizontalExtra,
      ratio: Math.max(0, leftWidth - compact.width) / desiredHorizontalExtra,
    },
    {
      direction: 'right', axis: 'horizontal',
      left: Math.max(safeLeft, Math.min(compact.left, safeRight - rightWidth)),
      top: Math.max(safeTop, Math.min(compact.top, safeBottom - compact.height)),
      width: rightWidth, height: Math.min(compact.height, safeBottom - safeTop),
      extra: rightWidth - compact.width, desiredExtra: desiredHorizontalExtra,
      ratio: Math.max(0, rightWidth - compact.width) / desiredHorizontalExtra,
    },
  ]

  const vertical = preferredCandidate(candidates, 'vertical')
  const horizontal = preferredCandidate(candidates, 'horizontal')
  // Roughly half a card row/column is enough to make scrolling reveal additional
  // depth without covering another positional set. Prefer vertical whenever it
  // offers that meaningful clearance.
  const meaningfulVertical = vertical && vertical.extra >= Math.min(48, cardHeight * 0.5)
  const meaningfulHorizontal = horizontal && horizontal.extra >= Math.min(42, cardWidth * 0.5)
  const chosen = meaningfulVertical ? vertical : meaningfulHorizontal ? horizontal : vertical ?? horizontal ?? candidates[1]

  return {
    direction: chosen.direction,
    axis: chosen.axis,
    left: Math.max(safeLeft, Math.min(chosen.left, safeRight - chosen.width)),
    top: Math.max(safeTop, Math.min(chosen.top, safeBottom - chosen.height)),
    width: Math.min(chosen.width, safeRight - safeLeft),
    height: Math.min(chosen.height, safeBottom - safeTop),
  }
}
