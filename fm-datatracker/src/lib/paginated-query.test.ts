import { describe, expect, it } from 'vitest'
import { paginatedQuery } from './paginated-query'

describe('complete paginated reads', () => {
  it('retrieves more than 1000 rows even when the server caps each response below the requested size', async () => {
    const source = Array.from({ length: 1203 }, (_, id) => ({ id }))
    const offsets: number[] = []
    const result = await paginatedQuery(() => ({ range: async (from, to) => {
      offsets.push(from)
      return { data: source.slice(from, Math.min(to + 1, from + 200)), error: null }
    } }))
    expect(result.data).toEqual(source)
    expect(offsets).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1203])
  })
  it('rejects a failed later page instead of returning an incomplete history', async () => {
    await expect(paginatedQuery(() => ({ range: async from => from ? { data: null, error: new Error('offline') } : { data: [{ id: 1 }], error: null } }))).rejects.toThrow('offline')
  })
})
