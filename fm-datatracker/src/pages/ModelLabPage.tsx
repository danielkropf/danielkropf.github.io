import{useEffect,useRef,useState}from'react'
import{supabase}from'../lib/supabase'
import{ATTRIBUTE_CATALOG,type AttributeCategory}from'../lib/attributes'
import{positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{canonicalRoleDefaultWeights}from'../lib/role-scoring'
import{useSaves}from'../features/saves/SaveContext'
import{SaveState}from'../components/SaveState'
import{loadModelConfig,retryModelConfigPatch,scheduleModelConfigPatch}from'../lib/model-config'
import{describeDbError}from'../lib/db-error'
import{createLatestSaveRequestGuard}from'../lib/latest-save-request'

type Role={id:string;name:string;weights:Record<string,number>}
type Tactic={id:string;name:string;roles:Role[];[key:string]:unknown}
type Config={role_weight_overrides:Record<string,Record<string,number>>;tactics:Tactic[];selected_tactic_id:string|null;selected_role_id:string|null}

const groups:Array<{key:AttributeCategory;label:string}>=[{key:'technical',label:'Técnico'},{key:'mental',label:'Mental'},{key:'physical',label:'Físico'},{key:'goalkeeping',label:'Goleiro'}]
const positions=[['GK','Goleiro'],['D (C)','Defesa central'],['D (R)','Lateral'],['WB (R)','Ala'],['DM (C)','Médio defensivo'],['M (C)','Médio central'],['M (R)','Médio lateral'],['AM (C)','Médio ofensivo'],['AM (R)','Extremo'],['ST (C)','Atacante']] as const
const fresh=():Config=>({role_weight_overrides:{},tactics:[],selected_tactic_id:null,selected_role_id:null})

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
  const loadGuard=useRef(createLatestSaveRequestGuard())
  function saveStatus(next:string,detail?:string){setStatus(next);setSaveDetail(detail??'')}
  async function retrySave(){if(!selected)return;try{const result=await retryModelConfigPatch(selected.id,saveStatus);if(!result)scheduleModelConfigPatch(selected.id,'2.9.0',{role_weight_overrides:config.role_weight_overrides},saveStatus,undefined,0)}catch{/* shared layer updates status */}}

  const roleOptions=rolesFor(position,phase)
  const selectedRole=roleOptions.find(([code])=>code===roleCode)??roleOptions[0]
  const roleId=`${phase}-${positionGroup(position)}-${selectedRole[0]}`
  const roleName=selectedRole[1]
  const weights=config.role_weight_overrides[roleId]??canonicalRoleDefaultWeights(roleId,roleName)

  useEffect(()=>{
    const first=rolesFor(position,phase)[0]
    setRoleCode(first[0])
  },[phase,position])

  useEffect(()=>{
    loaded.current=false
    if(!supabase||!selected){loadGuard.current.invalidate();return}
    const token=loadGuard.current.begin(selected.id)
    saveStatus('Carregando…')
    void loadModelConfig(selected.id).then(data=>{
      if(!loadGuard.current.isCurrent(token))return
      const c=data as Partial<Config>
      setConfig({...fresh(),...c,role_weight_overrides:c.role_weight_overrides??{}})
      loaded.current=true;saveStatus('✓ Salvo')
    }).catch(error=>{if(loadGuard.current.isCurrent(token))saveStatus('⚠ Não foi possível carregar',describeDbError(error).full)})
    return()=>loadGuard.current.invalidate(token)
  },[selected?.id])

  useEffect(()=>{
    if(!loaded.current||!selected||!supabase)return
    scheduleModelConfigPatch(selected.id,'2.9.0',{role_weight_overrides:config.role_weight_overrides},saveStatus)
  },[config.role_weight_overrides,selected?.id])

  function changeWeight(key:string,value:number){
    setConfig(c=>({...c,role_weight_overrides:{...c.role_weight_overrides,[roleId]:{...(c.role_weight_overrides[roleId]??canonicalRoleDefaultWeights(roleId,roleName)),[key]:value}}}))
  }

  function reset(){
    if(mode==='general')return
    if(!confirm(`Restaurar a matriz padrão de ${roleName}?`))return
    setConfig(c=>({...c,role_weight_overrides:{...c.role_weight_overrides,[roleId]:canonicalRoleDefaultWeights(roleId,roleName)}}))
  }

  return <div className="screen-page scoring-page">
    <div className="title-row"><div><h1>Pontuação & Funções</h1></div><SaveState status={status} detail={saveDetail} onRetry={status.startsWith('⚠')?()=>void retrySave():undefined}/></div>
    <section className="card scoring-toolbar">
      <div className="scoring-mode"><button className={mode==='general'?'active':''} onClick={()=>setMode('general')}>Pontuação geral</button><button className={mode==='role'?'active':''} onClick={()=>setMode('role')}>Por função</button></div>
      {mode==='role'&&<><div className="phase-compact"><button className={phase==='IP'?'active':''} onClick={()=>setPhase('IP')}>IP</button><button className={phase==='OOP'?'active':''} onClick={()=>setPhase('OOP')}>OOP</button></div><label>Posição<select value={position} onChange={e=>setPosition(e.target.value)}>{positions.map(([value,label])=><option value={value} key={value}>{label} · {value}</option>)}</select></label><label>Função<select value={selectedRole[0]} onChange={e=>setRoleCode(e.target.value)}>{roleOptions.map(([code,name])=><option value={code} key={code}>{code} · {name}</option>)}</select></label><button className="secondary reset-weights" onClick={reset}>Restaurar padrão da função</button></>}
    </section>
    {mode==='general'?<section className="card scoring-workspace"><div className="scoring-workspace-title"><div><h2>Pontuação geral</h2></div></div><div className="empty"><h3>Nota Geral estrutural</h3><p>A Nota Geral não usa mais uma matriz global editável. Ela corresponde à maior BasePositionScore entre as posições-base elegíveis do jogador, usando as matrizes canônicas IP/OOP e aptidão posicional mínima de 15/20 quando esse dado está disponível.</p><p>Para ajustar critérios de avaliação, edite as matrizes por função.</p></div></section>:<section className="card scoring-workspace"><div className="scoring-workspace-title"><div><h2>{phase} · {position} · {roleName}</h2></div><p>1 ignora · 2 secundário · 3 importante · 4 muito importante · 5 crítico</p></div><div className="weight-groups">{groups.map(group=><section className={`weight-group weight-group-${group.key}`} key={group.key}><h3>{group.label}</h3><div>{ATTRIBUTE_CATALOG.filter(attribute=>attribute.category===group.key).sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:'base'})).map(attribute=><label className="weight-row" key={attribute.key}><span>{attribute.label}</span><input type="range" min="1" max="5" value={weights[attribute.key]??1} onChange={e=>changeWeight(attribute.key,Number(e.target.value))}/><output>{weights[attribute.key]??1}</output></label>)}</div></section>)}</div></section>}
  </div>
}
