import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type Props = {
  status: string
  detail?: string
  onRetry?: () => void
}

type SaveStateEntry = Props & {
  id: string
  active: boolean
  order: number
}

type SaveStateRegistry = {
  current: SaveStateEntry | null
  update: (id: string, entry: Omit<SaveStateEntry, 'id' | 'order'>) => void
  remove: (id: string) => void
}

const SaveStateContext = createContext<SaveStateRegistry | null>(null)

function SaveStateView({ status, detail = '', onRetry }: Props) {
  const failed = status.startsWith('⚠')
  const saving = status.startsWith('Salvando')
  const saved = status.startsWith('✓')
  const className = failed ? 'save-state-failed' : saving ? 'save-state-saving' : saved ? 'save-state-saved' : ''
  return <span className={`save-state-control ${className}`.trim()} title={detail || status} role={failed ? 'alert' : 'status'}>
    <span>{status}</span>
    {failed && onRetry && <button type="button" onClick={onRetry}>Tentar novamente</button>}
  </span>
}

function markerIsActive(marker: HTMLElement) {
  let node: HTMLElement | null = marker.parentElement
  while (node) {
    if (node.hidden) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    node = node.parentElement
  }
  return true
}

export function SaveStateProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, SaveStateEntry>>({})
  const order = useRef(0)

  const update = useCallback<SaveStateRegistry['update']>((id, entry) => {
    setEntries(current => {
      const previous = current[id]
      const nextOrder = !previous || (!previous.active && entry.active) ? ++order.current : previous.order
      return { ...current, [id]: { ...entry, id, order: nextOrder } }
    })
  }, [])

  const remove = useCallback((id: string) => {
    setEntries(current => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  const current = useMemo(() => Object.values(entries)
    .filter(entry => entry.active)
    .sort((a, b) => b.order - a.order)[0] ?? null, [entries])

  const registry = useMemo<SaveStateRegistry>(() => ({ current, update, remove }), [current, update, remove])
  return <SaveStateContext.Provider value={registry}>{children}</SaveStateContext.Provider>
}

export function SaveState({ status, detail = '', onRetry }: Props) {
  const registry = useContext(SaveStateContext)
  const id = useId()
  const marker = useRef<HTMLSpanElement>(null)
  const value = useRef({ status, detail, onRetry })
  value.current = { status, detail, onRetry }

  useLayoutEffect(() => {
    if (!registry || !marker.current) return
    registry.update(id, { ...value.current, active: markerIsActive(marker.current) })
  }, [detail, id, onRetry, registry?.update, status])

  useLayoutEffect(() => {
    if (!registry || !marker.current) return
    const element = marker.current
    const sync = () => registry.update(id, { ...value.current, active: markerIsActive(element) })
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(sync)
    if (observer) {
      let node: HTMLElement | null = element.parentElement
      while (node) {
        observer.observe(node, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] })
        node = node.parentElement
      }
    }
    sync()
    return () => {
      observer?.disconnect()
      registry.remove(id)
    }
  }, [id, registry?.remove, registry?.update])

  if (registry) return <span ref={marker} className="save-state-marker" aria-hidden="true" />
  return <SaveStateView status={status} detail={detail} onRetry={onRetry} />
}

export function SaveStateOutlet() {
  const registry = useContext(SaveStateContext)
  if (!registry?.current) return null
  return <SaveStateView status={registry.current.status} detail={registry.current.detail} onRetry={registry.current.onRetry} />
}
