import { useEffect, useMemo, useState } from 'react'

type SquadOption = { id: string; name: string }

export function RosterPlayerContextMenu({ x, y, squads, activeSquadId, onMoveSquad, onLoan, onSale, onRemove, onClose }: {
  x: number
  y: number
  squads: SquadOption[]
  activeSquadId?: string | null
  onMoveSquad: (groupId: string) => void
  onLoan: () => void
  onSale: () => void
  onRemove?: () => void
  onClose: () => void
}) {
  const [squadOpen, setSquadOpen] = useState(false)
  const mainWidth = 238
  const subWidth = 220
  const mainLeft = Math.max(8, Math.min(x, window.innerWidth - mainWidth - 8))
  const mainTop = Math.max(8, Math.min(y, window.innerHeight - Math.min(220, 42 * (3 + Number(Boolean(onRemove)))) - 8))
  const submenuLeft = useMemo(() => mainLeft + mainWidth + subWidth + 12 <= window.innerWidth ? mainLeft + mainWidth + 4 : Math.max(8, mainLeft - subWidth - 4), [mainLeft])
  const submenuTop = Math.max(8, Math.min(mainTop, window.innerHeight - Math.min(360, squads.length * 38 + 12) - 8))

  useEffect(() => {
    const close = () => onClose()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', escape) }
  }, [onClose])

  return <>
    <div className="planning-context-menu roster-player-context-menu" role="menu" style={{ left: mainLeft, top: mainTop }} onClick={event => event.stopPropagation()}>
      <button role="menuitem" className="context-menu-branch" aria-haspopup="menu" aria-expanded={squadOpen} onPointerEnter={() => setSquadOpen(true)} onFocus={() => setSquadOpen(true)} onClick={() => setSquadOpen(open => !open)}><span>Mover para elenco</span><b aria-hidden="true">›</b></button>
      <button role="menuitem" onPointerEnter={() => setSquadOpen(false)} onClick={onLoan}>Adicionar para empréstimo</button>
      <button role="menuitem" onPointerEnter={() => setSquadOpen(false)} onClick={onSale}>Adicionar para venda</button>
      {onRemove && <button role="menuitem" className="is-danger" onPointerEnter={() => setSquadOpen(false)} onClick={onRemove}>Remover do planejamento</button>}
    </div>
    {squadOpen && <div className="planning-context-menu roster-player-context-submenu" role="menu" aria-label="Mover para elenco" style={{ left: submenuLeft, top: submenuTop }} onClick={event => event.stopPropagation()} onPointerLeave={() => setSquadOpen(false)}>
      {squads.map(squad => <button role="menuitemradio" aria-checked={squad.id === activeSquadId} className={squad.id === activeSquadId ? 'is-active' : ''} key={squad.id} onClick={() => onMoveSquad(squad.id)}>{squad.name}</button>)}
      {!squads.length && <span className="context-menu-empty">Nenhum elenco disponível</span>}
    </div>}
  </>
}
