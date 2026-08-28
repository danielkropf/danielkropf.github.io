import { describe, expect, it } from 'vitest'
import { createLatestSaveRequestGuard } from './latest-save-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function observed<T>(guard: ReturnType<typeof createLatestSaveRequestGuard>, saveId: string, promise: Promise<T>) {
  const token = guard.begin(saveId)
  try {
    const value = await promise
    return guard.isCurrent(token) ? { kind: 'value' as const, saveId, value } : { kind: 'stale' as const }
  } catch (error) {
    return guard.isCurrent(token) ? { kind: 'error' as const, saveId, error } : { kind: 'stale' as const }
  }
}

describe('latest save request guard', () => {
  it('ignora A quando A resolve depois de B', async () => {
    const guard = createLatestSaveRequestGuard()
    const a = deferred<string>()
    const b = deferred<string>()
    const resultA = observed(guard, 'A', a.promise)
    const resultB = observed(guard, 'B', b.promise)

    b.resolve('config-B')
    await expect(resultB).resolves.toEqual({ kind: 'value', saveId: 'B', value: 'config-B' })
    a.resolve('config-A')
    await expect(resultA).resolves.toEqual({ kind: 'stale' })
  })

  it('ignora também erro tardio de A depois de B', async () => {
    const guard = createLatestSaveRequestGuard()
    const a = deferred<string>()
    const b = deferred<string>()
    const resultA = observed(guard, 'A', a.promise)
    const resultB = observed(guard, 'B', b.promise)

    b.resolve('config-B')
    await expect(resultB).resolves.toEqual({ kind: 'value', saveId: 'B', value: 'config-B' })
    a.reject(new Error('late A failure'))
    await expect(resultA).resolves.toEqual({ kind: 'stale' })
  })


  it('não permite que config de A seja escrita no save B depois da troca', async () => {
    const guard = createLatestSaveRequestGuard()
    const a = deferred<{ tactics: string[] }>()
    const b = deferred<{ tactics: string[] }>()
    let currentSaveId = 'A'
    let applied: { tactics: string[] } | null = null
    const writes: Array<{ saveId: string; config: { tactics: string[] } }> = []

    const tokenA = guard.begin('A')
    const loadA = a.promise.then(config => {
      if (guard.isCurrent(tokenA)) applied = config
    })

    currentSaveId = 'B'
    const tokenB = guard.begin('B')
    const loadB = b.promise.then(config => {
      if (guard.isCurrent(tokenB)) applied = config
    })

    b.resolve({ tactics: ['B'] })
    await loadB
    if (applied) writes.push({ saveId: currentSaveId, config: applied })

    a.resolve({ tactics: ['A'] })
    await loadA
    if (applied) writes.push({ saveId: currentSaveId, config: applied })

    expect(writes).toEqual([
      { saveId: 'B', config: { tactics: ['B'] } },
      { saveId: 'B', config: { tactics: ['B'] } },
    ])
    expect(writes.some(write => write.saveId === 'B' && write.config.tactics.includes('A'))).toBe(false)
  })

  it('invalida uma requisição no cleanup mesmo sem novo save', () => {
    const guard = createLatestSaveRequestGuard()
    const token = guard.begin('A')
    expect(guard.isCurrent(token)).toBe(true)
    guard.invalidate(token)
    expect(guard.isCurrent(token)).toBe(false)
  })
})
