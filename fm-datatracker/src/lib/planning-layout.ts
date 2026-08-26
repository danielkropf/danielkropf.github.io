export type PlanningCardLayout = { cardWidth: number; capacity: number; columns: number; rows: number; reservesExpand: boolean }

export function calculatePlanningCardLayout(width: number, grouped: boolean, optionCount: number): PlanningCardLayout {
  const gap = 6
  const minCardWidth = width < 700 ? 148 : 164
  const maxCardWidth = 220
  const expandWidth = 40
  const rows = grouped ? 2 : 1
  const maxColumns = 4
  const columns = Math.min(maxColumns, Math.max(1, Math.floor((width + gap) / (minCardWidth + gap))))
  const reservesExpand = optionCount > columns * rows
  const lastRowWidth = Math.max(minCardWidth, width - (reservesExpand ? expandWidth + gap : 0))
  const lastRowColumns = Math.min(columns, Math.max(1, Math.floor((lastRowWidth + gap) / (minCardWidth + gap))))
  const widthColumns = Math.max(1, Math.min(columns, optionCount || columns))
  const cardWidth = Math.max(minCardWidth, Math.min(maxCardWidth, Math.floor((width - gap * (widthColumns - 1) - (reservesExpand ? expandWidth + gap : 0)) / widthColumns)))
  const visibleCapacity = reservesExpand ? columns * (rows - 1) + lastRowColumns : columns * rows
  return { cardWidth, capacity: Math.max(1, Math.min(grouped ? 8 : 4, visibleCapacity)), columns, rows, reservesExpand }
}
