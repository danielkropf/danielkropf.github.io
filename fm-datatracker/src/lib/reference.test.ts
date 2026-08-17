import{describe,expect,it}from'vitest'
import{normalizeCountry,percentile,positionFamily,referenceLevel}from'./reference'

describe('base de referência',()=>{
  it('normaliza países em português e inglês',()=>{expect(normalizeCountry('Brazil')).toBe('brasil');expect(normalizeCountry('França')).toBe('franca')})
  it('identifica a primeira linha posicional',()=>{expect(positionFamily('D/WB/M (L)')).toBe('D');expect(positionFamily(['AM (R)','ST (C)'])).toBe('AM')})
  it('calcula percentil e faixa de nível',()=>{expect(percentile(15,[5,10,15,20])).toBe(75);expect(referenceLevel(75)).toBe('Bom');expect(referenceLevel(96)).toBe('Elite')})
})
