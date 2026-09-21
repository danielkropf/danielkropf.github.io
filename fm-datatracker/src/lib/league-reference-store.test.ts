import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(()=>({result:vi.fn(),from:vi.fn(),update:vi.fn(),eq:vi.fn(),lt:vi.fn(),select:vi.fn()}))
vi.mock('./supabase',()=>({supabase:{from:mocks.from}}))
import { fileHash } from './importer'
import { referenceFixture } from './league-reference.fixture'
import { hasUsableLeagueComparison, loadBestLeagueReference, loadLeagueReference, persistLeagueReference } from './league-reference-store'

beforeEach(()=>{
  vi.clearAllMocks()
  const q:any={
    select:(...a:unknown[])=>{mocks.select(...a);return q},
    eq:(...a:unknown[])=>{mocks.eq(...a);return q},
    lt:(...a:unknown[])=>{mocks.lt(...a);return q},
    order:()=>q,
    limit:()=>q,
    update:(...a:unknown[])=>{mocks.update(...a);return q},
    maybeSingle:mocks.result,
  }
  mocks.from.mockReturnValue(q)
})
const args=async()=>({saveId:'save',importId:'import',importHash:'enclosing-hash',fmFileHash:await fileHash('a'.repeat(64)),date:'2034-01-01',value:referenceFixture(),mode:'validated'})
const persistedRow=async(value=referenceFixture(), date=value.checkpoint ?? '2034-01-01', id='import')=>({id,file_hash:`hash-${id}`,reference:{save_id:'save',import_id:id,import_hash:`hash-${id}`,fm_file_hash:await fileHash(value.sourceSha256),data:value}})

it('persists only the matching accepted import, preserving existing metadata and checking affected rows',async()=>{const a=await args();mocks.result.mockResolvedValueOnce({data:{id:a.importId,file_hash:a.importHash,snapshot_date:a.date,status:'imported',source_schema:{custom:'keep'}},error:null}).mockResolvedValueOnce({data:{id:a.importId},error:null});await persistLeagueReference(a);expect(mocks.eq).toHaveBeenCalledWith('save_id','save');expect(mocks.eq).toHaveBeenCalledWith('id','import');expect(mocks.update.mock.calls[0][0].source_schema).toMatchObject({custom:'keep',league_reference:{save_id:'save',import_id:'import',import_hash:a.importHash,fm_file_hash:a.fmFileHash}})})
it('rejects CSV fallback, wrong fingerprint and wrong checkpoint before any DB mutation',async()=>{const a=await args();for(const bad of [{...a,mode:'csv-fallback'},{...a,fmFileHash:'wrong'},{...a,date:'2035-01-01'}])await expect(persistLeagueReference(bad)).rejects.toThrow();expect(mocks.from).not.toHaveBeenCalled()})
it('rejects mismatched enclosing import and denied/no-op updates',async()=>{const a=await args();mocks.result.mockResolvedValueOnce({data:{file_hash:'other',snapshot_date:a.date,status:'imported'},error:null});await expect(persistLeagueReference(a)).rejects.toThrow();expect(mocks.update).not.toHaveBeenCalled();mocks.result.mockResolvedValueOnce({data:{file_hash:a.importHash,snapshot_date:a.date,status:'imported'},error:null}).mockResolvedValueOnce({data:null,error:null});await expect(persistLeagueReference(a)).rejects.toThrow('não foi gravada')})
it('loads only the exact checkpoint and validates save/import/fingerprint binding',async()=>{const a=await args(),row={id:a.importId,file_hash:a.importHash,reference:{save_id:a.saveId,import_id:a.importId,import_hash:a.importHash,fm_file_hash:a.fmFileHash,data:a.value}};mocks.result.mockResolvedValueOnce({data:row,error:null});expect(await loadLeagueReference(a.saveId,a.date)).toEqual(a.value);expect(mocks.eq).toHaveBeenCalledWith('snapshot_date',a.date);mocks.result.mockResolvedValueOnce({data:{...row,reference:{...row.reference,save_id:'other'}},error:null});expect(await loadLeagueReference(a.saveId,a.date)).toBeNull();mocks.result.mockResolvedValueOnce({data:null,error:null});expect(await loadLeagueReference(a.saveId,a.date)).toBeNull()})
it('recognizes a league reference only when the team has a usable current or completed population',()=>{const d=referenceFixture();expect(hasUsableLeagueComparison(d,1)).toBe(true);d.players=[];expect(hasUsableLeagueComparison(d,1)).toBe(false)})
it('falls back to the newest earlier usable checkpoint when the current import has no comparison population',async()=>{
  const exact=referenceFixture();exact.checkpoint='2035-01-01';exact.cohorts[0].status='historical';exact.cohorts[0].reason='same_save_calendar_and_history_completed';exact.players=[]
  const previous=referenceFixture()
  mocks.result
    .mockResolvedValueOnce({data:await persistedRow(exact,'2035-01-01','exact'),error:null})
    .mockResolvedValueOnce({data:{snapshot_date:'2034-01-01'},error:null})
    .mockResolvedValueOnce({data:await persistedRow(previous,'2034-01-01','previous'),error:null})
  const selected=await loadBestLeagueReference('save','2035-01-01')
  expect(selected).toMatchObject({requestedDate:'2035-01-01',sourceDate:'2034-01-01',fallback:true})
  expect(selected.data).toEqual(previous)
  expect(mocks.lt).toHaveBeenCalledWith('snapshot_date','2035-01-01')
})
it('uses the exact checkpoint without scanning history when its completed league population is usable',async()=>{
  const exact=referenceFixture();exact.checkpoint='2035-01-01';exact.cohorts[0].status='historical';exact.cohorts[0].reason='same_save_calendar_and_history_completed'
  mocks.result.mockResolvedValueOnce({data:await persistedRow(exact,'2035-01-01','exact'),error:null})
  const selected=await loadBestLeagueReference('save','2035-01-01')
  expect(selected).toMatchObject({sourceDate:'2035-01-01',fallback:false})
  expect(mocks.lt).not.toHaveBeenCalled()
})
