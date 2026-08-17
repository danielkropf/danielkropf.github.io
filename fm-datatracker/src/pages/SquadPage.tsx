import{useEffect,useMemo,useState}from'react'
import{supabase}from'../lib/supabase'
import{attributeScore}from'../lib/scoring'
import{positionRank,positionSideRank}from'../lib/positions'
import{DEFAULT_ATTRIBUTE_WEIGHTS}from'../lib/attributes'
import{normalizeCountry,percentile as calculatePercentile,positionFamily,referenceLevel,referenceScore,type ReferenceDataset,type ReferenceLevel}from'../lib/reference'
import{useSaves}from'../features/saves/SaveContext'
import type{PlayerRow}from'../types/domain'

type SortKey='status'|'name'|'age'|'nationality'|'value'|'team'|'position'|'score'|'reference'
type Snapshot=PlayerRow['player_snapshots'][number]
type Row={player:PlayerRow;latest:Snapshot|undefined;score:number|null;status:string;marketValue:string|null;referencePercentile:number|null;referenceLevel:ReferenceLevel|null;referenceSample:number}

export function SquadPage(){
  const{selected}=useSaves()
  const[players,setPlayers]=useState<PlayerRow[]>([])
  const[weights,setWeights]=useState<Record<string,number>>({...DEFAULT_ATTRIBUTE_WEIGHTS})
  const[chosen,setChosen]=useState<PlayerRow|null>(null)
  const[search,setSearch]=useState('')
  const[sort,setSort]=useState<{key:SortKey;direction:1|-1}>({key:'position',direction:1})
  const[reference,setReference]=useState<ReferenceDataset|null>(null)
  const[referenceCountry,setReferenceCountry]=useState('')
  const[referenceDivision,setReferenceDivision]=useState(1)

  useEffect(()=>{void fetch(`${import.meta.env.BASE_URL}reference/players.v1.json`).then(response=>{if(!response.ok)throw new Error('Base de referência indisponível');return response.json() as Promise<ReferenceDataset>}).then(setReference).catch(()=>setReference(null))},[])

  const referenceCountries=useMemo(()=>[...new Set(reference?.markets.map(market=>market.country)??[])].sort((a,b)=>a.localeCompare(b,'pt-BR')),[reference])
  const referenceDivisions=useMemo(()=>reference?.markets.filter(market=>market.country===referenceCountry).map(market=>market.division).sort((a,b)=>a-b)??[],[reference,referenceCountry])
  useEffect(()=>{if(!referenceCountries.length)return;const matched=referenceCountries.find(country=>normalizeCountry(country)===normalizeCountry(selected?.country));setReferenceCountry(current=>referenceCountries.includes(current)?current:matched??referenceCountries[0])},[referenceCountries,selected?.country])
  useEffect(()=>{if(referenceDivisions.length&&!referenceDivisions.includes(referenceDivision))setReferenceDivision(referenceDivisions[0])},[referenceDivisions,referenceDivision])

  useEffect(()=>{
    if(!supabase||!selected)return
    void Promise.all([
      supabase.from('players').select('id,current_name,nationality,last_seen_date,is_active,player_snapshots(id,snapshot_date,age,club,squad,positions,contract_expiry,raw_data,normalized_data,player_attributes(attribute_key,attribute_label,value,category))').eq('save_id',selected.id).order('current_name'),
      supabase.from('scoring_models').select('config').eq('save_id',selected.id).eq('name','Model Lab').order('created_at').limit(1).maybeSingle()
    ]).then(([p,m])=>{
      setPlayers((p.data??[])as unknown as PlayerRow[])
      const config=m.data?.config as {general_weights?:Record<string,number>}|undefined
      setWeights({...DEFAULT_ATTRIBUTE_WEIGHTS,...(config?.general_weights??{})})
    })
  },[selected?.id])

  const referenceScores=useMemo(()=>{
    const groups:Record<string,number[]>={GK:[],D:[],WB:[],DM:[],M:[],AM:[],ST:[]}
    if(!reference)return groups
    for(const player of reference.players){if(player.c!==referenceCountry||player.d!==referenceDivision)continue;const group=positionFamily(player.p),score=referenceScore(player,reference.attributes,weights);if(score!==null)(groups[group]??=[]).push(score)}
    for(const scores of Object.values(groups))scores.sort((a,b)=>a-b)
    return groups
  },[reference,referenceCountry,referenceDivision,weights])

  const rows=useMemo(()=>players.filter(p=>p.current_name.toLowerCase().includes(search.toLowerCase())).map(player=>{
    const latest=[...player.player_snapshots].sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date))[0]
    const score=latest?attributeScore(latest.player_attributes.map(a=>({key:a.attribute_key,value:a.value,weight:weights[a.attribute_key]??1}))):null
    const population=latest?referenceScores[positionFamily(latest.positions)]??[]:[],referencePercentile=score===null?null:calculatePercentile(score,population)
    return{player,latest,score,status:'Não selecionado',marketValue:latest?extractMarketValue(latest):null,referencePercentile,referenceLevel:referencePercentile===null?null:referenceLevel(referencePercentile),referenceSample:population.length}
  }).sort((a,b)=>compareRows(a,b,sort.key)*sort.direction||a.player.current_name.localeCompare(b.player.current_name,'pt-BR')),[players,weights,search,sort,referenceScores])

  function changeSort(key:SortKey){setSort(c=>({key,direction:c.key===key?c.direction===1?-1:1:key==='score'||key==='value'?-1:1}))}

  return <div className="screen-page squad-page">
    <div className="title-row"><div><span className="eyebrow">ELENCO</span><h1>{selected?.club_name}</h1><p>{players.length} jogadores históricos</p></div><div className="squad-actions"><label>Referência<select value={referenceCountry} onChange={e=>setReferenceCountry(e.target.value)}>{referenceCountries.map(country=><option value={country} key={country}>{country}</option>)}</select></label><label>Divisão<select value={referenceDivision} onChange={e=>setReferenceDivision(Number(e.target.value))}>{referenceDivisions.map(division=><option value={division} key={division}>{division}ª divisão</option>)}</select></label><input className="search" placeholder="Buscar jogador" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
    <div className="table-wrap squad-table"><table><thead><tr><SortHeader label="Status" column="status" sort={sort} change={changeSort}/><SortHeader label="Nome" column="name" sort={sort} change={changeSort}/><SortHeader label="Idade" column="age" sort={sort} change={changeSort}/><SortHeader label="Nacionalidade" column="nationality" sort={sort} change={changeSort}/><SortHeader label="Valor" column="value" sort={sort} change={changeSort}/><SortHeader label="Equipe" column="team" sort={sort} change={changeSort}/><SortHeader label="Posições" column="position" sort={sort} change={changeSort}/><SortHeader label="Nota geral" column="score" sort={sort} change={changeSort}/><SortHeader label="Nível de referência" column="reference" sort={sort} change={changeSort} description="Percentil da nota geral entre jogadores da mesma linha posicional no país e divisão selecionados. A nota usa os pesos atuais do save e os coeficientes 0, 1, 2, 4 e 6."/></tr></thead><tbody>{rows.map(({player:p,latest:s,score,status,marketValue,referencePercentile,referenceLevel:level,referenceSample})=><tr key={p.id} onClick={()=>setChosen(p)} className="clickable"><td><span className="planning-status unselected">{status}</span></td><td><strong>{p.current_name}</strong></td><td>{s?.age??'—'}</td><td>{p.nationality||'—'}</td><td>{marketValue||'—'}</td><td>{s?.club||s?.squad||'—'}</td><td>{s?.positions?.join(', ')||'—'}</td><td><b>{score===null?'—':score.toFixed(1)}</b></td><td>{referencePercentile===null?'—':<span className={`reference-level metric-tooltip level-${level?.toLowerCase().replaceAll(' ','-')}`} tabIndex={0} data-tooltip={`P${referencePercentile}: a nota é igual ou superior à de ${referencePercentile}% dos ${referenceSample} jogadores de ${positionFamily(s?.positions??[])} da ${referenceDivision}ª divisão de ${referenceCountry}. Cálculo feito com os pesos gerais atuais do save.`}><b>P{referencePercentile}</b> {level}</span>}</td></tr>)}</tbody></table></div>
    {chosen&&<PlayerDrawer player={chosen} close={()=>setChosen(null)}/>}</div>
}

function extractMarketValue(snapshot:Snapshot){
  const normalized=snapshot.normalized_data??{}
  for(const key of ['value','transfer_value','market_value','valor'])if(normalized[key]!=null&&String(normalized[key]).trim())return String(normalized[key])
  for(const[key,value]of Object.entries(snapshot.raw_data??{})){const normalizedKey=key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_');if(['value','transfer_value','market_value','valor'].includes(normalizedKey)&&String(value).trim())return String(value)}
  return null
}

function numericMarketValue(raw:string|null){
  if(!raw)return-1
  const first=raw.split(/\s*[-–]\s*/)[0],match=first.replace(/\s/g,'').match(/([\d.,]+)\s*([KMB])?/i)
  if(!match)return-1
  const number=Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'))
  return number*({K:1e3,M:1e6,B:1e9}[match[2]?.toUpperCase() as 'K'|'M'|'B']??1)
}

function compareRows(a:Row,b:Row,key:SortKey){
  if(key==='position'){const ap=a.latest?.positions??[],bp=b.latest?.positions??[];return positionRank(ap)-positionRank(bp)||positionSideRank(ap)-positionSideRank(bp)}
  if(key==='score')return(a.score??-1)-(b.score??-1)
  if(key==='reference')return(a.referencePercentile??-1)-(b.referencePercentile??-1)
  if(key==='value')return numericMarketValue(a.marketValue)-numericMarketValue(b.marketValue)
  if(key==='age')return(a.latest?.age??999)-(b.latest?.age??999)
  const av=key==='status'?a.status:key==='name'?a.player.current_name:key==='nationality'?a.player.nationality??'':a.latest?.club||a.latest?.squad||''
  const bv=key==='status'?b.status:key==='name'?b.player.current_name:key==='nationality'?b.player.nationality??'':b.latest?.club||b.latest?.squad||''
  return av.localeCompare(bv,'pt-BR')
}

function SortHeader({label,column,sort,change,description}:{label:string;column:SortKey;sort:{key:SortKey;direction:1|-1};change:(key:SortKey)=>void;description?:string}){return <th><button className="sort-button" onClick={()=>change(column)}><span>{label}{description&&<i className="metric-help metric-tooltip" tabIndex={0} data-tooltip={description} onClick={event=>event.stopPropagation()}>?</i>}</span><span>{sort.key===column?(sort.direction===1?'▲':'▼'):'↕'}</span></button></th>}

function PlayerDrawer({player,close}:{player:PlayerRow;close:()=>void}){
  const snaps=[...player.player_snapshots].sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date))
  return <div className="overlay" onClick={close}><article className="drawer" onClick={e=>e.stopPropagation()}><button className="close" onClick={close}>×</button><span className="eyebrow">FICHA HISTÓRICA</span><h1>{player.current_name}</h1>{snaps.map((s,index)=>{const prev=snaps[index+1];return <section className="snapshot" key={s.id}><h3>{s.snapshot_date} · {s.club||s.squad||'Sem equipe'}</h3><div className="attribute-grid">{s.player_attributes.sort((a,b)=>b.value-a.value).map(a=>{const old=prev?.player_attributes.find(x=>x.attribute_key===a.attribute_key)?.value,delta=old===undefined?null:a.value-old;return <div key={a.attribute_key}><span>{a.attribute_label}</span><b>{a.value}</b>{delta!==null&&<small className={delta>0?'up':delta<0?'down':''}>{delta>0?'+':''}{delta}</small>}</div>})}</div></section>})}{!snaps.length&&<p>Jogador sem snapshot de atributos.</p>}</article></div>
}
