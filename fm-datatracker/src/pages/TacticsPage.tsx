import{useEffect,useRef,useState,type DragEvent,type MouseEvent}from'react'
import{createPortal}from'react-dom'
import{supabase}from'../lib/supabase'
import{DEFAULT_ATTRIBUTE_WEIGHTS}from'../lib/attributes'
import{attributeScore,combinedPhaseScore,fmScaleScore}from'../lib/scoring'
import{ScoreBadge}from'../components/ScoreBadge'
import{SaveState}from'../components/SaveState'
import{roleDefaultWeights,usesLegacyRoleDefaults}from'../lib/roleWeights'
import{PITCH_NODES,positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{useSaves}from'../features/saves/SaveContext'
import{loadModelConfig,patchModelConfig,retryModelConfigPatch,scheduleModelConfigPatch}from'../lib/model-config'
import{describeDbError}from'../lib/db-error'

type Role={id:string;name:string;weights:Record<string,number>}
type Assignment={playerId:string;nodeId:string;position:string;roleId:string;roleCode:string;roleName:string}
type Tactic={id:string;name:string;roles:Role[];assignments?:Assignment[];ipAssignments:Assignment[];oopAssignments:Assignment[];lineup:Record<string,string|null>}
type Config={general_weights:Record<string,number>;role_weight_overrides:Record<string,Record<string,number>>;tactics:Tactic[];selected_tactic_id:string|null;selected_role_id:string|null}
type Candidate={id:string;name:string;positions:string[];age:number|null;attributes:Array<{key:string;value:number}>}
type PlayerSortKey='name'|'positions'|'age'|'positionScore'|'generalScore'
type RolePicker={phase:TacticPhase;playerId:string;position:string;roleCode:string;top:number;left:number;width:number}

const FORMATIONS:Record<string,string[]>={
  '4-3-3':['gk','dl','dcl','dcr','dr','dmc','mcl','mcr','aml','amr','stc'],
  '4-2-3-1':['gk','dl','dcl','dcr','dr','dml','dmr','aml','amc','amr','stc'],
  '4-4-2':['gk','dl','dcl','dcr','dr','ml','mcl','mcr','mr','stl','str'],
  '3-4-3':['gk','dcl','dc','dcr','wbl','mcl','mcr','wbr','aml','amr','stc'],
  '3-5-2':['gk','dcl','dc','dcr','wbl','mcl','mc','mcr','wbr','stl','str']
}
const DEFAULT_NODE_IDS=FORMATIONS['4-3-3']
const fresh=():Config=>({general_weights:{...DEFAULT_ATTRIBUTE_WEIGHTS},role_weight_overrides:{},tactics:[],selected_tactic_id:null,selected_role_id:null})

function makeAssignment(nodeId:string,phase:TacticPhase,playerId:string):Assignment{
  const node=PITCH_NODES.find(n=>n.id===nodeId)!,role=rolesFor(node.position,phase)[0]
  return{playerId,nodeId,position:node.position,roleId:`${phase}-${positionGroup(node.position)}-${role[0]}`,roleCode:role[0],roleName:role[1]}
}

function assignmentsFor(formation:string,phase:TacticPhase){
  return(FORMATIONS[formation]??DEFAULT_NODE_IDS).map((nodeId,index)=>makeAssignment(nodeId,phase,`p${index}`))
}

function laneLabel(nodeId:string){
  const x=PITCH_NODES.find(n=>n.id===nodeId)?.x??50
  return x<40?'Esquerda':x>60?'Direita':'Centro'
}

function lineClass(position:string){
  const group=positionGroup(position)
  if(group==='GK')return'gk'
  if(group==='FB'||group==='CB')return'd'
  if(group==='WB'||group==='DM')return'dm'
  if(group==='WM'||group==='CM')return'm'
  if(group==='W'||group==='AM')return'am'
  return'st'
}

function normalizeAssignments(raw:Assignment[]|undefined,phase:TacticPhase){
  const source=raw?.length?raw:assignmentsFor('4-3-3',phase)
  return source.map((a,index)=>{
    const option=rolesFor(a.position,phase).find(r=>r[0]===a.roleCode)??rolesFor(a.position,phase)[0]
    return{...a,playerId:a.playerId??`p${index}`,roleId:`${phase}-${positionGroup(a.position)}-${option[0]}`,roleCode:option[0],roleName:option[1]}
  })
}

function normalizeTactic(t:Partial<Tactic>&Pick<Tactic,'id'|'name'>):Tactic{
  const legacy=t.assignments
  const ipAssignments=normalizeAssignments(t.ipAssignments??legacy,'IP')
  const oopAssignments=normalizeAssignments(t.oopAssignments??legacy,'OOP')
  const roles=[...(t.roles??[])]
  for(const a of [...ipAssignments,...oopAssignments]){
    const existing=roles.find(r=>r.id===a.roleId)
    if(existing){existing.name=a.roleName;if(usesLegacyRoleDefaults(existing.weights))existing.weights=roleDefaultWeights(a.roleId,a.roleName)}
    else roles.push({id:a.roleId,name:a.roleName,weights:roleDefaultWeights(a.roleId,a.roleName)})
  }
  return{id:t.id,name:t.name,roles,ipAssignments,oopAssignments,lineup:t.lineup??{}}
}

export function TacticsPage(){
  const{selected}=useSaves()
  const[config,setConfig]=useState<Config>(fresh)
  const[status,setStatus]=useState('Carregando…')
  const[saveDetail,setSaveDetail]=useState('')
  const[phase,setPhase]=useState<TacticPhase>('IP')
  const[dragging,setDragging]=useState<number|null>(null)
  const[createOpen,setCreateOpen]=useState(false)
  const[editPlayerId,setEditPlayerId]=useState<string|null>(null)
  const[name,setName]=useState('')
  const[ipFormation,setIpFormation]=useState('4-3-3')
  const[oopFormation,setOopFormation]=useState('4-3-3')
  const[candidates,setCandidates]=useState<Candidate[]>([])
  const[sideTab,setSideTab]=useState<'structure'|'players'>('structure')
  const[viewedSlot,setViewedSlot]=useState('general')
  const[compatibleOnly,setCompatibleOnly]=useState(false)
  const[playerSort,setPlayerSort]=useState<{key:PlayerSortKey;direction:1|-1}>({key:'generalScore',direction:-1})
  const[playerPickerSlot,setPlayerPickerSlot]=useState<string|null>(null)
  const[playerPickerAnchor,setPlayerPickerAnchor]=useState<{top:number;left:number;width:number}|null>(null)
  const[playerPickerSearch,setPlayerPickerSearch]=useState('')
  const[playerPickerColumns,setPlayerPickerColumns]=useState<Array<'positions'|'age'|'roleScore'|'generalScore'>>(['positions','age','roleScore','generalScore'])
  const[draggingCard,setDraggingCard]=useState<{phase:TacticPhase;playerId:string}|null>(null)
  const[rolePicker,setRolePicker]=useState<RolePicker|null>(null)
  const cardWasDragged=useRef(false)
  const loaded=useRef(false)

  function saveStatus(next:string,detail?:string){setStatus(next);setSaveDetail(detail??'')}
  async function persistPatch(patch:Record<string,unknown>){
    if(!selected)return
    saveStatus('Salvando…')
    try{const result=await patchModelConfig(selected.id,'2.9.0',patch);saveStatus('✓ Salvo',result.diagnostic??'')}
    catch(error){saveStatus('⚠ Não foi possível salvar',describeDbError(error).full)}
  }
  async function retrySave(){
    if(!selected)return
    try{const result=await retryModelConfigPatch(selected.id,saveStatus);if(!result)await persistPatch({tactics:config.tactics,selected_tactic_id:config.selected_tactic_id,selected_role_id:config.selected_role_id})}catch{/* shared layer already updated the status */}
  }

  useEffect(()=>{
    loaded.current=false
    if(!supabase||!selected)return
    saveStatus('Carregando…')
    void loadModelConfig(selected.id).then(data=>{
      const c=data as Partial<Config>
      setConfig({...fresh(),...c,tactics:(c.tactics??[]).map(t=>normalizeTactic(t))})
      loaded.current=true
      saveStatus('✓ Salvo')
    }).catch(error=>saveStatus('⚠ Não foi possível carregar',describeDbError(error).full))
  },[selected?.id])

  useEffect(()=>{
    if(!supabase||!selected){setCandidates([]);return}
    void supabase.from('imports').select('id').eq('save_id',selected.id).eq('status','imported').in('file_type',['squad','intake']).order('created_at',{ascending:false}).limit(1).maybeSingle().then(async({data})=>{
      if(!data){setCandidates([]);return}
      const result=await supabase!.from('player_snapshots').select('player_id,positions,age,players!inner(id,current_name),player_attributes(attribute_key,value)').eq('save_id',selected.id).eq('import_id',data.id)
      const rows=(result.data??[])as unknown as Array<{player_id:string;positions:string[];age:number|null;players:{id:string;current_name:string};player_attributes:Array<{attribute_key:string;value:number}>}>
      setCandidates(rows.map(row=>({id:row.player_id,name:row.players.current_name,positions:row.positions??[],age:row.age,attributes:row.player_attributes.map(a=>({key:a.attribute_key,value:a.value}))})))
    })
  },[selected?.id])

  useEffect(()=>{
    if(!loaded.current||!selected||!supabase)return
    scheduleModelConfigPatch(selected.id,'2.9.0',{
      tactics:config.tactics,
      selected_tactic_id:config.selected_tactic_id,
      selected_role_id:config.selected_role_id,
    },saveStatus)
  },[config.tactics,config.selected_tactic_id,config.selected_role_id,selected?.id])

  const tactic=config.tactics.find(t=>t.id===config.selected_tactic_id)
  const assignments=tactic?(phase==='IP'?tactic.ipAssignments:tactic.oopAssignments):[]
  const editing=assignments.find(a=>a.playerId===editPlayerId)
  const otherAssignments=tactic?(phase==='IP'?tactic.oopAssignments:tactic.ipAssignments):[]
  const linkedOther=otherAssignments.find(a=>a.playerId===editPlayerId)

  function create(){
    const clean=name.trim()
    if(!clean)return
    const id=crypto.randomUUID()
    const created=normalizeTactic({id,name:clean,roles:[],ipAssignments:assignmentsFor(ipFormation,'IP'),oopAssignments:assignmentsFor(oopFormation,'OOP')})
    setConfig(c=>{const next={...c,tactics:[...c.tactics,created],selected_tactic_id:id,selected_role_id:null};void persistPatch({tactics:next.tactics,selected_tactic_id:id,selected_role_id:null});return next})
    setName('');setCreateOpen(false)
  }

  function remove(){
    if(!tactic||!confirm(`Excluir a tática “${tactic.name}”?`))return
    setConfig(c=>{const next={...c,tactics:c.tactics.filter(t=>t.id!==tactic.id),selected_tactic_id:null,selected_role_id:null};void persistPatch({tactics:next.tactics,selected_tactic_id:null,selected_role_id:null});return next})
  }

  function updatePhase(targetPhase:TacticPhase,transform:(items:Assignment[])=>Assignment[]){
    if(!tactic)return
    const key=targetPhase==='IP'?'ipAssignments':'oopAssignments'
    setConfig(c=>({...c,tactics:c.tactics.map(t=>t.id===tactic.id?{...t,[key]:transform(t[key])}:t)}))
  }

  function changeRole(roleCode:string){
    if(!tactic||!editing)return
    changeAssignmentRole(editing.playerId,phase,roleCode)
  }

  function changeAssignmentRole(slotId:string,targetPhase:TacticPhase,roleCode:string){
    if(!tactic)return
    const key=targetPhase==='IP'?'ipAssignments':'oopAssignments'
    const assignment=tactic[key].find(a=>a.playerId===slotId)
    if(!assignment)return
    const option=rolesFor(assignment.position,targetPhase).find(r=>r[0]===roleCode)!
    const roleId=`${targetPhase}-${positionGroup(assignment.position)}-${option[0]}`
    setConfig(c=>({...c,tactics:c.tactics.map(t=>{
      if(t.id!==tactic.id)return t
      const roles=t.roles.some(r=>r.id===roleId)?t.roles:[...t.roles,{id:roleId,name:option[1],weights:roleDefaultWeights(roleId,option[1])}]
      return{...t,roles,[key]:t[key].map(a=>a.playerId===slotId?{...a,roleId,roleCode:option[0],roleName:option[1]}:a)}
    })}))
  }

  function relinkOther(targetNodeId:string){
    if(!editing||!linkedOther)return
    if(editing.position==='GK'||linkedOther.position==='GK')return
    const otherPhase:TacticPhase=phase==='IP'?'OOP':'IP'
    updatePhase(otherPhase,items=>{
      const target=items.find(a=>a.nodeId===targetNodeId)
      if(!target)return items
      return items.map(a=>a.nodeId===linkedOther.nodeId?{...a,playerId:target.playerId}:a.nodeId===target.nodeId?{...a,playerId:editing.playerId}:a)
    })
  }

  function selectPlayer(slotId:string,playerId:string){
    if(!tactic)return
    setConfig(c=>({...c,tactics:c.tactics.map(t=>t.id===tactic.id?{...t,lineup:{...t.lineup,[slotId]:playerId||null}}:t)}))
  }

  function swapPhaseLinks(targetPhase:TacticPhase,targetPlayerId:string){
    if(!tactic||!draggingCard||draggingCard.phase!==targetPhase||draggingCard.playerId===targetPlayerId){setDraggingCard(null);return}
    const key=targetPhase==='IP'?'ipAssignments':'oopAssignments',sourcePlayerId=draggingCard.playerId
    const phaseAssignments=tactic[key]
    if(phaseAssignments.some(assignment=>(assignment.playerId===sourcePlayerId||assignment.playerId===targetPlayerId)&&assignment.position==='GK')){setDraggingCard(null);return}
    setConfig(current=>({...current,tactics:current.tactics.map(item=>item.id===tactic.id?{...item,[key]:item[key].map(assignment=>assignment.playerId===sourcePlayerId?{...assignment,playerId:targetPlayerId}:assignment.playerId===targetPlayerId?{...assignment,playerId:sourcePlayerId}:assignment)}:item)}))
    setDraggingCard(null)
  }

  function scoreFor(candidate:Candidate,ip:Assignment,oop:Assignment){
    if(!tactic)return null
    const scores=[ip,oop].map(a=>{
      const weights=config.role_weight_overrides[a.roleId]??tactic.roles.find(r=>r.id===a.roleId)?.weights??roleDefaultWeights(a.roleId,a.roleName)
      return attributeScore(candidate.attributes.map(attribute=>({key:attribute.key,value:attribute.value,weight:weights[attribute.key]??3})))
    })
    return combinedPhaseScore(scores[0],scores[1])
  }

  function rankedCandidates(ip:Assignment,oop:Assignment){
    return candidates.map(candidate=>({candidate,score:scoreFor(candidate,ip,oop)})).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.candidate.name.localeCompare(b.candidate.name,'pt-BR'))
  }

  function changePlayerSort(key:PlayerSortKey){setPlayerSort(current=>({key,direction:current.key===key?current.direction===1?-1:1:key==='name'||key==='positions'?1:-1}))}

  function drop(event:DragEvent<HTMLElement>){
    event.preventDefault()
    if(!tactic||dragging===null||assignments[dragging].nodeId==='gk')return
    const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*100,y=(event.clientY-rect.top)/rect.height*100
    const target=PITCH_NODES.filter(n=>n.id!=='gk').sort((a,b)=>(a.x-x)**2+(a.y-y)**2-((b.x-x)**2+(b.y-y)**2))[0]
    const occupied=assignments.findIndex(a=>a.nodeId===target.id)
    updatePhase(phase,items=>{
      const next=items.map(a=>({...a})),source=next[dragging]
      if(occupied>=0){const sourceNode=PITCH_NODES.find(n=>n.id===source.nodeId)!;next[occupied]={...makeAssignment(sourceNode.id,phase,next[occupied].playerId)}}
      next[dragging]={...makeAssignment(target.id,phase,source.playerId)}
      return next
    })
    setDragging(null)
  }

  const naturalSort=(a:Assignment,b:Assignment)=>{
    const an=PITCH_NODES.find(n=>n.id===a.nodeId)!,bn=PITCH_NODES.find(n=>n.id===b.nodeId)!
    const rank:Record<string,number>={GK:0,FB:1,CB:1,WB:2,DM:2,WM:3,CM:3,W:4,AM:4,ST:5}
    return rank[positionGroup(a.position)]-rank[positionGroup(b.position)]||bn.x-an.x
  }
  const pairedRows=tactic?[...tactic.ipAssignments].sort(naturalSort).map(ip=>({ip,oop:tactic.oopAssignments.find(a=>a.playerId===ip.playerId)!})):[]
  const selectedPair=viewedSlot==='general'?undefined:pairedRows.find(({ip})=>ip.playerId===viewedSlot)
  const playerRows=candidates.filter(candidate=>!compatibleOnly||!selectedPair||candidate.positions.some(position=>position.toUpperCase()===selectedPair.ip.position.toUpperCase())).map(candidate=>{const raw=attributeScore(candidate.attributes.map(attribute=>({key:attribute.key,value:attribute.value,weight:config.general_weights[attribute.key]??3})));return{candidate,positionScore:selectedPair?scoreFor(candidate,selectedPair.ip,selectedPair.oop):null,generalScore:raw===null?null:fmScaleScore(raw)}}).sort((a,b)=>{const key=playerSort.key;let result=0;if(key==='name')result=a.candidate.name.localeCompare(b.candidate.name,'pt-BR');else if(key==='positions')result=a.candidate.positions.join(',').localeCompare(b.candidate.positions.join(','));else if(key==='age')result=(a.candidate.age??999)-(b.candidate.age??999);else if(key==='positionScore')result=(a.positionScore??-1)-(b.positionScore??-1);else result=(a.generalScore??-1)-(b.generalScore??-1);return result*playerSort.direction||a.candidate.name.localeCompare(b.candidate.name,'pt-BR')})
  const pickerPair=pairedRows.find(({ip})=>ip.playerId===playerPickerSlot)
  const pickerRows=pickerPair?rankedCandidates(pickerPair.ip,pickerPair.oop).filter(({candidate})=>[candidate.name,candidate.positions.join(' '),candidate.age].join(' ').toLowerCase().includes(playerPickerSearch.toLowerCase())).map(row=>{const raw=attributeScore(row.candidate.attributes.map(attribute=>({key:attribute.key,value:attribute.value,weight:config.general_weights[attribute.key]??3})));return{...row,generalScore:raw===null?null:fmScaleScore(raw)}}):[]
  const playerSortMark=(key:PlayerSortKey)=>playerSort.key===key?(playerSort.direction===1?'▲':'▼'):'↕'

  function beginCardDrag(targetPhase:TacticPhase,playerId:string){cardWasDragged.current=true;setRolePicker(null);setDraggingCard({phase:targetPhase,playerId})}
  function finishCardDrag(){setDraggingCard(null);window.setTimeout(()=>{cardWasDragged.current=false},0)}
  function openRolePicker(event:MouseEvent<HTMLButtonElement>,assignment:Assignment,targetPhase:TacticPhase){
    if(cardWasDragged.current)return
    const card=event.currentTarget.closest('.role-box') as HTMLElement|null,rect=(card??event.currentTarget).getBoundingClientRect()
    setRolePicker({phase:targetPhase,playerId:assignment.playerId,position:assignment.position,roleCode:assignment.roleCode,top:rect.bottom,left:rect.left,width:rect.width})
  }
  function roleCard(assignment:Assignment,targetPhase:TacticPhase){return <div className={`role-box line-${lineClass(assignment.position)}`} draggable={assignment.position!=='GK'} onDragStart={()=>assignment.position!=='GK'&&beginCardDrag(targetPhase,assignment.playerId)} onDragEnd={finishCardDrag} onDragOver={event=>event.preventDefault()} onDrop={()=>swapPhaseLinks(targetPhase,assignment.playerId)} title="Arraste para trocar o vínculo"><b>{assignment.position}</b><button type="button" className="role-inline-picker" onClick={event=>openRolePicker(event,assignment,targetPhase)} aria-label={`Função ${targetPhase} de ${assignment.position}`}><span>{assignment.roleCode}</span><small>{assignment.roleName}</small></button></div>}

  return <div className="tactics-page">
    <div className="title-row"><div><span className="eyebrow">ESTRUTURA DO TIME · FM26</span><h1>Táticas</h1><p>Configure separadamente as posições e funções com e sem a bola.</p></div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠')?()=>void retrySave():undefined}/></div>
    <div className="tactic-topbar"><div className="tactic-toolbar"><select aria-label="Tática selecionada" value={tactic?.id??''} onChange={e=>{const id=e.target.value||null;setConfig(c=>({...c,selected_tactic_id:id,selected_role_id:null}));void persistPatch({selected_tactic_id:id,selected_role_id:null})}}><option value="">Selecione uma tática</option>{config.tactics.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select><button onClick={()=>setCreateOpen(true)}>+ Adicionar</button><button className="danger-button" disabled={!tactic} onClick={remove}>Excluir</button></div><div className="tactic-tabs"><button className={sideTab==='structure'?'active':''} onClick={()=>setSideTab('structure')}>Estrutura</button><button className={sideTab==='players'?'active':''} onClick={()=>setSideTab('players')}>Jogadores</button></div></div>
    <div className="tactic-workspace">
      <section className={`football-pitch ${!tactic?'pitch-empty':''}`} onDragOver={e=>e.preventDefault()} onDrop={drop}>
        <div className="phase-switch field-phase-switch" aria-label="Fase da tática"><button className={phase==='IP'?'active':''} onClick={()=>setPhase('IP')}>IP</button><button className={phase==='OOP'?'active':''} onClick={()=>setPhase('OOP')}>OOP</button></div>
        {PITCH_NODES.map(n=><i className="position-target" style={{left:`${n.x}%`,top:`${n.y}%`}} key={n.id}/>)}
        {assignments.map((a,index)=>{const node=PITCH_NODES.find(n=>n.id===a.nodeId)!;return <div className={`pitch-player ${dragging===index?'dragging':''}`} style={{left:`${node.x}%`,top:`${node.y}%`}} key={a.playerId}><button className={`role-ball line-${lineClass(a.position)}`} draggable={a.nodeId!=='gk'} onDragStart={()=>setDragging(index)} title={a.nodeId==='gk'?'Goleiro fixo':'Arraste para outra posição'}><span>{a.roleCode}</span></button><button className="player-edit" onClick={()=>setEditPlayerId(a.playerId)} aria-label={`Editar ${a.position}`} title="Editar função">✎</button><small>{a.position}</small></div>})}
        {!tactic&&<div className="empty-pitch-action"><h2>Comece pela sua primeira tática</h2><button onClick={()=>setCreateOpen(true)}>Criar nova tática</button></div>}
      </section>
      <aside className="card tactic-side-panel">{sideTab==='structure'?<div className={`role-summary ${tactic?'has-tactic':''}`}>{tactic&&<div className="role-pair-head"><span>In Possession</span><span>Out of Possession</span><span>Jogador · ordenado pela nota das funções</span><span></span></div>}{pairedRows.map(({ip,oop})=><div className="role-pair-row" key={ip.playerId}>{roleCard(ip,'IP')}{roleCard(oop,'OOP')}<button className="player-picker advanced-player-picker" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setPlayerPickerAnchor({top:rect.top,left:rect.left,width:rect.width});setPlayerPickerSlot(ip.playerId);setPlayerPickerSearch('')}}>{candidates.find(candidate=>candidate.id===tactic?.lineup[ip.playerId])?.name??'Selecionar jogador'}</button><button onClick={()=>setEditPlayerId(ip.playerId)} aria-label={`Editar ${ip.position} e ${oop.position}`} title="Editar vínculo e função">✎</button></div>)}{!tactic&&<p>Crie uma tática para configurar as funções.</p>}</div>:<div className="player-ranking"><div className="player-ranking-controls"><select value={viewedSlot} onChange={e=>{setViewedSlot(e.target.value);if(e.target.value==='general')setCompatibleOnly(false)}}><option value="general">Geral</option>{pairedRows.map(({ip,oop})=><option value={ip.playerId} key={ip.playerId}>{ip.position} {ip.roleCode} · {oop.position} {oop.roleCode}</option>)}</select><label><input type="checkbox" checked={compatibleOnly} disabled={viewedSlot==='general'} onChange={e=>setCompatibleOnly(e.target.checked)}/> Somente jogadores da posição</label></div><div className={`player-ranking-head ${selectedPair?'with-position':''}`}><button className="sort-button" onClick={()=>changePlayerSort('name')}>Jogador {playerSortMark('name')}</button><button className="sort-button" onClick={()=>changePlayerSort('positions')}>Posições {playerSortMark('positions')}</button><button className="sort-button" onClick={()=>changePlayerSort('age')}>Idade {playerSortMark('age')}</button>{selectedPair&&<button className="sort-button" onClick={()=>changePlayerSort('positionScore')}>Nota da posição {playerSortMark('positionScore')}</button>}<button className="sort-button" onClick={()=>changePlayerSort('generalScore')}>Nota geral {playerSortMark('generalScore')}</button></div><div className="player-ranking-body">{playerRows.map(({candidate,positionScore,generalScore})=><div className={`player-ranking-row ${selectedPair?'with-position':''}`} key={candidate.id}><b>{candidate.name}</b><span>{candidate.positions.join(', ')||'—'}</span><span>{candidate.age??'—'}</span>{selectedPair&&<ScoreBadge value={positionScore} className="score-badge-compact"/>}<ScoreBadge value={generalScore} className="score-badge-compact"/></div>)}</div></div>}</aside>
    </div>

    {rolePicker&&createPortal(<><button className="role-card-dropdown-dismiss" aria-label="Fechar seletor de função" onClick={()=>setRolePicker(null)}/><div className={`role-card-dropdown line-${lineClass(rolePicker.position)}`} style={{top:rolePicker.top,left:rolePicker.left,width:rolePicker.width}} role="listbox" aria-label={`Funções para ${rolePicker.position}`}>{rolesFor(rolePicker.position,rolePicker.phase).map(([code,label])=><button type="button" className={code===rolePicker.roleCode?'active':''} onClick={()=>{changeAssignmentRole(rolePicker.playerId,rolePicker.phase,code);setRolePicker(null)}} role="option" aria-selected={code===rolePicker.roleCode} key={code}><b>{code}</b><span>{label}</span></button>)}</div></>,document.body)}

    {createOpen&&<div className="settings-overlay" onClick={()=>setCreateOpen(false)}><section className="tactic-modal" onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">NOVA ESTRUTURA</span><h2>Criar tática</h2></div><button className="close" onClick={()=>setCreateOpen(false)}>×</button></header><label>Nome da tática<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: 4-3-3 Posicional"/></label><div className="formation-grid"><label>Formação In Possession<select value={ipFormation} onChange={e=>setIpFormation(e.target.value)}>{Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}</select></label><label>Formação Out of Possession<select value={oopFormation} onChange={e=>setOopFormation(e.target.value)}>{Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}</select></label></div><footer><button className="ghost" onClick={()=>setCreateOpen(false)}>Cancelar</button><button onClick={create} disabled={!name.trim()}>Criar tática</button></footer></section></div>}

    {playerPickerSlot&&pickerPair&&<div className="settings-overlay player-picker-overlay" onClick={()=>setPlayerPickerSlot(null)}><section className="advanced-picker-modal" style={playerPickerAnchor?{top:Math.max(12,Math.min(playerPickerAnchor.top,window.innerHeight-560)),left:Math.max(12,Math.min(playerPickerAnchor.left,window.innerWidth-Math.min(780,window.innerWidth-24)-12)),width:Math.min(780,window.innerWidth-24)}:undefined} onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">{pickerPair.ip.position} {pickerPair.ip.roleCode} · {pickerPair.oop.position} {pickerPair.oop.roleCode}</span><h2>Selecionar jogador</h2></div><button className="close" onClick={()=>setPlayerPickerSlot(null)}>×</button></header><div className="advanced-picker-controls"><input autoFocus placeholder="Filtrar por nome" value={playerPickerSearch} onChange={e=>setPlayerPickerSearch(e.target.value)}/><div>{(['positions','age','roleScore','generalScore']as const).map(column=><label key={column}><input type="checkbox" checked={playerPickerColumns.includes(column)} onChange={e=>setPlayerPickerColumns(current=>e.target.checked?[...current,column]:current.filter(item=>item!==column))}/>{{positions:'Posições',age:'Idade',roleScore:'Nota da função',generalScore:'Nota geral'}[column]}</label>)}</div></div><div className="advanced-picker-table"><div className="advanced-picker-head"><span>Jogador</span>{playerPickerColumns.includes('positions')&&<span>Posições</span>}{playerPickerColumns.includes('age')&&<span>Idade</span>}{playerPickerColumns.includes('roleScore')&&<span>Função</span>}{playerPickerColumns.includes('generalScore')&&<span>Geral</span>}</div>{pickerRows.map(({candidate,score,generalScore})=>{const taken=Object.entries(tactic!.lineup).some(([slot,id])=>slot!==playerPickerSlot&&id===candidate.id);return <button className="advanced-picker-row" disabled={taken} onClick={()=>{selectPlayer(playerPickerSlot,candidate.id);setPlayerPickerSlot(null)}} key={candidate.id}><strong>{candidate.name}</strong>{playerPickerColumns.includes('positions')&&<span>{candidate.positions.join(', ')||'—'}</span>}{playerPickerColumns.includes('age')&&<span>{candidate.age??'—'}</span>}{playerPickerColumns.includes('roleScore')&&<b>{score?.toFixed(1)??'—'}</b>}{playerPickerColumns.includes('generalScore')&&<b>{generalScore?.toFixed(1)??'—'}</b>}</button>})}</div><footer><button className="ghost" onClick={()=>{selectPlayer(playerPickerSlot,'');setPlayerPickerSlot(null)}}>Remover jogador</button></footer></section></div>}

    {editing&&<div className="settings-overlay" onClick={()=>setEditPlayerId(null)}><section className="tactic-modal role-modal" onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">{phase} · {editing.position}</span><h2>Editar jogador</h2></div><button className="close" onClick={()=>setEditPlayerId(null)}>×</button></header><div className="role-editor-layout"><div><h3>Função em {phase}</h3><div className="role-options">{rolesFor(editing.position,phase).map(([code,label])=><button className={editing.roleCode===code?'active':''} onClick={()=>changeRole(code)} key={code}><b>{code}</b><span>{label}</span></button>)}</div></div><div><h3>Posição vinculada em {phase==='IP'?'OOP':'IP'}</h3><div className="mini-link-pitch">{PITCH_NODES.map(n=><i className="position-target" style={{left:`${n.x}%`,top:`${n.y}%`}} key={n.id}/>)}{otherAssignments.map(a=>{const node=PITCH_NODES.find(n=>n.id===a.nodeId)!;return <button className={`mini-player line-${lineClass(a.position)} ${linkedOther?.nodeId===a.nodeId?'linked':''}`} style={{left:`${node.x}%`,top:`${node.y}%`}} disabled={editing.position==='GK'||a.position==='GK'} onClick={()=>relinkOther(a.nodeId)} title={`${a.position} · ${laneLabel(a.nodeId)}`} key={a.nodeId}>{a.roleCode}</button>})}</div><p className="modal-hint">A posição realçada representa este mesmo jogador na outra formação.</p></div></div><footer><button onClick={()=>setEditPlayerId(null)}>Concluir</button></footer></section></div>}
  </div>
}
