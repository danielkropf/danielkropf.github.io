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

/**
 * Expands a Planning set only on the vertical axis and always returns enough
 * height for every requested player row. Expanded sets deliberately float above
 * neighbouring compact sets instead of introducing an inner scrollbar: depth is
 * inspected by enlarging the set, not by creating a second scrolling surface.
 *
 * The full rectangle is kept inside the useful pitch whenever that is
 * geometrically possible. If the requested depth itself is taller than the
 * useful pitch, the helper preserves the requested height rather than silently
 * clipping it down; presentation can then decide how the outer pitch handles an
 * exceptional oversized depth list.
 */
export function resolvePlanningSetExpansion({
  pitchWidth,
  pitchHeight,
  compact,
  obstacles: _obstacles,
  playerCount,
  cardHeight,
  gap,
  verticalItemsPerRow = 1,
  verticalPadding = 16,
  boundaryMargin = 10,
}: ResolvePlanningSetExpansionInput): PlanningSetExpansion {
  const safeLeft = boundaryMargin
  const safeTop = boundaryMargin
  const safeRight = Math.max(safeLeft, pitchWidth - boundaryMargin)
  const safeBottom = Math.max(safeTop, pitchHeight - boundaryMargin)
  const usefulHeight = Math.max(0, safeBottom - safeTop)
  const width = Math.min(compact.width, Math.max(0, safeRight - safeLeft))
  const left = Math.max(safeLeft, Math.min(compact.left, safeRight - width))
  const compactTop = Math.max(safeTop, Math.min(compact.top, safeBottom - compact.height))
  const compactHeight = Math.min(compact.height, usefulHeight || compact.height)

  const perRow = Math.max(1, Math.floor(verticalItemsPerRow))
  const rows = Math.max(1, Math.ceil(Math.max(1, playerCount) / perRow))
  const desiredHeight = Math.max(compactHeight, rows * cardHeight + Math.max(0, rows - 1) * gap + verticalPadding)
  const desiredExtra = Math.max(0, desiredHeight - compactHeight)

  // Preserve the previous mental model: consume space above first. Unlike the
  // v0.32.3 implementation, obstacles do not cap the result because an expanded
  // set owns a floating z-layer and must reveal its complete depth.
  const availableAbove = Math.max(0, compactTop - safeTop)
  const growUp = Math.min(desiredExtra, availableAbove)
  let top = compactTop - growUp

  if (desiredHeight <= usefulHeight) {
    // If the remaining growth would cross the lower bound, shift the whole
    // expanded rectangle upward until it fits while preserving full height.
    top = Math.min(top, safeBottom - desiredHeight)
    top = Math.max(safeTop, top)
  } else {
    top = safeTop
  }

  return {
    direction: top < compactTop ? 'up' : 'down',
    axis: 'vertical',
    left,
    top,
    width,
    height: desiredHeight,
  }
}
