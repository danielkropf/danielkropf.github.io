// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ selected: { id: 'a', name: 'Save A' }, invalidate: vi.fn() }))
vi.mock('../saves/SaveContext', () => ({ useSaves: () => ({ selected: mocks.selected }) }))
vi.mock('../../lib/dataCache', () => ({ invalidateSaveData: mocks.invalidate }))
vi.mock('./ImportPanel', () => ({ ImportPanel: (props: any) => <div data-testid="task" data-save={props.pinnedSave.id} data-confirm={props.confirmRequest}><button onClick={() => props.onProgress({ phase: 'ready', detail: '20 jogadores' })}>Pronto {props.initialFmFile?.name}</button><button onClick={() => props.onCompleted('Resumo: 20 jogadores, 1 intake')}>Concluir {props.initialFmFile?.name}</button></div> }))
import { ImportQueueProvider, ImportQueueLauncher, ImportSettings, ImportQueueIndicator, useImportQueue } from './ImportQueue'
function State() { const q = useImportQueue(); return <><span data-testid="open">{String(q.importOpen)}</span><button onClick={() => q.setImportOpen(true)}>Import</button><ImportQueueIndicator /></> }
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); mocks.selected = { id: 'a', name: 'Save A' }; mocks.invalidate.mockClear() })
function stage(...names: string[]) { fireEvent.change(screen.getByLabelText('Selecionar vários saves .fm'), { target: { files: names.map(name => new File(['a'], name)) } }) }
function start(count: number) { fireEvent.click(screen.getByText(`Confirmar leitura de ${count} arquivo(s)`)) }
it('stages several files without starting, supports additions and removal, then closes and reads the confirmed list', () => {
 render(<ImportQueueProvider><State /><ImportQueueLauncher /></ImportQueueProvider>)
 fireEvent.click(screen.getByText('Import')); stage('one.fm', 'two.fm')
 expect(screen.queryAllByTestId('task')).toHaveLength(0)
 stage('three.fm'); fireEvent.click(screen.getByLabelText('Remover two.fm'))
 expect(screen.queryByText('two.fm')).toBeNull(); start(2)
 expect(screen.getAllByTestId('task')).toHaveLength(2)
 expect(screen.getByTestId('open').textContent).toBe('false')
 expect(screen.getAllByLabelText('2 tarefas restantes')[0]).toBeTruthy()
})
it('keeps tasks and drafts pinned when navigating or changing save, and notifies after completion', () => {
 const view = render(<ImportQueueProvider><ImportQueueLauncher /></ImportQueueProvider>)
 stage('one.fm'); mocks.selected = { id: 'b', name: 'Save B' }
 view.rerender(<ImportQueueProvider><ImportQueueLauncher /></ImportQueueProvider>); start(1)
 view.rerender(<ImportQueueProvider><p>Outra tela</p></ImportQueueProvider>)
 expect(screen.getByTestId('task').getAttribute('data-save')).toBe('a')
 fireEvent.click(screen.getByText('Concluir one.fm'))
 expect(mocks.invalidate).toHaveBeenCalledWith('a')
 expect(screen.getByRole('status').textContent).toContain('20 jogadores')
})
it('confirms only selected ready jobs, supports individual confirmation and adding more while jobs remain', () => {
 render(<ImportQueueProvider><State /><ImportQueueLauncher /></ImportQueueProvider>)
 stage('one.fm', 'two.fm', 'three.fm'); start(3)
 fireEvent.click(screen.getByText('Pronto one.fm')); fireEvent.click(screen.getByText('Pronto two.fm'))
 expect(screen.getAllByLabelText('1 tarefas restantes')[0]).toBeTruthy()
 fireEvent.click(screen.getByLabelText('Selecionar one.fm')); fireEvent.click(screen.getByText('Salvar selecionados (1)'))
 expect(screen.getAllByTestId('task').map(t => t.getAttribute('data-confirm'))).toEqual(['1','0','0'])
 const row = screen.getByText('two.fm').closest('li')!
 fireEvent.click(within(row).getByText('Salvar'))
 expect(screen.getAllByTestId('task').map(t => t.getAttribute('data-confirm'))).toEqual(['1','1','0'])
 stage('four.fm'); start(1); expect(screen.getAllByTestId('task')).toHaveLength(4)
})
it('persists preference in settings and never exposes it in the import launcher', () => {
 const view = render(<ImportQueueProvider><ImportSettings /></ImportQueueProvider>)
 const label = 'Salvar imports sem pedir confirmação'
 expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(false)
 fireEvent.click(screen.getByLabelText(label)); view.unmount()
 render(<ImportQueueProvider><ImportSettings /><ImportQueueLauncher /></ImportQueueProvider>)
 expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(true)
 expect(screen.getAllByLabelText(label)).toHaveLength(1)
 expect(screen.queryByText('Importar automaticamente após leitura e validação')).toBeNull()
})

it('keeps the import window open when a historical update starts and completes', () => {
 function Update() { const q=useImportQueue(); return <button onClick={()=>q.add([new File(['a'],'old.fm')],{id:'old',original_filename:'old.fm',file_hash:'hash',file_type:'squad',snapshot_date:'2025-01-01'})}>Atualizar antigo</button> }
 render(<ImportQueueProvider><State/><Update/><ImportQueueLauncher/></ImportQueueProvider>)
 fireEvent.click(screen.getByText('Atualizar antigo'))
 expect(screen.getByTestId('open').textContent).toBe('true')
 fireEvent.click(screen.getByText('Pronto old.fm'))
 fireEvent.click(screen.getByText('Salvar'))
 expect(screen.getByTestId('open').textContent).toBe('true')
 fireEvent.click(screen.getByText('Concluir old.fm'))
 expect(screen.getByTestId('open').textContent).toBe('true')
})
