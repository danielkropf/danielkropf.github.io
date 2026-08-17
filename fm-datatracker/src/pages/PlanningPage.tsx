import{useEffect,useMemo,useRef,useState}from'react'
import{supabase}from'../lib/supabase'
import{positionFamilies}from'../lib/reference'
import{useSaves}from'../features/saves/SaveContext'

type Player={id:string;current_name:string;player_snapshots:Array<{snapshot_date:string;age:number|null;positions:string[];club:string|null;squad:string|null}>}
type Group={id:string;name:string}
type Planning={groups:Group[];assignments:Record<string,string>}
type Config=Record<string,unknown>&{planning?:Planning}
const defaults=():Planning=>({groups:[{id:'principal',name:'Principal'},{id:'b',name:'Time B'},{id:'base',name:'Base'}],assignments:{}})

export function PlanningPage(){
  const{selected}=useSaves(),[players,setPlayers]=useState<Player[]>([]),[modelId,setModelId]=useState<string|null>(null),[config,setConfig]=useState<Config>({planning:defaults()}),[newGroup,setNewGroup]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('Carregando…'),loaded=useRef(false)
  useEffect(()=>{loaded.current=false;if(!supabase||!selected)return;void Promise.all([
    supabase.from('players').select('id,current_name,player_snapshots(snapshot_date,age,positions,club,squad)').eq('save_id',selected.id).eq('is_active',true).order('current_name'),
    supabase.from('scoring_models').select('id,config').eq('save_id',selected.id).eq('name','Model Lab').order('created_at').limit(1).maybeSingle()
  ]).then(([playerResult,modelResult])=>{setPlayers((playerResult.data??[])as unknown as Player[]);const existing=(modelResult.data?.config??{})as Config;setConfig({...existing,planning:existing.planning??defaults()});setModelId(modelResult.data?.id??null);loaded.current=true;setStatus('Salvo automaticamente')})},[selected?.id])
  useEffect(()=>{if(!loaded.current||!selected||!supabase)return;setStatus('Salvando…');const timer=setTimeout(async()=>{const{data:{user}}=await supabase!.auth.getUser(),payload={owner_id:user!.id,save_id:selected.id,name:'Model Lab',version:'2.4.0',config,is_active:true},result=modelId?await supabase!.from('scoring_models').update(payload).eq('id',modelId).select('id').single():await supabase!.from('scoring_models').insert(payload).select('id').single();if(result.data?.id)setModelId(result.data.id);setStatus(result.error?`Erro: ${result.error.message}`:'Salvo automaticamente')},450);return()=>clearTimeout(timer)},[config,modelId,selected?.id])
  const planning=config.planning??defaults(),latest=(player:Player)=>[...player.player_snapshots].sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date))[0]
  const visible=useMemo(()=>players.filter(player=>player.current_name.toLowerCase().includes(search.toLowerCase())),[players,search])
  function update(transform:(planning:Planning)=>Planning){setConfig(current=>({...current,planning:transform(current.planning??defaults())}))}
  function assign(playerId:string,groupId:string){update(current=>({...current,assignments:{...current.assignments,[playerId]:groupId}}))}
  function addGroup(){const name=newGroup.trim();if(!name)return;update(current=>({...current,groups:[...current.groups,{id:crypto.randomUUID(),name}]}));setNewGroup('')}
  function rename(id:string,name:string){update(current=>({...current,groups:current.groups.map(group=>group.id===id?{...group,name}:group)}))}
  function remove(id:string){if(!confirm('Excluir este elenco? Os jogadores voltarão para Sem definição.'))return;update(current=>({groups:current.groups.filter(group=>group.id!==id),assignments:Object.fromEntries(Object.entries(current.assignments).filter(([,groupId])=>groupId!==id))}))}
  const columns=[{id:'',name:'Sem definição'},...planning.groups]
  return <div className="screen-page planning-page"><div className="title-row"><div><h1>Planejamento</h1></div><div className="planning-header-actions"><span className="save-state">{status}</span><input placeholder="Novo elenco" value={newGroup} onChange={event=>setNewGroup(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')addGroup()}}/><button onClick={addGroup}>+ Adicionar</button><input className="search" placeholder="Buscar jogador" value={search} onChange={event=>setSearch(event.target.value)}/></div></div>
    <section className="planning-overview">{planning.groups.map(group=>{const members=players.filter(player=>planning.assignments[player.id]===group.id),depth=Object.entries(members.flatMap(player=>positionFamilies(latest(player)?.positions??[])).reduce<Record<string,number>>((result,line)=>(result[line]=(result[line]??0)+1,result),{}));return <div className="card" key={group.id}><strong>{group.name}</strong><b>{members.length}</b><span>jogadores</span><div>{depth.map(([line,count])=><small key={line}>{line} {count}</small>)}</div></div>})}</section>
    <section className="planning-board">{columns.map(column=>{const members=visible.filter(player=>(planning.assignments[player.id]??'')===column.id);return <article className="planning-column" key={column.id||'unassigned'}><header>{column.id?<input value={column.name} onChange={event=>rename(column.id,event.target.value)}/>:<h2>{column.name}</h2>}<span>{members.length}</span>{column.id&&<button className="column-delete" onClick={()=>remove(column.id)}>×</button>}</header><div className="planning-player-list">{members.map(player=>{const snapshot=latest(player);return <div className="planning-player" key={player.id}><div><strong>{player.current_name}</strong><span>{snapshot?.positions?.join(', ')||'Sem posição'} · {snapshot?.age??'—'} anos</span></div><select value={planning.assignments[player.id]??''} onChange={event=>assign(player.id,event.target.value)}><option value="">Sem definição</option>{planning.groups.map(group=><option value={group.id} key={group.id}>{group.name}</option>)}</select></div>})}{!members.length&&<p>Nenhum jogador neste elenco.</p>}</div></article>})}</section>
  </div>
}
