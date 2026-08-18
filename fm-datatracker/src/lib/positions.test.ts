import { describe, expect, it } from 'vitest'
import { canPlayPosition, positionCapabilities, positionRank, positionSideRank } from './positions'

describe('ordenação por posição', () => {
  it('segue GK, D, WB, DM, M, AM, ST', () => {
    const positions = [['ST'], ['AM (C)'], ['GK'], ['DM'], ['WB (R)'], ['D (LC)'], ['M (C)']]
    expect(positions.sort((a,b)=>positionRank(a)-positionRank(b)).map(p=>p[0])).toEqual(['GK','D (LC)','WB (R)','DM','M (C)','AM (C)','ST'])
  })

  it('ordena a especificação entre parênteses por R, C, L', () => {
    const positions = [['D (LC)'], ['D (C)'], ['D (RC)']]
    expect(positions.sort((a,b)=>positionSideRank(a)-positionSideRank(b)).map(p=>p[0])).toEqual(['D (RC)','D (C)','D (LC)'])
  })

  it('aplica o lado à lista compacta completa do FM', () => {
    expect(positionCapabilities(['D, WB (R)'])).toEqual([
      { family: 'D', sides: 'R' },
      { family: 'WB', sides: 'R' },
    ])
    expect(positionCapabilities(['D (C), DM, M (C)'])).toEqual([
      { family: 'D', sides: 'C' },
      { family: 'DM', sides: 'C' },
      { family: 'M', sides: 'C' },
    ])
  })

  it('diferencia família e lado na compatibilidade', () => {
    expect(canPlayPosition(['D, WB (R)'], 'D (R)')).toBe(true)
    expect(canPlayPosition(['D, WB (R)'], 'D (L)')).toBe(false)
    expect(canPlayPosition(['D (C)'], 'D (L)')).toBe(false)
  })
})
