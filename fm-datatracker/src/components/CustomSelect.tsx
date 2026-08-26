import { useEffect, useRef, useState } from 'react'

export type CustomSelectOption = { value: string; label: string; disabled?: boolean }

type Props = {
  value: string
  options: CustomSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function CustomSelect({ value, options, onChange, placeholder = 'Selecione', disabled = false, className = '', ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('keydown', key) }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  return <div className={`dt-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()} ref={rootRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}>
    <button type="button" className="dt-select-trigger dt-control" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)}>
      <span>{selected?.label ?? placeholder}</span><b aria-hidden="true">⌄</b>
    </button>
    {open && <div className="dt-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map(option => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'is-selected' : ''} disabled={option.disabled} onClick={() => { onChange(option.value); setOpen(false) }} key={option.value}>{option.label}</button>)}
    </div>}
  </div>
}
