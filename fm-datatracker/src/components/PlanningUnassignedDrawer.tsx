import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { playerNameStatusClass } from '../lib/player-name-status'
import { selectPickerRows } from '../lib/planning-picker-selection'
import type { UnassignedDrawerState } from '../lib/planning-unassigned'
export type UnassignedDrawerItem = { id: string; name: string; age: number | null; positions: string[]; bestPosition: string | null; bestRole: string | null; eligiblePositions: string[]; hasEligible: boolean; value: number | null; status: string; score: ReactNode }
export function PlanningUnassignedDrawer({ items, sets, initialState, onClose, onProfile, onContext, onDragStart, onDragEnd, onAssign }: {
  items: UnassignedDrawerItem[]; sets: Array<{ id: string; label: string }>; initialState?: UnassignedDrawerState
  onClose: () => void; onProfile: (id: string, state: UnassignedDrawerState) => void; onContext: (event: MouseEvent, id: string) => void
  onDragStart: (id: string) => void; onDragEnd: () => void; onAssign: (ids: string[], setId: string) => void
}) {
  const [search,setSearch] = useState(initialState?.search ?? '')
  const [position,setPosition] = useState(initialState?.position ?? '')
  const [selected,setSelected] = useState(new Set(initialState?.selected ?? []))
  const [anchor,setAnchor] = useState<string | null>(initialState?.anchor ?? null)
  const [target,setTarget] = useState(initialState?.target ?? '')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = initialState?.scrollTop ?? 0 }, [])
  const visible = items.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')) && (!position || (position === '__none' ? !item.hasEligible : item.eligiblePositions.includes(position))))
  const validSelection = items.filter(item => selected.has(item.id)).map(item => item.id)
  const options = [...new Set(items.flatMap(item => item.eligiblePositions))].sort()
  return <aside className="planning-unassigned" aria-label="Jogadores sem conjunto">
    <header><div><h2>Sem conjunto <span>{items.length}</span></h2><small>Melhor posição apta na tática atual</small></div><button type="button" aria-label="Recolher sem conjunto" onClick={onClose}>×</button></header>
    <div className="planning-unassigned-filters"><input aria-label="Buscar nos jogadores sem conjunto" placeholder="Buscar jogador" value={search} onChange={e=>setSearch(e.target.value)} /><select aria-label="Posição dos jogadores sem conjunto" value={position} onChange={e=>setPosition(e.target.value)}><option value="">Todas as posições aptas</option>{options.map(value=><option key={value}>{value}</option>)}<option value="__none">Sem posição apta</option></select></div>
    <div className="planning-unassigned-list" role="listbox" aria-label="Jogadores disponíveis" aria-multiselectable="true" ref={listRef}>
      {!visible.length && <p>{items.length ? 'Nenhum jogador corresponde aos filtros.' : 'Todos os jogadores observados deste elenco estão em conjuntos.'}</p>}
      {visible.map(item => <article key={item.id} className={selected.has(item.id) ? 'is-selected' : ''} role="option" aria-selected={selected.has(item.id)} tabIndex={0} draggable onDragStart={e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',item.id);onDragStart(item.id)}} onDragEnd={onDragEnd} onContextMenu={e=>onContext(e,item.id)} onClick={e=>{const next=selectPickerRows(selected,anchor,item.id,visible.map(row=>row.id),e);setSelected(next.selected);setAnchor(next.anchor)}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key===' '||e.key==='Enter')){e.preventDefault();const next=selectPickerRows(selected,anchor,item.id,visible.map(row=>row.id),e);setSelected(next.selected);setAnchor(next.anchor)}}}>
        <button type="button" className={`player-name ${playerNameStatusClass(item.status)}`} title={item.status} onClick={e=>{e.stopPropagation();onProfile(item.id,{search,position,selected:[...selected],anchor,target,scrollTop:listRef.current?.scrollTop ?? 0})}}>{item.name}</button>
        <small>{item.age == null ? 'Idade desconhecida' : `${item.age} anos`} · {item.positions.join(', ') || 'Posições desconhecidas'}</small>
        <div className="planning-unassigned-rating"><span title={item.bestRole ?? undefined}>{item.bestPosition ?? (item.hasEligible ? 'Sem nota para comparar' : 'Sem posição apta')}</span>{item.score}</div>
      </article>)}
    </div>
    <footer><small>{validSelection.length} selecionado(s) · Ctrl/⌘ e Shift</small><select aria-label="Conjunto de destino" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Adicionar ao conjunto…</option>{sets.map(set=><option key={set.id} value={set.id}>{set.label}</option>)}</select><button type="button" disabled={!validSelection.length||!sets.some(set=>set.id===target)} onClick={()=>{onAssign(validSelection,target);setSelected(new Set());setAnchor(null)}}>Adicionar selecionados</button></footer>
  </aside>
}
