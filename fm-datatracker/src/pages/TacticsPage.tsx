import{useEffect,useRef,useState,type DragEvent}from'react'
import{supabase}from'../lib/supabase'
import{DEFAULT_ATTRIBUTE_WEIGHTS}from'../lib/attributes'
import{PITCH_NODES,positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{useSaves}from'../features/saves/SaveContext'

type Role={id:string;name:string;weights:Record<string,number>}
type Assignment={playerId:string;nodeId:string;position:string;roleId:string;roleCode:string;roleName:string}
type Tactic={id:string;name:string;roles:Role[];assignments?:Assignment[];ipAssignments:Assignment[];oopAssignments:Assignment[]}
type Config={general_weights:Record<string,number>;tactics:Tactic[];selected_tactic_id:string|null;selected_role_id:string|null}

const FORMATIONS:Record<string,string[]>={
  '4-3-3':['gk','dl','dcl','dcr','dr','dmc','mcl','mcr','aml','amr','stc'],
  '4-2-3-1':['gk','dl','dcl','dcr','dr','dml','dmr','aml','amc','amr','stc'],
  '4-4-2':['gk','dl','dcl','dcr','dr','ml','mcl','mcr','mr','stl','str'],
  '3-4-3':['gk','dcl','dc','dcr','wbl','mcl','mcr','wbr','aml','amr','stc'],
  '3-5-2':['gk','dcl','dc','dcr','wbl','mcl','mc','mcr','wbr','stl','str']
}
const DEFAULT_NODE_IDS=FORMATIONS['4-3-3']
const fresh=():Config=>({general_weights:{...DEFAULT_ATTRIBUTE_WEIGHTS},tactics:[],selected_tactic_id:null,selected_role_id:null})

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
    if(existing)existing.name=a.roleName
    else roles.push({id:a.roleId,name:a.roleName,weights:{...DEFAULT_ATTRIBUTE_WEIGHTS}})
  }
  return{id:t.id,name:t.name,roles,ipAssignments,oopAssignments}
}

export function TacticsPage(){
  const{selected}=useSaves()
  const[modelId,setModelId]=useState<string|null>(null)
  const[config,setConfig]=useState<Config>(fresh)
  const[status,setStatus]=useState('Carregando…')
  const[phase,setPhase]=useState<TacticPhase>('IP')
  const[dragging,setDragging]=useState<number|null>(null)
  const[createOpen,setCreateOpen]=useState(false)
  const[editPlayerId,setEditPlayerId]=useState<string|null>(null)
  const[name,setName]=useState('')
  const[ipFormation,setIpFormation]=useState('4-3-3')
  const[oopFormation,setOopFormation]=useState('4-3-3')
  const loaded=useRef(false)

  useEffect(()=>{
    loaded.current=false
    if(!supabase||!selected)return
    void supabase.from('scoring_models').select('id,config').eq('save_id',selected.id).eq('name','Model Lab').order('created_at').limit(1).maybeSingle().then(({data})=>{
      if(data){const c=data.config as Partial<Config>;setModelId(data.id);setConfig({...fresh(),...c,tactics:(c.tactics??[]).map(t=>normalizeTactic(t))})}
      else{setModelId(null);setConfig(fresh())}
      loaded.current=true
      setStatus('Salvo automaticamente')
    })
  },[selected?.id])

  useEffect(()=>{
    if(!loaded.current||!selected||!supabase)return
    setStatus('Salvando…')
    const timer=setTimeout(async()=>{
      const{data:{user}}=await supabase!.auth.getUser()
      const payload={owner_id:user!.id,save_id:selected.id,name:'Model Lab',version:'2.1.0',config,is_active:true}
      const result=modelId?await supabase!.from('scoring_models').update(payload).eq('id',modelId).select('id').single():await supabase!.from('scoring_models').insert(payload).select('id').single()
      if(result.data?.id)setModelId(result.data.id)
      setStatus(result.error?`Erro: ${result.error.message}`:'Salvo automaticamente')
    },450)
    return()=>clearTimeout(timer)
  },[config,modelId,selected?.id])

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
    setConfig(c=>({...c,tactics:[...c.tactics,created],selected_tactic_id:id,selected_role_id:null}))
    setName('');setCreateOpen(false)
  }

  function remove(){
    if(!tactic||!confirm(`Excluir a tática “${tactic.name}”?`))return
    setConfig(c=>({...c,tactics:c.tactics.filter(t=>t.id!==tactic.id),selected_tactic_id:null,selected_role_id:null}))
  }

  function updatePhase(targetPhase:TacticPhase,transform:(items:Assignment[])=>Assignment[]){
    if(!tactic)return
    const key=targetPhase==='IP'?'ipAssignments':'oopAssignments'
    setConfig(c=>({...c,tactics:c.tactics.map(t=>t.id===tactic.id?{...t,[key]:transform(t[key])}:t)}))
  }

  function changeRole(roleCode:string){
    if(!tactic||!editing)return
    const option=rolesFor(editing.position,phase).find(r=>r[0]===roleCode)!
    const roleId=`${phase}-${positionGroup(editing.position)}-${option[0]}`
    const key=phase==='IP'?'ipAssignments':'oopAssignments'
    setConfig(c=>({...c,tactics:c.tactics.map(t=>{
      if(t.id!==tactic.id)return t
      const roles=t.roles.some(r=>r.id===roleId)?t.roles:[...t.roles,{id:roleId,name:option[1],weights:{...DEFAULT_ATTRIBUTE_WEIGHTS}}]
      return{...t,roles,[key]:t[key].map(a=>a.playerId===editing.playerId?{...a,roleId,roleCode:option[0],roleName:option[1]}:a)}
    })}))
  }

  function relinkOther(targetNodeId:string){
    if(!editing||!linkedOther)return
    const otherPhase:TacticPhase=phase==='IP'?'OOP':'IP'
    updatePhase(otherPhase,items=>{
      const target=items.find(a=>a.nodeId===targetNodeId)
      if(!target)return items
      return items.map(a=>a.nodeId===linkedOther.nodeId?{...a,playerId:target.playerId}:a.nodeId===target.nodeId?{...a,playerId:editing.playerId}:a)
    })
  }

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

  return <div className="tactics-page">
    <div className="title-row"><div><span className="eyebrow">ESTRUTURA DO TIME · FM26</span><h1>Táticas</h1><p>Configure separadamente as posições e funções com e sem a bola.</p></div><span className="save-state">{status}</span></div>
    <div className="phase-switch" aria-label="Fase da tática"><button className={phase==='IP'?'active':''} onClick={()=>setPhase('IP')}>In Possession (IP)</button><button className={phase==='OOP'?'active':''} onClick={()=>setPhase('OOP')}>Out of Possession (OOP)</button></div>
    <div className="tactic-workspace">
      <section className={`football-pitch ${!tactic?'pitch-empty':''}`} onDragOver={e=>e.preventDefault()} onDrop={drop}>
        {PITCH_NODES.map(n=><i className="position-target" style={{left:`${n.x}%`,top:`${n.y}%`}} key={n.id}/>)}
        {assignments.map((a,index)=>{const node=PITCH_NODES.find(n=>n.id===a.nodeId)!;return <div className={`pitch-player ${dragging===index?'dragging':''}`} style={{left:`${node.x}%`,top:`${node.y}%`}} key={a.playerId}><button className="role-ball" draggable={a.nodeId!=='gk'} onDragStart={()=>setDragging(index)} title={a.nodeId==='gk'?'Goleiro fixo':'Arraste para outra posição'}><span>{a.roleCode}</span></button><button className="player-edit" onClick={()=>setEditPlayerId(a.playerId)} aria-label={`Editar ${a.position}`} title="Editar função">✎</button><small>{a.position}</small></div>})}
        {!tactic&&<div className="empty-pitch-action"><h2>Comece pela sua primeira tática</h2><button onClick={()=>setCreateOpen(true)}>Criar nova tática</button></div>}
      </section>
      <aside className="card tactic-list"><h2>Suas táticas</h2>{config.tactics.map(t=><button className={t.id===tactic?.id?'active':''} onClick={()=>setConfig(c=>({...c,selected_tactic_id:t.id,selected_role_id:null}))} key={t.id}>{t.name}</button>)}{!config.tactics.length&&<p>Nenhuma tática criada.</p>}<div className="tactic-actions"><button className="create-tactic-button" onClick={()=>setCreateOpen(true)}>+ Criar tática</button><button className="danger-button" disabled={!tactic} onClick={remove}>Excluir selecionada</button></div></aside>
    </div>

    {createOpen&&<div className="settings-overlay" onClick={()=>setCreateOpen(false)}><section className="tactic-modal" onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">NOVA ESTRUTURA</span><h2>Criar tática</h2></div><button className="close" onClick={()=>setCreateOpen(false)}>×</button></header><label>Nome da tática<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: 4-3-3 Posicional"/></label><div className="formation-grid"><label>Formação In Possession<select value={ipFormation} onChange={e=>setIpFormation(e.target.value)}>{Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}</select></label><label>Formação Out of Possession<select value={oopFormation} onChange={e=>setOopFormation(e.target.value)}>{Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}</select></label></div><footer><button className="ghost" onClick={()=>setCreateOpen(false)}>Cancelar</button><button onClick={create} disabled={!name.trim()}>Criar tática</button></footer></section></div>}

    {editing&&<div className="settings-overlay" onClick={()=>setEditPlayerId(null)}><section className="tactic-modal role-modal" onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">{phase} · {editing.position}</span><h2>Editar jogador</h2></div><button className="close" onClick={()=>setEditPlayerId(null)}>×</button></header><label>Função em {phase}<div className="role-options">{rolesFor(editing.position,phase).map(([code,label])=><button className={editing.roleCode===code?'active':''} onClick={()=>changeRole(code)} key={code}><b>{code}</b><span>{label}</span></button>)}</div></label><label>Posição vinculada em {phase==='IP'?'OOP':'IP'}<select value={linkedOther?.nodeId??''} onChange={e=>relinkOther(e.target.value)}>{otherAssignments.map(a=><option value={a.nodeId} key={a.nodeId}>{a.position} · {laneLabel(a.nodeId)} · {a.roleCode}</option>)}</select></label><p className="modal-hint">Este vínculo identifica o mesmo jogador nas duas formações.</p><footer><button onClick={()=>setEditPlayerId(null)}>Concluir</button></footer></section></div>}
  </div>
}
