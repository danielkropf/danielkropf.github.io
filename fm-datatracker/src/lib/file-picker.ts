export type ImportFileKind = 'csv' | 'fm'

type PickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    startIn?: FileSystemDirectoryHandle
    id?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandle[]>
}
type StoredDirectory = FileSystemDirectoryHandle & {
  requestPermission?: (options?: { mode?: 'read' }) => Promise<PermissionState>
}

const DB_NAME = 'fm-datatracker-file-picker'
const STORE_NAME = 'directories'
const NAME_PREFIX = 'fm-datatracker-file-picker-name:'
export const IMPORT_DIRECTORY_CHANGED = 'fm-datatracker-import-directory-changed'
const memoryDirectories = new Map<ImportFileKind, FileSystemDirectoryHandle>()

const storedName = (kind: ImportFileKind) => {
  try { return localStorage.getItem(`${NAME_PREFIX}${kind}`) } catch { return null }
}
const rememberName = (kind: ImportFileKind, name: string) => {
  try { localStorage.setItem(`${NAME_PREFIX}${kind}`, name) } catch { /* display preference is optional */ }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getDirectory(kind: ImportFileKind): Promise<FileSystemDirectoryHandle | null> {
  const inMemory = memoryDirectories.get(kind)
  if (inMemory) return inMemory
  try {
    const database = await openDatabase()
    const directory = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(kind)
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
    if (directory) memoryDirectories.set(kind, directory)
    return directory
  } catch {
    return null
  }
}

async function persistDirectory(kind: ImportFileKind, directory: FileSystemDirectoryHandle): Promise<void> {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(directory, kind)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch { /* The selected folder continues to work during this session. */ }
}

function setDirectory(kind: ImportFileKind, directory: FileSystemDirectoryHandle): void {
  memoryDirectories.set(kind, directory)
  rememberName(kind, directory.name)
  window.dispatchEvent(new CustomEvent(IMPORT_DIRECTORY_CHANGED, { detail: { kind, name: directory.name } }))
  void persistDirectory(kind, directory)
}

export function supportsPersistentFilePicker(): boolean {
  const picker = window as PickerWindow
  return Boolean(picker.showDirectoryPicker && picker.showOpenFilePicker)
}

export async function getImportDirectoryName(kind: ImportFileKind): Promise<string | null> {
  return (await getDirectory(kind))?.name ?? storedName(kind)
}

export async function chooseImportDirectory(kind: ImportFileKind): Promise<string | null> {
  const picker = window as PickerWindow
  if (!picker.showDirectoryPicker) return null
  const directory = await picker.showDirectoryPicker({ mode: 'read' })
  setDirectory(kind, directory)
  return directory.name
}

export async function chooseImportFile(kind: ImportFileKind): Promise<File | null> {
  const picker = window as PickerWindow
  if (!picker.showOpenFilePicker) return null
  const directory = await getDirectory(kind)
  const accept: { description: string; accept: Record<string, string[]> } = kind === 'csv'
    ? { description: 'Arquivo CSV', accept: { 'text/csv': ['.csv'] } }
    : { description: 'Save do Football Manager', accept: { 'application/octet-stream': ['.fm'] } }
  try {
    // A persisted directory must win over Chromium's generic last-used folder.
    // Do not pass `id` here: Chromium may restore an id's remembered location
    // before honoring startIn, which defeats the explicit user preference.
    if (directory) {
      const stored = directory as StoredDirectory
      const permission = await stored.requestPermission?.({ mode: 'read' })
      if (permission === 'denied') throw new Error(`A permissão para a pasta padrão de ${kind.toUpperCase()} foi negada. Defina-a novamente.`)
    }
    const [handle] = await picker.showOpenFilePicker({ multiple: false, startIn: directory ?? undefined, types: [accept] })
    return handle ? await handle.getFile() : null
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}
