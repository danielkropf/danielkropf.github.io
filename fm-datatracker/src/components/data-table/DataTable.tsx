import { useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'

export type DataTableSort = { key: string; direction: 1 | -1 }

export type DataTableCapabilities = {
  sorting?: boolean
  resizing?: boolean
  reordering?: boolean
  freezing?: boolean
  selection?: boolean
}

export type DataTableColumnLike = {
  id: string
  label: string
}

type DataTableProps<Row, Column extends DataTableColumnLike> = {
  rows: Row[]
  columns: Column[]
  rowKey: (row: Row) => string
  renderCell: (row: Row, column: Column) => ReactNode
  getColumnWidth: (column: Column) => number
  sort?: DataTableSort
  onSort?: (key: string) => void
  selectedRowKey?: string | null
  onSelectRow?: (row: Row) => void
  capabilities?: DataTableCapabilities
  className?: string
  loading?: boolean
  loadingMessage?: ReactNode
  emptyMessage?: ReactNode
  frozenIndex?: number
  getCellClassName?: (row: Row, column: Column, columnIndex: number) => string | undefined
  getRowClassName?: (row: Row) => string | undefined
  renderHeaderLabel?: (column: Column) => ReactNode
  onHeaderContextMenu?: (event: MouseEvent, column: Column, columnIndex: number) => void
  onColumnResizeStart?: (event: MouseEvent, column: Column, columnIndex: number) => void
  onColumnMove?: (fromIndex: number, toIndex: number) => void
}

type DragTarget = { index: number; side: 'before' | 'after' }

const DEFAULT_CAPABILITIES: Required<DataTableCapabilities> = {
  sorting: true,
  resizing: false,
  reordering: false,
  freezing: false,
  selection: false,
}

export function DataTable<Row, Column extends DataTableColumnLike>({
  rows,
  columns,
  rowKey,
  renderCell,
  getColumnWidth,
  sort,
  onSort,
  selectedRowKey = null,
  onSelectRow,
  capabilities,
  className = '',
  loading = false,
  loadingMessage = 'Carregando…',
  emptyMessage = 'Nenhum resultado encontrado.',
  frozenIndex = -1,
  getCellClassName,
  getRowClassName,
  renderHeaderLabel,
  onHeaderContextMenu,
  onColumnResizeStart,
  onColumnMove,
}: DataTableProps<Row, Column>) {
  const enabled = { ...DEFAULT_CAPABILITIES, ...capabilities }
  const draggingColumnIndex = useRef<number | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)

  const widths = useMemo(() => columns.map(column => Math.max(1, getColumnWidth(column))), [columns, getColumnWidth])
  const tableWidth = useMemo(() => widths.reduce((total, width) => total + width, 0), [widths])
  const frozenOffsets = useMemo(() => {
    const offsets: number[] = []
    let left = 0
    for (const width of widths) {
      offsets.push(left)
      left += width
    }
    return offsets
  }, [widths])

  const clearDragState = () => {
    draggingColumnIndex.current = null
    setDraggingIndex(null)
    setDragTarget(null)
  }

  const headerDragStart = (event: DragEvent<HTMLTableCellElement>, column: Column, index: number) => {
    if (!enabled.reordering) return
    draggingColumnIndex.current = index
    setDraggingIndex(index)
    setDragTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', column.label)

    const ghost = document.createElement('div')
    ghost.className = 'dt-table-drag-ghost'
    ghost.textContent = column.label
    document.body.appendChild(ghost)
    event.dataTransfer.setDragImage(ghost, 18, 18)
    requestAnimationFrame(() => ghost.remove())
  }

  const headerDragOver = (event: DragEvent<HTMLTableCellElement>, index: number) => {
    if (!enabled.reordering || draggingColumnIndex.current === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const side: DragTarget['side'] = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    if (dragTarget?.index !== index || dragTarget.side !== side) setDragTarget({ index, side })
  }

  const headerDrop = (event: DragEvent<HTMLTableCellElement>, targetIndex: number) => {
    event.preventDefault()
    const fromIndex = draggingColumnIndex.current
    const target = dragTarget ?? { index: targetIndex, side: 'before' as const }
    if (!enabled.reordering || fromIndex === null || !onColumnMove) {
      clearDragState()
      return
    }

    let insertionIndex = target.index + (target.side === 'after' ? 1 : 0)
    if (fromIndex < insertionIndex) insertionIndex -= 1
    const toIndex = Math.max(0, Math.min(columns.length - 1, insertionIndex))
    if (fromIndex !== toIndex) onColumnMove(fromIndex, toIndex)
    clearDragState()
  }

  return (
    <div className={`dt-table-shell ${draggingIndex !== null ? 'dt-table-is-reordering ' : ''}${className}`.trim()}>
      {loading && !rows.length ? <div className="dt-table-state" role="status">{loadingMessage}</div> : null}
      {!loading && !rows.length ? <div className="dt-table-state dt-table-empty">{emptyMessage}</div> : null}
      <table className="dt-table" style={{ width: tableWidth, minWidth: tableWidth }}>
        <colgroup>
          {columns.map((column, index) => <col key={column.id} style={{ width: widths[index], minWidth: widths[index], maxWidth: widths[index] }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => {
              const frozen = enabled.freezing && index <= frozenIndex
              const frozenEdge = frozen && index === frozenIndex
              const dropBefore = dragTarget?.index === index && dragTarget.side === 'before'
              const dropAfter = dragTarget?.index === index && dragTarget.side === 'after'
              return (
                <th
                  key={column.id}
                  className={`${frozen ? 'dt-table-frozen ' : ''}${frozenEdge ? 'dt-table-frozen-edge ' : ''}${enabled.reordering ? 'dt-table-reorderable ' : ''}${draggingIndex === index ? 'dt-table-column-dragging ' : ''}${dropBefore ? 'dt-table-drop-before ' : ''}${dropAfter ? 'dt-table-drop-after ' : ''}`.trim()}
                  style={{ left: frozen ? frozenOffsets[index] : undefined, width: widths[index], minWidth: widths[index], maxWidth: widths[index] }}
                  draggable={enabled.reordering}
                  onDragStart={(event: DragEvent<HTMLTableCellElement>) => headerDragStart(event, column, index)}
                  onDragOver={(event: DragEvent<HTMLTableCellElement>) => headerDragOver(event, index)}
                  onDrop={(event: DragEvent<HTMLTableCellElement>) => headerDrop(event, index)}
                  onDragEnd={clearDragState}
                  onContextMenu={(event: MouseEvent<HTMLTableCellElement>) => onHeaderContextMenu?.(event, column, index)}
                  aria-sort={enabled.sorting && sort?.key === column.id ? (sort.direction === 1 ? 'ascending' : 'descending') : undefined}
                  scope="col"
                >
                  <button
                    type="button"
                    className="dt-table-sort"
                    disabled={!enabled.sorting || !onSort}
                    onClick={() => enabled.sorting && onSort?.(column.id)}
                  >
                    <span>{renderHeaderLabel ? renderHeaderLabel(column) : column.label}</span>
                    {enabled.sorting ? <span className="dt-table-sort-indicator" aria-hidden="true">
                      {sort?.key === column.id ? (sort.direction === 1 ? '▲' : '▼') : '↕'}
                    </span> : null}
                  </button>
                  {enabled.resizing && onColumnResizeStart ? (
                    <i
                      className="dt-table-resizer"
                      onMouseDown={(event: MouseEvent<HTMLElement>) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onColumnResizeStart(event, column, index)
                      }}
                    />
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const key = rowKey(row)
            const selected = enabled.selection && selectedRowKey === key
            const clickable = enabled.selection && Boolean(onSelectRow)
            return (
              <tr
                key={key}
                className={`${clickable ? 'dt-table-clickable ' : ''}${selected ? 'dt-table-selected ' : ''}${getRowClassName?.(row) ?? ''}`.trim()}
                aria-selected={enabled.selection ? selected : undefined}
                onClick={clickable ? () => onSelectRow?.(row) : undefined}
              >
                {columns.map((column, index) => {
                  const frozen = enabled.freezing && index <= frozenIndex
                  const frozenEdge = frozen && index === frozenIndex
                  return (
                    <td
                      key={column.id}
                      className={`${frozen ? 'dt-table-frozen ' : ''}${frozenEdge ? 'dt-table-frozen-edge ' : ''}${getCellClassName?.(row, column, index) ?? ''}`.trim()}
                      style={{ left: frozen ? frozenOffsets[index] : undefined, width: widths[index], minWidth: widths[index], maxWidth: widths[index] }}
                    >
                      {renderCell(row, column)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
