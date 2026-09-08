import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'

export type DataTableQuickFilter = {
  id: string
  label: string
  count?: number
  active?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type DataTableViewOption = {
  id: string
  label: string
  active?: boolean
  custom?: boolean
  onSelect: () => void
  onDelete?: () => void
}

export type DataTableColumnMenuItem = {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect?: () => void
  children?: DataTableColumnMenuItem[]
}

export function DataTableChrome({ views = [], quickFilters = [], onCreateView, children }: {
  views?: DataTableViewOption[]
  quickFilters?: DataTableQuickFilter[]
  onCreateView?: () => void
  children?: ReactNode
}) {
  const [viewsOpen, setViewsOpen] = useState(false)
  const activeView = views.find(view => view.active)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!viewsOpen) return
    const close = (event: MouseEvent) => { if (!anchorRef.current?.contains(event.target as Node)) setViewsOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewsOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [viewsOpen])

  return <div className="dt-table-chrome">
    {(views.length > 0 || onCreateView || children) && <div className="dt-table-menu-bar">
      {(views.length > 0 || onCreateView) && <div className="dt-table-view-control" ref={anchorRef}>
        <button type="button" className="dt-table-view-trigger" aria-haspopup="menu" aria-expanded={viewsOpen} onClick={() => setViewsOpen(open => !open)}>
          <span>Visualização</span><strong>{activeView?.label ?? 'Personalizada'}</strong><b aria-hidden="true">⌄</b>
        </button>
        {viewsOpen && <div className="dt-table-view-menu" role="menu" onClick={event => event.stopPropagation()}>
          {views.filter(view => !view.custom).map(view => <ViewMenuRow key={view.id} view={view} close={() => setViewsOpen(false)} />)}
          {views.some(view => view.custom) && <div className="dt-table-view-separator" />}
          {views.filter(view => view.custom).map(view => <ViewMenuRow key={view.id} view={view} close={() => setViewsOpen(false)} />)}
          {onCreateView && <><div className="dt-table-view-separator"/><button type="button" className="dt-table-view-create" onClick={() => { setViewsOpen(false); onCreateView() }}>+ Salvar visualização atual</button></>}
        </div>}
      </div>}
      {children && <div className="dt-table-menu-extra">{children}</div>}
    </div>}
    {quickFilters.length > 0 && <div className="dt-table-quick-filters" role="group" aria-label="Filtros rápidos">
      {quickFilters.map(filter => <button type="button" key={filter.id} className={filter.active ? 'active' : ''} disabled={filter.disabled} aria-pressed={Boolean(filter.active)} onClick={filter.onSelect}>
        <span>{filter.label}</span>{filter.count !== undefined && <small>{filter.count}</small>}
      </button>)}
    </div>}
  </div>
}

function ViewMenuRow({ view, close }: { view: DataTableViewOption; close: () => void }) {
  return <div className={`dt-table-view-row ${view.active ? 'active' : ''}`}>
    <button type="button" role="menuitemradio" aria-checked={Boolean(view.active)} onClick={() => { view.onSelect(); close() }}><span>{view.active ? '✓' : ''}</span><strong>{view.label}</strong></button>
    {view.custom && view.onDelete && <button type="button" className="dt-table-view-delete" aria-label={`Excluir visualização ${view.label}`} onClick={event => { event.stopPropagation(); view.onDelete?.() }}>×</button>}
  </div>
}

export function TableViewSaveDialog({ open, value, onChange, onCancel, onSave }: {
  open: boolean
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  if (!open) return null
  return createPortal(<div className="dt-table-dialog-overlay" onPointerDown={onCancel}>
    <section className="dt-table-view-dialog" role="dialog" aria-modal="true" aria-labelledby="dt-table-view-dialog-title" onPointerDown={event => event.stopPropagation()}>
      <header><h2 id="dt-table-view-dialog-title">Salvar visualização</h2><button type="button" onClick={onCancel}>×</button></header>
      <label>Nome<input autoFocus value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSave(); if (event.key === 'Escape') onCancel() }} /></label>
      <footer><button type="button" className="ghost" onClick={onCancel}>Cancelar</button><button type="button" disabled={!value.trim()} onClick={onSave}>Salvar</button></footer>
    </section>
  </div>, document.body)
}

type MenuLevelState = { active: string | null; setActive: Dispatch<SetStateAction<string | null>>; keepOpen: () => void; scheduleClose: () => void; closeAll: () => void }
const MenuLevelContext = createContext<MenuLevelState | null>(null)

export function shouldCloseDataTableColumnMenuOnScroll(target: EventTarget | null) {
  return !(target instanceof Element && Boolean(target.closest('.dt-table-advanced-context')))
}

export function DataTableColumnMenu({ x, y, title, items, onClose }: { x: number; y: number; title?: string; items: DataTableColumnMenuItem[]; onClose: () => void }) {
  const [active, setActive] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const keepOpen = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { keepOpen(); closeTimer.current = window.setTimeout(() => setActive(null), 130) }

  useLayoutEffect(() => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const padding = 10
    setPosition({ left: Math.max(padding, Math.min(x, window.innerWidth - rect.width - padding)), top: Math.max(padding, Math.min(y, window.innerHeight - rect.height - padding)) })
  }, [x, y, items.length])
  useEffect(() => {
    const close = () => onClose()
    const scroll = (event: Event) => { if (shouldCloseDataTableColumnMenuOnScroll(event.target)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('keydown', escape)
    return () => {
      keepOpen(); window.removeEventListener('click', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const level: MenuLevelState = { active, setActive, keepOpen, scheduleClose, closeAll: onClose }
  return createPortal(<aside ref={panelRef} className="dt-table-advanced-context" style={position} onClick={event => event.stopPropagation()} onMouseEnter={keepOpen} onMouseLeave={scheduleClose}>
    {title && <div className="dt-table-context-title">{title}</div>}
    <MenuLevelContext.Provider value={level}><MenuItems items={items}/></MenuLevelContext.Provider>
  </aside>, document.body)
}

function NestedLevel({ parent, children }: { parent: MenuLevelState; children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null)
  return <MenuLevelContext.Provider value={{ ...parent, active, setActive }}>{children}</MenuLevelContext.Provider>
}

function MenuItems({ items }: { items: DataTableColumnMenuItem[] }) {
  return <>{items.map(item => item.children?.length ? <MenuBranch key={item.id} item={item}/> : <MenuLeaf key={item.id} item={item}/>)}</>
}

function MenuLeaf({ item }: { item: DataTableColumnMenuItem }) {
  const level = useContext(MenuLevelContext)
  return <button type="button" className={`${item.separatorBefore ? 'has-separator ' : ''}${item.danger ? 'is-danger' : ''}`.trim()} disabled={item.disabled} onClick={() => { item.onSelect?.(); level?.closeAll() }}>{item.label}</button>
}

function MenuBranch({ item }: { item: DataTableColumnMenuItem }) {
  const level = useContext(MenuLevelContext)
  const id = useId()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const open = level?.active === id
  const activate = () => { if (!level || item.disabled) return; level.keepOpen(); level.setActive(id) }
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !panelRef.current) { setPosition(null); return }
    const anchor = anchorRef.current.getBoundingClientRect(); const panel = panelRef.current.getBoundingClientRect(); const gap = 5; const padding = 10
    const left = anchor.right + gap + panel.width <= window.innerWidth - padding ? anchor.right + gap : Math.max(padding, anchor.left - gap - panel.width)
    const top = Math.max(padding, Math.min(anchor.top, window.innerHeight - panel.height - padding))
    setPosition({ left, top })
  }, [open, item.children?.length])
  if (!level) return null
  return <div className={`dt-table-context-branch ${item.separatorBefore ? 'has-separator' : ''}`} onMouseEnter={activate} onMouseLeave={level.scheduleClose}>
    <button ref={anchorRef} type="button" disabled={item.disabled} onMouseEnter={activate} onFocus={activate}><span>{item.label}</span><b aria-hidden="true">›</b></button>
    {open && createPortal(<div ref={panelRef} className="dt-table-advanced-context dt-table-context-submenu" style={{ left: position?.left ?? -10000, top: position?.top ?? -10000, visibility: position ? 'visible' : 'hidden' }} onClick={event => event.stopPropagation()} onMouseEnter={level.keepOpen} onMouseLeave={level.scheduleClose}>
      <NestedLevel parent={level}><MenuItems items={item.children ?? []}/></NestedLevel>
    </div>, document.body)}
  </div>
}
