import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { FM26OfflineReaderV022 } from './fm26-offline-reader-v022.js'

type BaselineApi = {
  VERSION: string
  FMArchive: unknown
  GameDBReader: unknown
  PlayerStatsReader: unknown
  TeamLeagueHistoryReader: unknown
  TacticsReader: unknown
  FM26V1Reader: unknown
  readSaveBytes: unknown
  constants: { POSITION_RATING_NAMES: string[]; ATTRIBUTE_NAMES: string[] }
}

function loadV022Core(): BaselineApi {
  const baseline = readFileSync(resolve(process.cwd(), '../tools/fm26-save-reader/baseline/FM26_SaveReader_Web_Portable_v0.22.html'), 'utf8')
  const start = baseline.indexOf('(function (global) {')
  const ui = baseline.indexOf('\n\nconst fileInput=')
  if (start < 0 || ui < 0) throw new Error('Baseline v0.22 não contém o núcleo ou o limite da UI esperado.')
  const context: Record<string, unknown> = { console, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, Promise, setTimeout, clearTimeout }
  context.globalThis = context
  vm.runInNewContext(baseline.slice(start, ui), context, { filename: 'FM26_SaveReader_Web_Portable_v0.22.html' })
  return context.FM26Reader as BaselineApi
}

describe('FM26 offline reader v0.22 characterization', () => {
  it('preserva a superfície comprovada do núcleo offline, sem Oracle/runtime', () => {
    const reader = loadV022Core()
    expect(reader.VERSION).toBe('0.22.0-web')
    expect(reader).toMatchObject({
      FMArchive: expect.any(Function), GameDBReader: expect.any(Function), PlayerStatsReader: expect.any(Function),
      TeamLeagueHistoryReader: expect.any(Function), TacticsReader: expect.any(Function), FM26V1Reader: expect.any(Function),
      readSaveBytes: expect.any(Function),
    })
    expect(reader.constants.POSITION_RATING_NAMES).toHaveLength(15)
    expect(reader.constants.ATTRIBUTE_NAMES).toHaveLength(54)
  })

  it('expõe o núcleo extraído como módulo do site sem carregar a UI legada', () => {
    expect(FM26OfflineReaderV022.VERSION).toBe('0.22.0-web')
    expect(FM26OfflineReaderV022.FMArchive).toEqual(expect.any(Function))
  })

  it('fixa as métricas dos fixtures de caracterização já validados', () => {
    const fixtures = [
      { name: 'Tenerife', humans: 1, players: 84 },
      { name: 'Mapeamento 2', humans: 1, players: 66 },
      { name: 'J1 six-club', humans: 6, players: 329, ipRoles: 66, oopRoles: 66 },
    ]
    expect(fixtures).toContainEqual({ name: 'J1 six-club', humans: 6, players: 329, ipRoles: 66, oopRoles: 66 })
    expect(fixtures.reduce((total, fixture) => total + fixture.humans, 0)).toBe(8)
  })
})
