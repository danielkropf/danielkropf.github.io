import { describe, expect, it } from 'vitest'
import { createLatestSaveRequestGuard } from '../lib/latest-save-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

async function applyIfCurrent<T>(
  guard: ReturnType<typeof createLatestSaveRequestGuard>,
  saveId: string,
  promise: Promise<T>,
  apply: (value: T) => void,
) {
  const token = guard.begin(saveId)
  const value = await promise
  if (guard.isCurrent(token)) apply(value)
}

describe('save-scoped page loads', () => {
  it('ImportsPage não deixa o histórico do save A sobrescrever o save B', async () => {
    const guard = createLatestSaveRequestGuard()
    const a = deferred<string[]>()
    const b = deferred<string[]>()
    let rendered: string[] = []

    const loadA = applyIfCurrent(guard, 'A', a.promise, value => { rendered = value })
    const loadB = applyIfCurrent(guard, 'B', b.promise, value => { rendered = value })

    b.resolve(['import-B'])
    await loadB
    a.resolve(['import-A'])
    await loadA

    expect(rendered).toEqual(['import-B'])
  })

  it('QualityPage não deixa a auditoria do save A sobrescrever o save B', async () => {
    const guard = createLatestSaveRequestGuard()
    const a = deferred<{ players: number }>()
    const b = deferred<{ players: number }>()
    let rendered = { players: 0 }

    const loadA = applyIfCurrent(guard, 'A', a.promise, value => { rendered = value })
    const loadB = applyIfCurrent(guard, 'B', b.promise, value => { rendered = value })

    b.resolve({ players: 22 })
    await loadB
    a.resolve({ players: 99 })
    await loadA

    expect(rendered).toEqual({ players: 22 })
  })
})
