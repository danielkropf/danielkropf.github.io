// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({selected:{id:'a',name:'Save A'},invalidate:vi.fn()}))
vi.mock('../saves/SaveContext',()=>({useSaves:()=>({selected:mocks.selected})}))
vi.mock('../../lib/dataCache',()=>({invalidateSaveData:mocks.invalidate}))
vi.mock('./ImportPanel',()=>({ImportPanel:(props:any)=><div data-testid="task" data-save={props.pinnedSave.id}><span>{props.initialFmFile?.name}</span><button onClick={()=>props.onCompleted('Resumo: 20 jogadores, 1 intake')}>Concluir {props.initialFmFile?.name}</button></div>}))
import {ImportQueueProvider,ImportQueueLauncher} from './ImportQueue'
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();mocks.selected={id:'a',name:'Save A'}})
it('keeps several tasks mounted after route and save changes and notifies completion for the pinned save',async()=>{
 const view=render(<ImportQueueProvider><ImportQueueLauncher/></ImportQueueProvider>)
 fireEvent.change(screen.getByLabelText('Selecionar vários saves .fm'),{target:{files:[new File(['a'],'one.fm'),new File(['b'],'two.fm')]}})
 expect(screen.getAllByTestId('task')).toHaveLength(2)
 mocks.selected={id:'b',name:'Save B'}
 view.rerender(<ImportQueueProvider><p>Outra tela</p></ImportQueueProvider>)
 expect(screen.getAllByTestId('task').every(t=>t.getAttribute('data-save')==='a')).toBe(true)
 fireEvent.click(screen.getByText('Concluir one.fm'))
 await waitFor(()=>expect(mocks.invalidate).toHaveBeenCalledWith('a'))
 expect(screen.getAllByTestId('task')).toHaveLength(1)
 expect(screen.getByRole('status').textContent).toContain('20 jogadores')
})
it('persists the automatic confirmation preference',()=>{
 const view=render(<ImportQueueProvider><ImportQueueLauncher/></ImportQueueProvider>)
 fireEvent.click(screen.getByLabelText('Importar automaticamente após leitura e validação'))
 view.unmount()
 render(<ImportQueueProvider><ImportQueueLauncher/></ImportQueueProvider>)
 expect((screen.getByLabelText('Importar automaticamente após leitura e validação') as HTMLInputElement).checked).toBe(true)
})
