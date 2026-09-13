import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { invalidateSaveReads, loadSaveRead, peekSaveRead, rememberSaveRead } from './save-read-cache'
import { setPrivateSession } from './private-session'
beforeEach(() => invalidateSaveReads())
afterEach(() => vi.useRealTimers())
it('shares concurrent requests and reuses successful data per save and resource', async () => {
  const read = vi.fn().mockResolvedValue([1])
  await Promise.all([loadSaveRead('a',['p'],read),loadSaveRead('a',['p'],read)])
  await loadSaveRead('a',['p'],read)
  expect(read).toHaveBeenCalledTimes(1)
  await loadSaveRead('b',['p'],read)
  expect(read).toHaveBeenCalledTimes(2)
})
it('retries failures and partial responses instead of retaining them', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(2)
  await expect(loadSaveRead('a',[],read)).rejects.toThrow('offline')
  expect(await loadSaveRead('a',[],read)).toBe(2)
  await loadSaveRead('a',['partial'],read,()=>false)
  expect(peekSaveRead('a',['partial'])).toBeUndefined()
})
it('expires and evicts old data with bounded memory', () => {
  vi.useFakeTimers()
  rememberSaveRead('a',['p'],1)
  vi.advanceTimersByTime(300001)
  expect(peekSaveRead('a',['p'])).toBeUndefined()
  for(let i=0;i<129;i++) rememberSaveRead('a',[i],i)
  expect(peekSaveRead('a',[0])).toBeUndefined()
  expect(peekSaveRead('a',[128])).toBe(128)
})
it('discards an in-flight read after save invalidation or account change', async () => {
  let finish!: (n:number)=>void
  const request = loadSaveRead('a',[],()=>new Promise<number>(resolve=>{finish=resolve}))
  await Promise.resolve()
  invalidateSaveReads('a');finish(1)
  await expect(request).rejects.toThrow('save mudaram')
  expect(peekSaveRead('a',[])).toBeUndefined()
  rememberSaveRead('a',[],3)
  setPrivateSession('other-account')
  expect(peekSaveRead('a',[])).toBeUndefined()
})
