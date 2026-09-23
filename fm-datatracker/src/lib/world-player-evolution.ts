import { ATTRIBUTE_CATALOG } from './attributes'
import { WORLD_CENSUS_ATTRIBUTE_NAMES, WORLD_CENSUS_POSITION_RATING_NAMES } from './fm26-world-census'
import { canonicalBytes, sha256Bytes } from './world-census-protocol'
import { supabase } from './supabase'

const PLAYER_CORE_DOMAIN = 'player_core_facts'
const POSITION_THRESHOLD = 15

export type WorldPlayerCoreProjectionRow = {
  id: string; save_id: string; lineage_id: string; checkpoint_id: string; reader_run_id: string
  world_person_record_id: string; person_entity_id: string; identity_epoch_id: string | null
  person_record_ref: number; uid: number | string; checkpoint_date: string | null; is_canonical: boolean
  identity_linkage_status: 'confirmed' | 'unknown' | 'ambiguous' | 'unsupported' | 'excluded'
  identity_linkage_reason: string; identity_birth_date: string | null
  core_status: 'confirmed' | 'unknown' | 'ambiguous' | 'unsupported' | 'excluded'; core_reason_code: string
  ca: number | null; pa: number | null; position_ratings: number[] | null; attributes_1_20: number[] | null
  height_cm: number | null; evidence_refs: number[]; derivation_ref: number
}

export type WorldEvolutionSnapshot = {
  id: string; snapshot_date: string; age: number | null; club: string | null; squad: string | null
  positions: string[]; normalized_data: Record<string, unknown>
  player_attributes: Array<{ attribute_key: string; value: number | null }>
}
export type WorldEvolutionPoint = { row: WorldPlayerCoreProjectionRow; snapshot: WorldEvolutionSnapshot | null }
export type WorldPlayerEvolutionShadow = { uid: string; points: WorldEvolutionPoint[]; segments: WorldEvolutionSnapshot[][]; diagnostic: string | null }
export type WorldPlayerCoreProjectionVerification = {
  readerRunId: string; packageId: string; effectivePackageId: string | null; domainAction: 'replace' | 'inherit' | 'mask'
  directCount: number; projectionCount: number; directHash: string; projectionHash: string
  missingRefs: number[]; extraRefs: number[]; differingRefs: number[]; matches: boolean
}
type DirectPlayerCoreFact = { person_record_ref?: unknown; status?: unknown; reason_code?: unknown; ca?: unknown; pa?: unknown; positions?: unknown; attributes_1_20?: unknown; height_cm?: unknown; evidence_refs?: unknown; derivation_ref?: unknown }
type StatePackageRow = { id: string; base_anchor_package_id: string | null; domain_actions: Record<string, unknown> }
type StateSegmentRow = { ordinal: number; storage_bucket: string; storage_path: string; segment_hash: string; codec: string; schema_version: string }

export type WorldPlayerCoreProjectionGateway = {
  loadRowsByUid: (saveId: string, uid: string) => Promise<WorldPlayerCoreProjectionRow[]>
  loadRowsByRun: (readerRunId: string) => Promise<WorldPlayerCoreProjectionRow[]>
  loadPackage: (readerRunId: string) => Promise<StatePackageRow | null>
  loadSegments: (packageId: string) => Promise<StateSegmentRow[]>
  download: (bucket: string, path: string) => Promise<Blob>
}

function defaultGateway(): WorldPlayerCoreProjectionGateway {
  if (!supabase) throw new Error('world_projection_database_not_configured')
  const client = supabase
  return {
    async loadRowsByUid(saveId, uid) {
      const result = await client.from('world_player_core_projection').select(projectionSelect).eq('save_id', saveId).eq('uid', uid).eq('is_canonical', true).order('checkpoint_date').order('reader_run_id')
      if (result.error) throw new Error(result.error.message)
      return (result.data ?? []) as unknown as WorldPlayerCoreProjectionRow[]
    },
    async loadRowsByRun(readerRunId) {
      const result = await client.from('world_player_core_projection').select(projectionSelect).eq('reader_run_id', readerRunId).order('person_record_ref')
      if (result.error) throw new Error(result.error.message)
      return (result.data ?? []) as unknown as WorldPlayerCoreProjectionRow[]
    },
    async loadPackage(readerRunId) {
      const result = await client.from('world_state_packages').select('id,base_anchor_package_id,domain_actions').eq('reader_run_id', readerRunId).eq('status', 'complete').maybeSingle()
      if (result.error) throw new Error(result.error.message)
      return result.data as unknown as StatePackageRow | null
    },
    async loadSegments(packageId) {
      const result = await client.from('world_state_segments').select('ordinal,storage_bucket,storage_path,segment_hash,codec,schema_version').eq('package_id', packageId).eq('domain_key', PLAYER_CORE_DOMAIN).order('ordinal')
      if (result.error) throw new Error(result.error.message)
      return (result.data ?? []) as unknown as StateSegmentRow[]
    },
    async download(bucket, path) {
      const result = await client.storage.from(bucket).download(path)
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'world_projection_segment_download_failed')
      return result.data
    },
  }
}

const catalogKeys = new Set(ATTRIBUTE_CATALOG.map(attribute => attribute.key))
function normalizedKey(value: string) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') }
function appAttributeKey(worldName: string): string | null {
  if (worldName === 'Teamwork') return 'team_work'
  if (worldName === 'Punching Tendency') return 'punching'
  if (worldName === 'Rushing Out Tendency') return 'rushing_out_tendency'
  if (worldName === 'Left Foot' || worldName === 'Right Foot') return null
  const key = normalizedKey(worldName)
  return catalogKeys.has(key) ? key : null
}
function exactAge(birthDate: string, checkpointDate: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00Z`), checkpoint = new Date(`${checkpointDate}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(checkpoint.getTime()) || checkpoint < birth) return null
  let age = checkpoint.getUTCFullYear() - birth.getUTCFullYear()
  if (checkpoint.getUTCMonth() < birth.getUTCMonth() || (checkpoint.getUTCMonth() === birth.getUTCMonth() && checkpoint.getUTCDate() < birth.getUTCDate())) age -= 1
  return age
}

export function worldProjectionRowToEvolutionSnapshot(row: WorldPlayerCoreProjectionRow): WorldEvolutionSnapshot | null {
  if (!row.is_canonical || row.identity_linkage_status !== 'confirmed' || !row.identity_epoch_id || !row.identity_birth_date) return null
  if (row.core_status !== 'confirmed' || !row.checkpoint_date) return null
  if (!row.position_ratings || row.position_ratings.length !== WORLD_CENSUS_POSITION_RATING_NAMES.length) return null
  if (!row.attributes_1_20 || row.attributes_1_20.length !== WORLD_CENSUS_ATTRIBUTE_NAMES.length) return null
  const positionalRatings = Object.fromEntries(WORLD_CENSUS_POSITION_RATING_NAMES.map((name, index) => [name, row.position_ratings![index]]))
  const positions = WORLD_CENSUS_POSITION_RATING_NAMES.filter((_, index) => (row.position_ratings?.[index] ?? 0) >= POSITION_THRESHOLD)
  const playerAttributes = WORLD_CENSUS_ATTRIBUTE_NAMES.flatMap((name, index) => { const key = appAttributeKey(name); return key ? [{ attribute_key: key, value: row.attributes_1_20![index] }] : [] })
  return {
    id: `world-core:${row.id}`, snapshot_date: row.checkpoint_date, age: exactAge(row.identity_birth_date, row.checkpoint_date),
    club: null, squad: null, positions,
    normalized_data: { source: 'world-census-player-core-projection', identity_epoch_id: row.identity_epoch_id, positional_ratings: positionalRatings,
      feet: { left: row.attributes_1_20[24], right: row.attributes_1_20[25] }, ca: row.ca, pa: row.pa, height_cm: row.height_cm },
    player_attributes: playerAttributes,
  }
}

export function buildWorldPlayerEvolutionShadow(rows: WorldPlayerCoreProjectionRow[]): WorldPlayerEvolutionShadow {
  const canonical = rows.filter(row => row.is_canonical).sort((a,b) => String(a.checkpoint_date ?? '').localeCompare(String(b.checkpoint_date ?? '')) || a.reader_run_id.localeCompare(b.reader_run_id) || a.person_record_ref-b.person_record_ref)
  const uidValues=[...new Set(canonical.map(row=>String(row.uid)))], lineageValues=[...new Set(canonical.map(row=>row.lineage_id))]
  const points=canonical.map(row=>({row,snapshot:worldProjectionRowToEvolutionSnapshot(row)}))
  if(uidValues.length>1)return{uid:'',points,segments:[],diagnostic:'multiple_world_uids_in_shadow_input'}
  if(lineageValues.length>1)return{uid:uidValues[0]??'',points,segments:[],diagnostic:'multiple_world_lineages_for_uid'}
  const segments: WorldEvolutionSnapshot[][]=[]; let activeEpoch:string|null=null; let current:WorldEvolutionSnapshot[]=[]
  const flush=()=>{if(current.length)segments.push(current);current=[];activeEpoch=null}
  for(const point of points){const epoch=point.row.identity_epoch_id;if(!point.snapshot||!epoch){flush();continue}if(activeEpoch&&activeEpoch!==epoch)flush();activeEpoch=epoch;current.push(point.snapshot)}
  flush(); return{uid:uidValues[0]??'',points,segments,diagnostic:null}
}

const projectionSelect='id,save_id,lineage_id,checkpoint_id,reader_run_id,world_person_record_id,person_entity_id,identity_epoch_id,person_record_ref,uid,checkpoint_date,is_canonical,identity_linkage_status,identity_linkage_reason,identity_birth_date,core_status,core_reason_code,ca,pa,position_ratings,attributes_1_20,height_cm,evidence_refs,derivation_ref'
export async function loadWorldPlayerEvolutionShadow(saveId:string,uid:string|number,gateway?:WorldPlayerCoreProjectionGateway):Promise<WorldPlayerEvolutionShadow>{
  try {
    const rows=await (gateway??defaultGateway()).loadRowsByUid(saveId,String(uid))
    return buildWorldPlayerEvolutionShadow(rows)
  } catch(error) {
    return{uid:String(uid),points:[],segments:[],diagnostic:error instanceof Error?error.message:String(error)}
  }
}

function normalizeDirectFact(value:DirectPlayerCoreFact){return{person_record_ref:Number(value.person_record_ref),status:value.status??null,reason_code:value.reason_code??null,ca:value.ca??null,pa:value.pa??null,positions:value.positions??null,attributes_1_20:value.attributes_1_20??null,height_cm:value.height_cm??null,evidence_refs:value.evidence_refs??null,derivation_ref:value.derivation_ref??null}}
function normalizeProjectionFact(row:WorldPlayerCoreProjectionRow){return{person_record_ref:row.person_record_ref,status:row.core_status,reason_code:row.core_reason_code,ca:row.ca,pa:row.pa,positions:row.position_ratings,attributes_1_20:row.attributes_1_20,height_cm:row.height_cm,evidence_refs:row.evidence_refs,derivation_ref:row.derivation_ref}}
export async function compareWorldPlayerCoreProjection(directItems:DirectPlayerCoreFact[],projectionRows:WorldPlayerCoreProjectionRow[]){
  const direct=directItems.map(normalizeDirectFact).sort((a,b)=>a.person_record_ref-b.person_record_ref), projection=projectionRows.map(normalizeProjectionFact).sort((a,b)=>a.person_record_ref-b.person_record_ref)
  const dm=new Map(direct.map(x=>[x.person_record_ref,x])),pm=new Map(projection.map(x=>[x.person_record_ref,x]));const decoder=new TextDecoder()
  const missingRefs=[...dm.keys()].filter(ref=>!pm.has(ref)),extraRefs=[...pm.keys()].filter(ref=>!dm.has(ref))
  const differingRefs=[...dm.keys()].filter(ref=>pm.has(ref)&&decoder.decode(canonicalBytes(dm.get(ref)!))!==decoder.decode(canonicalBytes(pm.get(ref)!)))
  const [directHash,projectionHash]=await Promise.all([sha256Bytes(canonicalBytes(direct)),sha256Bytes(canonicalBytes(projection))])
  return{directCount:direct.length,projectionCount:projection.length,directHash,projectionHash,missingRefs,extraRefs,differingRefs,matches:!missingRefs.length&&!extraRefs.length&&!differingRefs.length&&directHash===projectionHash}
}

async function gunzipJson(blob:Blob):Promise<Record<string,unknown>>{if(typeof DecompressionStream==='undefined')throw new Error('world_projection_gzip_unavailable');const text=await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('world_projection_segment_not_object');return parsed as Record<string,unknown>}
async function directPlayerCoreItems(readerRunId:string,gateway:WorldPlayerCoreProjectionGateway):Promise<{packageId:string;effectivePackageId:string|null;action:'replace'|'inherit'|'mask';items:DirectPlayerCoreFact[]}>{
  const statePackage=await gateway.loadPackage(readerRunId)
  if(!statePackage)throw new Error('world_projection_package_missing')
  const action=statePackage.domain_actions?.[PLAYER_CORE_DOMAIN]
  if(action!=='replace'&&action!=='inherit'&&action!=='mask')throw new Error(`world_projection_domain_action_invalid:${String(action)}`)
  const effectivePackageId=action==='replace'?statePackage.id:action==='inherit'?statePackage.base_anchor_package_id:null
  if(action==='inherit'&&!effectivePackageId)throw new Error('world_projection_inherited_anchor_missing')
  if(!effectivePackageId)return{packageId:statePackage.id,effectivePackageId:null,action,items:[]}
  const items:DirectPlayerCoreFact[]=[]
  for(const segment of await gateway.loadSegments(effectivePackageId)){
    if(segment.codec!=='gzip-json-v1'||segment.schema_version!=='world-state-segment-v1')throw new Error('world_projection_segment_contract_mismatch')
    const decoded=await gunzipJson(await gateway.download(segment.storage_bucket,segment.storage_path))
    if(decoded.schema_version!=='world-state-segment-v1'||decoded.domain!==PLAYER_CORE_DOMAIN||decoded.ordinal!==segment.ordinal||!Array.isArray(decoded.items))throw new Error('world_projection_segment_payload_mismatch')
    if(await sha256Bytes(canonicalBytes(decoded))!==segment.segment_hash)throw new Error('world_projection_segment_hash_mismatch')
    items.push(...decoded.items as DirectPlayerCoreFact[])
  }
  return{packageId:statePackage.id,effectivePackageId,action,items}
}
export async function verifyWorldPlayerCoreProjectionForRun(readerRunId:string,gateway?:WorldPlayerCoreProjectionGateway):Promise<WorldPlayerCoreProjectionVerification>{
  const source=gateway??defaultGateway()
  const [direct,projectionRows]=await Promise.all([directPlayerCoreItems(readerRunId,source),source.loadRowsByRun(readerRunId)])
  const comparison=await compareWorldPlayerCoreProjection(direct.items,projectionRows)
  return{readerRunId,packageId:direct.packageId,effectivePackageId:direct.effectivePackageId,domainAction:direct.action,...comparison}
}
