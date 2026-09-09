// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ selected: { id: 'save-a', name: 'A' }, parse: vi.fn() }))
vi.mock('../saves/SaveContext', () => ({ useSaves: () => ({ selected: mocks.selected }) }))
vi.mock('../../lib/importer', async original => ({ ...await original<typeof import('../../lib/importer')>(), parseCsvFile: (...args: unknown[]) => mocks.parse(...args) }))
vi.mock('../../lib/file-picker', () => ({ IMPORT_DIRECTORY_CHANGED: 'dir-change', getImportDirectoryName: async () => null, supportsPersistentFilePicker: () => false, chooseImportFile: vi.fn(), chooseImportDirectory: vi.fn() }))
import { ImportPanel } from './ImportPanel'
const preview = (rows: number) => ({ headers: ['Name'], detectedAttributes: [], ignoredColumns: [], rows: [{ Name: 'Example' }], rowCount: rows, fileType: 'squad', warnings: [], delimiter: ',' })
beforeEach(() => { mocks.selected = { id: 'save-a', name: 'A' }; mocks.parse.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('import scope and asynchronous input', () => {
  it('keeps the latest CSV result when an earlier file finishes afterwards', async () => {
    let resolve!: (value: unknown) => void
    mocks.parse.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce(preview(2))
    const { container } = render(<ImportPanel />)
    const input = container.querySelector('input[type="file"][accept*="csv"]')!
    fireEvent.change(input, { target: { files: [new File(['a'], 'first.csv')] } })
    fireEvent.change(input, { target: { files: [new File(['b'], 'second.csv')] } })
    expect(await screen.findByText('2 linhas e 1 dados detectados.')).not.toBeNull()
    await act(async () => resolve(preview(9)))
    expect(screen.queryByText('9 linhas e 1 dados detectados.')).toBeNull()
    expect(screen.getByText('second.csv')).not.toBeNull()
  })
  it('clears selected files on save change and ignores the old pending read', async () => {
    let resolve!: (value: unknown) => void
    mocks.parse.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const view = render(<ImportPanel />)
    fireEvent.change(view.container.querySelector('input[type="file"][accept*="csv"]')!, { target: { files: [new File(['a'], 'private-a.csv')] } })
    mocks.selected = { id: 'save-b', name: 'B' }; view.rerender(<ImportPanel />)
    await act(async () => resolve(preview(9)))
    expect(screen.queryByText('private-a.csv')).toBeNull()
    expect(screen.queryByText('9 linhas e 1 dados detectados.')).toBeNull()
    expect(screen.getByText('Escolher CSV')).not.toBeNull()
  })
  it('terminates the FM worker when the import scope unmounts', async () => {
    const terminate = vi.fn(), postMessage = vi.fn()
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage = postMessage })
    const view = render(<ImportPanel />)
    const file = new File(['fm'], 'private.fm'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
    fireEvent.change(view.container.querySelector('input[type="file"][accept*=".fm"]')!, { target: { files: [file] } })
    await waitFor(() => expect(postMessage).toHaveBeenCalledOnce())
    view.unmount()
    expect(terminate).toHaveBeenCalledOnce()
  })
})
