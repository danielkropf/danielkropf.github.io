import { describe, expect, it } from 'vitest'
import { createSaveRefreshRequestGuard, resolveSaveRefresh } from './save-refresh'

describe('save refresh reconciliation', () => {
  it('preserva o last-known-good e não altera a chave ativa em falha transitória', () => {
    const saveA = { id: 'save-a', name: 'A' }
    const saveB = { id: 'save-b', name: 'B' }
    const result = resolveSaveRefresh({
      currentSaves: [saveA, saveB],
      currentSelected: saveB,
      rememberedId: 'save-b',
      data: null,
      error: 'network timeout',
    })
    expect(result.saves).toEqual([saveA, saveB])
    expect(result.selected).toBe(saveB)
    expect(result.error).toBe('network timeout')
    expect(result.persistActiveSaveId).toBeUndefined()
  })

  it('só remove a seleção depois de uma resposta vazia bem-sucedida', () => {
    const saveA = { id: 'save-a', name: 'A' }
    const result = resolveSaveRefresh({
      currentSaves: [saveA],
      currentSelected: saveA,
      rememberedId: 'save-a',
      data: [],
      error: null,
    })
    expect(result.saves).toEqual([])
    expect(result.selected).toBeNull()
    expect(result.persistActiveSaveId).toBeNull()
  })
})


describe('save refresh request guard', () => {
  it('ignora uma resposta antiga quando dois refreshes terminam fora de ordem', () => {
    const guard = createSaveRefreshRequestGuard()
    const first = guard.begin()
    const second = guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('invalida refresh pendente no unmount', () => {
    const guard = createSaveRefreshRequestGuard()
    const token = guard.begin()
    guard.invalidate()
    expect(guard.isCurrent(token)).toBe(false)
  })
})
