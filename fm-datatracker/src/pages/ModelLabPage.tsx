import{useEffect,useRef,useState}from'react'
import{supabase}from'../lib/supabase'
import{ATTRIBUTE_CATALOG,DEFAULT_ATTRIBUTE_WEIGHTS,type AttributeCategory}from'../lib/attributes'
import{positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{roleDefaultWeights}from'../lib/roleWeights'
import{useSaves}from'../features/saves/SaveContext'
import{SaveState}from'../components/SaveState'
import{loadModelConfig,retryModelConfigPatch,scheduleModelConfigPatch}from'../lib/model-config'
import{describeDbError}from'../lib/db-error'

type Role={id:string;name:string;weights:Record<string,number>}
type Tactic={id:string;name:string;roles:Role[];[key:string]:unknown}
type Config={general_weights:Record<string,number>;role_weight_overrides:Record<string,Record<string,number>>;tactics:Tactic[];selected_tactic_id:string|null;selected_role_id:string|null}

const groups:Array<{key:AttributeCategory;label:string}>=[{key:'technical',label:'Técnico'},{key:'mental',label:'Mental'},{key:'physical',label:'Físico'},{key:'goalkeeping',label:'Goleiro'}]
const positions=[['GK','Goleiro'],['D (C)','Defesa central'],['D (R)','Lateral'],['WB (R)','Ala'],['DM (C)','Médio defensivo'],['M (C)','Médio central'],['M (R)','Médio lateral'],['AM (C)','Médio ofensivo'],['AM (R)','Extremo'],['ST (C)','Atacante']] as const
const generalDefaults=()=>({...DEFAULT_ATTRIBUTE_WEIGHTS})
const fresh=():Config=>({general_weights:generalDefaults(),role_weight_overrides:{},tactics:[],selected_tactic_id:null,selected_role_id:null})

export function ModelLabPage(){
  const{selected}=useSaves()
  const[config,setConfig]=useState<Config>(fresh)
  const[mode,setMode]=useState<'general'|'role'>('general')
  const[phase,setPhase]=useState<TacticPhase>('IP')
  const[position,setPosition]=useState('GK')
  const[roleCode,setRoleCode]=useState('GK')
  const[status,setStatus]=useState('Carregando…')
  const[saveDetail,setSaveDetail]=useState('')
  const loaded=useRef(false)
  function saveStatus(next:string,detail?:string){setStatus(next);setSaveDetail(detail??'')}
  async function retrySave(){if(!selected)return;try{const result=await retryModelConfigPatch(selected.id,saveStatus);if(!result)scheduleModelConfigPatch(selected.id,'2.9.0',{general_weights:config.general_weights,role_weight_overrides:config.role_weight_overrides},saveStatus,undefined,0)}catch{/* shared layer updates status */}}

  const roleOptions=rolesFor(position,phase)
  const selectedRole=roleOptions.find(([code])=>code===roleCode)??roleOptions[0]
  const roleId=`${phase}-${positionGroup(position)}-${selectedRole[0]}`
  const roleName=selectedRole[1]
  const weights=mode==='general'?config.general_weights:config.role_weight_overrides[roleId]??roleDefaultWeights(roleId,roleName)

  useEffect(()=>{
    const first=rolesFor(position,phase)[0]
    setRoleCode(first[0])
  },[phase,position])

  useEffect(()=>{
    loaded.current=false
    if(!supabase||!selected)return
    saveStatus('Carregando…')
    void loadModelConfig(selected.id).then(data=>{
      const c=data as Partial<Config>
      setConfig({...fresh(),...c,general_weights:{...generalDefaults(),...(c.general_weights??{})},role_weight_overrides:c.role_weight_overrides??{}})
      loaded.current=true;saveStatus('✓ Salvo')
    }).catch(error=>saveStatus('⚠ Não foi possível carregar',describeDbError(error).full))
  },[selected?.id])

  useEffect(()=>{
    if(!loaded.current||!selected||!supabase)return
    scheduleModelConfigPatch(selected.id,'2.9.0',{
      general_weights:config.general_weights,
      role_weight_overrides:config.role_weight_overrides,
    },saveStatus)
  },[config.general_weights,config.role_weight_overrides,selected?.id])

  function changeWeight(key:string,value:number){
    if(mode==='general')setConfig(c=>({...c,general_weights:{...c.general_weights,[key]:value}}))
    else setConfig(c=>({...c,role_weight_overrides:{...c.role_weight_overrides,[roleId]:{...(c.role_weight_overrides[roleId]??roleDefaultWeights(roleId,roleName)),[key]:value}}}))
  }

  function reset(){
    const message=mode==='general'?'Restaurar todos os pesos gerais para 3?':`Restaurar a matriz padrão de ${roleName}?`
    if(!confirm(message))return
    if(mode==='general')setConfig(c=>({...c,general_weights:generalDefaults()}))
    else setConfig(c=>({...c,role_weight_overrides:{...c.role_weight_overrides,[roleId]:roleDefaultWeights(roleId,roleName)}}))
  }

  return <div className="screen-page scoring-page">
    <div className="title-row"><div><h1>Pontuação & Funções</h1></div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠')?()=>void retrySave():undefined}/></div>
    <section className="card scoring-toolbar">
      <div className="scoring-mode"><button className={mode==='general'?'active':''} onClick={()=>setMode('general')}>Pontuação geral</button><button className={mode==='role'?'active':''} onClick={()=>setMode('role')}>Por função</button></div>
      {mode==='role'&&<><div className="phase-compact"><button className={phase==='IP'?'active':''} onClick={()=>setPhase('IP')}>IP</button><button className={phase==='OOP'?'active':''} onClick={()=>setPhase('OOP')}>OOP</button></div><label>Posição<select value={position} onChange={e=>setPosition(e.target.value)}>{positions.map(([value,label])=><option value={value} key={value}>{label} · {value}</option>)}</select></label><label>Função<select value={selectedRole[0]} onChange={e=>setRoleCode(e.target.value)}>{roleOptions.map(([code,name])=><option value={code} key={code}>{code} · {name}</option>)}</select></label></>}
      <button className="secondary reset-weights" onClick={reset}>{mode==='general'?'Restaurar padrão 3':'Restaurar padrão da função'}</button>
    </section>
    <section className="card scoring-workspace"><div className="scoring-workspace-title"><div><h2>{mode==='general'?'Pontuação geral':`${phase} · ${position} · ${roleName}`}</h2></div><p>1 ignora · 2 secundário · 3 importante · 4 muito importante · 5 crítico</p></div><div className="weight-groups">{groups.map(group=><section className={`weight-group weight-group-${group.key}`} key={group.key}><h3>{group.label}</h3><div>{ATTRIBUTE_CATALOG.filter(attribute=>attribute.category===group.key).sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:'base'})).map(attribute=><label className="weight-row" key={attribute.key}><span>{attribute.label}</span><input type="range" min="1" max="5" value={weights[attribute.key]??3} onChange={e=>changeWeight(attribute.key,Number(e.target.value))}/><output>{weights[attribute.key]??3}</output></label>)}</div></section>)}</div></section>
  </div>
}
