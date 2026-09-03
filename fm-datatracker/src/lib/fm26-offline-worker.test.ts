import { describe, expect, it } from 'vitest'
import { buildOfflineWorkerResult } from './fm26-offline-worker'
import type { OfflineFmRead } from './fm26-offline-normalizer'

describe('FM26 offline worker result contract', () => {
  it('transports competition_history while keeping raw outside the worker result envelope', () => {
    const competitionHistory = {
      version: 'fm26-competition-history-v1',
      status: 'partial',
      seasons: [],
      diagnostics: { warnings: ['synthetic'] },
    }
    const input = {
      raw: { private_reader_diagnostics: true },
      players: [],
      tactics: [],
      diagnostics: { human_manager_count: 0 },
      snapshot_date: '2028-06-30',
      snapshot_date_precision: 'day',
      competition_history: competitionHistory,
    } as unknown as OfflineFmRead

    const result = buildOfflineWorkerResult(input)

    expect(result.competition_history).toEqual(competitionHistory)
    expect(result).not.toHaveProperty('raw')
    expect(result).toMatchObject({
      players: [],
      tactics: [],
      diagnostics: { human_manager_count: 0 },
      snapshot_date: '2028-06-30',
      snapshot_date_precision: 'day',
    })
  })
})
