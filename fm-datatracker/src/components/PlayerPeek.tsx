import{forwardRef,useEffect,useLayoutEffect,useRef,useState,type MouseEvent}from'react'
import{createPortal}from'react-dom'
import{ATTRIBUTE_LOOKUP}from'../lib/attributes'

type QuickAttribute={attribute_key:string;attribute_label:string;value:number;category:string}
type QuickPlayer={current_name:string;nationality:string|null}
type QuickSnapshot={positions:string[];age:number|null;club:string|null;preferred_foot?:string|null;height?:number|null;player_attributes:QuickAttribute[]}
type PeekPosition={top:number;left:number}

function PersonIcon({size=16}:{size?:number}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75"/><path d="M5.5 19c.45-3.35 2.75-5 6.5-5s6.05 1.65 6.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
}

export function PlayerPeek({player,snapshot}:{player:QuickPlayer;snapshot:QuickSnapshot}){
  const buttonRef=useRef<HTMLButtonElement|null>(null)
  const panelRef=useRef<HTMLElement|null>(null)
  const[anchor,setAnchor]=useState<DOMRect|null>(null)
  const[position,setPosition]=useState<PeekPosition|null>(null)
  const show=(element:HTMLElement)=>{setPosition(null);setAnchor(element.getBoundingClientRect())}
  const hide=()=>{setAnchor(null);setPosition(null)}
  const stop=(event:MouseEvent<HTMLButtonElement>)=>event.stopPropagation()

  useLayoutEffect(()=>{
    if(!anchor||!panelRef.current)return
    const panel=panelRef.current.getBoundingClientRect(),gap=8,padding=8
    let left=anchor.right+gap
    if(left+panel.width>window.innerWidth-padding)left=anchor.left-gap-panel.width
    left=Math.max(padding,Math.min(left,window.innerWidth-panel.width-padding))
    const desiredTop=anchor.top+(anchor.height-panel.height)/2
    const top=Math.max(padding,Math.min(desiredTop,window.innerHeight-panel.height-padding))
    setPosition({left,top})
  },[anchor,player.current_name,snapshot])

  useEffect(()=>{
    if(!anchor)return
    const refresh=()=>{const button=buttonRef.current;if(button)show(button)}
    window.addEventListener('resize',refresh)
    window.addEventListener('scroll',refresh,true)
    return()=>{window.removeEventListener('resize',refresh);window.removeEventListener('scroll',refresh,true)}
  },[anchor])

  return <span className="player-peek-wrap">
    <button ref={buttonRef} type="button" className="player-peek" aria-label={`Prévia de ${player.current_name}`} onClick={stop} onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={hide} onFocus={event=>show(event.currentTarget)} onBlur={hide}><PersonIcon/></button>
    {anchor&&createPortal(<PlayerTooltip ref={panelRef} player={player} snapshot={snapshot} position={position}/>,document.body)}
  </span>
}

const PlayerTooltip=forwardRef<HTMLElement,{player:QuickPlayer;snapshot:QuickSnapshot;position:PeekPosition|null}>(function PlayerTooltip({player,snapshot,position},ref){
  const groups=['technical','mental','physical','goalkeeping'] as const
  const labels={technical:'Técnico',mental:'Mental',physical:'Físico',goalkeeping:'Goleiro'}
  return <aside ref={ref} className="fm-player-tooltip fm-player-tooltip-portal fm-player-tooltip-trigger-anchored" style={{top:position?.top??-10000,left:position?.left??-10000,visibility:position?'visible':'hidden'}}>
    <header><div className="profile-silhouette"><PersonIcon size={22}/></div><div><h2>{player.current_name}</h2><p>{snapshot.positions.join(', ')} · {snapshot.age??'—'} anos</p><small>{snapshot.club??'—'} · {player.nationality??'—'} · {snapshot.height?`${snapshot.height} cm`:'—'} · {footLabel(snapshot.preferred_foot??null)}</small></div></header>
    <div className="fm-attribute-columns">{groups.map(group=><section key={group}><h3>{labels[group]}</h3>{snapshot.player_attributes.filter(attribute=>(ATTRIBUTE_LOOKUP[attribute.attribute_key]?.category??attribute.category)===group).sort((a,b)=>a.attribute_label.localeCompare(b.attribute_label)).map(attribute=><span key={attribute.attribute_key}>{attribute.attribute_label}<b className={attributeClass(attribute.value)}>{attribute.value}</b></span>)}</section>)}</div>
  </aside>
})

const attributeClass=(value:number)=>value>=15?'attribute-high':value>=10?'attribute-mid':'attribute-low'
const footLabel=(foot:string|null)=>foot?`Pé ${foot}`:'Pé —'
