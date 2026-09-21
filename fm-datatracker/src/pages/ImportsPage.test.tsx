// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({range:vi.fn(),add:vi.fn()}))
vi.mock('../features/saves/SaveContext',()=>({useSaves:()=>({selected:{id:'save',name:'Save'}})}))
vi.mock('../features/imports/ImportQueue',()=>({ImportQueueLauncher:()=> <h1>Importar arquivos</h1>,useImportQueue:()=>({add:mocks.add,isUpdating:()=>false})}))
vi.mock('../lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,range:mocks.range};return q}}}))
import { IMPORT_DATA_VERSION } from '../lib/import-version'
import {ImportsPage} from './ImportsPage'
afterEach(()=>{cleanup();vi.unstubAllGlobals();mocks.range.mockReset()})
it('loads history beside new imports, paginates all rows and only offers necessary updates',async()=>{
 vi.stubGlobal('__APP_VERSION__','0.39.0')
 const row=(id:string,version:string)=>({id,original_filename:`${id}.fm`,snapshot_date:'2030-09-22',status:'completed',row_count:10,app_version:version})
 mocks.range.mockResolvedValueOnce({data:Array.from({length:500},(_,i)=>row(`current-${i}`,IMPORT_DATA_VERSION)),error:null})
 mocks.range.mockResolvedValueOnce({data:[row('old','0.35.0')],error:null})
 render(<ImportsPage/>)
 await screen.findByText('old.fm')
 expect(screen.getByText('Importar arquivos')).toBeTruthy()
 expect(screen.getAllByRole('button',{name:/Atualizar /})).toHaveLength(1)
 expect(mocks.range.mock.calls).toEqual([[0,499],[500,999]])
 fireEvent.click(screen.getByRole('button',{name:'Atualizar old.fm'}))
 expect(mocks.add).not.toHaveBeenCalled()
 const file=new File(['save'],'old.fm')
 fireEvent.change(screen.getByLabelText('Arquivo original para atualização'),{target:{files:[file]}})
 expect(mocks.add).toHaveBeenCalledWith([file],expect.objectContaining({id:'old'}))
 await waitFor(()=>expect(screen.queryByText('Carregando histórico…')).toBeNull())
},15000)
