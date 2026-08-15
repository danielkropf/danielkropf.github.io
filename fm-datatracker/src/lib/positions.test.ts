import { describe, expect, it } from 'vitest'
import { positionRank } from './positions'

describe('ordenação por posição', () => {
  it('segue GK, D, WB, DM, M, AM, ST', () => {
    const positions = [['ST'], ['AM (C)'], ['GK'], ['DM'], ['WB (R)'], ['D (LC)'], ['M (C)']]
    expect(positions.sort((a,b)=>positionRank(a)-positionRank(b)).map(p=>p[0])).toEqual(['GK','D (LC)','WB (R)','DM','M (C)','AM (C)','ST'])
  })
})
