import { describe, expect, it } from 'vitest'
import { functionProjectionKey, generalProjectionKey, projectionAbilityFacts, snapshotProjectionFacts } from './projection-player'

const trustedNormalized = (ca = 132, pa = 166) => ({
  source: 'fm26-save-offline',
  ca_pa_status: 'candidate_with_provenance_not_universally_validated',
  fm_hidden: { current_ability: ca, potential_ability: pa, professionalism: 18, ambition: 14 },
})

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  snapshot_date: '2026-08-26',
  positions: ['M (C)'],
  raw_data: { birth_date: '2008-01-01' },
  normalized_data: trustedNormalized(),
  player_attributes: [{ attribute_key: 'determination', value: 16 }],
  ...overrides,
})

describe('projection player facts v2.1', () => {
  it('mantém chaves gerais estáveis para compatibilidade', () => {
    expect(generalProjectionKey(['GK'])).toBe('GK')
    expect(generalProjectionKey(['D (C)', 'DM (C)'])).toBe('OUTFIELD')
  })

  it('cria chave funcional estável por fase, posição e função', () => {
    expect(functionProjectionKey([{ phase: 'IP', position: 'D (L)', roleCode: 'FB' }, { phase: 'OOP', position: 'WB (L)', roleCode: 'WB' }])).toBe('IP:D(L):FB|OOP:WB(L):WB')
  })

  it('aceita somente a fonte/status .fm explicitamente permitidos', () => {
    const facts = snapshotProjectionFacts(snapshot())
    expect(facts.ca).toBe(132)
    expect(facts.pa).toBe(166)
    expect(facts.caFact).toMatchObject({
      value: 132,
      origin: 'fm26-save-offline',
      namespace: 'normalized_data.fm_hidden',
      status: 'candidate_with_provenance_not_universally_validated',
      confidence: 'experimental_candidate',
    })
    expect(facts.abilityAvailable).toBe(true)
    expect(facts.professionalism).toBe(18)
    expect(facts.ambition).toBe(14)
    expect(facts.determination).toBe(16)
    expect(facts.birthDate).toBe('2008-01-01')
    expect(facts.personalitySource).toBe('exact')
  })

  it('ignora CA/PA preservados de CSV/PlayerExport', () => {
    const abilities = projectionAbilityFacts(snapshot({
      raw_data: { birth_date: '2008-01-01', current_ability: 199, potential_ability: 200, ca: 198, pa: 199 },
      normalized_data: { current_ability: 197, potential_ability: 198, ca_candidate: 196, pa_candidate: 197 },
    }))
    expect(abilities.available).toBe(false)
    expect(abilities.ca.value).toBeNull()
    expect(abilities.pa.value).toBeNull()
    expect(abilities.reason).toMatch(/provenance/i)
  })

  it('ignora campo genérico ou spoofed mesmo com nomes reconhecíveis', () => {
    const abilities = projectionAbilityFacts(snapshot({
      raw_data: { current_ability: 190, potential_ability: 195 },
      normalized_data: {
        source: 'csv-only',
        ca_pa_status: 'candidate_with_provenance_not_universally_validated',
        current_ability: 190,
        potential_ability: 195,
        fm_hidden: { current_ability: 190, potential_ability: 195 },
      },
    }))
    expect(abilities.available).toBe(false)
    expect(abilities.ca.origin).toBeNull()
  })

  it('rejeita provenance/status .fm não autorizado', () => {
    const abilities = projectionAbilityFacts(snapshot({
      normalized_data: {
        source: 'fm26-save-offline',
        ca_pa_status: 'confirmed',
        fm_hidden: { current_ability: 132, potential_ability: 166 },
      },
    }))
    expect(abilities.available).toBe(false)
    expect(abilities.ca.reason).toMatch(/status de confiança/i)
  })

  it('não aceita alias top-level mesmo quando a provenance geral é válida', () => {
    const abilities = projectionAbilityFacts(snapshot({
      normalized_data: {
        source: 'fm26-save-offline',
        ca_pa_status: 'candidate_with_provenance_not_universally_validated',
        current_ability: 132,
        potential_ability: 166,
        ca_candidate: 132,
        pa_candidate: 166,
      },
    }))
    expect(abilities.available).toBe(false)
    expect(abilities.ca.reason).toMatch(/não está disponível/i)
  })

  it('ausência de input confiável produz indisponibilidade explícita', () => {
    const facts = snapshotProjectionFacts(snapshot({ normalized_data: {} }))
    expect(facts.ca).toBeNull()
    expect(facts.pa).toBeNull()
    expect(facts.abilityAvailable).toBe(false)
    expect(facts.abilityUnavailableReason).toBeTruthy()
    expect(facts.personalitySource).toBe('neutral')
  })
})
