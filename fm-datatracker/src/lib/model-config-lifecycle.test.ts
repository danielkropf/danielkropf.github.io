import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), compatibility: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => mocks.read() }
  return query
}, rpc: (...args: unknown[]) => mocks.rpc(...args) } }))
vi.mock('./database-compatibility', () => ({ checkDatabaseCompatibility: () => mocks.compatibility(), resetDatabaseCompatibilityCache: vi.fn() }))
import { discardModelConfigState, hasDirtyModelConfig, invalidateModelConfig, loadModelConfig, patchModelConfig, peekModelConfig, scheduleModelConfigPatch } from './model-config'
import { setPrivateSession } from './private-session'

beforeEach(() => {
  setPrivateSession(null); setPrivateSession('a'); discardModelConfigState('save')
  mocks.read.mockReset(); mocks.rpc.mockReset(); mocks.compatibility.mockReset().mockResolvedValue({ status: 'current' })
})
describe('private model config lifecycle', () => {
  it('an invalidated late read cannot replace a newer loaded configuration', async () => {
    let resolve!: (value: unknown) => void
    mocks.read.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const old = loadModelConfig('save')
    const rejection = expect(old).rejects.toThrow('obsoleto')
    invalidateModelConfig('save')
    mocks.read.mockResolvedValueOnce({ data: [{ id: 'new', config: { revision: 2 } }], error: null })
    expect(await loadModelConfig('save')).toEqual({ revision: 2 })
    resolve({ data: [{ id: 'old', config: { revision: 1 } }], error: null })
    await rejection
    expect(peekModelConfig('save')).toEqual({ revision: 2 })
  })
  it('cancels an autosave queued before switching users', async () => {
    vi.useFakeTimers()
    try {
      scheduleModelConfigPatch('save', 'v1', { planning: { private: 'a' } })
      expect(hasDirtyModelConfig('save')).toBe(true)
      setPrivateSession('b')
      await vi.runAllTimersAsync()
      expect(hasDirtyModelConfig('save')).toBe(false)
      expect(peekModelConfig('save')).toBeNull()
      expect(mocks.rpc).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('rejects an in-flight response after deletion instead of resurrecting deleted state', async () => {
    let resolve!: (value: unknown) => void
    mocks.rpc.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const write = patchModelConfig('save', 'v1', { planning: { id: 'a' } })
    const rejected = expect(write).rejects.toThrow('descartado')
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce())
    discardModelConfigState('save')
    resolve({ data: { id: 'model', config: { planning: { id: 'a' } } }, error: null })
    await rejected
    expect(peekModelConfig('save')).toBeNull()
    expect(hasDirtyModelConfig('save')).toBe(false)
  })
})
