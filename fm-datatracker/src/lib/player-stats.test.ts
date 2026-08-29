import{describe,expect,it}from'vitest'
import{statContextLabel,statMetricEntries,statsSample}from'./player-stats'

describe('player stats analyzer helpers',()=>{
  it('confidence representa somente tamanho da amostra',()=>{
    expect(statsSample(0)).toEqual({minutes:0,confidence:0,label:'Sem amostra'})
    expect(statsSample(1800).confidence).toBe(1)
    expect(statsSample(450).confidence).toBeCloseTo(.5)
  })
  it('não inventa contexto ausente',()=>{
    expect(statContextLabel({season:null,competition:null,team:null,snapshot_date:'2032-07-01'})).toBe('2032-07-01')
    expect(statContextLabel({season:'2031/32',competition:null,team:'Numantia',snapshot_date:'2032-07-01'})).toBe('2031/32 · Numantia')
  })
  it('oculta campos estruturais da lista de métricas',()=>{
    const rows=statMetricEntries({normalized_stats:{team:'Numantia',minutes:900,avg_rating:'7.12',goals:'5'}} as never)
    expect(rows.map(item=>item.key)).toEqual(['avg_rating','goals'])
  })
})
