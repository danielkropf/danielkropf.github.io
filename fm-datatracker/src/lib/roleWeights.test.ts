import{describe,expect,it}from'vitest'
import{ATTRIBUTE_CATALOG}from'./attributes'
import{ROLE_WEIGHT_MATRIX,roleDefaultWeights}from'./roleWeights'

describe('matriz de pesos FM26 v1.0',()=>{
  it('contém 69 funções com todos os 47 atributos',()=>{
    expect(Object.keys(ROLE_WEIGHT_MATRIX)).toHaveLength(69)
    expect(Object.values(ROLE_WEIGHT_MATRIX).every(weights=>Object.keys(weights).length===ATTRIBUTE_CATALOG.length)).toBe(true)
  })
  it('restaura o padrão específico da função',()=>{
    const weights=roleDefaultWeights('IP-GK-BPGK','Ball-Playing Goalkeeper')
    expect(weights.passing).toBe(4)
    expect(weights.kicking).toBe(5)
    expect(weights.finishing).toBe(1)
  })
})
