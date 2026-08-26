import { useEffect, useRef, useState } from 'react'

export type CustomSelectOption = { value: string; label: string; disabled?: boolean }

type Props = {
  value: string
  options: CustomSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  disabledReason?: string
  className?: string
  ariaLabel?: string
}

export function CustomSelect({ value, options, onChange, placeholder = 'Selecione', disabled = false, disabledReason, className = '', ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = options.find(option => option.value === value)

  function firstEnabledIndex(direction: 1 | -1, from: number) {
    if (!options.length) return -1
    let index = from
    for (let count = 0; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length
      if (!options[index]?.disabled) return index
    }
    return -1
  }

  function openMenu(preferredIndex?: number) {
    if (disabled) return
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
    setActiveIndex(preferredIndex ?? (selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(1, -1)))
    setOpen(true)
  }

  function closeMenu(returnFocus = false) {
    setOpen(false)
    if (returnFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) closeMenu(false) }
    const focus = (event: FocusEvent) => { if (!rootRef.current?.contains(event.target as Node)) closeMenu(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeMenu(true) } }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('focusin', focus)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('focusin', focus); window.removeEventListener('keydown', key) }
  }, [open])

  useEffect(() => { if (disabled) closeMenu(false) }, [disabled])

  function keyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
      const start = selectedIndex >= 0 ? selectedIndex : (event.key === 'ArrowUp' ? 0 : -1)
      openMenu(event.key === 'ArrowUp' ? firstEnabledIndex(-1, start) : firstEnabledIndex(1, start))
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(current => firstEnabledIndex(event.key === 'ArrowDown' ? 1 : -1, current))
    } else if (event.key === 'Home') {
      event.preventDefault(); setActiveIndex(firstEnabledIndex(1, -1))
    } else if (event.key === 'End') {
      event.preventDefault(); setActiveIndex(firstEnabledIndex(-1, 0))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option && !option.disabled) { onChange(option.value); closeMenu(true) }
    } else if (event.key === 'Tab') closeMenu(false)
  }

  return <div className={`dt-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()} ref={rootRef}>
    <button ref={triggerRef} type="button" className="dt-select-trigger dt-control" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} title={disabled ? disabledReason : undefined} onKeyDown={keyDown} onClick={() => open ? closeMenu(false) : openMenu()}>
      <span>{selected?.label ?? placeholder}</span><b aria-hidden="true">⌄</b>
    </button>
    {open && <div className="dt-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === value} className={`${option.value === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`.trim()} disabled={option.disabled} onMouseEnter={() => !option.disabled && setActiveIndex(index)} onClick={() => { onChange(option.value); closeMenu(true) }} key={option.value}>{option.label}</button>)}
    </div>}
  </div>
}
