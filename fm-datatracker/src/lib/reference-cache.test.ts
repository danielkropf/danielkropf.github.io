import { describe, expect, it } from 'vitest'
import { createReferenceDatasetLoader, isReferenceDataset } from './reference-cache'

const validDataset = {
  version: 1,
  generatedAt: '2026-08-28T00:00:00.000Z',
  attributes: ['passing'],
  markets: [{ country: 'Brasil', division: 1, count: 1 }],
  players: [{ c: 'Brasil', d: 1, a: 20, p: 'M (C)', v: [15] }],
}

describe('reference dataset cache', () => {
  it('permite retry depois da primeira falha', async () => {
    let calls = 0
    const loader = createReferenceDatasetLoader(
      () => '/reference/players.v1.json',
      async () => {
        calls += 1
        if (calls === 1) throw new Error('offline')
        return { ok: true, json: async () => validDataset }
      },
    )

    await expect(loader()).resolves.toBeNull()
    await expect(loader()).resolves.toEqual(validDataset)
    expect(calls).toBe(2)
  })

  it('não mantém asset estruturalmente inválido em cache', async () => {
    let calls = 0
    const loader = createReferenceDatasetLoader(
      () => '/reference/players.v1.json',
      async () => {
        calls += 1
        return { ok: true, json: async () => calls === 1 ? { version: 1 } : validDataset }
      },
    )

    await expect(loader()).resolves.toBeNull()
    await expect(loader()).resolves.toEqual(validDataset)
    expect(calls).toBe(2)
  })

  it('valida a estrutura mínima sem inventar versão ou hash novos', () => {
    expect(isReferenceDataset(validDataset)).toBe(true)
    expect(isReferenceDataset({ ...validDataset, players: [{}] })).toBe(false)
    expect(isReferenceDataset({ ...validDataset, attributes: [123] })).toBe(false)
    expect(isReferenceDataset({ ...validDataset, players: [{ ...validDataset.players[0], v: [] }] })).toBe(false)
    expect(isReferenceDataset({ ...validDataset, players: [{ ...validDataset.players[0], v: ['15'] }] })).toBe(false)
  })
})
