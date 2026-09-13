import { assertPrivateSession, onPrivateSessionChange, privateSessionGeneration } from './private-session'

type Entry = { saveId: string; expires: number; value?: unknown; promise?: Promise<unknown> }
const entries = new Map<string, Entry>()
const TTL = 5 * 60_000
const LIMIT = 128
let epoch = 0
const revisions = new Map<string, number>()
const keyOf = (saveId: string, parts: unknown[]) => JSON.stringify([saveId, ...parts])
function keep(key: string, entry: Entry) {
  entries.delete(key); entries.set(key, entry)
  while (entries.size > LIMIT) entries.delete(entries.keys().next().value!)
}
export function peekSaveRead<T>(saveId: string, parts: unknown[]): T | undefined {
  const key = keyOf(saveId, parts); const entry = entries.get(key)
  if (!entry) return undefined
  if (entry.expires <= Date.now()) { entries.delete(key); return undefined }
  keep(key, entry)
  return entry.value as T | undefined
}
export function rememberSaveRead<T>(saveId: string, parts: unknown[], value: T) {
  keep(keyOf(saveId, parts), { saveId, expires: Date.now() + TTL, value })
}
export function loadSaveRead<T>(saveId: string, parts: unknown[], read: () => Promise<T>, retain: (value: T) => boolean = () => true): Promise<T> {
  const key = keyOf(saveId, parts); const cached = entries.get(key)
  if (cached && cached.expires > Date.now()) { keep(key, cached); return cached.promise as Promise<T> ?? Promise.resolve(cached.value as T) }
  const generation = privateSessionGeneration()
  const currentEpoch = epoch; const revision = revisions.get(saveId) ?? 0
  const entry: Entry = { saveId, expires: Date.now() + TTL }
  const promise = Promise.resolve().then(read).then(value => {
    assertPrivateSession(generation)
    if (epoch !== currentEpoch || (revisions.get(saveId) ?? 0) !== revision) throw new Error('Os dados do save mudaram; a leitura anterior foi descartada.')
    if (entries.get(key) === entry) {
      if (retain(value)) { entry.value = value; entry.expires = Date.now() + TTL }
      else entries.delete(key)
    }
    return value
  }).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error })
  entry.promise = promise; keep(key, entry)
  return promise
}
export function invalidateSaveReads(saveId?: string) {
  if (saveId) revisions.set(saveId, (revisions.get(saveId) ?? 0) + 1)
  else { epoch++; revisions.clear() }
  for (const [key, entry] of entries) if (!saveId || entry.saveId === saveId) entries.delete(key)
}
onPrivateSessionChange(() => invalidateSaveReads())
