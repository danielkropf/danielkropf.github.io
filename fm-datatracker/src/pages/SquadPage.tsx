import{useEffect,useMemo,useState,type ReactNode}from'react'
import{createPortal}from'react-dom'
import{useNavigate}from'react-router-dom'
import{supabase}from'../lib/supabase'
import{attributeScore}from'../lib/scoring'
import{positionRank,positionSideRank}from'../lib/positions'
import{DEFAULT_ATTRIBUTE_WEIGHTS}from'../lib/attributes'
import{normalizeCountry,percentile as calculatePercentile,positionFamilies,positionFamily,referenceLevel,referenceScore,type ReferenceDataset,type ReferenceLevel}from'../lib/reference'
import{roleDefaultWeights}from'../lib/roleWeights'
import{positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{useSaves}from'../features/saves/SaveContext'
import type{PlayerRow}from'../types/domain'

type SortKey='status'|'name'|'age'|'nationality'|'value'|'team'|'position'|'score'|'reference'
type Snapshot=PlayerRow['player_snapshots'][number]
type Planning={groups:Array<{id:string;name:string}>;assignments:Record<string,string>}
type ModelConfig={general_weights?:Record<string,number>;role_weight_overrides?:Record<string,Record<string,number>>;planning?:Planning}
type Row={player:PlayerRow;latest:Snapshot|undefined;score:number|null;status:string;marketValue:string|null;referencePercentile:number|null;referenceLevel:ReferenceLevel|null;referenceSample:number;referenceGroup:string;compatible:boolean}

const positions=[['GK','Goleiro'],['D (C)','Defesa central'],['D (R)','Lateral'],['WB (R)','Ala'],['DM (C)','Médio defensivo'],['M (C)','Médio central'],['M (R)','Médio lateral'],['AM (C)','Médio ofensivo'],['AM (R)','Extremo'],['ST (C)','Atacante']] as const

export function SquadPage(){
  const{selected}=useSaves(),navigate=useNavigate()
  const[players,setPlayers]=useState<PlayerRow[]>([]),[model,setModel]=useState<ModelConfig>({})
  const[search,setSearch]=useState(''),[sort,setSort]=useState<{key:SortKey;direction:1|-1}>({key:'position',direction:1})
  const[reference,setReference]=useState<ReferenceDataset|null>(null),[referenceCountry,setReferenceCountry]=useState(''),[referenceDivision,setReferenceDivision]=useState(1)
  const[evaluation,setEvaluation]=useState<'general'|'role'>('general'),[phase,setPhase]=useState<TacticPhase>('IP'),[position,setPosition]=useState('AM (R)'),[roleCode,setRoleCode]=useState('W')

  useEffect(()=>{void fetch(`${import.meta.env.BASE_URL}reference/players.v1.json`).then(response=>{if(!response.ok)throw new Error();return response.json() as Promise<ReferenceDataset>}).then(setReference).catch(()=>setReference(null))},[])
  const referenceCountries=useMemo(()=>[...new Set(reference?.markets.map(m=>m.country)??[])].sort((a,b)=>a.localeCompare(b,'pt-BR')),[reference])
  const referenceDivisions=useMemo(()=>reference?.markets.filter(m=>m.country===referenceCountry).map(m=>m.division).sort((a,b)=>a-b)??[],[reference,referenceCountry])
  useEffect(()=>{if(!referenceCountries.length)return;const matched=referenceCountries.find(country=>normalizeCountry(country)===normalizeCountry(selected?.country));setReferenceCountry(current=>referenceCountries.includes(current)?current:matched??referenceCountries[0])},[referenceCountries,selected?.country])
  useEffect(()=>{if(referenceDivisions.length&&!referenceDivisions.includes(referenceDivision))setReferenceDivision(referenceDivisions[0])},[referenceDivisions,referenceDivision])

  useEffect(()=>{if(!supabase||!selected)return;void Promise.all([
    supabase.from('players').select('id,current_name,nationality,last_seen_date,is_active,player_snapshots(id,snapshot_date,age,club,squad,positions,contract_expiry,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))').eq('save_id',selected.id).order('current_name'),
    supabase.from('scoring_models').select('config').eq('save_id',selected.id).eq('name','Model Lab').order('created_at').limit(1).maybeSingle()
  ]).then(([playersResult,modelResult])=>{setPlayers((playersResult.data??[])as unknown as PlayerRow[]);setModel((modelResult.data?.config??{})as ModelConfig)})},[selected?.id])

  const generalWeights={...DEFAULT_ATTRIBUTE_WEIGHTS,...(model.general_weights??{})}
  const roleOptions=rolesFor(position,phase),selectedRole=roleOptions.find(([code])=>code===roleCode)??roleOptions[0]
  const roleId=`${phase}-${positionGroup(position)}-${selectedRole[0]}`,roleName=selectedRole[1]
  const activeWeights=evaluation==='general'?generalWeights:model.role_weight_overrides?.[roleId]??roleDefaultWeights(roleId,roleName)
  useEffect(()=>{setRoleCode(rolesFor(position,phase)[0][0])},[position,phase])

  const referenceScores=useMemo(()=>{
    const groups:Record<string,number[]>={GK:[],D:[],WB:[],DM:[],M:[],AM:[],ST:[]}
    if(!reference)return groups
    for(const player of reference.players){
      if(player.c!==referenceCountry||player.d!==referenceDivision)continue
      const score=referenceScore(player,reference.attributes,activeWeights);if(score===null)continue
      for(const group of positionFamilies(player.p))if(groups[group])groups[group].push(score)
    }
    for(const scores of Object.values(groups))scores.sort((a,b)=>a-b)
    return groups
  },[reference,referenceCountry,referenceDivision,activeWeights])

  const rows=useMemo(()=>players.filter(player=>player.current_name.toLowerCase().includes(search.toLowerCase())).map(player=>{
    const latest=[...player.player_snapshots].sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date))[0]
    const score=latest?attributeScore(latest.player_attributes.map(attribute=>({key:attribute.attribute_key,value:attribute.value,weight:activeWeights[attribute.attribute_key]??1}))):null
    const eligible=latest?positionFamilies(latest.positions):[],target=positionFamily(position)
    let referenceGroup=target,referencePercentile:number|null=null,referenceSample=0
    if(score!==null){
      const groups=evaluation==='role'?[target]:eligible
      for(const group of groups){const population=referenceScores[group]??[],value=calculatePercentile(score,population);if(value!==null&&(referencePercentile===null||value>referencePercentile)){referencePercentile=value;referenceGroup=group;referenceSample=population.length}}
    }
    const groupId=model.planning?.assignments[player.id],status=model.planning?.groups.find(group=>group.id===groupId)?.name??'Não selecionado'
    return{player,latest,score,status,marketValue:latest?extractMarketValue(latest):null,referencePercentile,referenceLevel:referencePercentile===null?null:referenceLevel(referencePercentile),referenceSample,referenceGroup,compatible:evaluation==='general'||eligible.includes(target)}
  }).sort((a,b)=>compareRows(a,b,sort.key)*sort.direction||a.player.current_name.localeCompare(b.player.current_name,'pt-BR')),[players,search,sort,activeWeights,evaluation,position,referenceScores,model.planning])

  function changeSort(key:SortKey){setSort(current=>({key,direction:current.key===key?current.direction===1?-1:1:key==='score'||key==='value'||key==='reference'?-1:1}))}
  return <div className="screen-page squad-page">
    <div className="title-row"><div><h1>{selected?.club_name}</h1></div><div className="squad-actions"><label>Referência<select value={referenceCountry} onChange={event=>setReferenceCountry(event.target.value)}>{referenceCountries.map(country=><option value={country} key={country}>{country}</option>)}</select></label><label>Divisão<select value={referenceDivision} onChange={event=>setReferenceDivision(Number(event.target.value))}>{referenceDivisions.map(division=><option value={division} key={division}>{division}ª divisão</option>)}</select></label><input className="search" placeholder="Buscar jogador" value={search} onChange={event=>setSearch(event.target.value)}/></div></div>
    <section className="squad-evaluation-bar"><div className="scoring-mode"><button className={evaluation==='general'?'active':''} onClick={()=>setEvaluation('general')}>Melhor referência</button><button className={evaluation==='role'?'active':''} onClick={()=>setEvaluation('role')}>Por função</button></div>{evaluation==='role'&&<><div className="phase-compact"><button className={phase==='IP'?'active':''} onClick={()=>setPhase('IP')}>IP</button><button className={phase==='OOP'?'active':''} onClick={()=>setPhase('OOP')}>OOP</button></div><select value={position} onChange={event=>setPosition(event.target.value)}>{positions.map(([value,label])=><option value={value} key={value}>{label} · {value}</option>)}</select><select value={selectedRole[0]} onChange={event=>setRoleCode(event.target.value)}>{roleOptions.map(([code,name])=><option value={code} key={code}>{code} · {name}</option>)}</select></>}</section>
    <div className="table-wrap squad-table"><table><thead><tr><SortHeader label="Status" column="status" sort={sort} change={changeSort}/><SortHeader label="Nome" column="name" sort={sort} change={changeSort}/><SortHeader label="Idade" column="age" sort={sort} change={changeSort}/><SortHeader label="Nacionalidade" column="nationality" sort={sort} change={changeSort}/><SortHeader label="Valor" column="value" sort={sort} change={changeSort}/><SortHeader label="Equipe" column="team" sort={sort} change={changeSort}/><SortHeader label="Posições" column="position" sort={sort} change={changeSort}/><SortHeader label={evaluation==='general'?'Nota geral':roleName} column="score" sort={sort} change={changeSort}/><SortHeader label="Nível de referência" column="reference" sort={sort} change={changeSort} description="No modo Melhor referência, usamos o maior percentil entre todas as linhas em que o jogador atua. No modo Por função, todos são comparados na posição e função selecionadas."/></tr></thead><tbody>{rows.map(row=><tr key={row.player.id} onClick={()=>navigate(`/players/${row.player.id}`)} className={`clickable ${row.compatible?'':'position-incompatible'}`}><td><span className={`planning-status ${row.status==='Não selecionado'?'unselected':'selected'}`}>{row.status}</span></td><td><strong>{row.player.current_name}</strong></td><td>{row.latest?.age??'—'}</td><td>{row.player.nationality||'—'}</td><td>{row.marketValue||'—'}</td><td>{row.latest?.club||row.latest?.squad||'—'}</td><td>{row.latest?.positions?.join(', ')||'—'}</td><td><b>{row.score===null?'—':row.score.toFixed(1)}</b></td><td>{row.referencePercentile===null?'—':<Tooltip content={`P${row.referencePercentile}: nota igual ou superior à de ${row.referencePercentile}% dos ${row.referenceSample} jogadores aptos em ${row.referenceGroup}, na ${referenceDivision}ª divisão de ${referenceCountry}.${row.compatible?'':' Este jogador não possui a posição selecionada nos dados importados.'}`}><span className={`reference-level level-${row.referenceLevel?.toLowerCase().replaceAll(' ','-')}`} tabIndex={0}><b>P{row.referencePercentile}</b> {row.referenceLevel} · {row.referenceGroup}</span></Tooltip>}</td></tr>)}</tbody></table></div>
  </div>
}

export function extractMarketValue(snapshot:Snapshot){const normalized=snapshot.normalized_data??{};for(const key of['value','transfer_value','market_value','valor'])if(normalized[key]!=null&&String(normalized[key]).trim())return String(normalized[key]);for(const[key,value]of Object.entries(snapshot.raw_data??{})){const normalizedKey=key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_');if(['value','transfer_value','market_value','valor'].includes(normalizedKey)&&String(value).trim())return String(value)}return null}
function numericMarketValue(raw:string|null){if(!raw)return-1;const first=raw.split(/\s*[-–]\s*/)[0],match=first.replace(/\s/g,'').match(/([\d.,]+)\s*([KMB])?/i);if(!match)return-1;const number=Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));return number*({K:1e3,M:1e6,B:1e9}[match[2]?.toUpperCase()as'K'|'M'|'B']??1)}
function compareRows(a:Row,b:Row,key:SortKey){if(key==='position'){const ap=a.latest?.positions??[],bp=b.latest?.positions??[];return positionRank(ap)-positionRank(bp)||positionSideRank(ap)-positionSideRank(bp)}if(key==='score')return(a.score??-1)-(b.score??-1);if(key==='reference')return(a.referencePercentile??-1)-(b.referencePercentile??-1);if(key==='value')return numericMarketValue(a.marketValue)-numericMarketValue(b.marketValue);if(key==='age')return(a.latest?.age??999)-(b.latest?.age??999);const av=key==='status'?a.status:key==='name'?a.player.current_name:key==='nationality'?a.player.nationality??'':a.latest?.club||a.latest?.squad||'',bv=key==='status'?b.status:key==='name'?b.player.current_name:key==='nationality'?b.player.nationality??'':b.latest?.club||b.latest?.squad||'';return av.localeCompare(bv,'pt-BR')}
function SortHeader({label,column,sort,change,description}:{label:string;column:SortKey;sort:{key:SortKey;direction:1|-1};change:(key:SortKey)=>void;description?:string}){return <th><button className="sort-button" onClick={()=>change(column)}><span>{label}{description&&<Tooltip content={description}><i className="metric-help" tabIndex={0} onClick={event=>event.stopPropagation()}>?</i></Tooltip>}</span><span>{sort.key===column?(sort.direction===1?'▲':'▼'):'↕'}</span></button></th>}
function Tooltip({content,children}:{content:string;children:ReactNode}){const[anchor,setAnchor]=useState<DOMRect|null>(null),show=(element:HTMLElement)=>setAnchor(element.getBoundingClientRect()),width=Math.min(330,typeof window==='undefined'?330:window.innerWidth-24),left=anchor?Math.min(Math.max(12,anchor.left+anchor.width/2-width/2),window.innerWidth-width-12):0,above=Boolean(anchor&&anchor.top>145);return <span className="tooltip-anchor" onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={()=>setAnchor(null)} onFocus={event=>show(event.currentTarget)} onBlur={()=>setAnchor(null)}>{children}{anchor&&createPortal(<span role="tooltip" className={`floating-tooltip ${above?'above':'below'}`} style={{left,width,top:above?anchor.top-8:anchor.bottom+8}}>{content}</span>,document.body)}</span>}
