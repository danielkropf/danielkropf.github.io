import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

export type DataTableContextMenuItem = {
  id: string
  label: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect: () => void
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
  fillContainer?: boolean
  getCellClassName?: (row: Row, column: Column, columnIndex: number) => string | undefined
  getRowClassName?: (row: Row) => string | undefined
  isRowDisabled?: (row: Row) => boolean
  renderHeaderLabel?: (column: Column) => ReactNode
  onHeaderContextMenu?: (event: MouseEvent, column: Column, columnIndex: number) => void
  getHeaderContextMenuItems?: (column: Column, columnIndex: number) => DataTableContextMenuItem[]
  onColumnResizeStart?: (event: MouseEvent, column: Column, columnIndex: number) => void
  onColumnWidthChange?: (column: Column, width: number, columnIndex: number) => void
  getColumnMinWidth?: (column: Column, columnIndex: number) => number
  getColumnMaxWidth?: (column: Column, columnIndex: number) => number
  onColumnMove?: (fromIndex: number, toIndex: number) => void
}

type DragTarget = { index: number; side: 'before' | 'after' }
type ContextMenuState = { x: number; y: number; index: number }

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
  fillContainer = false,
  getCellClassName,
  getRowClassName,
  isRowDisabled,
  renderHeaderLabel,
  onHeaderContextMenu,
  getHeaderContextMenuItems,
  onColumnResizeStart,
  onColumnWidthChange,
  getColumnMinWidth,
  getColumnMaxWidth,
  onColumnMove,
}: DataTableProps<Row, Column>) {
  const enabled = { ...DEFAULT_CAPABILITIES, ...capabilities }
  const draggingColumnIndex = useRef<number | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const widths = useMemo(() => columns.map((column, index) => {
    const minWidth = Math.max(48, getColumnMinWidth?.(column, index) ?? 1)
    const maxWidth = Math.max(minWidth, getColumnMaxWidth?.(column, index) ?? Number.POSITIVE_INFINITY)
    return Math.max(minWidth, Math.min(maxWidth, Math.max(1, getColumnWidth(column))))
  }), [columns, getColumnWidth, getColumnMinWidth, getColumnMaxWidth])
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

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [contextMenu])

  useEffect(() => () => {
    document.body.classList.remove('dt-table-resizing')
  }, [])

  const clearDragState = () => {
    draggingColumnIndex.current = null
    setDraggingIndex(null)
    setDragTarget(null)
  }

  const headerDragStart = (event: DragEvent<HTMLTableCellElement>, column: Column, index: number) => {
    if (!enabled.reordering) return
    setContextMenu(null)
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

  function clearLiveResizeVariables() {
    const table = tableRef.current
    if (!table) return
    table.style.removeProperty('--dt-table-live-width')
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      table.style.removeProperty(`--dt-col-${columnIndex}-width`)
      table.style.removeProperty(`--dt-frozen-${columnIndex}-left`)
    }
  }

  function applyLiveResize(index: number, width: number) {
    const table = tableRef.current
    if (!table) return
    const liveWidths = widths.map((current, columnIndex) => columnIndex === index ? width : current)
    table.style.setProperty(`--dt-col-${index}-width`, `${width}px`)
    table.style.setProperty('--dt-table-live-width', `${liveWidths.reduce((total, current) => total + current, 0)}px`)
    let left = 0
    for (let columnIndex = 0; columnIndex < liveWidths.length; columnIndex += 1) {
      table.style.setProperty(`--dt-frozen-${columnIndex}-left`, `${left}px`)
      left += liveWidths[columnIndex]
    }
  }

  function internalResizeStart(event: MouseEvent<HTMLElement>, column: Column, index: number) {
    if (!enabled.resizing || (!onColumnResizeStart && !onColumnWidthChange)) return

    const header = event.currentTarget.closest('th') as HTMLElement | null
    const startWidth = header?.getBoundingClientRect().width ?? widths[index]
    const startX = event.clientX
    const minWidth = Math.max(48, getColumnMinWidth?.(column, index) ?? 72)
    const maxWidth = Math.max(minWidth, getColumnMaxWidth?.(column, index) ?? 640)
    let pendingWidth = startWidth

    clearLiveResizeVariables()
    document.body.classList.add('dt-table-resizing')
    setContextMenu(null)

    const move = (moveEvent: PointerEvent) => {
      pendingWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(startWidth + moveEvent.clientX - startX)))
      // Width is applied directly to CSS variables so visual feedback is not
      // coupled to a React/page rerender. Persistence happens only on pointerup
      // for the canonical callback path.
      applyLiveResize(index, pendingWidth)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (onColumnWidthChange) {
        onColumnWidthChange(column, pendingWidth, index)
      } else if (onColumnResizeStart) {
        // Legacy integrations (currently Elenco) historically installed their own
        // pointermove listener and rerendered React for every pixel. Defer that
        // callback until release and replay only the final delta, preserving its
        // persisted width contract without coupling visual feedback to rerenders.
        const finalClientX = startX + pendingWidth - startWidth
        onColumnResizeStart({ clientX: startX } as MouseEvent<HTMLElement>, column, index)
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: finalClientX }))
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: finalClientX }))
      }
      document.body.classList.remove('dt-table-resizing')
      requestAnimationFrame(() => requestAnimationFrame(clearLiveResizeVariables))
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function openHeaderContextMenu(event: MouseEvent<HTMLTableCellElement>, column: Column, index: number) {
    const items = getHeaderContextMenuItems?.(column, index) ?? []
    if (items.length) {
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ x: event.clientX, y: event.clientY, index })
      return
    }
    onHeaderContextMenu?.(event, column, index)
  }

  const contextColumn = contextMenu ? columns[contextMenu.index] : undefined
  const contextItems = contextColumn && contextMenu ? (getHeaderContextMenuItems?.(contextColumn, contextMenu.index) ?? []) : []

  return (
    <div className={`dt-table-shell ${draggingIndex !== null ? 'dt-table-is-reordering ' : ''}${className}`.trim()}>
      {loading && !rows.length ? <div className="dt-table-state" role="status">{loadingMessage}</div> : null}
      {!loading && !rows.length ? <div className="dt-table-state dt-table-empty">{emptyMessage}</div> : null}
      <table ref={tableRef} className="dt-table" style={{ width: fillContainer ? `max(100%, var(--dt-table-live-width, ${tableWidth}px))` : `var(--dt-table-live-width, ${tableWidth}px)`, minWidth: `var(--dt-table-live-width, ${tableWidth}px)` }}>
        <colgroup>
          {columns.map((column, index) => { const width = `var(--dt-col-${index}-width, ${widths[index]}px)`; return <col key={column.id} style={{ width, minWidth: width, maxWidth: width }} /> })}
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
                  style={{ left: frozen ? `var(--dt-frozen-${index}-left, ${frozenOffsets[index]}px)` : undefined, width: `var(--dt-col-${index}-width, ${widths[index]}px)`, minWidth: `var(--dt-col-${index}-width, ${widths[index]}px)`, maxWidth: `var(--dt-col-${index}-width, ${widths[index]}px)` }}
                  draggable={enabled.reordering}
                  onDragStart={(dragEvent: DragEvent<HTMLTableCellElement>) => headerDragStart(dragEvent, column, index)}
                  onDragOver={(dragEvent: DragEvent<HTMLTableCellElement>) => headerDragOver(dragEvent, index)}
                  onDrop={(dragEvent: DragEvent<HTMLTableCellElement>) => headerDrop(dragEvent, index)}
                  onDragEnd={clearDragState}
                  onContextMenu={(contextEvent: MouseEvent<HTMLTableCellElement>) => openHeaderContextMenu(contextEvent, column, index)}
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
                  {enabled.resizing && (onColumnResizeStart || onColumnWidthChange) ? (
                    <i
                      className="dt-table-resizer"
                      onMouseDown={(resizeEvent: MouseEvent<HTMLElement>) => {
                        resizeEvent.preventDefault()
                        resizeEvent.stopPropagation()
                        internalResizeStart(resizeEvent, column, index)
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
            const disabled = Boolean(isRowDisabled?.(row))
            const selected = enabled.selection && selectedRowKey === key
            const clickable = enabled.selection && Boolean(onSelectRow) && !disabled
            return (
              <tr
                key={key}
                className={`${clickable ? 'dt-table-clickable ' : ''}${selected ? 'dt-table-selected ' : ''}${disabled ? 'dt-table-row-disabled ' : ''}${getRowClassName?.(row) ?? ''}`.trim()}
                aria-selected={enabled.selection ? selected : undefined}
                aria-disabled={disabled || undefined}
                onClick={clickable ? () => onSelectRow?.(row) : undefined}
              >
                {columns.map((column, index) => {
                  const frozen = enabled.freezing && index <= frozenIndex
                  const frozenEdge = frozen && index === frozenIndex
                  return (
                    <td
                      key={column.id}
                      className={`${frozen ? 'dt-table-frozen ' : ''}${frozenEdge ? 'dt-table-frozen-edge ' : ''}${getCellClassName?.(row, column, index) ?? ''}`.trim()}
                      style={{ left: frozen ? `var(--dt-frozen-${index}-left, ${frozenOffsets[index]}px)` : undefined, width: `var(--dt-col-${index}-width, ${widths[index]}px)`, minWidth: `var(--dt-col-${index}-width, ${widths[index]}px)`, maxWidth: `var(--dt-col-${index}-width, ${widths[index]}px)` }}
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
      {contextMenu && contextColumn && contextItems.length && typeof document !== 'undefined' ? createPortal(
        <aside
          className="dt-table-context-menu"
          role="menu"
          aria-label={`Opções da coluna ${contextColumn.label}`}
          style={{ left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 264)), top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - Math.min(420, 52 + contextItems.length * 38))) }}
          onClick={(menuEvent: MouseEvent<HTMLElement>) => menuEvent.stopPropagation()}
        >
          <div className="dt-table-context-title">{contextColumn.label}</div>
          {contextItems.map(item => <button
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            className={`${item.separatorBefore ? 'has-separator ' : ''}${item.danger ? 'is-danger ' : ''}${item.checked ? 'is-checked ' : ''}`.trim()}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              setContextMenu(null)
            }}
            key={item.id}
          >
            <span className="dt-table-context-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            <span>{item.label}</span>
          </button>)}
        </aside>, document.body) : null}
    </div>
  )
}
