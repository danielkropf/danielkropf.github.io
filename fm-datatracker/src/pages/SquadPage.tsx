import{createContext,useContext,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,useTransition,type Dispatch,type ReactNode,type SetStateAction}from'react'
import{createPortal}from'react-dom'
import{useNavigate}from'react-router-dom'
import{supabase}from'../lib/supabase'
import{generalScoreForSnapshot}from'../lib/base-position-score'
import{pairedRoleScore,resolveRoleWeights,roleScore}from'../lib/role-scoring'
import{ScoreWithProjection}from'../components/ScoreWithProjection'
import{functionProjectionKey}from'../lib/projection-player'
import{CustomSelect}from'../components/CustomSelect'
import{PositionSelector}from'../components/PositionSelector'
import{DataTable}from'../components/data-table/DataTable'
import{DATA_TABLE_PRESETS}from'../components/data-table/presets'
import{positionRank,positionSideRank}from'../lib/positions'
import{ATTRIBUTE_CATALOG,type AttributeCategory}from'../lib/attributes'
import{generalReferencePercentile,generalReferenceScoresByFamily,normalizeCountry,referenceLevel,type ReferenceDataset,type ReferenceLevel}from'../lib/reference'
import{positionGroup,rolesFor,type TacticPhase}from'../lib/tactics'
import{canPlayPosition}from'../lib/positions'
import{loadCurrentPlayers,loadReferenceDataset}from'../lib/dataCache'
import{useSaves}from'../features/saves/SaveContext'
import{PlayerPeek}from'../components/PlayerPeek'
import type{PlayerRow}from'../types/domain'
import{loadModelConfig}from'../lib/model-config'

type SortKey='status'|'name'|'age'|'nationality'|'value'|'team'|'position'|'height'|'weight'|'foot'|'contract'|'snapshot'|'score'|'reference'
type ColumnKey=SortKey
type Assignment={playerId:string;nodeId:string;position:string;roleId?:string;roleCode:string;roleName:string}
type Tactic={id:string;name:string;ipAssignments:Assignment[];oopAssignments:Assignment[];roles?:{id:string;name:string;weights:Record<string,number>}[]}
type TableColumn={id:string;kind:'data'|'attribute'|'role'|'tacticRole';key?:ColumnKey;attributeKey?:string;phase?:TacticPhase;position?:string;roleCode?:string;tacticId?:string;linkId?:string;label:string}
type Snapshot=PlayerRow['player_snapshots'][number]
type Planning={groups:Array<{id:string;name:string}>;assignments:Record<string,string>;slotAssignments?:Record<string,Record<string,string[]>>}
type ModelConfig={role_weight_overrides?:Record<string,Record<string,number>>;planning?:Planning;tactics?:Tactic[]}
type Row={player:PlayerRow;latest:Snapshot|undefined;score:number|null;status:string;marketValue:string|null;referencePercentile:number|null;referenceLevel:ReferenceLevel|null;referenceSample:number;referenceGroup:string;compatible:boolean;columnScores:Record<string,number|null>}
type Filter={id:string;column:SortKey;operator:'contains'|'equals'|'gte'|'lte';value:string}

const positions=[['GK','Goleiro'],['D (L)','Defesa esquerda'],['D (C)','Defesa central'],['D (R)','Defesa direita'],['WB (L)','Ala esquerdo'],['WB (R)','Ala direito'],['DM (C)','Médio defensivo'],['M (L)','Médio esquerdo'],['M (C)','Médio central'],['M (R)','Médio direito'],['AM (L)','Extremo esquerdo'],['AM (C)','Médio ofensivo'],['AM (R)','Extremo direito'],['ST (C)','Atacante']] as const
const allColumns:ColumnKey[]=['status','name','age','nationality','value','team','position','height','weight','foot','contract','snapshot','score','reference']
const defaultColumnKeys:ColumnKey[]=['status','name','age','nationality','value','team','position','score','reference']
const columnLabels:Record<ColumnKey,string>={status:'Status',name:'Nome',age:'Idade',nationality:'Nacionalidade',value:'Valor',team:'Equipe',position:'Posições',height:'Altura',weight:'Peso',foot:'Pé preferido',contract:'Fim do contrato',snapshot:'Data do snapshot',score:'Nota geral',reference:'Nível de referência'}
const generalColumns:TableColumn[]=allColumns.map(key=>({id:key,kind:'data',key,label:columnLabels[key]}))
const defaultColumns:TableColumn[]=defaultColumnKeys.map(key=>({id:key,kind:'data',key,label:columnLabels[key]}))
const columnWidths:Record<ColumnKey,number>={status:130,name:210,age:72,nationality:140,value:130,team:130,position:170,height:90,weight:85,foot:125,contract:125,snapshot:125,score:105,reference:180}
const roleColumn=(phase:TacticPhase,position:string,roleCode:string):TableColumn=>({id:`role|${phase}|${position}|${roleCode}`,kind:'role',phase,position,roleCode,label:`${phase} · ${position} · ${roleCode}`})
const tacticColumn=(tactic:Tactic,ip:Assignment,oop:Assignment):TableColumn=>({id:`tactic|${tactic.id}|${ip.playerId}`,kind:'tacticRole',tacticId:tactic.id,linkId:ip.playerId,label:`${tactic.name} · ${ip.position} ${ip.roleCode} ↔ ${oop.position} ${oop.roleCode}`})
const attributeColumn=(key:string,label:string):TableColumn=>({id:`attribute|${key}`,kind:'attribute',attributeKey:key,label})
function defaultWidth(column:TableColumn){return column.kind==='data'?columnWidths[column.key!]:column.kind==='attribute'?105:column.kind==='tacticRole'?185:125}
function readColumns():{columns:TableColumn[];frozenIndex:number;widths:Record<string,number>}{try{const saved=JSON.parse(localStorage.getItem('fm-datatracker:squad-table-v2')??'null');if(Array.isArray(saved?.columns)&&saved.columns.some((column:TableColumn)=>column.id==='name'))return{columns:saved.columns as TableColumn[],frozenIndex:Number.isInteger(saved.frozenIndex)?saved.frozenIndex:Math.max(0,saved.columns.findIndex((column:TableColumn)=>column.id==='name')),widths:saved.widths??{}}}catch{}return{columns:defaultColumns,frozenIndex:1,widths:{}}}

export function SquadPage(){
  const{selected}=useSaves(),navigate=useNavigate()
  const[players,setPlayers]=useState<PlayerRow[]>([]),[model,setModel]=useState<ModelConfig>({})
  const[loading,setLoading]=useState(false),[isPending,startTransition]=useTransition()
  const[search,setSearch]=useState(''),[sort,setSort]=useState<{key:string;direction:1|-1}>({key:'position',direction:1})
  const[selectedPlayerId,setSelectedPlayerId]=useState<string|null>(null)
  const[reference,setReference]=useState<ReferenceDataset|null>(null),[referenceCountry,setReferenceCountry]=useState(''),[referenceDivision,setReferenceDivision]=useState(1)
  const[filterOpen,setFilterOpen]=useState(false),[filters,setFilters]=useState<Filter[]>([])
  const initialTable=useMemo(readColumns,[]),[positionFilters,setPositionFilters]=useState<string[]|null>(null),[columns,setColumns]=useState<TableColumn[]>(initialTable.columns),[frozenIndex,setFrozenIndex]=useState(initialTable.frozenIndex),[widths,setWidths]=useState<Record<string,number>>(initialTable.widths),[columnMenu,setColumnMenu]=useState<{x:number;y:number;index:number}|null>(null)

  useEffect(()=>{void loadReferenceDataset().then(setReference)},[])
  useEffect(()=>{localStorage.setItem('fm-datatracker:squad-table-v2',JSON.stringify({columns,frozenIndex,widths}))},[columns,frozenIndex,widths])
  useEffect(()=>{const close=()=>setColumnMenu(null);window.addEventListener('click',close);return()=>window.removeEventListener('click',close)},[])
  const referenceCountries=useMemo(()=>[...new Set(reference?.markets.map(m=>m.country)??[])].sort((a,b)=>a.localeCompare(b,'pt-BR')),[reference])
  const referenceDivisions=useMemo(()=>reference?.markets.filter(m=>m.country===referenceCountry).map(m=>m.division).sort((a,b)=>a-b)??[],[reference,referenceCountry])
  useEffect(()=>{if(!referenceCountries.length)return;const matched=referenceCountries.find(country=>normalizeCountry(country)===normalizeCountry(selected?.country));setReferenceCountry(current=>referenceCountries.includes(current)?current:matched??referenceCountries[0])},[referenceCountries,selected?.country])
  useEffect(()=>{if(referenceDivisions.length&&!referenceDivisions.includes(referenceDivision))setReferenceDivision(referenceDivisions[0])},[referenceDivisions,referenceDivision])

  useEffect(()=>{let active=true;if(!supabase||!selected){setPlayers([]);setModel({});return()=>{active=false}}setLoading(true);void Promise.all([
    loadCurrentPlayers(selected.id),
    loadModelConfig(selected.id)
  ]).then(([cached,modelConfig])=>{if(!active)return;startTransition(()=>{setPlayers(cached as unknown as PlayerRow[]);setModel(modelConfig as ModelConfig);setLoading(false)})}).catch(()=>{if(active)setLoading(false)});return()=>{active=false}},[selected?.id])

  const referenceScores=useMemo(()=>generalReferenceScoresByFamily(
    reference?.players.filter(player=>player.c===referenceCountry&&player.d===referenceDivision)??[],
    reference?.attributes??[]
  ),[reference,referenceCountry,referenceDivision])

  const rows=useMemo(()=>players.filter(player=>player.current_name.toLowerCase().includes(search.toLowerCase())).map(player=>{
    const latest=player.player_snapshots[0]
    const score=latest?generalScoreForSnapshot(latest)?.score??null:null
    const referenceResult=latest&&score!==null?generalReferencePercentile(score,latest,referenceScores):null
    const referenceGroup=referenceResult?.family??'M',referencePercentile=referenceResult?.percentile??null,referenceSample=referenceResult?.population.length??0
    const groupId=Object.entries(model.planning?.slotAssignments??{}).find(([,rows])=>Object.values(rows).some(ids=>ids.includes(player.id)))?.[0],status=model.planning?.groups.find(group=>group.id===groupId)?.name??'Não selecionado'
    const row:Row={player,latest,score,status,marketValue:latest?extractMarketValue(latest):null,referencePercentile,referenceLevel:referencePercentile===null?null:referenceLevel(referencePercentile),referenceSample,referenceGroup,compatible:true,columnScores:{}}
    for(const column of columns){if(column.kind==='role')row.columnScores[column.id]=scoreForRole(row,column,model);else if(column.kind==='tacticRole')row.columnScores[column.id]=scoreForTacticRole(row,column,model)}
    return row
  }).filter(row=>filters.every(filter=>matchesFilter(row,filter))&&(positionFilters===null||positionFilters.length>0&&positionFilters.some(target=>canPlayPosition(row.latest?.positions??[],target)))).sort((a,b)=>compareTableRows(a,b,sort.key,columns)*sort.direction||a.player.current_name.localeCompare(b.player.current_name,'pt-BR')),[players,search,sort,referenceScores,model,filters,positionFilters,columns])

  function changeSort(key:string){setSort(current=>({key,direction:current.key===key?current.direction===1?-1:1:key==='score'||key==='value'||key==='reference'||key.startsWith('role|')||key.startsWith('tactic|')?-1:1}))}
  function removeColumn(index:number){if(columns[index]?.id==='name')return;const nextColumns=columns.filter((_,itemIndex)=>itemIndex!==index);setColumns(nextColumns);setFrozenIndex(boundary=>{if(boundary<0)return-1;const adjusted=index<=boundary?boundary-1:boundary,nameIndex=nextColumns.findIndex(column=>column.id==='name');return Math.min(nextColumns.length-1,Math.max(adjusted,nameIndex))});setColumnMenu(null)}
  function insertColumn(column:TableColumn){const index=columnMenu?.index??columns.length-1;setColumns(current=>[...current.slice(0,index+1),{...column,id:column.kind==='role'||column.kind==='tacticRole'?`${column.id}|${crypto.randomUUID()}`:column.id},...current.slice(index+1)]);setColumnMenu(null)}
  function moveColumn(from:number,to:number){if(from===to)return;setColumns(current=>{const next=[...current],item=next.splice(from,1)[0];next.splice(to,0,item);setFrozenIndex(boundary=>Math.max(boundary,next.findIndex(column=>column.id==='name')));return next})}
  function resizeColumn(index:number,startX:number){const column=columns[index],start=widths[column.id]??defaultWidth(column),move=(event:PointerEvent)=>setWidths(current=>({...current,[column.id]:Math.max(64,start+event.clientX-startX)})),stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)}

  return <div className="screen-page squad-page">
    <div className="title-row"><div><h1>{selected?.club_name}</h1>{(loading||isPending)&&<span className="background-loading" role="status">Atualizando elenco em segundo plano…</span>}</div><div className="squad-actions"><label>Referência<CustomSelect ariaLabel="País de referência" value={referenceCountry} options={referenceCountries.map(country=>({value:country,label:country}))} onChange={setReferenceCountry}/></label><label>Divisão<CustomSelect ariaLabel="Divisão de referência" value={String(referenceDivision)} options={referenceDivisions.map(division=>({value:String(division),label:`${division}ª divisão`}))} onChange={value=>setReferenceDivision(Number(value))}/></label><input className="search" placeholder="Buscar jogador" value={search} onChange={event=>setSearch(event.target.value)}/></div></div>
    <section className="squad-evaluation-bar"><PositionSelector selected={positionFilters} onChange={setPositionFilters}/><span className="table-customization-hint">Clique com o botão direito no cabeçalho para adicionar, remover ou congelar colunas.</span><button className={`filter-toggle ${filters.length?'active':''}`} onClick={()=>setFilterOpen(true)}>Filtros {filters.length?`(${filters.length})`:''}</button></section>
    <DataTable<Row,TableColumn>
      className="squad-table customizable-squad-table"
      rows={rows}
      columns={columns}
      rowKey={row=>row.player.id}
      renderCell={(row,column)=><SquadCellContent column={column} row={row} referenceCountry={referenceCountry} referenceDivision={referenceDivision} model={model} openPlayer={()=>navigate(`/players/${row.player.id}`)}/>}
      getColumnWidth={column=>widths[column.id]??defaultWidth(column)}
      sort={sort}
      onSort={changeSort}
      selectedRowKey={selectedPlayerId}
      onSelectRow={row=>setSelectedPlayerId(current=>current===row.player.id?null:row.player.id)}
      capabilities={DATA_TABLE_PRESETS.squad}
      frozenIndex={frozenIndex}
      loading={!players.length&&(loading||isPending)}
      loadingMessage="Carregando jogadores… você pode navegar livremente pelo aplicativo."
      emptyMessage={players.length?'Nenhum jogador corresponde aos filtros atuais.':'Nenhum jogador disponível.'}
      getCellClassName={(_,column)=>column.kind==='role'||column.kind==='tacticRole'||column.key==='score'?'role-score-cell':column.kind==='attribute'?'attribute-table-cell':column.key==='name'?'frozen-player-name':undefined}
      renderHeaderLabel={column=><>{column.label}{column.key==='reference'?<Tooltip content="Usamos o maior percentil entre todas as linhas em que o jogador atua."><i className="metric-help" tabIndex={0} onClick={event=>event.stopPropagation()}>?</i></Tooltip>:null}</>}
      onHeaderContextMenu={(event,_,index)=>{event.preventDefault();setColumnMenu({x:event.clientX,y:event.clientY,index})}}
      onColumnResizeStart={(event,_,index)=>resizeColumn(index,event.clientX)}
      onColumnMove={moveColumn}
    />
    {columnMenu&&<ColumnContextMenu x={columnMenu.x} y={columnMenu.y} column={columns[columnMenu.index]} dataColumns={generalColumns.filter(column=>!columns.some(current=>current.kind==='data'&&current.key===column.key))} attributeColumns={ATTRIBUTE_CATALOG.filter(attribute=>!columns.some(current=>current.kind==='attribute'&&current.attributeKey===attribute.key)).map(attribute=>attributeColumn(attribute.key,attribute.label))} tactics={model.tactics??[]} insert={insertColumn} remove={()=>removeColumn(columnMenu.index)} freeze={()=>{setFrozenIndex(columnMenu.index);setColumnMenu(null)}} unfreeze={()=>{setFrozenIndex(-1);setColumnMenu(null)}}/>}
    {filterOpen&&<div className="settings-overlay" onClick={()=>setFilterOpen(false)}><section className="filter-modal" onClick={event=>event.stopPropagation()}><header><div><span className="eyebrow">ELENCO</span><h2>Filtros</h2></div><button className="close" onClick={()=>setFilterOpen(false)}>×</button></header><div className="filter-list">{filters.map(filter=><div className="filter-row" key={filter.id}><CustomSelect value={filter.column} ariaLabel="Campo do filtro" options={filterColumns.map(([value,label])=>({value,label}))} onChange={value=>setFilters(current=>current.map(item=>item.id===filter.id?{...item,column:value as SortKey}:item))}/><CustomSelect value={filter.operator} ariaLabel="Operador do filtro" options={[{value:'contains',label:'contém'},{value:'equals',label:'é igual a'},{value:'gte',label:'maior ou igual'},{value:'lte',label:'menor ou igual'}]} onChange={value=>setFilters(current=>current.map(item=>item.id===filter.id?{...item,operator:value as Filter['operator']}:item))}/><input value={filter.value} onChange={event=>setFilters(current=>current.map(item=>item.id===filter.id?{...item,value:event.target.value}:item))}/><button className="column-delete" onClick={()=>setFilters(current=>current.filter(item=>item.id!==filter.id))}>×</button></div>)}</div><footer><button className="ghost" onClick={()=>setFilters([])}>Limpar</button><button onClick={()=>setFilters(current=>[...current,{id:crypto.randomUUID(),column:'name',operator:'contains',value:''}])}>+ Adicionar filtro</button><button onClick={()=>setFilterOpen(false)}>Aplicar</button></footer></section></div>}
  </div>
}

function SquadCellContent({column,row,referenceCountry,referenceDivision,model,openPlayer}:{column:TableColumn;row:Row;referenceCountry:string;referenceDivision:number;model:ModelConfig;openPlayer:()=>void}){
  if(column.kind==='tacticRole'||column.kind==='role'){const score=row.columnScores[column.id]??null;let scoreKey='';if(column.kind==='role'&&column.phase&&column.position&&column.roleCode){scoreKey=functionProjectionKey([{phase:column.phase,position:column.position,roleCode:column.roleCode}])}else if(column.kind==='tacticRole'&&column.tacticId&&column.linkId){const tactic=model.tactics?.find(item=>item.id===column.tacticId),ip=tactic?.ipAssignments.find(item=>item.playerId===column.linkId),oop=tactic?.oopAssignments.find(item=>item.playerId===column.linkId)??ip;if(ip&&oop)scoreKey=functionProjectionKey([{phase:'IP',position:ip.position,roleCode:ip.roleCode},{phase:'OOP',position:oop.position,roleCode:oop.roleCode}])}return <ScoreWithProjection playerId={row.player.id} currentScore={score} snapshot={row.latest} scoreType="function" scoreKey={scoreKey} variant="inline" currentTitle="Nota atual nesta função" projectionTitle={'Projeção média nesta função no pico\nEstimativa do DataTracker; não é o CP do Football Manager.'}/>}
  if(column.kind==='attribute'){const attribute=row.latest?.player_attributes.find(item=>item.attribute_key===column.attributeKey);return <b>{attribute?.value??'—'}</b>}
  const key=column.key!
  if(key==='status')return <span className={`planning-status ${row.status==='Não selecionado'?'unselected':'selected'}`}>{row.status}</span>
  if(key==='name')return <div className="squad-player-name-cell">{row.latest&&<PlayerPeek player={row.player} snapshot={row.latest}/>}<button className="player-name" onClick={event=>{event.stopPropagation();openPlayer()}}>{row.player.current_name}</button></div>
  if(key==='age')return <>{row.latest?.age??'—'}</>
  if(key==='nationality')return <>{row.player.nationality||'—'}</>
  if(key==='value')return <>{row.marketValue||'—'}</>
  if(key==='team')return <>{row.latest?.club||row.latest?.squad||'—'}</>
  if(key==='position')return <>{row.latest?.positions?.join(', ')||'—'}</>
  if(key==='height')return <>{row.latest?.height?`${row.latest.height} cm`:'—'}</>
  if(key==='weight')return <>{row.latest?.weight?`${row.latest.weight} kg`:'—'}</>
  if(key==='foot')return <>{row.latest?.preferred_foot||'—'}</>
  if(key==='contract')return <>{row.latest?.contract_expiry||'—'}</>
  if(key==='snapshot')return <>{row.latest?.snapshot_date||'—'}</>
  if(key==='score')return <ScoreWithProjection playerId={row.player.id} currentScore={row.score} currentRank={row.referencePercentile} snapshot={row.latest} scoreType="general" variant="inline" currentTitle="Nota atual"/>
  return <>{row.referencePercentile===null?'—':<Tooltip content={`P${row.referencePercentile}: nota igual ou superior à de ${row.referencePercentile}% dos ${row.referenceSample} jogadores aptos em ${row.referenceGroup}, na ${referenceDivision}ª divisão de ${referenceCountry}.`}><span className={`reference-level level-${row.referenceLevel?.toLowerCase().replaceAll(' ','-')}`} tabIndex={0}><b>P{row.referencePercentile}</b> {row.referenceLevel} · {row.referenceGroup}</span></Tooltip>}</>
}

export function extractMarketValue(snapshot:Snapshot){const normalized=snapshot.normalized_data??{};for(const key of['value','transfer_value','market_value','valor'])if(normalized[key]!=null&&String(normalized[key]).trim())return String(normalized[key]);for(const[key,value]of Object.entries(snapshot.raw_data??{})){const normalizedKey=key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_');if(['value','transfer_value','market_value','valor'].includes(normalizedKey)&&String(value).trim())return String(value)}return null}
function numericMarketValue(raw:string|null){if(!raw)return-1;const first=raw.split(/\s*[-–]\s*/)[0],match=first.replace(/\s/g,'').match(/([\d.,]+)\s*([KMB])?/i);if(!match)return-1;const number=Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));return number*({K:1e3,M:1e6,B:1e9}[match[2]?.toUpperCase()as'K'|'M'|'B']??1)}
function compareRows(a:Row,b:Row,key:SortKey){if(key==='position'){const ap=a.latest?.positions??[],bp=b.latest?.positions??[];return positionRank(ap)-positionRank(bp)||positionSideRank(ap)-positionSideRank(bp)}if(key==='score')return(a.score??-1)-(b.score??-1);if(key==='reference')return(a.referencePercentile??-1)-(b.referencePercentile??-1);if(key==='value')return numericMarketValue(a.marketValue)-numericMarketValue(b.marketValue);if(key==='age'||key==='height'||key==='weight')return Number(rowValue(a,key)??999)-Number(rowValue(b,key)??999);return String(rowValue(a,key)??'').localeCompare(String(rowValue(b,key)??''),'pt-BR')}
function rowValue(row:Row,key:SortKey){if(key==='status')return row.status;if(key==='name')return row.player.current_name;if(key==='nationality')return row.player.nationality;if(key==='team')return row.latest?.club||row.latest?.squad;if(key==='position')return row.latest?.positions?.join(', ');if(key==='age')return row.latest?.age;if(key==='height')return row.latest?.height;if(key==='weight')return row.latest?.weight;if(key==='foot')return row.latest?.preferred_foot;if(key==='contract')return row.latest?.contract_expiry;if(key==='snapshot')return row.latest?.snapshot_date;if(key==='score')return row.score;if(key==='reference')return row.referencePercentile;return row.marketValue}
function compareTableRows(a:Row,b:Row,key:string,columns:TableColumn[]){const column=columns.find(item=>item.id===key);if(column?.kind==='tacticRole'||column?.kind==='role')return(a.columnScores[column.id]??-1)-(b.columnScores[column.id]??-1);if(column?.kind==='attribute'){const value=(row:Row)=>row.latest?.player_attributes.find(item=>item.attribute_key===column.attributeKey)?.value??-1;return value(a)-value(b)}return compareRows(a,b,key as SortKey)}
function scoreForRole(row:Row,column:TableColumn,model:ModelConfig){if(!row.latest||!column.phase||!column.position||!column.roleCode)return null;const roleName=rolesFor(column.position,column.phase).find(([code])=>code===column.roleCode)?.[1]??column.roleCode,id=`${column.phase}-${positionGroup(column.position)}-${column.roleCode}`,weights=resolveRoleWeights({roleId:id,roleName,overrideWeights:model.role_weight_overrides?.[id]});return roleScore(row.latest.player_attributes,weights)}
function scoreForTacticRole(row:Row,column:TableColumn,model:ModelConfig){if(!row.latest||!column.tacticId||!column.linkId)return null;const tactic=model.tactics?.find(item=>item.id===column.tacticId),ip=tactic?.ipAssignments.find(item=>item.playerId===column.linkId),oop=tactic?.oopAssignments.find(item=>item.playerId===column.linkId)??ip;if(!tactic||!ip||!oop)return null;const weights=(assignment:Assignment,phase:'IP'|'OOP')=>{const id=assignment.roleId??`${phase}-${positionGroup(assignment.position)}-${assignment.roleCode}`;return resolveRoleWeights({roleId:id,roleName:assignment.roleName,overrideWeights:model.role_weight_overrides?.[id]??tactic.roles?.find(role=>role.id===id)?.weights})};return pairedRoleScore(row.latest.player_attributes,weights(ip,'IP'),weights(oop,'OOP'))}
const filterColumns:Array<[SortKey,string]>=[['status','Status'],['name','Nome'],['age','Idade'],['nationality','Nacionalidade'],['value','Valor'],['team','Equipe'],['position','Posições'],['score','Nota'],['reference','Percentil']]
function filterValue(row:Row,column:SortKey){if(column==='status')return row.status;if(column==='name')return row.player.current_name;if(column==='age')return row.latest?.age??null;if(column==='nationality')return row.player.nationality??'';if(column==='value')return numericMarketValue(row.marketValue);if(column==='team')return row.latest?.club||row.latest?.squad||'';if(column==='position')return row.latest?.positions?.join(', ')||'';if(column==='score')return row.score;return row.referencePercentile}
function matchesFilter(row:Row,filter:Filter){if(!filter.value.trim())return true;const value=filterValue(row,filter.column);if(filter.operator==='contains')return String(value??'').toLocaleLowerCase('pt-BR').includes(filter.value.toLocaleLowerCase('pt-BR'));if(filter.operator==='equals')return String(value??'').toLocaleLowerCase('pt-BR')===filter.value.toLocaleLowerCase('pt-BR');const left=Number(value),right=Number(filter.value);if(!Number.isFinite(left)||!Number.isFinite(right))return false;return filter.operator==='gte'?left>=right:left<=right}

function ColumnContextMenu({x,y,column,dataColumns,attributeColumns,tactics,insert,remove,freeze,unfreeze}:{x:number;y:number;column:TableColumn;dataColumns:TableColumn[];attributeColumns:TableColumn[];tactics:Tactic[];insert:(column:TableColumn)=>void;remove:()=>void;freeze:()=>void;unfreeze:()=>void}){
  const categories:Array<[AttributeCategory,string]>=[['technical','Técnico'],['mental','Mental'],['physical','Físico'],['goalkeeping','Goleiro']]
  return <aside className="squad-column-context" style={{left:Math.max(12,Math.min(x,window.innerWidth-260)),top:Math.max(12,Math.min(y,window.innerHeight-190))}} onClick={event=>event.stopPropagation()}>
    <button onClick={freeze}>Congelar até esta coluna</button><button onClick={unfreeze}>Remover congelamento</button><button onClick={remove} disabled={column.id==='name'}>Remover coluna</button><hr/>
    <MenuRoot><MenuBranch label="Adicionar coluna">
      <MenuBranch label="Geral">{dataColumns.length?dataColumns.map(item=><button onClick={()=>insert(item)} key={item.id}>{item.label}</button>):<small>Todas já adicionadas</small>}</MenuBranch>
      <MenuBranch label="Atributos">{categories.map(([category,label])=><MenuBranch label={label} key={category}>{attributeColumns.filter(item=>ATTRIBUTE_CATALOG.find(attribute=>attribute.key===item.attributeKey)?.category===category).map(item=><button onClick={()=>insert(item)} key={item.id}>{item.label}</button>)}</MenuBranch>)}</MenuBranch>
      <MenuBranch label="Notas">
        <MenuBranch label="Táticas">{tactics.length?tactics.map(tactic=><MenuBranch label={tactic.name} key={tactic.id}>{tactic.ipAssignments.map(ip=>{const oop=tactic.oopAssignments.find(item=>item.playerId===ip.playerId)??ip;return <button onClick={()=>insert(tacticColumn(tactic,ip,oop))} key={ip.playerId}>{ip.position} {ip.roleCode} ↔ {oop.position} {oop.roleCode}</button>})}</MenuBranch>):<small>Nenhuma tática criada</small>}</MenuBranch>
        {(['IP','OOP']as TacticPhase[]).map(phase=><MenuBranch label={phase} key={phase}>{positions.map(([position,label])=><MenuBranch label={`${position} · ${label}`} key={position}>{rolesFor(position,phase).map(([code,name])=><button onClick={()=>insert(roleColumn(phase,position,code))} key={code}>{code} · {name}</button>)}</MenuBranch>)}</MenuBranch>)}
      </MenuBranch>
    </MenuBranch></MenuRoot>
  </aside>
}
type MenuLevelState={active:string|null;setActive:Dispatch<SetStateAction<string|null>>;keepOpen:()=>void;scheduleClose:()=>void}
const MenuLevelContext=createContext<MenuLevelState|null>(null)
function MenuRoot({children}:{children:ReactNode}){
  const[active,setActive]=useState<string|null>(null),closeTimer=useRef<number|null>(null)
  const keepOpen=()=>{if(closeTimer.current!==null){window.clearTimeout(closeTimer.current);closeTimer.current=null}}
  const scheduleClose=()=>{keepOpen();closeTimer.current=window.setTimeout(()=>setActive(null),150)}
  useEffect(()=>()=>keepOpen(),[])
  return <MenuLevelContext.Provider value={{active,setActive,keepOpen,scheduleClose}}>{children}</MenuLevelContext.Provider>
}
function NestedMenuLevel({children,parent}:{children:ReactNode;parent:MenuLevelState}){const[active,setActive]=useState<string|null>(null);return <MenuLevelContext.Provider value={{...parent,active,setActive}}>{children}</MenuLevelContext.Provider>}
function MenuBranch({label,children}:{label:string;children:ReactNode}){
  const level=useContext(MenuLevelContext),id=useId(),[anchor,setAnchor]=useState<DOMRect|null>(null),[position,setPosition]=useState<{left:number;top:number}|null>(null),panelRef=useRef<HTMLDivElement>(null),openState=level?.active===id
  const open=(element:HTMLElement)=>{level?.keepOpen();level?.setActive(id);setPosition(null);setAnchor(element.getBoundingClientRect())}
  useLayoutEffect(()=>{if(!anchor||!panelRef.current)return;const panel=panelRef.current.getBoundingClientRect(),gap=5,padding=12,left=anchor.right+gap+panel.width<=window.innerWidth-padding?anchor.right+gap:Math.max(padding,anchor.left-gap-panel.width),top=Math.max(padding,Math.min(anchor.top,window.innerHeight-panel.height-padding));setPosition({left,top})},[anchor,children])
  useEffect(()=>{if(!openState){setAnchor(null);setPosition(null)}},[openState])
  if(!level)return null
  return <div className="context-branch" onMouseEnter={level.keepOpen} onMouseLeave={level.scheduleClose}>
    <button onMouseEnter={event=>open(event.currentTarget)} onFocus={event=>open(event.currentTarget)}><span>{label}</span><span>›</span></button>
    {openState&&anchor&&createPortal(<div ref={panelRef} className="context-submenu-portal" style={{left:position?.left??-10000,top:position?.top??-10000,visibility:position?'visible':'hidden'}} onMouseEnter={level.keepOpen} onMouseLeave={level.scheduleClose} onClick={event=>event.stopPropagation()}><NestedMenuLevel parent={level}>{children}</NestedMenuLevel></div>,document.body)}
  </div>
}
function Tooltip({content,children}:{content:string;children:ReactNode}){const[anchor,setAnchor]=useState<DOMRect|null>(null),show=(element:HTMLElement)=>setAnchor(element.getBoundingClientRect()),width=Math.min(330,typeof window==='undefined'?330:window.innerWidth-24),left=anchor?Math.min(Math.max(12,anchor.left+anchor.width/2-width/2),window.innerWidth-width-12):0,above=Boolean(anchor&&anchor.top>145);return <span className="tooltip-anchor" onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={()=>setAnchor(null)} onFocus={event=>show(event.currentTarget)} onBlur={()=>setAnchor(null)}>{children}{anchor&&createPortal(<span role="tooltip" className={`floating-tooltip ${above?'above':'below'}`} style={{left,width,top:above?anchor.top-8:anchor.bottom+8}}>{content}</span>,document.body)}</span>}
