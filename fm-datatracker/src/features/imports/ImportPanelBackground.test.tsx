// @vitest-environment jsdom
import { cleanup,render,waitFor,screen } from '@testing-library/react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),stamp:vi.fn()}))
vi.mock('../saves/SaveContext',()=>({useSaves:()=>({selected:{id:'other',name:'Other'}})}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
vi.mock('../../lib/import-management',()=>({stampImportVersion:mocks.stamp}))
vi.mock('../../lib/importer',async original=>({...await original<typeof import('../../lib/importer')>(),filesHash:async()=> 'fixed-hash'}))
vi.mock('../../lib/file-picker',()=>({IMPORT_DIRECTORY_CHANGED:'dir-change',getImportDirectoryName:async()=>null,supportsPersistentFilePicker:()=>false,chooseImportFile:vi.fn(),chooseImportDirectory:vi.fn()}))
import {ImportPanel} from './ImportPanel'
import type {Save} from '../../types/domain'
afterEach(()=>{cleanup();vi.unstubAllGlobals();mocks.rpc.mockReset();mocks.stamp.mockReset()})
function testFile(){const file=new File(['fm'],'test.fm');Object.defineProperty(file,'arrayBuffer',{value:async()=>new ArrayBuffer(4)});return file}
beforeEach(()=>{
 vi.stubGlobal('__APP_VERSION__','0.37.0')
 mocks.rpc.mockResolvedValue({data:{import_id:'import-a',new_players:1,updated_players:0},error:null});mocks.stamp.mockResolvedValue(undefined)
 vi.stubGlobal('Worker',class{
  onmessage:any;terminate(){}
  postMessage(request:any){queueMicrotask(()=>this.onmessage?.({data:{id:request.id,type:'result',result:{players:[{fm_player_id:'1',current_name:'Youth',normalized_name:'youth',identity_key:'fm:1',date_of_birth:'2014-01-01',positions:[],attributes:[],normalized_data:{},raw_data:{}}],tactics:[],diagnostics:{resolved_human_club_count:1},snapshot_date:'2030-09-22',snapshot_date_precision:'day'}}}))}
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
