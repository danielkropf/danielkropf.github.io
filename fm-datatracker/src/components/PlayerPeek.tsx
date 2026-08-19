import{useState,type MouseEvent}from'react'
import{createPortal}from'react-dom'
import{ATTRIBUTE_LOOKUP}from'../lib/attributes'

type QuickAttribute={attribute_key:string;attribute_label:string;value:number;category:string}
type QuickPlayer={current_name:string;nationality:string|null}
type QuickSnapshot={positions:string[];age:number|null;club:string|null;preferred_foot?:string|null;height?:number|null;player_attributes:QuickAttribute[]}

export function PlayerPeek({player,snapshot}:{player:QuickPlayer;snapshot:QuickSnapshot}){
  const[anchor,setAnchor]=useState<{top:number;left:number}|null>(null)
  const show=()=>setAnchor({left:window.innerWidth/2,top:window.innerHeight/2})
  const stop=(event:MouseEvent<HTMLButtonElement>)=>event.stopPropagation()
  return <span className="player-peek-wrap">
    <button className="player-peek" aria-label={`Prévia de ${player.current_name}`} onClick={stop} onMouseEnter={show} onMouseLeave={()=>setAnchor(null)} onFocus={show} onBlur={()=>setAnchor(null)}>♟</button>
    {anchor&&createPortal(<PlayerTooltip player={player} snapshot={snapshot} anchor={anchor}/>,document.body)}
  </span>
}

function PlayerTooltip({player,snapshot,anchor}:{player:QuickPlayer;snapshot:QuickSnapshot;anchor:{top:number;left:number}}){
  const groups=['technical','mental','physical','goalkeeping'] as const
  const labels={technical:'Técnico',mental:'Mental',physical:'Físico',goalkeeping:'Goleiro'}
  return <aside className="fm-player-tooltip fm-player-tooltip-portal" style={{top:anchor.top,left:anchor.left}}>
    <header><div className="profile-silhouette">♟</div><div><h2>{player.current_name}</h2><p>{snapshot.positions.join(', ')} · {snapshot.age??'—'} anos</p><small>{snapshot.club??'—'} · {player.nationality??'—'} · {snapshot.height?`${snapshot.height} cm`:'—'} · {footLabel(snapshot.preferred_foot??null)}</small></div></header>
    <div className="fm-attribute-columns">{groups.map(group=><section key={group}><h3>{labels[group]}</h3>{snapshot.player_attributes.filter(attribute=>(ATTRIBUTE_LOOKUP[attribute.attribute_key]?.category??attribute.category)===group).sort((a,b)=>a.attribute_label.localeCompare(b.attribute_label)).map(attribute=><span key={attribute.attribute_key}>{attribute.attribute_label}<b className={attributeClass(attribute.value)}>{attribute.value}</b></span>)}</section>)}</div>
  </aside>
}

const attributeClass=(value:number)=>value>=15?'attribute-high':value>=10?'attribute-mid':'attribute-low'
const footLabel=(foot:string|null)=>foot?`Pé ${foot}`:'Pé —'
