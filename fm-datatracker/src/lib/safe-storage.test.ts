import { afterEach, expect, it, vi } from 'vitest'
import { safeStorage } from './safe-storage'
afterEach(() => vi.unstubAllGlobals())
it('keeps unavailable browser preferences from breaking save selection', () => {
  const fail = () => { throw new Error('storage denied') }
  vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
  expect(safeStorage.getItem('save')).toBeNull()
  expect(() => safeStorage.setItem('save', 'id')).not.toThrow()
  expect(() => safeStorage.removeItem('save')).not.toThrow()
})
