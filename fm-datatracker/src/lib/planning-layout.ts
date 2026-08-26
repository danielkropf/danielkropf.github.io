export type PlanningCardLayout = {
  cardWidth: number
  capacity: number
  columns: number
  rows: number
  reservesExpand: boolean
}

export type PlanningInsertionRect = {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

const CARD_GAP = 6
const EXPAND_CONTROL_WIDTH = 40
const MAX_COLUMNS = 4
const IDEAL_CARD_WIDTH = 220
const PROJECTED_IDEAL_CARD_WIDTH = 260

function minimumCardWidth(width: number, showProjection = false) {
  if (showProjection) {
    if (width < 520) return 188
    if (width < 700) return 204
    return 220
  }
  if (width < 520) return 132
  if (width < 700) return 148
  return 164
}

function columnsThatFit(width: number, minCardWidth: number, reserveExpand: boolean) {
  const available = Math.max(0, width - (reserveExpand ? EXPAND_CONTROL_WIDTH + CARD_GAP : 0))
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((available + CARD_GAP) / (minCardWidth + CARD_GAP))))
}

/**
 * Calculates the collapsed planning layout without ever squeezing a player card
 * below the readability floor. The +N control is budgeted before card width is
 * calculated, so excess players are hidden instead of shrinking the row.
 */
export function calculatePlanningCardLayout(width: number, grouped: boolean, optionCount: number, showProjection = false): PlanningCardLayout {
  const minCardWidth = minimumCardWidth(width, showProjection)
  const rows = grouped ? 2 : 1
  const fullColumns = columnsThatFit(width, minCardWidth, false)
  const theoreticalCapacity = fullColumns * rows
  const reservesExpand = optionCount > theoreticalCapacity
  const finalRowColumns = reservesExpand ? columnsThatFit(width, minCardWidth, true) : fullColumns
  const capacity = grouped
    ? Math.min(8, fullColumns + (rows > 1 ? finalRowColumns : 0))
    : Math.min(4, finalRowColumns)

  const widestOccupiedRow = Math.max(1, Math.min(fullColumns, optionCount || fullColumns))
  const reserveOnSameRow = !grouped && reservesExpand
  const widthBudget = Math.max(0, width - (reserveOnSameRow ? EXPAND_CONTROL_WIDTH + CARD_GAP : 0))
  const cardWidth = Math.max(
    minCardWidth,
    Math.min(showProjection ? PROJECTED_IDEAL_CARD_WIDTH : IDEAL_CARD_WIDTH, Math.floor((widthBudget - CARD_GAP * (widestOccupiedRow - 1)) / widestOccupiedRow)),
  )

  return {
    cardWidth,
    capacity: Math.max(1, Math.min(grouped ? 8 : 4, capacity)),
    columns: fullColumns,
    rows,
    reservesExpand,
  }
}

function groupInsertionRows(cards: PlanningInsertionRect[]) {
  const sorted = [...cards].sort((a, b) => a.top - b.top || a.left - b.left)
  const rows: Array<{ top: number; bottom: number; cards: PlanningInsertionRect[] }> = []
  for (const card of sorted) {
    const centerY = (card.top + card.bottom) / 2
    let row = rows.find(candidate => {
      const candidateCenter = (candidate.top + candidate.bottom) / 2
      const tolerance = Math.max(8, Math.min(card.bottom - card.top, candidate.bottom - candidate.top) * 0.4)
      return Math.abs(candidateCenter - centerY) <= tolerance
    })
    if (!row) {
      row = { top: card.top, bottom: card.bottom, cards: [] }
      rows.push(row)
    }
    row.top = Math.min(row.top, card.top)
    row.bottom = Math.max(row.bottom, card.bottom)
    row.cards.push(card)
  }
  rows.sort((a, b) => a.top - b.top)
  rows.forEach(row => row.cards.sort((a, b) => a.left - b.left))
  return rows
}

/**
 * Resolves one of the continuous insertion zones in a planning card row.
 * `currentBeforeId` adds a small hysteresis margin so DOM movement caused by the
 * placeholder cannot make the target rapidly oscillate while the cursor is
 * effectively still in the same zone.
 */
export function resolvePlanningInsertionBefore(
  cards: PlanningInsertionRect[],
  clientX: number,
  clientY: number,
  currentBeforeId: string | null | undefined,
): string | null {
  if (!cards.length) return null
  const rows = groupInsertionRows(cards)

  let rowIndex = 0
  for (let index = 0; index < rows.length - 1; index += 1) {
    const boundary = (rows[index].bottom + rows[index + 1].top) / 2
    if (clientY >= boundary) rowIndex = index + 1
  }

  const row = rows[rowIndex]
  const insertionPoints = row.cards.map((card, index) => ({
    beforeId: card.id as string | null,
    x: index === 0 ? card.left : (row.cards[index - 1].right + card.left) / 2,
  }))
  const nextRowFirst = rows[rowIndex + 1]?.cards[0]?.id ?? null
  insertionPoints.push({ beforeId: nextRowFirst, x: row.cards[row.cards.length - 1].right })

  let best = insertionPoints[0]
  let bestDistance = Math.abs(clientX - best.x)
  for (const point of insertionPoints.slice(1)) {
    const distance = Math.abs(clientX - point.x)
    if (distance < bestDistance) { best = point; bestDistance = distance }
  }

  if (currentBeforeId !== undefined) {
    const current = insertionPoints.find(point => point.beforeId === currentBeforeId)
    if (current) {
      const currentDistance = Math.abs(clientX - current.x)
      if (currentDistance <= bestDistance + 14) return current.beforeId
    }
  }

  return best.beforeId
}
