// @vitest-environment jsdom
vi.mock('../../lib/planning-maintenance',()=>({reconcileImportedPlanning:vi.fn().mockResolvedValue(undefined)}))
import { cleanup,render,waitFor,screen } from '@testing-library/react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),stamp:vi.fn(),find:vi.fn(),config:vi.fn(),patch:vi.fn(),excluded:[] as Array<{uid:number}>}))
vi.mock('../saves/SaveContext',()=>({useSaves:()=>({selected:{id:'other',name:'Other'}})}))
vi.mock('../../lib/model-config',()=>({loadModelConfig:mocks.config,patchModelConfig:mocks.patch}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../lib/import-management',()=>({stampImportVersion:mocks.stamp,findImportByHash:mocks.find}))
vi.mock('../../lib/importer',async original=>({...await original<typeof import('../../lib/importer')>(),filesHash:async()=> 'fixed-hash'}))
vi.mock('../../lib/file-picker',()=>({IMPORT_DIRECTORY_CHANGED:'dir-change',getImportDirectoryName:async()=>null,supportsPersistentFilePicker:()=>false,chooseImportFile:vi.fn(),chooseImportDirectory:vi.fn()}))
import {ImportPanel} from './ImportPanel'
import type {Save} from '../../types/domain'
afterEach(()=>{cleanup();vi.unstubAllGlobals();mocks.rpc.mockReset();mocks.stamp.mockReset()})
function testFile(){const file=new File(['fm'],'test.fm');Object.defineProperty(file,'arrayBuffer',{value:async()=>new ArrayBuffer(4)});return file}
beforeEach(()=>{
 mocks.find.mockReset().mockResolvedValue(null)
 mocks.excluded=[];mocks.config.mockReset().mockResolvedValue({excluded_non_players_by_date:{'2029-01-01':['10']}});mocks.patch.mockReset().mockResolvedValue({})
 vi.stubGlobal('__APP_VERSION__','0.37.0')
 mocks.rpc.mockResolvedValue({data:{import_id:'import-a',new_players:1,updated_players:0},error:null});mocks.stamp.mockResolvedValue(undefined)
 vi.stubGlobal('Worker',class{
  onmessage:any;terminate(){}
  postMessage(request:any){queueMicrotask(()=>this.onmessage?.({data:{id:request.id,type:'result',result:{players:[{fm_player_id:'1',current_name:'Youth',normalized_name:'youth',identity_key:'fm:1',date_of_birth:'2014-01-01',positions:[],attributes:[],normalized_data:{},raw_data:{}}],tactics:[],diagnostics:{resolved_human_club_count:1,excluded_non_players:mocks.excluded},snapshot_date:'2030-09-22',snapshot_date_precision:'day'}}}))}
 })
})
it('automatically persists a valid initial file exactly once into its pinned save and returns a summary',async()=>{
 const file=testFile()
 const completed=vi.fn()
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={file} autoConfirm onCompleted={completed}/>)
 await waitFor(()=>expect(completed).toHaveBeenCalledOnce())
 expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_save_id:'pinned',p_file_hash:'fixed-hash',p_snapshot_date:'2030-09-22'})
 expect(mocks.stamp).toHaveBeenCalledWith('pinned','import-a','0.37.0')
 expect(completed.mock.calls[0][0]).toContain('1 jogadores processados')
})

it('waits for confirmation when automatic imports are disabled',async()=>{
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()}/>)
 await waitFor(()=>expect((screen.getByRole('button',{name:'Confirmar importação'}) as HTMLButtonElement).disabled).toBe(false))
 expect(mocks.rpc).not.toHaveBeenCalled()
})
it('updates a prior import through the duplicate path and stamps its exact ID',async()=>{
 mocks.rpc.mockResolvedValue({data:{duplicate:true,import_id:'old',membership_sync:{status:'synced',synced_rows:1}},error:null})
 const done=vi.fn()
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} autoConfirm onCompleted={done} updateTarget={{id:'old',original_filename:'test.fm',file_hash:'fixed-hash',snapshot_date:'2030-09-22',file_type:'squad'}}/>)
 await waitFor(()=>expect(done).toHaveBeenCalledOnce())
 expect(mocks.stamp.mock.calls[0][1]).toBe('old');expect(done.mock.calls[0][0]).toContain('1 vínculo(s)')
})
it('refuses an update whose original hash does not match',async()=>{
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} autoConfirm updateTarget={{id:'old',original_filename:'test.fm',file_hash:'different',snapshot_date:'2030-09-22',file_type:'squad'}}/>)
 await screen.findByText(/O conteúdo selecionado não corresponde/)
 expect(mocks.rpc).not.toHaveBeenCalled()
})

it('saves a read result only after an explicit queue confirmation, once per request',async()=>{
 const file=testFile(), done=vi.fn(), save={id:'pinned',name:'Pinned'} as Save
 const view=render(<ImportPanel pinnedSave={save} initialFmFile={file} onCompleted={done} confirmRequest={0}/>)
 await waitFor(()=>expect((screen.getByRole('button',{name:'Confirmar importação'}) as HTMLButtonElement).disabled).toBe(false))
 expect(mocks.rpc).not.toHaveBeenCalled()
 view.rerender(<ImportPanel pinnedSave={save} initialFmFile={file} onCompleted={done} confirmRequest={1}/>)
 await waitFor(()=>expect(done).toHaveBeenCalledOnce())
 view.rerender(<ImportPanel pinnedSave={save} initialFmFile={file} onCompleted={done} confirmRequest={1}/>)
 expect(mocks.rpc).toHaveBeenCalledOnce()
})

it('detects an existing renamed file before confirmation and updates its original ID', async()=>{
 mocks.find.mockResolvedValue({id:'old',original_filename:'original.fm',file_hash:'fixed-hash',snapshot_date:'2030-09-22',file_type:'squad'})
 mocks.rpc.mockResolvedValue({data:{duplicate:true,import_id:'old'},error:null})
 const done=vi.fn(), progress=vi.fn()
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} autoConfirm onProgress={progress} onCompleted={done}/>)
 await waitFor(()=>expect(done).toHaveBeenCalledOnce())
 expect(mocks.find).toHaveBeenCalledWith('pinned','fixed-hash')
 expect(progress.mock.calls.some(([p])=>p.operation==='update' && p.detectedImportId==='old')).toBe(true)
 expect(mocks.stamp).toHaveBeenCalledWith('pinned','old','0.37.0',expect.objectContaining({reprocessed_reader:expect.any(String)}))
})
it('blocks automatic persistence if the history lookup fails', async()=>{
 mocks.find.mockRejectedValue(new Error('offline'))
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} autoConfirm/>)
 await screen.findByRole('alert')
 expect(mocks.rpc).not.toHaveBeenCalled()
})

it('classifies a mixed batch as two updates and one new import without saving before review',async()=>{
 const targets=[{id:'jan',original_filename:'old-jan.fm',file_hash:'fixed-hash',snapshot_date:'2030-09-22',file_type:'squad'},null,{id:'dec',original_filename:'old-dec.fm',file_hash:'fixed-hash',snapshot_date:'2030-09-22',file_type:'squad'}]
 mocks.find.mockImplementation(async()=>targets.shift())
 const progress=[vi.fn(),vi.fn(),vi.fn()]
 render(<>{progress.map((callback,i)=><ImportPanel key={i} pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} onProgress={callback}/>)}</>)
 await waitFor(()=>expect(progress.map(fn=>fn.mock.calls.at(-1)?.[0].phase)).toEqual(['ready','ready','ready']))
 expect(progress.map(fn=>fn.mock.calls.at(-1)?.[0].operation)).toEqual(['update','new','update'])
 expect(mocks.rpc).not.toHaveBeenCalled()
})

it('persists record exclusions for the exact checkpoint while preserving other dates',async()=>{
 mocks.excluded=[{uid:19400558},{uid:23289648}]
 const done=vi.fn()
 render(<ImportPanel pinnedSave={{id:'pinned',name:'Pinned'} as Save} initialFmFile={testFile()} autoConfirm onCompleted={done}/>)
 await waitFor(()=>expect(done).toHaveBeenCalledOnce())
 expect(mocks.patch).toHaveBeenCalledWith('pinned','0.37.0',{excluded_non_players_by_date:{'2029-01-01':['10'],'2030-09-22':['19400558','23289648']}})
})
