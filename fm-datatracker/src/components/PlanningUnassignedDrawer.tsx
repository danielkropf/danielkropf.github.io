import { CustomSelect } from './CustomSelect'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { playerNameStatusClass } from '../lib/player-name-status'
import { selectPickerRows } from '../lib/planning-picker-selection'
import type { UnassignedDrawerState } from '../lib/planning-unassigned'
export type UnassignedDrawerItem = { id: string; name: string; peek?: ReactNode; age: number | null; positions: string[]; bestPosition: string | null; bestSetLabel?: string | null; bestRole: string | null; eligiblePositions: string[]; hasEligible: boolean; value: number | null; status: string; score: ReactNode; setRatings: Array<{ id: string; label: string; eligible: boolean; position: string | null; value?: number | null; score: ReactNode }> }
export function PlanningUnassignedDrawer({ items, sets, initialState, requestedSet, onProfile, onContext, onDragStart, onDragEnd, onAssign }: {
  items: UnassignedDrawerItem[]; sets: Array<{ id: string; label: string }>; initialState?: UnassignedDrawerState; requestedSet?: { id: string; revision: number }
  onProfile: (id: string, state: UnassignedDrawerState) => void; onContext: (event: MouseEvent, id: string) => void
  onDragStart: (id: string) => void; onDragEnd: () => void; onAssign: (ids: string[], setId: string) => void
}) {
  const [search,setSearch] = useState(initialState?.search ?? '')
  const [position,setPosition] = useState(initialState?.position ?? '')
  const [selected,setSelected] = useState(new Set(initialState?.selected ?? []))
  const [anchor,setAnchor] = useState<string | null>(initialState?.anchor ?? null)
  const [expanded,setExpanded] = useState<Record<string, 0 | 1 | 2>>(initialState?.expanded ?? {})
  const [target,setTarget] = useState(initialState?.target ?? '')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = initialState?.scrollTop ?? 0 }, [])
  useEffect(() => { if (requestedSet && sets.some(set=>set.id===requestedSet.id)) setPosition(requestedSet.id) }, [requestedSet])
  const rating = (item: UnassignedDrawerItem) => position ? item.setRatings.find(set => set.id === position) : undefined
  const visible = items.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))).sort((a,b) => {
    const ar=rating(a), br=rating(b)
    return Number(br?.eligible ?? b.hasEligible)-Number(ar?.eligible ?? a.hasEligible) || ((br?.value ?? (position ? -Infinity : b.value) ?? -Infinity)-(ar?.value ?? (position ? -Infinity : a.value) ?? -Infinity)) || a.name.localeCompare(b.name,'pt-BR')
  })
  const validSelection = items.filter(item => selected.has(item.id)).map(item => item.id)
  return <aside className="planning-unassigned" aria-label="Jogadores sem conjunto">
    <header><div><h2>Sem conjunto <span>{items.length}</span></h2><small>Aptos primeiro · nota do conjunto</small></div></header>
    <div className="planning-unassigned-filters"><input aria-label="Buscar nos jogadores sem conjunto" placeholder="Buscar jogador" value={search} onChange={e=>setSearch(e.target.value)} /><CustomSelect ariaLabel="Conjunto dos jogadores sem conjunto" value={position} options={[{value:'',label:'Todos os conjuntos'},...sets.map(set=>({value:set.id,label:set.label}))]} onChange={setPosition} /></div>
    <div className="planning-unassigned-list" role="listbox" aria-label="Jogadores disponíveis" aria-multiselectable="true" ref={listRef}>
      {!visible.length && <p>{items.length ? 'Nenhum jogador corresponde aos filtros.' : 'Todos os jogadores observados deste elenco estão em conjuntos.'}</p>}
      {visible.map(item => <article key={item.id} className={`${selected.has(item.id) ? 'is-selected' : ''} ${(rating(item)?.eligible ?? item.hasEligible) ? '' : 'is-unfamiliar'}`} role="option" aria-selected={selected.has(item.id)} tabIndex={0} draggable onDragStart={e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',item.id);onDragStart(item.id)}} onDragEnd={onDragEnd} onContextMenu={e=>onContext(e,item.id)} onClick={e=>{const next=selectPickerRows(selected,anchor,item.id,visible.map(row=>row.id),e);setSelected(next.selected);setAnchor(next.anchor)}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key===' '||e.key==='Enter')){e.preventDefault();const next=selectPickerRows(selected,anchor,item.id,visible.map(row=>row.id),e);setSelected(next.selected);setAnchor(next.anchor)}}}>
        <div className="planning-unassigned-identity">{item.peek}<button type="button" className={`ghost player-name ${playerNameStatusClass(item.status)}`} title={item.status} onClick={e=>{e.stopPropagation();onProfile(item.id,{search,position,expanded,selected:[...selected],anchor,target,scrollTop:listRef.current?.scrollTop ?? 0})}}>{item.name}</button></div>
        <small>{item.age == null ? 'Idade desconhecida' : `${item.age} anos`} · {item.positions.join(', ') || 'Posições desconhecidas'}</small>
        <div className="planning-unassigned-rating"><span title={item.bestRole ?? undefined}>{rating(item)?.label ?? item.bestSetLabel ?? item.bestPosition ?? 'Sem conjunto apto'}</span>{rating(item)?.score ?? item.score}</div>
        <button type="button" className="ghost planning-unassigned-details-toggle" aria-label={`Conjuntos aptos de ${item.name}`} title="Expandir conjuntos aptos" aria-expanded={Boolean(expanded[item.id])} onClick={event => { event.stopPropagation(); setExpanded(current => ({ ...current, [item.id]: current[item.id] ? 0 : 1 })) }}>{expanded[item.id] ? '▴' : '▾'}</button>
        {Boolean(expanded[item.id]) && <div className="planning-unassigned-set-ratings">
          {!item.setRatings.some(set => set.eligible) && expanded[item.id] === 1 && <small>Nenhum conjunto apto nesta tática.</small>}
          {item.setRatings.filter(set => expanded[item.id] === 2 || set.eligible).map(set => <div key={set.id} className={set.eligible ? '' : 'is-unfamiliar'}><div><span>{set.label}</span><small>{set.position ?? 'Sem nota'}{!set.eligible ? ' · Sem aptidão' : ''}</small></div>{set.score}</div>)}
          <button type="button" className="ghost planning-unassigned-details-toggle" aria-expanded={expanded[item.id] === 2} onClick={event => { event.stopPropagation(); setExpanded(current => ({ ...current, [item.id]: current[item.id] === 2 ? 1 : 2 })) }}>{expanded[item.id] === 2 ? 'Mostrar somente aptos' : 'Mostrar todos os conjuntos'}</button>
        </div>}
      </article>)}
    </div>
    <footer><small>{validSelection.length} selecionado(s) · Ctrl/⌘ e Shift</small><CustomSelect ariaLabel="Conjunto de destino" value={target} options={[{value:'',label:'Adicionar ao conjunto…'},...sets.map(set=>({value:set.id,label:set.label}))]} onChange={setTarget} /><button type="button" disabled={!validSelection.length||!sets.some(set=>set.id===target)} onClick={()=>{onAssign(validSelection,target);setSelected(new Set());setAnchor(null)}}>Adicionar selecionados</button></footer>
  </aside>
}
