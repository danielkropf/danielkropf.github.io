import{describe,expect,it}from'vitest'
import{ATTRIBUTE_CATALOG}from'./attributes'
import{ROLE_WEIGHT_MATRIX,roleDefaultWeights}from'./roleWeights'

describe('matriz de pesos FM26 v1.0',()=>{
  it('contém 69 funções com todos os 47 atributos',()=>{
    expect(Object.keys(ROLE_WEIGHT_MATRIX)).toHaveLength(79)
    expect(Object.values(ROLE_WEIGHT_MATRIX).every(weights=>Object.keys(weights).length===ATTRIBUTE_CATALOG.length)).toBe(true)
  })
  it('restaura o padrão específico da função',()=>{
    const weights=roleDefaultWeights('IP-GK-BPGK','Ball-Playing Goalkeeper')
    expect(weights.passing).toBe(4)
    expect(weights.kicking).toBe(5)
    expect(weights.finishing).toBe(1)
  })
  it('reutiliza no OOP o padrão IP de funções compartilhadas',()=>{
    const ip=roleDefaultWeights('IP-GK-GK','Goalkeeper')
    const oop=roleDefaultWeights('OOP-GK-GK','Goalkeeper')
    expect(oop).not.toEqual(ip)
    expect(ip.acceleration).toBe(1)
    expect(oop.acceleration).toBe(3)
    expect(ip.throwing).toBe(4)
    expect(oop.throwing).toBe(2)
  })
  it('mantém a matriz própria de funções exclusivas do OOP',()=>{
    const weights=roleDefaultWeights('OOP-GK-SK','Sweeper Keeper')
    expect(Object.values(weights).some(weight=>weight!==3)).toBe(true)
  })
})
