import { describe, expect, it } from 'vitest'
import { functionProjectionKey, generalProjectionKey, snapshotProjectionFacts } from './projection-player'

describe('projection player facts v2.1', () => {
  it('mantém chaves gerais estáveis para compatibilidade', () => {
    expect(generalProjectionKey(['GK'])).toBe('GK')
    expect(generalProjectionKey(['D (C)', 'DM (C)'])).toBe('OUTFIELD')
  })
  it('cria chave funcional estável por fase, posição e função', () => {
    expect(functionProjectionKey([{ phase: 'IP', position: 'D (L)', roleCode: 'FB' }, { phase: 'OOP', position: 'WB (L)', roleCode: 'WB' }])).toBe('IP:D(L):FB|OOP:WB(L):WB')
  })
  it('extrai CA, PA e personalidade separadamente', () => {
    const facts = snapshotProjectionFacts({ snapshot_date: '2026-08-26', positions: ['M (C)'], raw_data: { birth_date: '2008-01-01' }, normalized_data: { fm_hidden: { current_ability: 132, potential_ability: 166, professionalism: 18, ambition: 14 } }, player_attributes: [{ attribute_key: 'determination', value: 16 }] })
    expect(facts.ca).toBe(132); expect(facts.pa).toBe(166); expect(facts.professionalism).toBe(18); expect(facts.ambition).toBe(14); expect(facts.determination).toBe(16); expect(facts.birthDate).toBe('2008-01-01'); expect(facts.personalitySource).toBe('exact')
  })
  it('usa baseline neutro quando a personalidade escondida não existe', () => {
    const facts = snapshotProjectionFacts({ snapshot_date: '2026-08-26', positions: ['M (C)'], raw_data: { birth_date: '2008-01-01' }, normalized_data: { current_ability: 120, potential_ability: 150 }, player_attributes: [] })
    expect(facts.ca).toBe(120); expect(facts.pa).toBe(150); expect(facts.personalitySource).toBe('neutral')
  })
})
