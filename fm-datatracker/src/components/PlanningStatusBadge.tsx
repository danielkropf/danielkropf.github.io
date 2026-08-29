import { useState, type FocusEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

type Anchor = { top: number; bottom: number; left: number }

function compactStatus(status: string) {
  const normalized = status.trim()
  if (!normalized || normalized.toLocaleLowerCase('pt-BR') === 'não selecionado') return '—'
  const group = normalized.match(/^grupo\s+(\d+)/i)
  if (group) return `G${group[1]}`
  if (normalized.toLocaleLowerCase('pt-BR') === 'principal') return 'P'
  return normalized.split(/\s+/).map(word => word[0] ?? '').join('').slice(0, 2).toUpperCase() || '•'
}

function statusExplanation(status: string) {
  const normalized = status.trim() || 'Não selecionado'
  if (normalized.toLocaleLowerCase('pt-BR') === 'não selecionado') {
    return 'Não selecionado — jogador ainda não possui destino definido no Planejamento.'
  }
  return `${normalized} — destino atual do jogador no Planejamento.`
}

export function PlanningStatusBadge({ status }: { status: string }) {
  const normalized = status.trim() || 'Não selecionado'
  const explanation = statusExplanation(normalized)
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left + rect.width / 2 })
  }
  const hide = () => setAnchor(null)
  const hover = (event: MouseEvent<HTMLSpanElement>) => show(event.currentTarget)
  const focus = (event: FocusEvent<HTMLSpanElement>) => show(event.currentTarget)

  const tooltipWidth = Math.min(300, typeof window === 'undefined' ? 300 : window.innerWidth - 24)
  const tooltipLeft = anchor && typeof window !== 'undefined'
    ? Math.min(Math.max(12, anchor.left - tooltipWidth / 2), window.innerWidth - tooltipWidth - 12)
    : 12
  const tooltipTop = anchor && typeof window !== 'undefined'
    ? (anchor.bottom > window.innerHeight - 84 ? Math.max(12, anchor.top - 58) : anchor.bottom + 6)
    : 12

  return <>
    <span
      className={`planning-status-badge ${normalized.toLocaleLowerCase('pt-BR') === 'não selecionado' ? 'is-unselected' : 'is-selected'}`}
      tabIndex={0}
      aria-label={explanation}
      onMouseEnter={hover}
      onMouseLeave={hide}
      onFocus={focus}
      onBlur={hide}
    >
      {compactStatus(normalized)}
    </span>
    {anchor && typeof document !== 'undefined' ? createPortal(
      <span className="planning-status-tooltip" role="tooltip" style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}>
        {explanation}
      </span>,
      document.body,
    ) : null}
  </>
}
