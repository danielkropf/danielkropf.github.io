import { useEffect, useMemo, useRef, useState } from 'react'

type PositionItem = { value: string; label: string }
type PositionGroup = { label: string; className: string; slots: Array<PositionItem | null> }

export const GLOBAL_POSITION_GROUPS: PositionGroup[] = [
  { label: 'GOLEIRO', className: 'planning-line-gk', slots: [null, { value: 'GK', label: 'GK' }, null] },
  { label: 'DEFESA', className: 'planning-line-d', slots: [{ value: 'D (R)', label: 'D(R)' }, { value: 'D (C)', label: 'D(C)' }, { value: 'D (L)', label: 'D(L)' }] },
  { label: 'MÉDIO DEFENSIVO', className: 'planning-line-dm', slots: [{ value: 'WB (R)', label: 'WB(R)' }, { value: 'DM (C)', label: 'DM(C)' }, { value: 'WB (L)', label: 'WB(L)' }] },
  { label: 'MÉDIO CENTRAL', className: 'planning-line-m', slots: [{ value: 'M (R)', label: 'M(R)' }, { value: 'M (C)', label: 'M(C)' }, { value: 'M (L)', label: 'M(L)' }] },
  { label: 'MÉDIO AVANÇADO', className: 'planning-line-am', slots: [{ value: 'AM (R)', label: 'AM(R)' }, { value: 'AM (C)', label: 'AM(C)' }, { value: 'AM (L)', label: 'AM(L)' }] },
  { label: 'ATACANTE', className: 'planning-line-st', slots: [null, { value: 'ST (C)', label: 'ST(C)' }, null] },
]

const allPositions = GLOBAL_POSITION_GROUPS.flatMap(group => group.slots).filter((item): item is PositionItem => Boolean(item)).map(item => item.value)
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z]/g, '')

export function canonicalPosition(value: string) {
  const normalized = normalize(value)
  return allPositions.find(position => normalize(position) === normalized) ?? value
}

export function PositionSelector({ selected, onChange, availablePositions, className = '', label = 'Todas as posições' }: {
  selected: string[] | null
  onChange: (value: string[] | null) => void
  availablePositions?: string[]
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const available = useMemo(() => {
    if (!availablePositions) return allPositions
    const wanted = new Set(availablePositions.map(normalize))
    return allPositions.filter(position => wanted.has(normalize(position)))
  }, [availablePositions])
  const selectedSet = useMemo(() => selected === null ? new Set(available) : new Set(selected.map(canonicalPosition).filter(position => available.includes(position))), [selected, available])
  const allChecked = available.length > 0 && available.every(position => selectedSet.has(position))
  const noneChecked = selected !== null && selectedSet.size === 0
  const summary = selected === null || allChecked ? label : noneChecked ? 'Nenhuma posição' : selectedSet.size === 1 ? [...selectedSet][0].replaceAll(' ', '') : `${selectedSet.size} posições`

  function close(returnFocus = false) {
    setOpen(false)
    if (returnFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false) }
    const focus = (event: FocusEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true) } }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('focusin', focus)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('focusin', focus); window.removeEventListener('keydown', key) }
  }, [open])

  function togglePosition(position: string, checked: boolean) {
    const base = selected === null ? [...available] : [...selectedSet]
    const next = checked ? [...new Set([...base, position])] : base.filter(item => item !== position)
    onChange(available.length > 0 && available.every(item => next.includes(item)) ? null : next)
  }

  return <div className={`dt-position-selector ${open ? 'is-open' : ''} ${className}`.trim()} ref={rootRef}>
    <button ref={triggerRef} type="button" className="dt-position-trigger dt-control" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><span>{summary}</span><b aria-hidden="true">⌄</b></button>
    {open && <div className="dt-position-menu" role="group" aria-label="Filtrar posições">
      <label className="dt-position-master"><input type="checkbox" checked={allChecked} onChange={event => onChange(event.target.checked ? null : [])} /><span>Todas as posições</span></label>
      {GLOBAL_POSITION_GROUPS.map(group => <section className={`dt-position-group ${group.className}`} key={group.label}><h4>{group.label}</h4><div>{group.slots.map((item, index) => item ? <label className={!available.includes(item.value) ? 'is-unavailable' : ''} key={item.value}><input type="checkbox" disabled={!available.includes(item.value)} checked={available.includes(item.value) && selectedSet.has(item.value)} onChange={event => togglePosition(item.value, event.target.checked)} /><span>{item.label}</span></label> : <span className="dt-position-spacer" key={`${group.label}-${index}`} />)}</div></section>)}
    </div>}
  </div>
}
